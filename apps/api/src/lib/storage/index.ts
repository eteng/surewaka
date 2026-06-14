import { createCloudinaryProvider } from './cloudinary';
import { createR2Provider } from './r2';
import type { PublicStorageProvider, PrivateStorageProvider } from '@surewaka/shared';

export const avatarStorage: PublicStorageProvider = createCloudinaryProvider();
export const documentStorage: PrivateStorageProvider = createR2Provider();
