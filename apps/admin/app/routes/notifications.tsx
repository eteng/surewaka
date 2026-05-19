import { useCallback, useEffect, useState } from 'react';
import { NOTIFICATION_TYPES } from '@surewaka/shared';
import type { NotificationType } from '@surewaka/shared';
import { useNotifications } from '~/hooks/use-notifications';
import { NotificationItem } from '~/components/notifications/notification-item';
import { Button } from '~/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';

export function meta() {
  return [{ title: 'SureWaka Admin - Notifications' }];
}

const PAGE_SIZE = 20;

const TYPE_LABELS: Record<NotificationType, string> = {
  new_user_signup: 'New User Signup',
  delivery_issue: 'Delivery Issue',
  carrier_verification_request: 'Carrier Verification Request',
  carrier_verified: 'Carrier Verified',
  dispute_opened: 'Dispute Opened',
  driver_verification_request: 'Driver Verification Request',
  system_alert: 'System Alert',
};

type ReadFilter = 'all' | 'unread' | 'read';

export default function NotificationsRoute() {
  const {
    notifications,
    isLoading,
    error,
    meta,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
  } = useNotifications();

  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');

  const loadNotifications = useCallback(() => {
    const options: {
      page: number;
      pageSize: number;
      type?: string;
      isRead?: boolean;
    } = {
      page,
      pageSize: PAGE_SIZE,
    };

    if (typeFilter !== 'all') {
      options.type = typeFilter;
    }

    if (readFilter === 'unread') {
      options.isRead = false;
    } else if (readFilter === 'read') {
      options.isRead = true;
    }

    fetchNotifications(options);
  }, [page, typeFilter, readFilter, fetchNotifications]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  function handleTypeFilterChange(value: string) {
    setTypeFilter(value);
    setPage(1);
  }

  function handleReadFilterChange(value: ReadFilter) {
    setReadFilter(value);
    setPage(1);
  }

  function handleMarkAllAsRead() {
    markAllAsRead();
  }

  function handlePreviousPage() {
    setPage((prev) => Math.max(1, prev - 1));
  }

  function handleNextPage() {
    const totalPages = meta?.totalPages ?? 1;
    setPage((prev) => Math.min(totalPages, prev + 1));
  }

  const totalPages = meta?.totalPages ?? 1;
  const total = meta?.total ?? 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            View and manage all your notifications
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleMarkAllAsRead}>
          Mark all as read
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-4">
        {/* Type filter */}
        <Select value={typeFilter} onValueChange={handleTypeFilterChange}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {NOTIFICATION_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Read/unread status toggle */}
        <div className="flex items-center rounded-md border">
          <button
            type="button"
            onClick={() => handleReadFilterChange('all')}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              readFilter === 'all'
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-accent'
            } rounded-l-md`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => handleReadFilterChange('unread')}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              readFilter === 'unread'
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-accent'
            }`}
          >
            Unread
          </button>
          <button
            type="button"
            onClick={() => handleReadFilterChange('read')}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              readFilter === 'read'
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-accent'
            } rounded-r-md`}
          >
            Read
          </button>
        </div>
      </div>

      {/* Notification list */}
      <div className="rounded-lg border">
        {isLoading && notifications.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">Loading notifications...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={loadNotifications}>
              Retry
            </Button>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">No notifications found</p>
          </div>
        ) : (
          <div className="divide-y">
            {notifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onRead={markAsRead}
                variant="page"
              />
            ))}
          </div>
        )}
      </div>

      {/* Pagination controls */}
      {total > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages} ({total} total)
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreviousPage}
              disabled={page <= 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNextPage}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
