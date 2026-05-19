import { useState } from 'react';
import { Bell } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';
import { useNotifications } from '~/hooks/use-notifications';
import { NotificationPopover } from './notification-popover';

/**
 * Formats the unread count for display in the badge.
 * - Returns "" when count is 0 (badge hidden)
 * - Returns the number as string for 1-99
 * - Returns "99+" for > 99
 */
export function formatBadgeCount(count: number): string {
  if (count <= 0) return '';
  if (count > 99) return '99+';
  return String(count);
}

export function NotificationBell() {
  const { unreadCount } = useNotifications();
  const [open, setOpen] = useState(false);

  const ariaLabel =
    unreadCount > 0
      ? `${unreadCount} unread notifications`
      : 'No unread notifications';

  const badgeText = formatBadgeCount(unreadCount);

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="icon-sm"
        className="relative"
        aria-label={ariaLabel}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Bell className="h-5 w-5" />
        {badgeText && (
          <span
            className={cn(
              'absolute -top-1 -right-1 flex items-center justify-center',
              'min-w-[18px] h-[18px] px-1 rounded-full',
              'bg-destructive text-destructive-foreground',
              'text-[10px] font-semibold leading-none'
            )}
          >
            {badgeText}
          </span>
        )}
      </Button>
      <NotificationPopover open={open} onOpenChange={setOpen} />
    </div>
  );
}
