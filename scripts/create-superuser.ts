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
import { neon } from '@neondatabase/serverless';

// ── Args ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const args: Record<string, string> = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const eqIdx = a.indexOf('=');
    if (eqIdx !== -1) {
      args[a.slice(2, eqIdx)] = a.slice(eqIdx + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      args[a.slice(2)] = argv[++i];
    } else {
      args[a.slice(2)] = '';
    }
  }
}

// Also support positional: create-superuser.ts eteng@busyunit.com
const email = args['email'] ?? (argv[0] && !argv[0].startsWith('--') ? argv[0] : undefined);

if (!email) {
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

  let dbUser = await sql`SELECT id FROM users WHERE clerk_id = ${clerkUser.id} LIMIT 1`;

  if (dbUser.length === 0) {
    console.log('No users table row found. Creating one...');

    const name =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || email.split('@')[0];
    const phone =
      (clerkUser.phoneNumbers as Array<{ phoneNumber: string }> | undefined)?.[0]?.phoneNumber ??
      '+000000000000';

    await sql`
      INSERT INTO users (clerk_id, email, phone, name, role, verified)
      VALUES (${clerkUser.id}, ${email}, ${phone}, ${name}, 'surewaka_admin', true)
      ON CONFLICT (clerk_id) DO NOTHING
    `;

    dbUser = await sql`SELECT id FROM users WHERE clerk_id = ${clerkUser.id} LIMIT 1`;

    if (dbUser.length === 0) {
      console.error('Failed to insert users row.');
      process.exit(1);
    }

    console.log('✓ users row created');
  }

  const userId = dbUser[0].id as string;
  console.log(`Found internal user: ${userId}`);

  const existing = await sql`SELECT id FROM user_roles WHERE user_id = ${userId} AND role = 'surewaka_admin' AND is_active = true LIMIT 1`;

  if (existing.length > 0) {
    console.log('surewaka_admin already active in user_roles table. Nothing to do.');
  } else {
    await sql`
      INSERT INTO user_roles (user_id, role, assigned_by, is_active, assigned_at)
      VALUES (${userId}, 'surewaka_admin', ${userId}, true, now())
      ON CONFLICT DO NOTHING
    `;

    await sql`
      INSERT INTO role_audit_log (user_id, action, role, performed_by, reason, created_at)
      VALUES (${userId}, 'assigned', 'surewaka_admin', ${userId}, 'Bootstrap via create-superuser script', now())
    `;

    console.log('✓ user_roles row inserted');
    console.log('✓ role_audit_log entry written');
  }

  console.log(`\nDone. ${email} is now surewaka_admin.\n`);
}

main().catch((err) => {
  console.error('\nFailed:', err.message ?? err);
  process.exit(1);
});
