import { useEffect, useRef, useState } from 'react';
import Ably from 'ably';
import type { TokenRequest } from 'ably';
import { useAuth } from '@clerk/expo';
import { CHANNELS } from '@surewaka/realtime';
import { apiClient } from '../api/client';

export type RealtimeConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

type RealtimeEventHandlers = Record<string, (data: unknown) => void>;

type UseRealtimeChannelOptions = {
  /** The delivery to subscribe to. Pass null/undefined to skip connecting (e.g. before the ID is known yet). */
  deliveryId: string | null | undefined;
  /** Event name -> handler, subscribed on the delivery's realtime channel. Read once per connection — add/remove entries by changing `deliveryId`, not by mutating the handler set mid-connection. */
  events: RealtimeEventHandlers;
  /**
   * Called whenever the connection (re)reaches 'connected' after having
   * dropped, so consumers can re-fetch current state via REST in case an
   * event was missed while disconnected (Requirement 2.4). Not called on
   * the very first connect — pair this hook with your own initial REST
   * fetch on mount for that (Requirement 2.4, 3.1, 6.2).
   */
  onReconnect?: () => void;
};

type UseRealtimeChannelReturn = {
  status: RealtimeConnectionStatus;
};

/**
 * Subscribes to a delivery's realtime channel (`CHANNELS.deliveryTracking`)
 * for the lifetime of the calling component. Fetches a token scoped to just
 * that channel via GET /api/v1/realtime/token (Requirement 1) through an
 * Ably `authCallback`, so the client never embeds the raw ABLY_API_KEY —
 * see design.md Component 2. This is why it talks to the `ably` client
 * library directly rather than through @surewaka/realtime's
 * RealtimeProvider abstraction, which only supports full-API-key auth.
 *
 * Ably's client already retries the underlying connection on drop; this
 * hook's job is surfacing that state and giving consumers a hook to re-sync
 * via REST, since a missed event on a Nigerian mobile connection is a real,
 * common scenario (Requirement 2.3, 2.4), not an edge case to ignore.
 */
export function useRealtimeChannel({
  deliveryId,
  events,
  onReconnect,
}: UseRealtimeChannelOptions): UseRealtimeChannelReturn {
  const { getToken } = useAuth();
  const [status, setStatus] = useState<RealtimeConnectionStatus>('connecting');

  // Refs so the connect effect doesn't need `events`/`onReconnect`/`getToken`
  // identity in its deps — re-subscribing on every render would thrash the
  // connection for callers that don't memoize their handler objects.
  const eventsRef = useRef(events);
  const onReconnectRef = useRef(onReconnect);
  const getTokenRef = useRef(getToken);

  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  useEffect(() => {
    onReconnectRef.current = onReconnect;
  }, [onReconnect]);

  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  useEffect(() => {
    if (!deliveryId) return;

    let hasConnectedOnce = false;
    setStatus('connecting');

    const client = new Ably.Realtime({
      authCallback: async (_tokenParams, callback) => {
        try {
          const sessionToken = await getTokenRef.current();
          if (!sessionToken) {
            callback('Not authenticated', null);
            return;
          }

          const res = await apiClient.get<TokenRequest>(
            `/api/v1/realtime/token?deliveryId=${deliveryId}`,
            sessionToken,
          );

          if (res.error || !res.data) {
            // Ably's own error surfacing just says generic "Request failed" —
            // log the actual deliveryId + server error here so a failure is
            // traceable from device logs without cross-referencing API logs.
            console.error(
              `[useRealtimeChannel] token fetch failed for deliveryId=${deliveryId}:`,
              res.error,
            );
            callback(res.error?.message ?? 'Failed to fetch realtime token', null);
            return;
          }

          callback(null, res.data);
        } catch (err) {
          callback(err instanceof Error ? err.message : 'Failed to fetch realtime token', null);
        }
      },
    });

    const channel = client.channels.get(CHANNELS.deliveryTracking(deliveryId));
    for (const [eventName, handler] of Object.entries(eventsRef.current)) {
      channel.subscribe(eventName, (message) => handler(message.data));
    }

    client.connection.on((stateChange) => {
      switch (stateChange.current) {
        case 'connected':
          setStatus('connected');
          if (hasConnectedOnce) {
            onReconnectRef.current?.();
          }
          hasConnectedOnce = true;
          break;
        case 'connecting':
          setStatus(hasConnectedOnce ? 'reconnecting' : 'connecting');
          break;
        case 'disconnected':
        case 'suspended':
          setStatus('reconnecting');
          break;
        case 'failed':
        case 'closed':
          setStatus('failed');
          break;
      }
    });

    return () => {
      channel.unsubscribe();
      client.close();
    };
  }, [deliveryId]);

  return { status };
}
