import { pgTable, uuid, text, timestamp, boolean, unique, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { userRole } from './enums';

export const users = pgTable(
  'users',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    email: text(),
    phone: text().notNull(),
    name: text().notNull(),
    role: userRole().default('customer').notNull(),
    verified: boolean().default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    avatarUrl: text('avatar_url'),
    notificationEmail: boolean('notification_email').default(true).notNull(),
    notificationSms: boolean('notification_sms').default(true).notNull(),
    gender: text(),
  },
  (table) => [
    unique('users_email_unique').on(table.email),
    check(
      'users_gender_check',
      sql`gender = ANY (ARRAY['woman'::text, 'man'::text, 'prefer_not_to_disclose'::text])`,
    ),
  ],
);
