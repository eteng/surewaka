import { pgTable, uuid, text, timestamp, foreignKey } from 'drizzle-orm/pg-core';
import { userRole } from './enums';
import { users } from './users';

export const roleAuditLog = pgTable(
  'role_audit_log',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    role: userRole().notNull(),
    action: text().notNull(),
    scopeType: text('scope_type'),
    scopeId: uuid('scope_id'),
    performedBy: uuid('performed_by'),
    reason: text(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.performedBy],
      foreignColumns: [users.id],
      name: 'role_audit_log_performed_by_users_id_fk',
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'role_audit_log_user_id_users_id_fk',
    }),
  ],
);
