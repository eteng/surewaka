import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PushNotificationData } from './deep-link-router';

const STORAGE_KEY = 'surewaka:deferred_deep_link';
const TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

type DeferredDeepLink = {
  data: PushNotificationData;
  storedAt: number; // timestamp ms
};

/**
 * Store a deferred deep link when a notification is tapped but the session is expired.
 * The link will be consumed after successful re-authentication.
 *
 * Requirement: 5.11
 */
export async function storeDeferredDeepLink(data: PushNotificationData): Promise<void> {
  const entry: DeferredDeepLink = {
    data,
    storedAt: Date.now(),
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
}

/**
 * Consume a stored deferred deep link after re-authentication.
 * Returns the notification data if the link is still within the 15-minute timeout,
 * or null if expired/empty. Always clears the stored link after reading.
 *
 * Requirement: 5.11
 */
export async function consumeDeferredDeepLink(): Promise<PushNotificationData | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    // Always clear after reading, regardless of validity
    await AsyncStorage.removeItem(STORAGE_KEY);

    const entry: DeferredDeepLink = JSON.parse(raw);

    // Check 15-minute timeout
    const elapsed = Date.now() - entry.storedAt;
    if (elapsed > TIMEOUT_MS) {
      return null;
    }

    return entry.data;
  } catch {
    // If parsing fails or storage is corrupted, clean up and return null
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    return null;
  }
}

/**
 * Explicitly clear any stored deferred deep link.
 *
 * Requirement: 5.11
 */
export async function clearDeferredDeepLink(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
