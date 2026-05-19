import type { ReactNode } from 'react';
import type { UserRole } from '@surewaka/shared';

export function RoleGate({
  roles,
  userRoles,
  children,
  fallback = null,
}: {
  roles: UserRole[];
  userRoles: UserRole[];
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const hasAccess =
    userRoles.includes('surewaka_admin') ||
    roles.some((role) => userRoles.includes(role));

  return hasAccess ? <>{children}</> : <>{fallback}</>;
}
