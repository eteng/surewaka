import { CheckCircle2, XCircle, Mail, MessageSquare, User, Calendar, ShieldCheck } from 'lucide-react';
import type { CustomerDetail } from '@surewaka/shared';
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card';

function formatGender(gender: string | null): string {
  if (!gender) return 'Not specified';

  const genderMap: Record<string, string> = {
    woman: 'Woman',
    man: 'Man',
    prefer_not_to_disclose: 'Prefer not to disclose',
  };

  if (genderMap[gender]) return genderMap[gender];

  // Fallback: capitalize first letter, replace underscores with spaces
  return gender
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatFullDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function CustomerInfoPanel({ customer }: { customer: CustomerDetail }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {/* Notification Preferences */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <MessageSquare className="h-4 w-4" />
            Notification Preferences
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm">
              <Mail className="h-4 w-4 text-muted-foreground" />
              Email Notifications
            </span>
            {customer.notificationEmail ? (
              <span className="flex items-center gap-1 text-sm font-medium text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                Enabled
              </span>
            ) : (
              <span className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
                <XCircle className="h-4 w-4" />
                Disabled
              </span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              SMS Notifications
            </span>
            {customer.notificationSms ? (
              <span className="flex items-center gap-1 text-sm font-medium text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                Enabled
              </span>
            ) : (
              <span className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
                <XCircle className="h-4 w-4" />
                Disabled
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Gender */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <User className="h-4 w-4" />
            Gender
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm font-medium">{formatGender(customer.gender)}</p>
        </CardContent>
      </Card>

      {/* Account Details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Calendar className="h-4 w-4" />
            Account Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Created</span>
            <span className="text-sm font-medium">{formatFullDate(customer.createdAt)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Verification</span>
            {customer.verified ? (
              <span className="flex items-center gap-1 text-sm font-medium text-green-600 dark:text-green-400">
                <ShieldCheck className="h-4 w-4" />
                Verified
              </span>
            ) : (
              <span className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
                <XCircle className="h-4 w-4" />
                Unverified
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
