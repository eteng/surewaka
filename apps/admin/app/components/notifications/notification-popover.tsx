import { useEffect } from 'react';
import { Link } from 'react-router';
import { useNotifications } from '~/hooks/use-notifications';
import { NotificationItem } from './notification-item';

type NotificationPopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function NotificationPopover({ open, onOpenChange }: NotificationPopoverProps) {
  const { notifications, isLoading, fetchNotifications, markAsRead, markAllAsRead } =
    useNotifications();

  // Fetch latest notifications when popover opens
  useEffect(() => {
    if (open) {
      fetchNotifications();
    }
  }, [open, fetchNotifications]);

  if (!open) return null;

  const hasUnread = notifications.some((n) => !n.isRead);

  return (
    <div
      className="absolute right-0 top-full z-50 mt-2 w-80 rounded-md border bg-popover shadow-md"
      role="dialog"
      aria-label="Notifications"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Notifications</h3>
        <button
          className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => markAllAsRead()}
          disabled={!hasUnread}
        >
          Mark all as read
        </button>
      </div>

      {/* Body */}
      <div className="max-h-96 overflow-y-auto">
        {isLoading && notifications.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-muted-foreground">No notifications yet</p>
          </div>
        ) : (
          <div className="divide-y">
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onRead={markAsRead}
                onClick={() => onOpenChange(false)}
                variant="popover"
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t px-4 py-3 text-center">
        <Link
          to="/notifications"
          className="text-xs font-medium text-primary hover:underline"
          onClick={() => onOpenChange(false)}
        >
          View all
        </Link>
      </div>
    </div>
  );
}
