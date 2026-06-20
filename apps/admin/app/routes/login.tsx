import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useClerk, useUser } from '@clerk/react';
import { Truck, Loader2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';

export function meta() {
  return [{ title: 'SureWaka Admin - Sign In' }];
}

export default function Login() {
  const navigate = useNavigate();
  const clerk = useClerk();
  const { isLoaded } = useUser();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;

    setError('');
    setLoading(true);

    try {
      const result = await clerk.client.signIn.create({
        strategy: 'password',
        identifier: email,
        password,
      });

      if (result.status === 'needs_second_factor') {
        navigate('/mfa/verify');
        return;
      }

      if (result.status === 'complete') {
        await clerk.setActive({ session: result.createdSessionId });
        navigate('/');
        return;
      }

      setError('Sign-in could not be completed. Please try again.');
    } catch (err: unknown) {
      const clerkError = err as { errors?: { message: string }[] };
      const message = clerkError?.errors?.[0]?.message ?? 'Invalid email or password';
      setError(message);
    } finally {
      setLoading(false);
    }
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

          <Button type="submit" className="w-full" disabled={loading || !isLoaded}>
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
