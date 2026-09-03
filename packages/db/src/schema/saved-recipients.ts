import { pgTable, uuid, text, timestamp, foreignKey } from 'drizzle-orm/pg-core';
import { users } from './users';

export const userSavedRecipients = pgTable(
  'user_saved_recipients',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    label: text(),
    recipientName: text('recipient_name').notNull(),
    recipientPhone: text('recipient_phone').notNull(),
    deliveryNotes: text('delivery_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'user_saved_recipients_user_id_fkey',
    }).onDelete('cascade'),
  ],
);
