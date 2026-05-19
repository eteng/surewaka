import 'dotenv/config';
import { createServiceClient } from '@surewaka/supabase';

const supabase = createServiceClient();
const USER_ID = 'a96881bf-50fd-4d28-8f6d-793c152108a4';

async function main() {
  // Reset app_metadata to surewaka_admin
  const { error } = await supabase.auth.admin.updateUserById(USER_ID, {
    app_metadata: {
      roles: ['surewaka_admin'],
      primary_role: 'surewaka_admin',
      provider: 'email',
      providers: ['email'],
    },
  });

  if (error) {
    console.error('Failed:', error.message);
    process.exit(1);
  }

  console.log('✅ Reset to surewaka_admin');

  // Get fresh token
  const { data, error: signInError } = await supabase.auth.signInWithPassword({
    email: 'admin-test@surewaka.com',
    password: 'TestAdmin123!',
  });

  if (signInError || !data.session) {
    console.error('Sign in failed:', signInError?.message);
    process.exit(1);
  }

  console.log(data.session.access_token);
}

main().catch(console.error);
