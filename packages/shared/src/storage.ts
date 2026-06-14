export type StorageFile = {
  buffer: Buffer;
  mimeType: string;
  path: string;
};

export type PublicUploadResult = {
  url: string;
  path: string;
};

export type PublicStorageProvider = {
  upload(file: StorageFile): Promise<PublicUploadResult>;
  delete(path: string): Promise<void>;
};

export type PrivateStorageProvider = {
  upload(file: StorageFile): Promise<{ path: string }>;
  delete(path: string): Promise<void>;
  getSignedUrl(path: string, expiresIn?: number): Promise<string>;
};

export class StorageError extends Error {
  constructor(
    public readonly code: 'UPLOAD_FAILED' | 'DELETE_FAILED' | 'SIGNED_URL_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}
