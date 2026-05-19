import 'dotenv/config';
import { createServerClient } from '@surewaka/supabase';

const token = process.argv[2];

if (!token) {
  console.error('Usage: tsx scripts/debug-auth.ts <token>');
  process.exit(1);
}

async function main() {
  console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? '✅ set' : '❌ missing');
  console.log('SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? '✅ set' : '❌ missing');
  console.log('Token length:', token.length);
  console.log('');

  const supabase = createServerClient(token);
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    console.error('❌ getUser error:', error.message, error.status);
  } else {
    console.log('✅ User:', data.user?.id, data.user?.email);
    console.log('   Roles:', data.user?.app_metadata?.roles);
  }
}

main().catch(console.error);
