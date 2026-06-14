import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrivateStorageProvider } from '@surewaka/shared';

const mockSend = vi.fn();
const mockGetSignedUrl = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: mockSend })),
  PutObjectCommand: vi.fn((input) => ({ _input: input })),
  DeleteObjectCommand: vi.fn((input) => ({ _input: input })),
  GetObjectCommand: vi.fn((input) => ({ _input: input })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

process.env.R2_ENDPOINT = 'https://account123.r2.cloudflarestorage.com';
process.env.R2_ACCESS_KEY_ID = 'test-access-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.R2_BUCKET = 'surewaka-private';

describe('createR2Provider', () => {
  let provider: PrivateStorageProvider;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { createR2Provider } = await import('../r2');
    provider = createR2Provider();
  });

  describe('upload', () => {
    it('puts object to R2 with correct bucket, key, and content type', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await provider.upload({
        buffer: Buffer.from('pdf-content'),
        mimeType: 'application/pdf',
        path: 'kyc/driver-abc/license-1234567890',
      });

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          _input: expect.objectContaining({
            Bucket: 'surewaka-private',
            Key: 'kyc/driver-abc/license-1234567890',
            ContentType: 'application/pdf',
          }),
        }),
      );
      expect(result).toEqual({ path: 'kyc/driver-abc/license-1234567890' });
    });

    it('throws StorageError with UPLOAD_FAILED when S3 send rejects', async () => {
      mockSend.mockRejectedValueOnce(new Error('NoSuchBucket'));

      await expect(
        provider.upload({
          buffer: Buffer.from('x'),
          mimeType: 'application/pdf',
          path: 'kyc/x',
        }),
      ).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
    });
  });

  describe('delete', () => {
    it('sends DeleteObjectCommand with correct bucket and key', async () => {
      mockSend.mockResolvedValueOnce({});

      await provider.delete('kyc/driver-abc/license-1234567890');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          _input: expect.objectContaining({
            Bucket: 'surewaka-private',
            Key: 'kyc/driver-abc/license-1234567890',
          }),
        }),
      );
    });

    it('throws StorageError with DELETE_FAILED when S3 send rejects', async () => {
      mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

      await expect(provider.delete('kyc/x')).rejects.toMatchObject({ code: 'DELETE_FAILED' });
    });
  });

  describe('getSignedUrl', () => {
    it('returns signed URL using default 3600s expiry', async () => {
      mockGetSignedUrl.mockResolvedValueOnce(
        'https://account123.r2.cloudflarestorage.com/surewaka-private/kyc/x?X-Amz-Signature=abc',
      );

      const url = await provider.getSignedUrl('kyc/driver-abc/license-1234567890');

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          _input: expect.objectContaining({ Key: 'kyc/driver-abc/license-1234567890' }),
        }),
        { expiresIn: 3600 },
      );
      expect(url).toBe(
        'https://account123.r2.cloudflarestorage.com/surewaka-private/kyc/x?X-Amz-Signature=abc',
      );
    });

    it('passes custom expiry to presigner', async () => {
      mockGetSignedUrl.mockResolvedValueOnce('https://signed.url/x');

      await provider.getSignedUrl('kyc/x', 7200);

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { expiresIn: 7200 },
      );
    });

    it('throws StorageError with SIGNED_URL_FAILED when presigner rejects', async () => {
      mockGetSignedUrl.mockRejectedValueOnce(new Error('CredentialsError'));

      await expect(provider.getSignedUrl('kyc/x')).rejects.toMatchObject({
        code: 'SIGNED_URL_FAILED',
      });
    });
  });
});
