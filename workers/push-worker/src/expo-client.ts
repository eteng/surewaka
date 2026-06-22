import { Expo } from 'expo-server-sdk';

/**
 * Singleton Expo Push API client.
 * Reuses connections and handles chunking internally.
 */
export const expo = new Expo();
