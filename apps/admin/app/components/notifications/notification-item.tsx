import { useNavigate } from 'react-router';
import {
  UserPlus,
  AlertTriangle,
  ShieldCheck,
  CheckCircle,
  MessageSquareWarning,
  IdCard,
  Info,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { NotificationData, NotificationType } from '@surewaka/shared';
import { cn } from '~/lib/utils';
import { formatRelativeTime } from '~/lib/format-relative-time';

const NOTIFICATION_ICONS: Record<NotificationType, LucideIcon> = {
  new_user_signup: UserPlus,
  delivery_issue: AlertTriangle,
  carrier_verification_request: ShieldCheck,
  carrier_verified: CheckCircle,
  dispute_opened: MessageSquareWarning,
  driver_verification_request: IdCard,
  system_alert: Info,
};

type NotificationItemProps = {
  notification: NotificationData;
  onRead: (id: string) => void;
  onClick?: (notification: NotificationData) => void;
  variant: 'popover' | 'page';
};

export function NotificationItem({
  notification,
  onRead,
  onClick,
  variant,
}: NotificationItemProps) {
  const navigate = useNavigate();
  const Icon = NOTIFICATION_ICONS[notification.type];
  const isClickable = notification.resourceLink !== null;

  function handleClick() {
    if (!isClickable) return;

    onRead(notification.id);

    if (notification.resourceLink) {
      navigate(notification.resourceLink);
    }

    onClick?.(notification);
  }

  const content = (
    <>
      {/* Unread dot indicator */}
      <div className="flex shrink-0 items-center justify-center w-2">
        {!notification.isRead && (
          <span className="h-2 w-2 rounded-full bg-blue-500" aria-label="Unread" />
        )}
      </div>

      {/* Type icon */}
      <div className="flex shrink-0 items-center justify-center">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium truncate">{notification.title}</p>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatRelativeTime(notification.createdAt)}
          </span>
        </div>
        <p
          className={cn(
            'text-xs text-muted-foreground',
            variant === 'popover' && 'line-clamp-2',
          )}
        >
          {notification.message}
        </p>
      </div>
    </>
  );

  if (isClickable) {
    return (
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors',
          'hover:bg-accent cursor-pointer',
          !notification.isRead && 'bg-accent/50',
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={cn(
        'flex w-full items-start gap-3 px-4 py-3',
        !notification.isRead && 'bg-accent/50',
      )}
    >
      {content}
    </div>
  );
}
