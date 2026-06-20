/**
 * Dev script: force-set a user's roles to surewaka_admin in Clerk public metadata.
 *
 * Usage:
 *   pnpm --filter @surewaka/api exec tsx scripts/fix-admin-role.ts <userId>
 *
 * Requires env vars: CLERK_SECRET_KEY
 */
import 'dotenv/config';
import { getClerkClient } from '@surewaka/auth';

const userId = process.argv[2];

if (!userId) {
  console.error('Usage: tsx scripts/fix-admin-role.ts <userId>');
  console.error('  userId: Clerk user ID (e.g. user_2abc...)');
  process.exit(1);
}

async function main() {
  const clerk = getClerkClient();

  await clerk.users.updateUserMetadata(userId, {
    publicMetadata: {
      roles: ['surewaka_admin'],
      primary_role: 'surewaka_admin',
    },
  });

  console.log('✅ Set roles to surewaka_admin for', userId);
}

main().catch(console.error);
