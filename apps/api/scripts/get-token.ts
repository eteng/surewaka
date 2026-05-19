import 'dotenv/config';
import { createServiceClient } from '@surewaka/supabase';

const supabase = createServiceClient();

const { data, error } = await supabase.auth.signInWithPassword({
  email: 'admin-test@surewaka.com',
  password: 'TestAdmin123!',
});

if (error || !data.session) {
  console.error('Failed:', error?.message);
  process.exit(1);
}

console.log(data.session.access_token);
