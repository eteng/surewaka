/**
 * Authenticated user type — resolved from Clerk token + DB lookup.
 *
 * `id` is the internal UUID from the users table (used in all FKs and queries).
 * `clerkId` is Clerk's external identifier (used only for auth resolution).
 */
export type AuthUser = {
  /** Internal UUID (from users table PK) */
  id: string;
  /** Clerk's user ID (e.g., "user_2xABC123def") */
  clerkId: string;
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
};
