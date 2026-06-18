import { pgTable, uuid, text, timestamp, boolean, index, unique, foreignKey } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { userRole } from './enums';
import { users } from './users';

export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: uuid('user_id').notNull(),
    role: userRole().notNull(),
    scopeType: text('scope_type'),
    scopeId: uuid('scope_id'),
    assignedBy: uuid('assigned_by'),
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
    revokedAt: timestamp('revoked_at'),
    isActive: boolean('is_active').default(true).notNull(),
  },
  (table) => [
    index('idx_user_roles_user_active')
      .using('btree', table.userId, table.isActive)
      .where(sql`(is_active = true)`),
    foreignKey({
      columns: [table.assignedBy],
      foreignColumns: [users.id],
      name: 'user_roles_assigned_by_users_id_fk',
    }),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: 'user_roles_user_id_users_id_fk',
    }).onDelete('cascade'),
    unique('uq_user_roles_active').on(table.userId, table.role, table.scopeId),
  ],
);
