import { type ColumnDef } from '@tanstack/react-table';
import { cn } from '~/lib/utils';

type WaitlistSignupRecord = {
  id: string;
  fullName: string;
  email: string;
  userType: 'sender' | 'business' | 'driver';
  source: string;
  createdAt: string;
};

const userTypeBadgeStyles: Record<WaitlistSignupRecord['userType'], string> = {
  sender: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  business: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  driver: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
};

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export const columns: ColumnDef<WaitlistSignupRecord>[] = [
  {
    accessorKey: 'fullName',
    header: 'Full Name',
    enableSorting: true,
  },
  {
    accessorKey: 'email',
    header: 'Email',
    enableSorting: true,
  },
  {
    accessorKey: 'userType',
    header: 'User Type',
    enableSorting: true,
    cell: ({ row }) => {
      const userType = row.getValue<WaitlistSignupRecord['userType']>('userType');
      return (
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize',
            userTypeBadgeStyles[userType],
          )}
        >
          {userType}
        </span>
      );
    },
  },
  {
    accessorKey: 'source',
    header: 'Source',
    enableSorting: true,
  },
  {
    accessorKey: 'createdAt',
    header: 'Signup Date',
    enableSorting: true,
    cell: ({ row }) => {
      const createdAt = row.getValue<string>('createdAt');
      return formatDate(createdAt);
    },
  },
];
