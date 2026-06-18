/**
 * Database schema — one file per domain entity.
 *
 * This is the single source of truth for the SureWaka database structure.
 * All tables, indexes, constraints, and enums are defined here.
 *
 * RLS policies are NOT included — authorization is handled entirely
 * in the API layer (Hono middleware + Clerk).
 */

// Enums (shared across tables)
export * from './enums';

// Core identity
export * from './users';
export * from './user-roles';
export * from './role-audit-log';

// Carriers & drivers
export * from './carriers';
export * from './drivers';

// Deliveries & payments
export * from './deliveries';
export * from './escrow-holds';
export * from './wallets';
export * from './payout-requests';

// User features
export * from './addresses';
export * from './name-change-requests';
export * from './notifications';

// Pre-launch
export * from './waitlist';
