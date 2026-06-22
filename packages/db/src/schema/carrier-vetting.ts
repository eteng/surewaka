import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  foreignKey,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { users } from './users';
import { carriers } from './carriers';
import { carrierApplicationStatus, carrierMemberAction, carrierMemberRole } from './enums';

// ── carrier_applications ──────────────────────────────────────────────────────

export const carrierApplications = pgTable(
  'carrier_applications',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    businessName: text('business_name').notNull(),
    contactName: text('contact_name').notNull(),
    email: text().notNull(),
    phone: text().notNull(),
    cacNumber: text('cac_number'),
    fleetSize: integer('fleet_size'),
    serviceAreas: jsonb('service_areas').notNull().default([]),
    notes: text(),
    status: carrierApplicationStatus().notNull().default('pending'),
    reviewedBy: uuid('reviewed_by'),
    reviewNotes: text('review_notes'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.reviewedBy],
      foreignColumns: [users.id],
      name: 'carrier_applications_reviewed_by_users_id_fk',
    }),
    index('idx_carrier_applications_status').on(table.status),
    index('idx_carrier_applications_created_at').on(table.createdAt),
  ],
);

// ── carrier_application_events (append-only) ──────────────────────────────────

export const carrierApplicationEvents = pgTable(
  'carrier_application_events',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    applicationId: uuid('application_id').notNull(),
    fromStatus: carrierApplicationStatus('from_status'),
    toStatus: carrierApplicationStatus('to_status').notNull(),
    performedBy: uuid('performed_by'),
    notes: text(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.applicationId],
      foreignColumns: [carrierApplications.id],
      name: 'carrier_application_events_application_id_fk',
    }),
    foreignKey({
      columns: [table.performedBy],
      foreignColumns: [users.id],
      name: 'carrier_application_events_performed_by_users_id_fk',
    }),
    index('idx_carrier_application_events_application').on(
      table.applicationId,
      table.createdAt,
    ),
  ],
);

// ── carrier_member_invitations ────────────────────────────────────────────────

export const carrierMemberInvitations = pgTable(
  'carrier_member_invitations',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    carrierId: uuid('carrier_id').notNull(),
    phone: text(),
    email: text(),
    role: carrierMemberRole().notNull(),
    invitedBy: uuid('invited_by').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.carrierId],
      foreignColumns: [carriers.id],
      name: 'carrier_member_invitations_carrier_id_carriers_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.invitedBy],
      foreignColumns: [users.id],
      name: 'carrier_member_invitations_invited_by_users_id_fk',
    }),
    index('idx_carrier_member_invitations_phone')
      .on(table.phone)
      .where(sql`phone IS NOT NULL AND accepted_at IS NULL`),
    index('idx_carrier_member_invitations_email')
      .on(table.email)
      .where(sql`email IS NOT NULL AND accepted_at IS NULL`),
    check('phone_or_email_required', sql`phone IS NOT NULL OR email IS NOT NULL`),
  ],
);

// ── carrier_member_events (append-only) ───────────────────────────────────────

export const carrierMemberEvents = pgTable(
  'carrier_member_events',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    carrierId: uuid('carrier_id').notNull(),
    targetUserId: uuid('target_user_id'),
    action: carrierMemberAction().notNull(),
    role: carrierMemberRole().notNull(),
    performedBy: uuid('performed_by'),
    notes: text(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.carrierId],
      foreignColumns: [carriers.id],
      name: 'carrier_member_events_carrier_id_carriers_id_fk',
    }),
    foreignKey({
      columns: [table.targetUserId],
      foreignColumns: [users.id],
      name: 'carrier_member_events_target_user_id_users_id_fk',
    }),
    foreignKey({
      columns: [table.performedBy],
      foreignColumns: [users.id],
      name: 'carrier_member_events_performed_by_users_id_fk',
    }),
    index('idx_carrier_member_events_carrier').on(table.carrierId, table.createdAt),
  ],
);
