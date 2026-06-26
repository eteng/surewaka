import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useClerk, useUser } from '@clerk/react';
import { Truck, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';

export function meta() {
  return [{ title: 'SureWaka Admin - Sign In' }];
}

type Step = 'password' | 'verify-device';

type EmailFactor = { strategy: string; emailAddressId: string };

export default function Login() {
  const navigate = useNavigate();
  const clerk = useClerk();
  const { isLoaded } = useUser();
  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function finishSignIn(status: string, createdSessionId: string | null) {
    if (status === 'complete' && createdSessionId) {
      await clerk.setActive({ session: createdSessionId });
      navigate('/');
      return true;
    }
    if (status === 'needs_second_factor') {
      navigate('/mfa/verify');
      return true;
    }
    return false;
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
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

      if (await finishSignIn(result.status, result.createdSessionId)) return;

      if (result.status === 'needs_client_trust') {
        const emailFactor = (result.supportedFirstFactors as EmailFactor[] | undefined)?.find(
          (f) => f.strategy === 'email_code',
        );
        if (!emailFactor) {
          setError('Device verification required but no email factor available. Contact support.');
          return;
        }
        await clerk.client.signIn.prepareFirstFactor({
          strategy: 'email_code',
          emailAddressId: emailFactor.emailAddressId,
        });
        setStep('verify-device');
        return;
      }

      setError(`Unexpected sign-in status: ${result.status}`);
    } catch (err: unknown) {
      const clerkError = err as { errors?: { message: string }[] };
      setError(clerkError?.errors?.[0]?.message ?? 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded) return;

    setError('');
    setLoading(true);

    try {
      const result = await clerk.client.signIn.attemptFirstFactor({
        strategy: 'email_code',
        code: otp,
      });

      if (await finishSignIn(result.status, result.createdSessionId)) return;

      setError(`Unexpected status after verification: ${result.status}`);
    } catch (err: unknown) {
      const clerkError = err as { errors?: { message: string }[] };
      setError(clerkError?.errors?.[0]?.message ?? 'Invalid code. Try again.');
      setOtp('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            {step === 'verify-device' ? <ShieldCheck className="h-6 w-6" /> : <Truck className="h-6 w-6" />}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">SureWaka Admin</h1>
          <p className="text-sm text-muted-foreground">
            {step === 'verify-device'
              ? `We sent a verification code to ${email}`
              : 'Sign in to access the operations dashboard'}
          </p>
        </div>

        {step === 'password' && (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
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
        )}

        {step === 'verify-device' && (
          <form onSubmit={handleOtpSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="otp" className="text-sm font-medium leading-none">
                Verification Code
              </label>
              <Input
                id="otp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="000000"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                required
                autoFocus
                autoComplete="one-time-code"
                className="text-center text-lg tracking-widest"
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading || otp.length !== 6}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Verify Device
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={() => { setStep('password'); setError(''); setOtp(''); }}
            >
              Back to Sign In
            </Button>
          </form>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Access restricted to authorized SureWaka staff only.
        </p>
      </div>
    </div>
  );
}
