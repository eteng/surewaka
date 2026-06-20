/**
 * Setup Test Admin Script
 *
 * Creates or updates a test user with surewaka_admin role in Clerk and the DB.
 * After running, sign in via the admin app UI at http://localhost:3001/login.
 *
 * Usage:
 *   pnpm --filter @surewaka/api exec tsx scripts/setup-test-admin.ts
 *
 * Requires env vars: CLERK_SECRET_KEY, DATABASE_URL
 */
import 'dotenv/config';
import { getClerkClient } from '@surewaka/auth';
import { db, users } from '@surewaka/db';
import { eq } from 'drizzle-orm';

const TEST_EMAIL = 'admin-test@surewaka.com';
const TEST_PASSWORD = 'TestAdmin123!';

async function main() {
  console.log('🔧 Setting up test admin user...\n');

  const clerk = getClerkClient();

  // Find or create user in Clerk
  const existingList = await clerk.users.getUserList({ emailAddress: [TEST_EMAIL] });
  let clerkUser = existingList.data[0];

  if (clerkUser) {
    console.log(`✅ Found existing Clerk user: ${TEST_EMAIL} (${clerkUser.id})`);
  } else {
    clerkUser = await clerk.users.createUser({
      emailAddress: [TEST_EMAIL],
      password: TEST_PASSWORD,
      firstName: 'Test',
      lastName: 'Admin',
      skipPasswordChecks: true,
    });
    console.log(`✅ Created Clerk user: ${TEST_EMAIL} (${clerkUser.id})`);
  }

  const userId = clerkUser.id;

  // Set surewaka_admin role in public metadata
  await clerk.users.updateUserMetadata(userId, {
    publicMetadata: {
      roles: ['surewaka_admin'],
      primary_role: 'surewaka_admin',
    },
  });
  console.log('✅ Set publicMetadata.roles = ["surewaka_admin"]');

  // Ensure user exists in the DB (for FK constraints)
  const existingDbUser = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (existingDbUser.length === 0) {
    await db.insert(users).values({
      id: userId,
      email: TEST_EMAIL,
      phone: '+2340000000000',
      name: 'Test Admin',
      role: 'surewaka_admin',
      verified: true,
    });
    console.log('✅ Inserted user into users table');
  } else {
    console.log('✅ User already exists in users table');
  }

  console.log('\n' + '═'.repeat(60));
  console.log('🎉 Test admin ready!');
  console.log('═'.repeat(60));
  console.log(`\nUser ID: ${userId}`);
  console.log(`Email:   ${TEST_EMAIL}`);
  console.log(`Password: ${TEST_PASSWORD}`);
  console.log(`Roles:   surewaka_admin`);
  console.log('\nSign in at: http://localhost:3001/login');
  console.log('\nOr use the Clerk Dashboard to impersonate this user and copy a session token.');
  console.log('═'.repeat(60));
}

main().catch(console.error);
