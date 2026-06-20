import 'dotenv/config';
import { verifyToken } from '@surewaka/auth';

const token = process.argv[2];

if (!token) {
  console.error('Usage: tsx scripts/debug-auth.ts <token>');
  process.exit(1);
}

async function main() {
  console.log('CLERK_SECRET_KEY:', process.env.CLERK_SECRET_KEY ? '✅ set' : '❌ missing');
  console.log('CLERK_PUBLISHABLE_KEY:', process.env.CLERK_PUBLISHABLE_KEY ? '✅ set' : '❌ missing');
  console.log('Token length:', token.length);
  console.log('');

  const user = await verifyToken(token);

  if (!user) {
    console.error('❌ Token invalid or expired');
    process.exit(1);
  }

  console.log('✅ User:', user.id, user.email);
  console.log('   Roles:', user.roles);
  console.log('   MFA verified:', user.mfaVerified);
}

main().catch(console.error);
