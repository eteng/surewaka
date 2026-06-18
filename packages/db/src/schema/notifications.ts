import { pgTable, uuid, text, timestamp, boolean, index, foreignKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { notificationType } from './enums';
import { users } from './users';

export const notifications = pgTable(
  'notifications',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    type: notificationType().notNull(),
    title: text().notNull(),
    message: text().notNull(),
    resourceLink: text('resource_link'),
    isRead: boolean('is_read').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_notifications_cleanup').using('btree', table.createdAt),
    index('idx_notifications_user_created').using('btree', table.userId, table.createdAt),
    index('idx_notifications_user_unread')
      .using('btree', table.userId, table.isRead)
      .where(sql`(is_read = false)`),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'notifications_user_id_fkey',
    }).onDelete('cascade'),
  ],
);
