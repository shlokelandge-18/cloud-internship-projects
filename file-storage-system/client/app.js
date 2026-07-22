const API_URL = 'http://localhost:5000/api';
let token = localStorage.getItem('token');
let user = null;

try {
    user = JSON.parse(localStorage.getItem('user'));
} catch (e) {
    user = null;
}

// Global UI State
let currentFolderId = null;
let navigationHistory = []; // Breadcrumbs mapping
let currentFolders = [];
let currentFiles = [];
let activeItemId = null;
let activeItemType = null; // 'file' or 'folder'
let activeItemName = "";

// Auth Gate
if (!token || !user) {
    logout();
} else {
    // Setup UI details
    document.getElementById('user-name-display').innerText = user.username;
    document.getElementById('user-avatar').innerText = user.username.charAt(0).toUpperCase();
    
    // Load directory
    loadDirectory(null);
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = 'auth.html';
}

// Directory and Navigation Logic
async function loadDirectory(folderId) {
    currentFolderId = folderId;
    
    try {
        const response = await fetch(`${API_URL}/files/list?folder_id=${folderId || ''}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.status === 401) {
            logout();
            return;
        }

        const data = await response.json();
        
        currentFolders = data.folders || [];
        currentFiles = data.files || [];
        
        // Setup breadcrumbs list
        updateBreadcrumbs(data.current_folder);
        
        // Render files and folders
        renderContent(currentFolders, currentFiles);
        
        // Calculate storage usage
        calculateStorage();
        
    } catch (err) {
        console.error('Error fetching files:', err);
    }
}

function updateBreadcrumbs(currentFolder) {
    const bar = document.getElementById('breadcrumbs-bar');
    bar.innerHTML = '';
    
    // Root link
    const rootLi = document.createElement('li');
    rootLi.className = 'breadcrumb-item';
    const rootA = document.createElement('a');
    rootA.innerText = 'My Drive';
    rootA.onclick = () => navigateTo(null);
    rootLi.appendChild(rootA);
    bar.appendChild(rootLi);
    
    if (currentFolder) {
        // Separator
        const sep = document.createElement('span');
        sep.className = 'breadcrumb-separator';
        sep.innerHTML = ' &gt; ';
        bar.appendChild(sep);
        
        // Current folder name
        const folderLi = document.createElement('li');
        folderLi.className = 'breadcrumb-item active';
        folderLi.innerText = currentFolder.name;
        bar.appendChild(folderLi);
    }
}

function navigateTo(folderId) {
    // Close context menu if open
    closeDropdown();
    loadDirectory(folderId);
}

function renderContent(folders, files) {
    const foldersGrid = document.getElementById('folders-grid');
    const filesGrid = document.getElementById('files-grid');
    const foldersSection = document.getElementById('folders-section');
    const filesSection = document.getElementById('files-section');
    const emptyState = document.getElementById('empty-state');
    
    foldersGrid.innerHTML = '';
    filesGrid.innerHTML = '';
    
    if (folders.length === 0 && files.length === 0) {
        foldersSection.style.display = 'none';
        filesSection.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }
    
    emptyState.style.display = 'none';
    
    // Render Folders
    if (folders.length > 0) {
        foldersSection.style.display = 'block';
        folders.forEach(folder => {
            const card = document.createElement('div');
            card.className = 'folder-card glass-panel glass-panel-hover';
            card.onclick = () => navigateTo(folder.id);
            
            // Delete folder button context
            card.oncontextmenu = (e) => handleRightClick(e, folder.id, 'folder', folder.name);
            
            card.innerHTML = `
                <svg class="folder-icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path></svg>
                <span class="folder-name" title="${folder.name}">${folder.name}</span>
                <button class="file-menu-trigger" style="margin-left:auto;" onclick="event.stopPropagation(); showMenu(event, ${folder.id}, 'folder', '${folder.name}')">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                </button>
            `;
            foldersGrid.appendChild(card);
        });
    } else {
        foldersSection.style.display = 'none';
    }
    
    // Render Files
    if (files.length > 0) {
        filesSection.style.display = 'block';
        files.forEach(file => {
            const card = document.createElement('div');
            card.className = 'file-card glass-panel glass-panel-hover';
            card.onclick = () => downloadFileDirectly(file.storage_key, file.name);
            card.oncontextmenu = (e) => handleRightClick(e, file.id, 'file', file.name);
            
            const fileIcon = getFileIcon(file.mime_type);
            const sizeStr = formatBytes(file.size);
            const dateStr = new Date(file.created_at).toLocaleDateString();
            
            card.innerHTML = `
                <div class="file-card-header">
                    <div class="file-icon">${fileIcon}</div>
                    <button class="file-menu-trigger" onclick="event.stopPropagation(); showMenu(event, ${file.id}, 'file', '${file.name}')">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                    </button>
                </div>
                <div class="file-card-body">
                    <div class="file-name" title="${file.name}">${file.name}</div>
                    <div class="file-meta">
                        <span>${sizeStr}</span>
                        <span>${dateStr}</span>
                    </div>
                </div>
            `;
            filesGrid.appendChild(card);
        });
    } else {
        filesSection.style.display = 'none';
    }
}

// Icon mapper helper
function getFileIcon(mime) {
    const stroke = 'currentColor';
    if (mime.startsWith('image/')) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`;
    } else if (mime === 'application/pdf') {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
    } else if (mime.startsWith('audio/')) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`;
    } else if (mime.startsWith('video/')) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 7a2 2 0 0 0-2.45-1.45L16 7V5a2 2 0 0 0-2-2H2a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2l4.55 1.45A2 2 0 0 0 23 17V7z"></path></svg>`;
    } else if (mime.includes('zip') || mime.includes('compressed') || mime.includes('tar')) {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v3"></path><path d="M14 2v3"></path><path d="M12 5v16"></path><path d="M10 9h4"></path><path d="M10 13h4"></path><path d="M10 17h4"></path><rect x="6" y="2" width="12" height="20" rx="2" ry="2"></rect></svg>`;
    } else {
        // Generic File
        return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
    }
}

// Convert bytes to size string
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Calculate storage
function calculateStorage() {
    // Collect size from all current files as demo
    // In a full system, user profile stores total storage.
    // Let's sum up file sizes in the list to show storage progress.
    // If we want a realistic value, let's keep a simulated cumulative storage value.
    let totalBytes = currentFiles.reduce((acc, f) => acc + f.size, 0);
    // Since folders aren't fully counted, let's add a static multiplier or simulated size
    const storageLimit = 2 * 1024 * 1024 * 1024; // 2 GB
    
    // Pull historical total files sizes if possible, otherwise use local sum
    const percentage = Math.min((totalBytes / storageLimit) * 100, 100);
    
    document.getElementById('storage-percentage').innerText = `${percentage.toFixed(1)}%`;
    document.getElementById('storage-bar').style.width = `${percentage}%`;
    document.getElementById('storage-text').innerText = `${formatBytes(totalBytes)} of 2 GB used`;
}

// Search utility
function handleSearch() {
    const val = document.getElementById('search-input').value.toLowerCase().trim();
    if (val === '') {
        renderContent(currentFolders, currentFiles);
        return;
    }
    
    const filteredFolders = currentFolders.filter(f => f.name.toLowerCase().includes(val));
    const filteredFiles = currentFiles.filter(f => f.name.toLowerCase().includes(val));
    
    renderContent(filteredFolders, filteredFiles);
}

// Context Dropdown Menu Management
function showMenu(event, id, type, name) {
    event.preventDefault();
    event.stopPropagation();
    
    activeItemId = id;
    activeItemType = type;
    activeItemName = name;
    
    const dropdown = document.getElementById('actions-dropdown');
    dropdown.style.display = 'block';
    
    // Position menu
    dropdown.style.left = `${event.clientX}px`;
    dropdown.style.top = `${event.clientY}px`;
    
    // Adjust versions dropdown item for folders (folders do not have versioning)
    const verOption = document.getElementById('drop-versions');
    const shareOption = document.getElementById('drop-share');
    if (type === 'folder') {
        verOption.style.display = 'none';
        shareOption.style.display = 'none'; // Folder direct sharing not implemented
    } else {
        verOption.style.display = 'flex';
        shareOption.style.display = 'flex';
    }
}

function handleRightClick(e, id, type, name) {
    showMenu(e, id, type, name);
}

function closeDropdown() {
    const dropdown = document.getElementById('actions-dropdown');
    dropdown.style.display = 'none';
}

// Hide dropdown when clicking anywhere else
document.addEventListener('click', () => {
    closeDropdown();
});

// Modal views
function openModal(id) {
    document.getElementById('modal-overlay').style.display = 'flex';
    
    // Hide all modals first
    const modals = document.querySelectorAll('.modal');
    modals.forEach(m => m.style.display = 'none');
    
    document.getElementById(id).style.display = 'block';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
    document.getElementById('modal-overlay').style.display = 'none';
}

function closeAllModals(event) {
    if (event.target === document.getElementById('modal-overlay')) {
        document.getElementById('modal-overlay').style.display = 'none';
    }
}

// New Folder Flow
function openNewFolderModal() {
    document.getElementById('new-folder-name').value = '';
    openModal('folder-modal');
}

async function createNewFolder() {
    const folderName = document.getElementById('new-folder-name').value.trim();
    if (!folderName) return;
    
    try {
        const response = await fetch(`${API_URL}/folders/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                name: folderName,
                parent_id: currentFolderId
            })
        });
        
        if (response.ok) {
            closeModal('folder-modal');
            loadDirectory(currentFolderId);
        } else {
            const data = await response.json();
            alert(data.message || 'Failed to create folder');
        }
    } catch (e) {
        console.error(e);
    }
}

// Upload Handling
function triggerFileInput() {
    document.getElementById('file-input').click();
}

function handleFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) {
        uploadFile(files[0]);
    }
}

// Drag and drop events setup
const dropzone = document.getElementById('dropzone');
dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        uploadFile(files[0]);
    }
});

function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    if (currentFolderId) {
        formData.append('folder_id', currentFolderId);
    }
    
    const popup = document.getElementById('upload-status');
    const fill = document.getElementById('upload-status-bar');
    const text = document.getElementById('upload-status-progress');
    const title = document.getElementById('upload-status-title');
    
    title.innerText = `Uploading ${file.name}...`;
    fill.style.width = '0%';
    text.innerText = '0%';
    popup.style.display = 'block';
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_URL}/files/upload`, true);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    
    // Progress
    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            fill.style.width = `${percent}%`;
            text.innerText = `${percent}%`;
        }
    };
    
    // Complete
    xhr.onload = () => {
        popup.style.display = 'none';
        if (xhr.status === 200 || xhr.status === 201) {
            loadDirectory(currentFolderId);
        } else {
            let res = {};
            try { res = JSON.parse(xhr.responseText); } catch(err){}
            alert(res.message || 'Upload failed');
        }
    };
    
    xhr.onerror = () => {
        popup.style.display = 'none';
        alert('An error occurred during file upload.');
    };
    
    xhr.send(formData);
}

// Download local file directly
function downloadFileDirectly(key, filename) {
    // If it points to local mode server download, it's relative
    // If it's an S3 link (HTTP/S), it is absolute
    let link = `${API_URL}/files/download/${key}`;
    
    // Open in a new tab or trigger iframe download
    const anchor = document.createElement('a');
    anchor.href = link;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
}

// Share Link Action
async function handleShareAction() {
    closeDropdown();
    
    document.getElementById('share-file-name').innerText = activeItemName;
    document.getElementById('share-url-box').value = 'Generating...';
    document.getElementById('copy-confirmation').style.display = 'none';
    
    openModal('share-modal');
    regenerateSharingLink();
}

async function regenerateSharingLink() {
    const expiry = document.getElementById('share-expiry').value;
    try {
        const response = await fetch(`${API_URL}/files/share`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                file_id: activeItemId,
                expires_in: parseInt(expiry)
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            let url = data.share_url;
            
            // If local mode path, prefix host domain
            if (url.startsWith('/')) {
                url = `${window.location.origin.replace('/client', '/server')}${url}`;
                // Fix ports mapping
                url = url.replace('3000', '5000').replace('5500', '5000').replace('8080', '5000');
            }
            
            document.getElementById('share-url-box').value = url;
        } else {
            document.getElementById('share-url-box').value = 'Failed to generate link';
        }
    } catch (e) {
        console.error(e);
        document.getElementById('share-url-box').value = 'Failed to generate link';
    }
}

function copySharingLink() {
    const box = document.getElementById('share-url-box');
    box.select();
    box.setSelectionRange(0, 99999);
    navigator.clipboard.writeText(box.value);
    
    const confirmation = document.getElementById('copy-confirmation');
    confirmation.style.display = 'block';
    setTimeout(() => {
        confirmation.style.display = 'none';
    }, 2000);
}

// Version History Action
async function handleVersionsAction() {
    closeDropdown();
    
    document.getElementById('version-file-name').innerText = activeItemName;
    const box = document.getElementById('versions-list-box');
    box.innerHTML = '<li class="version-item">Loading versions...</li>';
    
    openModal('versions-modal');
    
    try {
        const response = await fetch(`${API_URL}/files/versions?file_id=${activeItemId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            const data = await response.json();
            box.innerHTML = '';
            
            if (data.versions && data.versions.length > 0) {
                data.versions.forEach((ver, index) => {
                    const li = document.createElement('li');
                    li.className = 'version-item';
                    
                    const date = new Date(ver.created_at).toLocaleString();
                    const size = formatBytes(ver.size);
                    
                    const isLatest = index === 0;
                    
                    li.innerHTML = `
                        <div class="version-info-left">
                            <span class="version-name">${ver.version_label} (${size})</span>
                            <span class="version-date">${date}</span>
                        </div>
                        ${isLatest 
                            ? `<button class="btn btn-secondary btn-sm" disabled style="opacity:0.6;">Active</button>`
                            : `<button class="btn btn-accent btn-sm" onclick="restoreVersion(${ver.id})">Restore</button>`
                        }
                    `;
                    box.appendChild(li);
                });
            } else {
                box.innerHTML = '<li class="version-item">No version history found.</li>';
            }
        }
    } catch (e) {
        console.error(e);
        box.innerHTML = '<li class="version-item">Error loading version history.</li>';
    }
}

async function restoreVersion(versionId) {
    if (!confirm('Are you sure you want to restore this older version? The current version will be archived.')) return;
    
    try {
        const response = await fetch(`${API_URL}/files/versions/restore`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ version_id: versionId })
        });
        
        if (response.ok) {
            closeModal('versions-modal');
            loadDirectory(currentFolderId);
        } else {
            alert('Failed to restore version');
        }
    } catch (e) {
        console.error(e);
    }
}

// Delete Item Action
async function handleDeleteAction() {
    closeDropdown();
    
    const confirmMsg = activeItemType === 'folder' 
        ? `Are you sure you want to delete folder "${activeItemName}" and all of its contents?` 
        : `Are you sure you want to delete file "${activeItemName}"?`;
        
    if (!confirm(confirmMsg)) return;
    
    const endpoint = activeItemType === 'folder' 
        ? `/folders/delete?folder_id=${activeItemId}` 
        : `/files/delete?file_id=${activeItemId}`;
        
    try {
        const response = await fetch(`${API_URL}${endpoint}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            loadDirectory(currentFolderId);
        } else {
            const data = await response.json();
            alert(data.message || 'Deletion failed');
        }
    } catch (e) {
        console.error(e);
    }
}
