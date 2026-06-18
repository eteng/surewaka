import { pgTable, uuid, text, timestamp, index, foreignKey } from 'drizzle-orm/pg-core';
import { nameChangeStatus } from './enums';
import { users } from './users';

export const nameChangeRequests = pgTable(
  'name_change_requests',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    currentName: text('current_name').notNull(),
    requestedName: text('requested_name').notNull(),
    reason: text().notNull(),
    status: nameChangeStatus().default('pending').notNull(),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_name_change_requests_status').using('btree', table.status),
    index('idx_name_change_requests_user').using('btree', table.userId),
    foreignKey({
      columns: [table.reviewedBy],
      foreignColumns: [users.id],
      name: 'name_change_requests_reviewed_by_fkey',
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'name_change_requests_user_id_fkey',
    }).onDelete('cascade'),
  ],
);
