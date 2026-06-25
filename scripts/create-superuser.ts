#!/usr/bin/env npx tsx
/**
 * Create or promote a user to surewaka_admin.
 *
 * Usage:
 *   npx tsx scripts/create-superuser.ts --email eteng@busyunit.com
 *
 * Requires: CLERK_SECRET_KEY and DATABASE_URL in the environment (copy from .env.local).
 *
 * What it does:
 *   1. Looks up the Clerk user by email
 *   2. Sets publicMetadata.roles = ["surewaka_admin"] in Clerk
 *   3. If the user has a row in the users table, upserts a surewaka_admin entry
 *      in user_roles and logs a role_audit_log entry
 *
 * Note: Step 3 is best-effort. If the user hasn't logged in yet (no users row),
 * the Clerk metadata update in step 2 is sufficient — the role will be picked up
 * on first login when the users row is provisioned.
 */

import { createClerkClient } from '@clerk/backend';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { eq, and } from 'drizzle-orm';

// ── Args ─────────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, ...rest] = a.replace(/^--/, '').split('=');
      return [k, rest.join('=')];
    }),
);

// Also support positional: create-superuser.ts eteng@busyunit.com
const email = args['email'] ?? process.argv[2];

if (!email || email.startsWith('--')) {
  console.error('Usage: npx tsx scripts/create-superuser.ts --email <email>');
  process.exit(1);
}

// ── Env ───────────────────────────────────────────────────────────────────────

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!CLERK_SECRET_KEY) {
  console.error('Missing CLERK_SECRET_KEY');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

// ── Clients ───────────────────────────────────────────────────────────────────

const clerk = createClerkClient({ secretKey: CLERK_SECRET_KEY });
const sql = neon(DATABASE_URL);
const db = drizzle(sql);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nLooking up Clerk user for ${email}...`);

  const results = await clerk.users.getUserList({ emailAddress: [email] });

  if (results.totalCount === 0) {
    console.error(`No Clerk user found with email: ${email}`);
    console.error('Make sure the user has signed up first.');
    process.exit(1);
  }

  const clerkUser = results.data[0];
  const existingRoles = ((clerkUser.publicMetadata as Record<string, unknown>)?.roles as string[]) ?? [];
  const alreadyAdmin = existingRoles.includes('surewaka_admin');

  console.log(`Found Clerk user: ${clerkUser.id}`);
  console.log(`Current roles: ${existingRoles.length ? existingRoles.join(', ') : '(none)'}`);

  if (alreadyAdmin) {
    console.log('User already has surewaka_admin role in Clerk. Skipping Clerk update.');
  } else {
    const newRoles = [...new Set([...existingRoles, 'surewaka_admin'])];
    await clerk.users.updateUserMetadata(clerkUser.id, {
      publicMetadata: { ...clerkUser.publicMetadata, roles: newRoles },
    });
    console.log(`✓ Clerk publicMetadata updated — roles: ${newRoles.join(', ')}`);
  }

  // ── DB upsert (best-effort) ───────────────────────────────────────────────

  const dbUser = await db.execute(
    sql`SELECT id FROM users WHERE clerk_id = ${clerkUser.id} LIMIT 1`,
  );

  if (dbUser.rows.length === 0) {
    console.log('\nNo users table row found yet (user may not have logged in).');
    console.log('Clerk metadata is set — the role will be active on their next login.');
    return;
  }

  const userId = dbUser.rows[0].id as string;
  console.log(`Found internal user: ${userId}`);

  const existing = await db.execute(
    sql`SELECT id FROM user_roles WHERE user_id = ${userId} AND role = 'surewaka_admin' AND is_active = true LIMIT 1`,
  );

  if (existing.rows.length > 0) {
    console.log('surewaka_admin already active in user_roles table. Nothing to do.');
  } else {
    await db.execute(
      sql`
        INSERT INTO user_roles (user_id, role, assigned_by, is_active, assigned_at)
        VALUES (${userId}, 'surewaka_admin', ${userId}, true, now())
        ON CONFLICT DO NOTHING
      `,
    );

    await db.execute(
      sql`
        INSERT INTO role_audit_log (user_id, action, role, performed_by, reason, created_at)
        VALUES (${userId}, 'assigned', 'surewaka_admin', ${userId}, 'Bootstrap via create-superuser script', now())
      `,
    );

    console.log('✓ user_roles row inserted');
    console.log('✓ role_audit_log entry written');
  }

  console.log(`\nDone. ${email} is now surewaka_admin.\n`);
}

main().catch((err) => {
  console.error('\nFailed:', err.message ?? err);
  process.exit(1);
});
