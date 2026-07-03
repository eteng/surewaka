import { RefreshCw, WifiOff } from 'lucide-react';
import { cn } from '~/lib/utils';

type RealtimeConnectionBannerProps = {
  isConnected: boolean;
  isReconnecting: boolean;
  reconnectExhausted: boolean;
  manualRetry: () => void;
};

/**
 * Non-dismissible banner indicating realtime connection state.
 *
 * - Hidden when connected
 * - Shows "Live updates unavailable" with spinner when reconnecting
 * - Shows "Reconnection failed" with manual retry button when exhausted
 */
export function RealtimeConnectionBanner({
  isConnected,
  isReconnecting,
  reconnectExhausted,
  manualRetry,
}: RealtimeConnectionBannerProps) {
  // Don't render when connected
  if (isConnected) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        'flex items-center justify-between gap-3 rounded-md px-4 py-3 text-sm',
        reconnectExhausted
          ? 'bg-destructive/10 text-destructive border border-destructive/20'
          : 'bg-yellow-50 text-yellow-800 border border-yellow-200',
      )}
    >
      <div className="flex items-center gap-2">
        {isReconnecting ? (
          <RefreshCw className="h-4 w-4 animate-spin" />
        ) : (
          <WifiOff className="h-4 w-4" />
        )}
        <span className="font-medium">
          {reconnectExhausted
            ? 'Reconnection failed'
            : 'Live updates unavailable — reconnecting...'}
        </span>
      </div>

      {reconnectExhausted && (
        <button
          type="button"
          onClick={manualRetry}
          className="cursor-pointer inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      )}
    </div>
  );
}
