import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageError } from '@surewaka/shared';
import type { PrivateStorageProvider, StorageFile } from '@surewaka/shared';

function validateEnv(): void {
  const missing = [
    'R2_ENDPOINT',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET',
  ].filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing R2 env vars: ${missing.join(', ')}`);
  }
}

export function createR2Provider(): PrivateStorageProvider {
  validateEnv();

  const client = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT!,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  const bucket = process.env.R2_BUCKET!;

  return {
    async upload(file: StorageFile): Promise<{ path: string }> {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: file.path,
            Body: file.buffer,
            ContentType: file.mimeType,
          }),
        );
        return { path: file.path };
      } catch (err) {
        console.error('[R2Storage] Upload failed:', err);
        throw new StorageError('UPLOAD_FAILED', 'Failed to upload document to R2');
      }
    },

    async delete(path: string): Promise<void> {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: path }));
      } catch (err) {
        console.error('[R2Storage] Delete failed:', err);
        throw new StorageError('DELETE_FAILED', 'Failed to delete document from R2');
      }
    },

    async getSignedUrl(path: string, expiresIn = 3600): Promise<string> {
      try {
        const command = new GetObjectCommand({ Bucket: bucket, Key: path });
        return await getSignedUrl(client, command, { expiresIn });
      } catch (err) {
        console.error('[R2Storage] Signed URL generation failed:', err);
        throw new StorageError('SIGNED_URL_FAILED', 'Failed to generate signed URL');
      }
    },
  };
}
