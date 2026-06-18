import { pgTable, uuid, text, timestamp, index, unique } from 'drizzle-orm/pg-core';
import { waitlistUserType } from './enums';

export const waitlistSignups = pgTable(
  'waitlist_signups',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    fullName: text('full_name').notNull(),
    email: text().notNull(),
    userType: waitlistUserType('user_type').notNull(),
    source: text().default('home'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_waitlist_signups_created_at').using('btree', table.createdAt),
    index('idx_waitlist_signups_email').using('btree', table.email),
    index('idx_waitlist_signups_source').using('btree', table.source),
    unique('waitlist_signups_email_unique').on(table.email),
  ],
);
