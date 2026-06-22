import { type Router } from 'expo-router';
import { PUSH_DEEP_LINK_MAP } from '@surewaka/shared';
import type { PushNotificationType } from '@surewaka/shared';

export type PushNotificationData = {
  type: PushNotificationType;
  resourceId: string;
  deepLink: string;
  metadata?: Record<string, unknown>;
};

/**
 * Validates that a broadcast deep link is a safe internal route.
 * Must start with `/` and must not contain `://` (no external URLs).
 */
function isValidInternalRoute(url: string): boolean {
  return url.startsWith('/') && !url.includes('://');
}

/**
 * Resolves the navigation route from push notification data.
 * Uses PUSH_DEEP_LINK_MAP to determine the route template,
 * replaces `:resourceId` with the actual resource ID,
 * and validates broadcast deep links for internal routing.
 *
 * Requirements: 5.1-5.10
 */
export function navigateToDeepLink(data: PushNotificationData, router: Router): void {
  try {
    // Handle broadcast type separately — uses custom deepLink from payload
    if (data.type === 'broadcast') {
      const broadcastRoute = data.deepLink;

      if (broadcastRoute && isValidInternalRoute(broadcastRoute)) {
        router.push(broadcastRoute as never);
      } else {
        // Invalid or external URL — fall back to home (Req 5.9)
        router.replace('/' as never);
      }
      return;
    }

    // Look up route template from the deep link map
    const template = PUSH_DEEP_LINK_MAP[data.type];

    if (!template) {
      // Unknown type — fall back to home (Req 5.10)
      router.replace('/' as never);
      return;
    }

    // Replace :resourceId placeholder with actual ID
    const route = template.replace(':resourceId', data.resourceId);

    router.push(route as never);
  } catch {
    // Any error (invalid type, bad route, etc.) — navigate home (Req 5.10)
    router.replace('/' as never);
  }
}
