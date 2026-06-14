import { v2 as cloudinary } from 'cloudinary';
import { StorageError } from '@surewaka/shared';
import type { PublicStorageProvider, StorageFile, PublicUploadResult } from '@surewaka/shared';

function validateEnv(): void {
  const missing = [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
  ].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing Cloudinary env vars: ${missing.join(', ')}`);
  }
}

export function createCloudinaryProvider(): PublicStorageProvider {
  validateEnv();

  // cloudinary.config() mutates a process-level singleton in the SDK.
  // Safe here because createCloudinaryProvider() is called once at startup via the singleton index.
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  return {
    async upload(file: StorageFile): Promise<PublicUploadResult> {
      try {
        const dataUri = `data:${file.mimeType};base64,${file.buffer.toString('base64')}`;
        const result = await cloudinary.uploader.upload(dataUri, {
          public_id: file.path,
          overwrite: true,
          resource_type: 'image',
          format: 'webp',
          quality: 'auto',
          transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
        });
        return { url: result.secure_url, path: result.public_id };
      } catch (err) {
        console.error('[CloudinaryStorage] Upload failed:', err);
        throw new StorageError('UPLOAD_FAILED', 'Failed to upload image to Cloudinary');
      }
    },

    async delete(path: string): Promise<void> {
      try {
        await cloudinary.uploader.destroy(path, { resource_type: 'image' });
      } catch (err) {
        console.error('[CloudinaryStorage] Delete failed:', err);
        throw new StorageError('DELETE_FAILED', 'Failed to delete image from Cloudinary');
      }
    },
  };
}
