import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PublicStorageProvider } from '@surewaka/shared';

const mockUpload = vi.fn();
const mockDestroy = vi.fn();

vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      upload: mockUpload,
      destroy: mockDestroy,
    },
  },
}));

process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud';
process.env.CLOUDINARY_API_KEY = 'test-key';
process.env.CLOUDINARY_API_SECRET = 'test-secret';

describe('createCloudinaryProvider', () => {
  let provider: PublicStorageProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { createCloudinaryProvider } = await import('../cloudinary');
    provider = createCloudinaryProvider();
  });

  describe('upload', () => {
    it('encodes buffer as base64 data URI and calls cloudinary upload with correct options', async () => {
      mockUpload.mockResolvedValueOnce({
        secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/avatars/user-abc.webp',
        public_id: 'avatars/user-abc',
      });

      const result = await provider.upload({
        buffer: Buffer.from('fake-image-data'),
        mimeType: 'image/jpeg',
        path: 'avatars/user-abc',
      });

      expect(mockUpload).toHaveBeenCalledWith(
        expect.stringMatching(/^data:image\/jpeg;base64,/),
        expect.objectContaining({
          public_id: 'avatars/user-abc',
          overwrite: true,
          format: 'webp',
          quality: 'auto',
          transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
        }),
      );
      expect(result).toEqual({
        url: 'https://res.cloudinary.com/test-cloud/image/upload/v1/avatars/user-abc.webp',
        path: 'avatars/user-abc',
      });
    });

    it('throws StorageError with UPLOAD_FAILED when cloudinary rejects', async () => {
      mockUpload.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        provider.upload({
          buffer: Buffer.from('x'),
          mimeType: 'image/jpeg',
          path: 'avatars/user-abc',
        }),
      ).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
    });
  });

  describe('delete', () => {
    it('calls cloudinary destroy with path and image resource_type', async () => {
      mockDestroy.mockResolvedValueOnce({ result: 'ok' });

      await provider.delete('avatars/user-abc');

      expect(mockDestroy).toHaveBeenCalledWith('avatars/user-abc', { resource_type: 'image' });
    });

    it('throws StorageError with DELETE_FAILED when cloudinary rejects', async () => {
      mockDestroy.mockRejectedValueOnce(new Error('Not found'));

      await expect(provider.delete('avatars/user-abc')).rejects.toMatchObject({
        code: 'DELETE_FAILED',
      });
    });
  });
});
