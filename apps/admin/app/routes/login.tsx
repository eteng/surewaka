import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Truck, Loader2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { signIn } from '~/hooks/use-auth';
import { supabase } from '~/lib/supabase';

export function meta() {
  return [{ title: 'SureWaka Admin - Sign In' }];
}

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { data, error: signInError } = await signIn(email, password);

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    if (!data.session) {
      setError('No session returned');
      setLoading(false);
      return;
    }

    // Check MFA status
    const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (aalData) {
      if (aalData.nextLevel === 'aal2' && aalData.currentLevel === 'aal1') {
        // User has MFA enrolled but hasn't verified yet this session
        navigate('/mfa/verify');
      } else if (aalData.currentLevel === 'aal1' && aalData.nextLevel === 'aal1') {
        // User doesn't have MFA enrolled — force enrollment
        navigate('/mfa/enroll');
      } else {
        // AAL2 achieved
        navigate('/');
      }
    } else {
      navigate('/');
    }

    setLoading(false);
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Truck className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">SureWaka Admin</h1>
          <p className="text-sm text-muted-foreground">
            Sign in to access the operations dashboard
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium leading-none">
              Email
            </label>
            <Input
              id="email"
              type="email"
              placeholder="admin@surewaka.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium leading-none">
              Password
            </label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Sign In
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Access restricted to authorized SureWaka staff only.
        </p>
      </div>
    </div>
  );
}
