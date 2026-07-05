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
export * from './carrier-vetting';
export * from './drivers';

// Deliveries & payments
export * from './deliveries';
export * from './delivery-legs';
export * from './delivery-events';
export * from './delivery-ratings';
export * from './driver-locations';
export * from './carrier-sla-overrides';
export * from './escrow-holds';
export * from './wallets';
export * from './payout-requests';

// User features
export * from './addresses';
export * from './name-change-requests';
export * from './notifications';
export * from './push-tokens';

// Customer analytics
export * from './customer-segments';

// Pre-launch
export * from './waitlist';

// Alert system
export * from './alerts';
export * from './alert-settings';
