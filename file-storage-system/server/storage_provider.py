import os
import shutil
import boto3
from botocore.exceptions import ClientError

class StorageProvider:
    def __init__(self):
        self.aws_access_key = os.environ.get('AWS_ACCESS_KEY_ID')
        self.aws_secret_key = os.environ.get('AWS_SECRET_ACCESS_KEY')
        self.aws_region = os.environ.get('AWS_REGION', 'us-east-1')
        self.bucket_name = os.environ.get('AWS_BUCKET_NAME')
        
        # Determine mode
        if self.aws_access_key and self.aws_secret_key and self.bucket_name:
            self.mode = 'S3'
            print(f"[StorageProvider] Running in S3 mode. Bucket: {self.bucket_name}")
            try:
                self.s3_client = boto3.client(
                    's3',
                    aws_access_key_id=self.aws_access_key,
                    aws_secret_access_key=self.aws_secret_key,
                    region_name=self.aws_region
                )
            except Exception as e:
                print(f"[StorageProvider] Failed to initialize S3 client: {e}. Falling back to LOCAL mode.")
                self.mode = 'LOCAL'
        else:
            self.mode = 'LOCAL'
            print("[StorageProvider] Running in LOCAL fallback mode. Files will be saved locally.")
            
        self.local_upload_dir = os.path.join(
            os.path.dirname(os.path.abspath(__file__)), 'uploads'
        )
        if not os.path.exists(self.local_upload_dir):
            os.makedirs(self.local_upload_dir)

    def upload_file(self, file_path, storage_key, mime_type):
        """Uploads a local temporary file to S3 or moves it to the local uploads directory."""
        if self.mode == 'S3':
            try:
                self.s3_client.upload_file(
                    file_path,
                    self.bucket_name,
                    storage_key,
                    ExtraArgs={'ContentType': mime_type}
                )
                print(f"[StorageProvider] Uploaded {storage_key} to S3.")
                return True
            except ClientError as e:
                print(f"[StorageProvider] S3 Upload failed: {e}")
                return False
        else:
            # Local Mode: Move temporary file to uploads directory
            destination = os.path.join(self.local_upload_dir, storage_key)
            try:
                shutil.copy2(file_path, destination)
                print(f"[StorageProvider] Stored {storage_key} locally.")
                return True
            except Exception as e:
                print(f"[StorageProvider] Local copy failed: {e}")
                return False

    def delete_file(self, storage_key):
        """Deletes a file from S3 or local storage."""
        if self.mode == 'S3':
            try:
                self.s3_client.delete_object(Bucket=self.bucket_name, Key=storage_key)
                print(f"[StorageProvider] Deleted {storage_key} from S3.")
                return True
            except ClientError as e:
                print(f"[StorageProvider] S3 delete failed: {e}")
                return False
        else:
            destination = os.path.join(self.local_upload_dir, storage_key)
            if os.path.exists(destination):
                try:
                    os.remove(destination)
                    print(f"[StorageProvider] Deleted local file {storage_key}.")
                    return True
                except Exception as e:
                    print(f"[StorageProvider] Local delete failed: {e}")
                    return False
            return False

    def generate_download_url(self, storage_key, original_filename, expires_in=3600):
        """Generates a sharing link. For S3, it's a Presigned URL. For local, it's a server route."""
        if self.mode == 'S3':
            try:
                url = self.s3_client.generate_presigned_url(
                    'get_object',
                    Params={
                        'Bucket': self.bucket_name,
                        'Key': storage_key,
                        'ResponseContentDisposition': f'attachment; filename="{original_filename}"'
                    },
                    ExpiresIn=expires_in
                )
                return url
            except ClientError as e:
                print(f"[StorageProvider] Failed to generate presigned S3 URL: {e}")
                return None
        else:
            # For local dev, return the URL pointing to our backend API download route
            # Host name will be prepended by the client
            return f"/api/files/download/{storage_key}"
