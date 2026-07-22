import os
import uuid
import hashlib
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import jwt

from db import get_db_connection, init_db
from storage_provider import StorageProvider

# Initialize app and databases
app = Flask(__name__)
CORS(app)
init_db()

storage = StorageProvider()

JWT_SECRET = os.environ.get('JWT_SECRET', 'super-secret-key-123')

# Helper functions
def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def generate_token(user_id, username):
    payload = {
        'user_id': user_id,
        'username': username,
        'exp': datetime.utcnow() + timedelta(days=7)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm='HS256')

def login_required(f):
    def decorator(*args, **kwargs):
        token = None
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            if auth_header.startswith('Bearer '):
                token = auth_header.split(' ')[1]
        
        if not token:
            return jsonify({'message': 'Authorization token is missing'}), 401
        
        try:
            data = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
            conn = get_db_connection()
            user = conn.execute('SELECT * FROM users WHERE id = ?', (data['user_id'],)).fetchone()
            conn.close()
            if not user:
                return jsonify({'message': 'Invalid user token'}), 401
            request.user = user
        except jwt.ExpiredSignatureError:
            return jsonify({'message': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'message': 'Invalid token'}), 401
            
        return f(*args, **kwargs)
    decorator.__name__ = f.__name__
    return decorator

# --- AUTH ROUTES ---

@app.route('/api/auth/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({'message': 'Username and password are required'}), 400
        
    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
    if user:
        conn.close()
        return jsonify({'message': 'Username already exists'}), 409
        
    pwd_hash = hash_password(password)
    try:
        cursor = conn.cursor()
        cursor.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)', (username, pwd_hash))
        conn.commit()
        user_id = cursor.lastrowid
        conn.close()
        
        token = generate_token(user_id, username)
        return jsonify({'token': token, 'user': {'id': user_id, 'username': username}}), 201
    except Exception as e:
        conn.close()
        return jsonify({'message': f'Registration failed: {str(e)}'}), 500

@app.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password:
        return jsonify({'message': 'Username and password are required'}), 400
        
    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
    conn.close()
    
    if not user or user['password_hash'] != hash_password(password):
        return jsonify({'message': 'Invalid username or password'}), 401
        
    token = generate_token(user['id'], user['username'])
    return jsonify({'token': token, 'user': {'id': user['id'], 'username': user['username']}}), 200

# --- FOLDER ROUTES ---

@app.route('/api/folders/create', methods=['POST'])
@login_required
def create_folder():
    data = request.json
    name = data.get('name')
    parent_id = data.get('parent_id')  # Can be None or integer
    
    if not name:
        return jsonify({'message': 'Folder name is required'}), 400
        
    if parent_id == 'null' or parent_id == '':
        parent_id = None
        
    conn = get_db_connection()
    # Check duplicate in same level
    dup = conn.execute(
        'SELECT * FROM folders WHERE name = ? AND user_id = ? AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL))',
        (name, request.user['id'], parent_id, parent_id)
    ).fetchone()
    
    if dup:
        conn.close()
        return jsonify({'message': 'Folder with this name already exists at this location'}), 400
        
    cursor = conn.cursor()
    cursor.execute('INSERT INTO folders (name, parent_id, user_id) VALUES (?, ?, ?)', 
                   (name, parent_id, request.user['id']))
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    
    return jsonify({'id': new_id, 'name': name, 'parent_id': parent_id}), 201

@app.route('/api/folders/delete', methods=['DELETE'])
@login_required
def delete_folder():
    folder_id = request.args.get('folder_id')
    if not folder_id:
        return jsonify({'message': 'folder_id parameter is required'}), 400
        
    conn = get_db_connection()
    # Verify folder belongs to user
    folder = conn.execute('SELECT * FROM folders WHERE id = ? AND user_id = ?', (folder_id, request.user['id'])).fetchone()
    if not folder:
        conn.close()
        return jsonify({'message': 'Folder not found'}), 404
        
    # Find all files recursively in this folder and its subfolders to delete them from physical storage
    def get_child_folders(f_id):
        child_ids = [f_id]
        children = conn.execute('SELECT id FROM folders WHERE parent_id = ?', (f_id,)).fetchall()
        for child in children:
            child_ids.extend(get_child_folders(child['id']))
        return child_ids
        
    all_folder_ids = get_child_folders(folder_id)
    
    # Get all files inside these folders
    placeholders = ','.join('?' for _ in all_folder_ids)
    files = conn.execute(f'SELECT storage_key FROM files WHERE folder_id IN ({placeholders}) AND user_id = ?', 
                         (*all_folder_ids, request.user['id'])).fetchall()
    
    # Delete from physical storage
    for f in files:
        storage.delete_file(f['storage_key'])
        
    # Delete database records (Cascading will clean up files and versions if foreign keys enabled, 
    # but let's delete manually to be safe)
    cursor = conn.cursor()
    cursor.execute(f'DELETE FROM file_versions WHERE file_id IN (SELECT id FROM files WHERE folder_id IN ({placeholders}))', all_folder_ids)
    cursor.execute(f'DELETE FROM files WHERE folder_id IN ({placeholders}) AND user_id = ?', (*all_folder_ids, request.user['id']))
    cursor.execute(f'DELETE FROM folders WHERE id IN ({placeholders}) AND user_id = ?', (*all_folder_ids, request.user['id']))
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Folder and all its contents deleted successfully'}), 200

# --- FILE ROUTES ---

@app.route('/api/files/upload', methods=['POST'])
@login_required
def upload_file():
    if 'file' not in request.files:
        return jsonify({'message': 'No file part in the request'}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({'message': 'No selected file'}), 400
        
    folder_id = request.form.get('folder_id')
    if folder_id is None or folder_id == 'null' or folder_id == '':
        folder_id = None
    else:
        folder_id = int(folder_id)
        
    # Read details
    filename = file.filename
    mime_type = file.mimetype or 'application/octet-stream'
    
    # Save temporary file
    temp_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'temp')
    if not os.path.exists(temp_dir):
        os.makedirs(temp_dir)
        
    temp_filename = f"temp_{uuid.uuid4()}"
    temp_path = os.path.join(temp_dir, temp_filename)
    file.save(temp_path)
    
    file_size = os.path.getsize(temp_path)
    
    # Check if a file with the same name already exists in this folder for this user
    conn = get_db_connection()
    existing_file = conn.execute(
        'SELECT * FROM files WHERE name = ? AND user_id = ? AND (folder_id = ? OR (folder_id IS NULL AND ? IS NULL))',
        (filename, request.user['id'], folder_id, folder_id)
    ).fetchone()
    
    storage_key = f"{uuid.uuid4()}_{filename}"
    
    # Upload to storage
    upload_success = storage.upload_file(temp_path, storage_key, mime_type)
    
    # Clean up temp file
    if os.path.exists(temp_path):
        os.remove(temp_path)
        
    if not upload_success:
        conn.close()
        return jsonify({'message': 'Failed to upload file to cloud/local storage'}), 500
        
    cursor = conn.cursor()
    
    if existing_file:
        # File versioning flow:
        file_id = existing_file['id']
        old_storage_key = existing_file['storage_key']
        old_size = existing_file['size']
        old_created_at = existing_file['created_at']
        
        # 1. Archive the current file as a previous version
        # Create a nice version label like "Version 1 (2026-07-22 17:00)"
        version_label = f"Uploaded on {old_created_at}"
        cursor.execute(
            'INSERT INTO file_versions (file_id, storage_key, size, version_label, created_at) VALUES (?, ?, ?, ?, ?)',
            (file_id, old_storage_key, old_size, version_label, old_created_at)
        )
        
        # 2. Update the main file record with the new upload details
        cursor.execute(
            'UPDATE files SET storage_key = ?, size = ?, mime_type = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?',
            (storage_key, file_size, mime_type, file_id)
        )
        
        conn.commit()
        conn.close()
        return jsonify({'message': 'New version uploaded successfully', 'file_id': file_id, 'name': filename}), 200
    else:
        # Create new file entry
        cursor.execute(
            'INSERT INTO files (name, folder_id, user_id, storage_key, size, mime_type) VALUES (?, ?, ?, ?, ?, ?)',
            (filename, folder_id, request.user['id'], storage_key, file_size, mime_type)
        )
        file_id = cursor.lastrowid
        
        # Insert initial version record so there's always a full history trackable
        cursor.execute(
            'INSERT INTO file_versions (file_id, storage_key, size, version_label) VALUES (?, ?, ?, ?)',
            (file_id, storage_key, file_size, 'Initial Version')
        )
        
        conn.commit()
        conn.close()
        return jsonify({'id': file_id, 'name': filename, 'size': file_size, 'mime_type': mime_type, 'folder_id': folder_id}), 201

@app.route('/api/files/list', methods=['GET'])
@login_required
def list_directory():
    folder_id = request.args.get('folder_id')
    
    if folder_id == 'null' or folder_id == '' or folder_id is None:
        folder_id = None
    else:
        folder_id = int(folder_id)
        
    conn = get_db_connection()
    
    # Get current folder details for breadcrumbs
    current_folder = None
    if folder_id:
        folder_row = conn.execute('SELECT * FROM folders WHERE id = ? AND user_id = ?', (folder_id, request.user['id'])).fetchone()
        if folder_row:
            current_folder = dict(folder_row)
            
    # List folders in directory
    folders_query = 'SELECT * FROM folders WHERE user_id = ? AND '
    if folder_id is None:
        folders_query += 'parent_id IS NULL'
        params = (request.user['id'],)
    else:
        folders_query += 'parent_id = ?'
        params = (request.user['id'], folder_id)
        
    folders = [dict(row) for row in conn.execute(folders_query, params).fetchall()]
    
    # List files in directory
    files_query = 'SELECT * FROM files WHERE user_id = ? AND is_deleted = 0 AND '
    if folder_id is None:
        files_query += 'folder_id IS NULL'
    else:
        files_query += 'folder_id = ?'
        
    files = [dict(row) for row in conn.execute(files_query, params).fetchall()]
    
    conn.close()
    
    return jsonify({
        'current_folder': current_folder,
        'folders': folders,
        'files': files
    }), 200

@app.route('/api/files/delete', methods=['DELETE'])
@login_required
def delete_file():
    file_id = request.args.get('file_id')
    if not file_id:
        return jsonify({'message': 'file_id parameter is required'}), 400
        
    conn = get_db_connection()
    file_row = conn.execute('SELECT * FROM files WHERE id = ? AND user_id = ?', (file_id, request.user['id'])).fetchone()
    if not file_row:
        conn.close()
        return jsonify({'message': 'File not found'}), 404
        
    # Delete versions from S3/local and database
    versions = conn.execute('SELECT storage_key FROM file_versions WHERE file_id = ?', (file_id,)).fetchall()
    for v in versions:
        storage.delete_file(v['storage_key'])
        
    # Delete main file storage key just in case it is different
    storage.delete_file(file_row['storage_key'])
    
    cursor = conn.cursor()
    cursor.execute('DELETE FROM file_versions WHERE file_id = ?', (file_id,))
    cursor.execute('DELETE FROM files WHERE id = ?', (file_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'File and all its versions deleted successfully'}), 200

@app.route('/api/files/share', methods=['POST'])
@login_required
def share_file():
    data = request.json
    file_id = data.get('file_id')
    expires_in = data.get('expires_in', 3600)  # Default 1 hour
    
    if not file_id:
        return jsonify({'message': 'file_id is required'}), 400
        
    conn = get_db_connection()
    file_row = conn.execute('SELECT * FROM files WHERE id = ? AND user_id = ?', (file_id, request.user['id'])).fetchone()
    conn.close()
    
    if not file_row:
        return jsonify({'message': 'File not found'}), 404
        
    share_url = storage.generate_download_url(file_row['storage_key'], file_row['name'], expires_in)
    
    return jsonify({
        'name': file_row['name'],
        'share_url': share_url,
        'expires_in_seconds': expires_in
    }), 200

# --- VERSIONING ROUTES ---

@app.route('/api/files/versions', methods=['GET'])
@login_required
def list_versions():
    file_id = request.args.get('file_id')
    if not file_id:
        return jsonify({'message': 'file_id parameter is required'}), 400
        
    conn = get_db_connection()
    # Check permission
    file_row = conn.execute('SELECT * FROM files WHERE id = ? AND user_id = ?', (file_id, request.user['id'])).fetchone()
    if not file_row:
        conn.close()
        return jsonify({'message': 'File not found'}), 404
        
    versions = [dict(row) for row in conn.execute(
        'SELECT * FROM file_versions WHERE file_id = ? ORDER BY created_at DESC', (file_id,)
    ).fetchall()]
    conn.close()
    
    return jsonify({'versions': versions}), 200

@app.route('/api/files/versions/restore', methods=['POST'])
@login_required
def restore_version():
    data = request.json
    version_id = data.get('version_id')
    
    if not version_id:
        return jsonify({'message': 'version_id is required'}), 400
        
    conn = get_db_connection()
    version = conn.execute('SELECT * FROM file_versions WHERE id = ?', (version_id,)).fetchone()
    if not version:
        conn.close()
        return jsonify({'message': 'Version not found'}), 404
        
    # Check permissions on the file
    file_row = conn.execute('SELECT * FROM files WHERE id = ? AND user_id = ?', (version['file_id'], request.user['id'])).fetchone()
    if not file_row:
        conn.close()
        return jsonify({'message': 'Unauthorized or file not found'}), 403
        
    # Restore:
    # 1. Add current main file state as a history version before changing it
    cursor = conn.cursor()
    cursor.execute(
        'INSERT INTO file_versions (file_id, storage_key, size, version_label, created_at) VALUES (?, ?, ?, ?, ?)',
        (file_row['id'], file_row['storage_key'], file_row['size'], f"Archived before restoration on {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", file_row['created_at'])
    )
    
    # 2. Update the main file to point to the selected version's storage details
    cursor.execute(
        'UPDATE files SET storage_key = ?, size = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?',
        (version['storage_key'], version['size'], file_row['id'])
    )
    
    conn.commit()
    conn.close()
    
    return jsonify({'message': 'Version restored successfully'}), 200

# --- LOCAL FILE DOWNLOAD API ---
# This is accessed when storage provider is in local fallback mode
@app.route('/api/files/download/<storage_key>', methods=['GET'])
def download_local_file(storage_key):
    # To download locally, we map the storage_key to the file name in the DB to set attachment header
    conn = get_db_connection()
    # Search in files
    file_row = conn.execute('SELECT name FROM files WHERE storage_key = ?', (storage_key,)).fetchone()
    filename = file_row['name'] if file_row else "download"
    
    # If not found in files, search in versions
    if not file_row:
        ver_row = conn.execute(
            'SELECT files.name FROM file_versions JOIN files ON file_versions.file_id = files.id WHERE file_versions.storage_key = ?', 
            (storage_key,)
        ).fetchone()
        if ver_row:
            filename = ver_row['name']
            
    conn.close()
    
    uploads_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
    return send_from_directory(
        uploads_dir, 
        storage_key, 
        as_attachment=True, 
        download_name=filename
    )

if __name__ == '__main__':
    # Start flask app
    app.run(host='0.0.0.0', port=5000, debug=True)
