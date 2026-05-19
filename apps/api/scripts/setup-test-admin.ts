/**
 * Setup Test Admin Script
 *
 * Creates or updates a test user with surewaka_admin role in app_metadata.
 * Outputs a valid JWT token you can use to test the RBAC API endpoints.
 *
 * Usage:
 *   pnpm --filter @surewaka/api exec tsx scripts/setup-test-admin.ts
 *
 * Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import 'dotenv/config';
import { createServiceClient } from '@surewaka/supabase';
import { db, users } from '@surewaka/db';
import { eq } from 'drizzle-orm';

const supabase = createServiceClient();

const TEST_EMAIL = 'admin-test@surewaka.com';
const TEST_PASSWORD = 'TestAdmin123!';

async function main() {
  console.log('🔧 Setting up test admin user...\n');

  // Check if user already exists
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existing = existingUsers?.users?.find((u) => u.email === TEST_EMAIL);

  let userId: string;

  if (existing) {
    userId = existing.id;
    console.log(`✅ Found existing user: ${TEST_EMAIL} (${userId})`);
  } else {
    // Create the user
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { name: 'Test Admin' },
    });

    if (createError) {
      console.error('❌ Failed to create user:', createError.message);
      process.exit(1);
    }

    userId = newUser.user.id;
    console.log(`✅ Created user: ${TEST_EMAIL} (${userId})`);
  }

  // Update app_metadata with surewaka_admin role
  const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
    app_metadata: {
      roles: ['surewaka_admin'],
      primary_role: 'surewaka_admin',
    },
  });

  if (updateError) {
    console.error('❌ Failed to update app_metadata:', updateError.message);
    process.exit(1);
  }

  console.log('✅ Set app_metadata.roles = ["surewaka_admin"]');

  // Ensure user exists in the users table (for FK constraints)
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

  // Generate a session token by signing in
  const { data: session, error: signInError } = await supabase.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (signInError || !session.session) {
    console.error('❌ Failed to sign in:', signInError?.message);
    process.exit(1);
  }

  const token = session.session.access_token;

  console.log('\n' + '═'.repeat(60));
  console.log('🎉 Test admin ready! Use this token to test RBAC endpoints:');
  console.log('═'.repeat(60));
  console.log(`\nUser ID: ${userId}`);
  console.log(`Email:   ${TEST_EMAIL}`);
  console.log(`Roles:   surewaka_admin`);
  console.log(`\nAccess Token (expires in 1 hour):\n`);
  console.log(token);
  console.log('\n' + '═'.repeat(60));
  console.log('\nExample usage:');
  console.log(`\n  curl -H "Authorization: Bearer ${token.slice(0, 20)}..." \\`);
  console.log(`    http://localhost:4000/api/v1/admin/users/${userId}/roles`);
  console.log('\n' + '═'.repeat(60));
}

main().catch(console.error);
