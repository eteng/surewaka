import { pgTable, uuid, text, boolean, timestamp, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

export const pushTokens = pgTable(
  'push_tokens',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expoPushToken: text('expo_push_token').notNull().unique(),
    deviceId: text('device_id').notNull(),
    platform: text().notNull(),
    app: text().notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_push_tokens_user_active')
      .on(table.userId, table.isActive)
      .where(sql`is_active = true`),
    index('idx_push_tokens_user_app_active')
      .on(table.userId, table.app, table.isActive)
      .where(sql`is_active = true`),
    check('push_tokens_platform_check', sql`platform IN ('ios', 'android')`),
    check('push_tokens_app_check', sql`app IN ('customer', 'driver')`),
  ],
);
