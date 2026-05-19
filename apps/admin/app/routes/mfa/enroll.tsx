import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ShieldCheck, Loader2, Copy, Check, RefreshCw } from 'lucide-react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { useMFAEnrollment } from '~/hooks/use-mfa-enrollment';

export function meta() {
  return [{ title: 'SureWaka Admin - Set Up MFA' }];
}

export default function MfaEnroll() {
  const navigate = useNavigate();
  const { state, qrCode, secret, error, verifyCode, retry } = useMFAEnrollment();
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [copied, setCopied] = useState(false);

  // Redirect to dashboard once verified
  if (state === 'verified') {
    navigate('/', { replace: true });
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setVerifying(true);
    await verifyCode(code);
    setVerifying(false);
    setCode('');
  }

  async function handleCopySecret() {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Set Up Two-Factor Auth</h1>
          <p className="text-sm text-muted-foreground">
            {state === 'verify-code'
              ? 'Enter the code from your authenticator app to finish setup'
              : 'Scan the QR code with your authenticator app to secure your account'}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Loading */}
        {state === 'loading' && (
          <div className="flex flex-col items-center gap-2 py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Preparing MFA setup...</p>
          </div>
        )}

        {/* QR Code display (fresh enrollment or resumed with stored QR) */}
        {state === 'show-qr' && qrCode && (
          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="rounded-lg border bg-white p-3">
                <img src={qrCode} alt="MFA QR Code" className="h-48 w-48" />
              </div>
            </div>

            {secret && (
              <div className="space-y-1">
                <p className="text-center text-xs text-muted-foreground">
                  Can't scan? Enter this key manually:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">
                    {secret}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={handleCopySecret}
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Resumed enrollment without QR (user already scanned previously) */}
        {state === 'verify-code' && !qrCode && (
          <div className="rounded-md bg-muted px-4 py-3 text-center text-sm text-muted-foreground">
            You started MFA setup earlier. Enter the code from your authenticator app to complete
            it.
          </div>
        )}

        {/* Verification form (shown for both show-qr and verify-code states) */}
        {(state === 'show-qr' || state === 'verify-code') && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="code" className="text-sm font-medium leading-none">
                Enter the 6-digit code
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

            <Button type="submit" className="w-full" disabled={verifying || code.length !== 6}>
              {verifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Activate Two-Factor Auth
            </Button>
          </form>
        )}

        {/* Error state with retry */}
        {state === 'error' && (
          <div className="space-y-3">
            <Button variant="outline" onClick={retry} className="w-full">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
            <Button
              variant="ghost"
              onClick={() => navigate('/login')}
              className="w-full text-muted-foreground"
            >
              Back to Login
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
