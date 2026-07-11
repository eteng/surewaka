import { useState, useEffect, useRef, useCallback } from 'react';

const EXPIRY_WARNING_THRESHOLD_SECONDS = 120; // 2 minutes

type QuoteExpiryState = {
  /** Seconds remaining until quote expires. Null if no expiry is set. */
  secondsRemaining: number | null;
  /** True when remaining time is below the 2-minute threshold. */
  isExpiringSoon: boolean;
  /** True when the quote has fully expired. */
  isExpired: boolean;
  /** Formatted countdown string (e.g., "1:45") when expiring soon. */
  countdownDisplay: string | null;
};

/**
 * Hook that tracks quote expiry and triggers a refresh prompt.
 *
 * Accepts an ISO 8601 `expiresAt` timestamp and ticks every second to
 * compute remaining time. Returns state indicating whether the quote is
 * expiring soon (< 2 minutes) or already expired.
 *
 * Requirements: 8.4
 */
export function useQuoteExpiry(expiresAt: string | null): QuoteExpiryState {
  const [state, setState] = useState<QuoteExpiryState>({
    secondsRemaining: null,
    isExpiringSoon: false,
    isExpired: false,
    countdownDisplay: null,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const computeState = useCallback((): QuoteExpiryState => {
    if (!expiresAt) {
      return { secondsRemaining: null, isExpiringSoon: false, isExpired: false, countdownDisplay: null };
    }

    const now = Date.now();
    const expiryMs = new Date(expiresAt).getTime();
    const remainingMs = expiryMs - now;
    const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));

    if (remainingSeconds <= 0) {
      return { secondsRemaining: 0, isExpiringSoon: false, isExpired: true, countdownDisplay: '0:00' };
    }

    const isExpiringSoon = remainingSeconds <= EXPIRY_WARNING_THRESHOLD_SECONDS;
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    const countdownDisplay = isExpiringSoon ? `${minutes}:${seconds.toString().padStart(2, '0')}` : null;

    return { secondsRemaining: remainingSeconds, isExpiringSoon, isExpired: false, countdownDisplay };
  }, [expiresAt]);

  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!expiresAt) {
      setState({ secondsRemaining: null, isExpiringSoon: false, isExpired: false, countdownDisplay: null });
      return;
    }

    // Set initial state immediately
    setState(computeState());

    // Tick every second to update the countdown
    intervalRef.current = setInterval(() => {
      const newState = computeState();
      setState(newState);

      // Stop ticking once expired
      if (newState.isExpired && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [expiresAt, computeState]);

  return state;
}
