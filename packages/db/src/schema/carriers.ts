import { pgTable, uuid, text, timestamp, boolean, real, unique, foreignKey } from 'drizzle-orm/pg-core';
import { users } from './users';
import { carrierMemberRole } from './enums';

export const carriers = pgTable(
  'carriers',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    name: text().notNull(),
    contactEmail: text('contact_email').notNull(),
    rating: real().default(0),
    deliveryCount: real('delivery_count').default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    slug: text().notNull(),
    logoUrl: text('logo_url'),
    isVerified: boolean('is_verified').default(false).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    verifiedAt: timestamp('verified_at'),
    verifiedBy: uuid('verified_by'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.verifiedBy],
      foreignColumns: [users.id],
      name: 'carriers_verified_by_users_id_fk',
    }),
    unique('carriers_slug_unique').on(table.slug),
  ],
);

export const carrierMembers = pgTable(
  'carrier_members',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    carrierId: uuid('carrier_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: carrierMemberRole().notNull(),
    invitedBy: uuid('invited_by'),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
    leftAt: timestamp('left_at'),
    isActive: boolean('is_active').default(true).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.carrierId],
      foreignColumns: [carriers.id],
      name: 'carrier_members_carrier_id_carriers_id_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.invitedBy],
      foreignColumns: [users.id],
      name: 'carrier_members_invited_by_users_id_fk',
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'carrier_members_user_id_users_id_fk',
    }).onDelete('cascade'),
    unique('uq_carrier_members_active').on(table.carrierId, table.userId),
  ],
);
