/**
 * Dev script: generate a short-lived sign-in URL for a user.
 *
 * With Clerk, session JWTs are issued by the browser SDK during sign-in.
 * This script creates a sign-in token for a given userId that can be
 * exchanged via the Clerk frontend SDK for a session.
 *
 * Usage:
 *   pnpm --filter @surewaka/api exec tsx scripts/get-token.ts <userId>
 *
 * To get a userId, check the Clerk Dashboard → Users.
 *
 * Requires env vars: CLERK_SECRET_KEY
 */
import 'dotenv/config';
import { getClerkClient } from '@surewaka/auth';

const userId = process.argv[2];

if (!userId) {
  console.error('Usage: tsx scripts/get-token.ts <userId>');
  console.error('  userId: Clerk user ID (e.g. user_2abc...)');
  process.exit(1);
}

async function main() {
  const clerk = getClerkClient();

  const { token } = await clerk.signInTokens.createSignInToken({ userId, expiresInSeconds: 3600 });

  console.log('Sign-in token (valid 1 hour):');
  console.log(token);
  console.log('');
  console.log('Exchange this token via Clerk frontend SDK or Clerk Dashboard → Users → Impersonate.');
}

main().catch(console.error);
