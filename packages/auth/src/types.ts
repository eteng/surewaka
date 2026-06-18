/**
 * Authenticated user type — normalized from Clerk's JWT/user data.
 * Use this across the app instead of importing from @clerk/backend directly.
 */
export type AuthUser = {
  id: string;
  email?: string;
  phone?: string;
  name?: string;
  avatarUrl?: string;
  /** Primary role (convenience alias) */
  role?: string;
  /** All active roles from publicMetadata */
  roles: string[];
  /** Carrier ID for org-scoped roles */
  carrierId?: string;
  /** True when the session has a verified second factor (Clerk fva[1] !== -1) */
  mfaVerified: boolean;
};
