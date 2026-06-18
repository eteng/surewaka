import * as SecureStore from 'expo-secure-store';
import { type TokenCache } from '@clerk/expo';

/**
 * Clerk token cache backed by expo-secure-store.
 * Stores session tokens securely on device (Keychain on iOS, EncryptedSharedPrefs on Android).
 */
export const tokenCache: TokenCache = {
  async getToken(key: string) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async saveToken(key: string, value: string) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      // Silently fail — worst case user has to re-login
    }
  },
  async clearToken(key: string) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // Silently fail
    }
  },
};
