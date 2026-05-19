import { AlertCircle, Bell, RefreshCw, Shield, User } from 'lucide-react';
import { useProfile } from '~/hooks/use-profile';
import { AvatarUpload } from '~/components/profile/avatar-upload';
import { NotificationSettings } from '~/components/profile/notification-settings';
import { NameChangeForm } from '~/components/profile/name-change-form';
import { Skeleton } from '~/components/ui/skeleton';
import { Button } from '~/components/ui/button';

export function meta() {
  return [{ title: 'SureWaka Admin - Profile' }];
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      {/* Avatar section skeleton */}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex flex-col items-center gap-4">
          <Skeleton className="h-24 w-24 rounded-full" />
          <Skeleton className="h-8 w-32" />
        </div>
      </div>

      {/* Profile info skeleton */}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="space-y-4">
          <Skeleton className="h-5 w-40" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-48" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-48" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-36" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-5 w-24" />
            </div>
          </div>
        </div>
      </div>

      {/* Notification settings skeleton */}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="space-y-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </div>

      {/* Name change form skeleton */}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="space-y-4">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
    </div>
  );
}

function ProfileError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-destructive/50 bg-destructive/5 p-8">
      <AlertCircle className="h-10 w-10 text-destructive" />
      <div className="text-center">
        <h3 className="text-sm font-medium text-foreground">Failed to load profile</h3>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}

export default function SettingsProfile() {
  const {
    profile,
    isLoading,
    error,
    updatePreferences,
    uploadAvatar,
    removeAvatar,
    submitNameChangeRequest,
    isUpdating,
  } = useProfile();

  if (isLoading) {
    return (
      <div className="pt-4">
        <h1 className="text-2xl font-bold text-foreground">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          View your details and manage preferences
        </p>
        <div className="mt-6">
          <ProfileSkeleton />
        </div>
      </div>
    );
  }

  if (error && !profile) {
    return (
      <div className="pt-4">
        <h1 className="text-2xl font-bold text-foreground">Profile</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          View your details and manage preferences
        </p>
        <div className="mt-6">
          <ProfileError error={error} onRetry={() => window.location.reload()} />
        </div>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  return (
    <div className="pt-4">
      <h1 className="text-2xl font-bold text-foreground">Profile</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        View your details and manage preferences
      </p>

      <div className="mt-6 space-y-6">
        {/* Avatar section */}
        <div className="rounded-lg border border-border bg-card p-6">
          <AvatarUpload
            avatarUrl={profile.avatarUrl}
            onUpload={uploadAvatar}
            onRemove={removeAvatar}
            isUpdating={isUpdating}
          />
        </div>

        {/* Profile information (read-only) */}
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
              <User className="h-4 w-4" />
              Personal Information
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Name</p>
                <p className="text-sm text-foreground">{profile.name}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Email</p>
                <p className="text-sm text-foreground">{profile.email}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Phone</p>
                <p className="text-sm text-foreground">{profile.phone}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Role</p>
                <p className="text-sm text-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Shield className="h-3 w-3 text-muted-foreground" />
                    {profile.role}
                  </span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Notification settings */}
        <div className="rounded-lg border border-border bg-card p-6">
          <div className="space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Bell className="h-4 w-4" />
              Notifications
            </h2>
            <NotificationSettings
              notificationEmail={profile.notificationEmail}
              notificationSms={profile.notificationSms}
              onUpdate={updatePreferences}
              isUpdating={isUpdating}
            />
          </div>
        </div>

        {/* Name change request */}
        <div className="rounded-lg border border-border bg-card p-6">
          <NameChangeForm
            pendingNameChange={profile.pendingNameChange}
            onSubmit={submitNameChangeRequest}
            isUpdating={isUpdating}
          />
        </div>
      </div>
    </div>
  );
}
