import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { challengeMfa, getMfaFactors, verifyMfa } from '~/hooks/use-auth';

export function meta() {
  return [{ title: 'SureWaka Admin - Verify MFA' }];
}

export default function MfaVerify() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);

  useEffect(() => {
    async function initChallenge() {
      const { data: factors } = await getMfaFactors();
      const totpFactor = factors?.totp?.[0];

      if (!totpFactor) {
        // No TOTP factor — redirect to enrollment
        navigate('/mfa/enroll');
        return;
      }

      setFactorId(totpFactor.id);
      const { data: challenge, error: challengeError } = await challengeMfa(totpFactor.id);

      if (challengeError) {
        setError(challengeError.message);
        return;
      }

      if (challenge) {
        setChallengeId(challenge.id);
      }
    }

    initChallenge();
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || !challengeId) return;

    setError('');
    setLoading(true);

    const { error: verifyError } = await verifyMfa(factorId, challengeId, code);

    if (verifyError) {
      setError(verifyError.message);
      setLoading(false);
      // Create a new challenge for retry
      const { data: newChallenge } = await challengeMfa(factorId);
      if (newChallenge) {
        setChallengeId(newChallenge.id);
      }
      return;
    }

    navigate('/');
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Two-Factor Authentication</h1>
          <p className="text-sm text-muted-foreground">
            Enter the 6-digit code from your authenticator app
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="code" className="text-sm font-medium leading-none">
              Verification Code
            </label>
            <Input
              id="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
              autoFocus
              autoComplete="one-time-code"
              className="text-center text-lg tracking-widest"
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading || !challengeId}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Verify
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Open your authenticator app (Google Authenticator, 1Password, etc.) to get the code.
        </p>
      </div>
    </div>
  );
}
