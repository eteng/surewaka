import type { UserRole } from '@surewaka/shared';

export type RoleContext = {
  roles: UserRole[];
  hasRole: (role: UserRole) => boolean;
  hasAnyRole: (...roles: UserRole[]) => boolean;
  isAdmin: boolean;
  isSupport: boolean;
  isDriver: boolean;
  isCarrierAdmin: boolean;
  isCarrierDriver: boolean;
  isCustomer: boolean;
  carrierId?: string;
};

type AppMetadataInput = {
  roles?: UserRole[];
  primary_role?: UserRole;
  carrier_id?: string;
} | undefined;

/**
 * Pure function that derives role context from user app_metadata.
 * Not React-specific — can be used in any context.
 *
 * Defaults to ['customer'] if roles are missing or empty.
 * surewaka_admin always returns true for hasRole/hasAnyRole (hierarchy bypass).
 */
export function useRoles(appMetadata: AppMetadataInput): RoleContext {
  const roles: UserRole[] =
    appMetadata?.roles && appMetadata.roles.length > 0
      ? appMetadata.roles
      : ['customer'];

  const isAdmin = roles.includes('surewaka_admin');

  const hasRole = (role: UserRole): boolean => {
    if (isAdmin) return true;
    return roles.includes(role);
  };

  const hasAnyRole = (...requiredRoles: UserRole[]): boolean => {
    if (isAdmin) return true;
    return requiredRoles.some((role) => roles.includes(role));
  };

  return {
    roles,
    hasRole,
    hasAnyRole,
    isAdmin,
    isSupport: roles.includes('support_agent'),
    isDriver: roles.includes('driver'),
    isCarrierAdmin: roles.includes('carrier_admin'),
    isCarrierDriver: roles.includes('carrier_driver'),
    isCustomer: roles.includes('customer'),
    carrierId: appMetadata?.carrier_id,
  };
}
