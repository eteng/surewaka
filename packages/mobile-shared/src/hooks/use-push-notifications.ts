import { useCallback, useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useAuth } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { Platform } from 'react-native';
import { navigateToDeepLink } from '../utils/deep-link-router';
import type { PushNotificationData } from '../utils/deep-link-router';
import { apiClient } from '../api/client';

// ─── Types ───────────────────────────────────────────────────────────────────

type UsePushNotificationsReturn = {
  banner: { title: string; body: string; data: PushNotificationData } | null;
  dismissBanner: () => void;
  onBannerTap: () => void;
};

type UsePushNotificationsOptions = {
  app: 'customer' | 'driver';
};

// ─── Foreground handler — suppress system alerts (Req 6.3) ───────────────────
// Set once, outside the hook, to prevent duplicate registrations.

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// ─── Retry utility ───────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// ─── Device ID helper ────────────────────────────────────────────────────────

function getDeviceId(): string {
  // Use Constants.deviceName as a stable device identifier.
  // expo-device is listed as a peer dep for future use.
  return Constants.deviceName ?? `${Platform.OS}-${Constants.sessionId}`;
}


// ─── Token deactivation export (Req 2.6) ────────────────────────────────────

let _lastRegisteredToken: string | null = null;

/**
 * Deactivate the push token on logout.
 * Retries 3x with exponential backoff. Allows logout to proceed regardless of outcome.
 */
export async function deactivatePushToken(getToken: () => Promise<string | null>): Promise<void> {
  const pushToken = _lastRegisteredToken;
  if (!pushToken) return;

  try {
    await withRetry(async () => {
      const sessionToken = await getToken();
      if (!sessionToken) return;
      const encodedToken = encodeURIComponent(pushToken);
      await apiClient.delete(`/api/v1/push-tokens/${encodedToken}`, sessionToken);
    });
  } catch {
    // Allow logout to proceed regardless of outcome (Req 2.6)
  } finally {
    _lastRegisteredToken = null;
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function usePushNotifications(
  options: UsePushNotificationsOptions
): UsePushNotificationsReturn {
  const { app } = options;
  const { isSignedIn, getToken } = useAuth();
  const router = useRouter();

  const [banner, setBanner] = useState<{
    title: string;
    body: string;
    data: PushNotificationData;
  } | null>(null);

  const autoDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const registeredRef = useRef(false);

  // ─── Banner management ───────────────────────────────────────────────────

  const dismissBanner = useCallback(() => {
    if (autoDismissTimer.current) {
      clearTimeout(autoDismissTimer.current);
      autoDismissTimer.current = null;
    }
    setBanner(null);
  }, []);

  const showBanner = useCallback(
    (title: string, body: string, data: PushNotificationData) => {
      // Replace current banner and reset timer (Req 6.4)
      if (autoDismissTimer.current) {
        clearTimeout(autoDismissTimer.current);
      }
      setBanner({ title, body, data });
      autoDismissTimer.current = setTimeout(() => {
        setBanner(null);
        autoDismissTimer.current = null;
      }, 5000);
    },
    []
  );

  const onBannerTap = useCallback(() => {
    if (banner?.data) {
      navigateToDeepLink(banner.data, router);
    }
    dismissBanner();
  }, [banner, router, dismissBanner]);

  // ─── Token registration ──────────────────────────────────────────────────

  useEffect(() => {
    if (!isSignedIn || registeredRef.current) return;

    let cancelled = false;

    async function registerToken() {
      try {
        // Request notification permissions
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        if (existingStatus !== 'granted') {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }

        // Handle permission denied gracefully — no error UI (Req 1.5)
        if (finalStatus !== 'granted') return;

        if (cancelled) return;

        // Get Expo push token
        const projectId = Constants.expoConfig?.extra?.eas?.projectId;
        const tokenResponse = await Notifications.getExpoPushTokenAsync({
          projectId,
        });
        const expoPushToken = tokenResponse.data;

        if (cancelled) return;

        // Register with backend (retry 3x with exponential backoff) (Req 1.6)
        await withRetry(async () => {
          const sessionToken = await getToken();
          if (!sessionToken || cancelled) return;

          await apiClient.post(
            '/api/v1/push-tokens',
            {
              expoPushToken,
              deviceId: getDeviceId(),
              platform: Platform.OS as 'ios' | 'android',
              app,
            },
            sessionToken
          );
        });

        if (!cancelled) {
          _lastRegisteredToken = expoPushToken;
          registeredRef.current = true;
        }
      } catch {
        // Silently fail — permission denied or network errors are handled gracefully
      }
    }

    registerToken();

    return () => {
      cancelled = true;
    };
  }, [isSignedIn, app, getToken]);

  // ─── Foreground notification listener (Req 6.1, 6.4) ────────────────────

  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const content = notification.request.content;
      const data = content.data as PushNotificationData | undefined;

      if (data && content.title) {
        showBanner(content.title, content.body ?? '', data);
      }
    });

    return () => subscription.remove();
  }, [showBanner]);

  // ─── Notification response listener (tap → deep link) (Req 5.1, 5.2) ────

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as
        | PushNotificationData
        | undefined;

      if (data) {
        navigateToDeepLink(data, router);
      }
    });

    return () => subscription.remove();
  }, [router]);

  // ─── Cold-start notification handling (Req 5.11) ─────────────────────────

  useEffect(() => {
    async function handleColdStart() {
      const lastResponse = await Notifications.getLastNotificationResponseAsync();
      if (lastResponse) {
        const data = lastResponse.notification.request.content.data as
          | PushNotificationData
          | undefined;

        if (data) {
          navigateToDeepLink(data, router);
        }
      }
    }

    handleColdStart();
  }, [router]);

  // ─── Cleanup auto-dismiss timer on unmount ───────────────────────────────

  useEffect(() => {
    return () => {
      if (autoDismissTimer.current) {
        clearTimeout(autoDismissTimer.current);
      }
    };
  }, []);

  return { banner, dismissBanner, onBannerTap };
}
