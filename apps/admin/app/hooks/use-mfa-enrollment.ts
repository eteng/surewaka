import { useCallback, useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import QRCode from 'qrcode';

type MfaState = 'idle' | 'loading' | 'show-qr' | 'verify-code' | 'verified' | 'error';

type MfaEnrollmentResult = {
  state: MfaState;
  qrCode: string | null;
  secret: string | null;
  factorId: string | null;
  error: string | null;
  verifyCode: (code: string) => Promise<void>;
  retry: () => void;
};

const SESSION_KEY = 'mfa_enrollment';

type StoredEnrollment = {
  uri: string;
  qrCode: string;
  secret: string;
};

function getStoredEnrollment(): StoredEnrollment | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storeEnrollment(data: StoredEnrollment) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
}

function clearStoredEnrollment() {
  sessionStorage.removeItem(SESSION_KEY);
}

export function useMFAEnrollment(): MfaEnrollmentResult {
  const { user } = useUser();
  const [state, setState] = useState<MfaState>('idle');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  const initialize = useCallback(async () => {
    if (!user) return;

    setState('loading');
    setError(null);

    try {
      // If already enrolled, nothing to do
      if (user.totpEnabled) {
        setState('verified');
        return;
      }

      // Resume from sessionStorage if available (page refresh resilience)
      const stored = getStoredEnrollment();
      if (stored) {
        setQrCode(stored.qrCode);
        setSecret(stored.secret);
        setState('show-qr');
        return;
      }

      // Fresh enrollment
      const totp = await user.createTOTP();
      const uri = totp.uri ?? '';
      const secret = totp.secret ?? '';
      const qrDataUrl = await QRCode.toDataURL(uri);

      setFactorId(totp.id ?? null);
      setQrCode(qrDataUrl);
      setSecret(secret);

      storeEnrollment({ uri, qrCode: qrDataUrl, secret });
      setState('show-qr');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      setState('error');
    }
  }, [user]);

  const verifyCode = async (code: string) => {
    if (!user) return;
    setError(null);

    try {
      await user.verifyTOTP({ code });
      clearStoredEnrollment();
      setState('verified');
    } catch (err: unknown) {
      setError('Invalid code. Check your authenticator app and try again.');
    }
  };

  const retry = useCallback(() => {
    initialized.current = false;
    clearStoredEnrollment();
    initialize();
  }, [initialize]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    initialize();
  }, [initialize]);

  return { state, qrCode, secret, factorId, error, verifyCode, retry };
}
