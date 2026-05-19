import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '~/lib/supabase';

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
  factorId: string;
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
  const [state, setState] = useState<MfaState>('idle');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);

  const createChallenge = async (fId: string): Promise<boolean> => {
    const { data, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: fId,
    });
    if (challengeError) {
      setError(challengeError.message);
      setState('error');
      return false;
    }
    setChallengeId(data.id);
    return true;
  };

  const initialize = useCallback(async () => {
    setState('loading');
    setError(null);

    try {
      const { data: factorsData, error: listError } = await supabase.auth.mfa.listFactors();

      if (listError) {
        setError(listError.message);
        setState('error');
        return;
      }

      const verifiedFactor = factorsData?.totp?.find((f) => f.status === 'verified');
      const unverifiedFactor = factorsData?.totp?.find((f) => f.status === 'unverified');

      // Already has a verified factor — shouldn't be on enroll page
      if (verifiedFactor) {
        setState('verified');
        return;
      }

      // Resume an existing unverified factor
      if (unverifiedFactor) {
        setFactorId(unverifiedFactor.id);

        // Try to recover QR from sessionStorage (same browser session)
        const stored = getStoredEnrollment();
        if (stored && stored.factorId === unverifiedFactor.id) {
          setQrCode(stored.qrCode);
          setSecret(stored.secret);
          const ok = await createChallenge(unverifiedFactor.id);
          if (ok) setState('show-qr');
          return;
        }

        // QR is lost but factor exists — create challenge anyway
        // User may have already scanned it on a previous page load
        const ok = await createChallenge(unverifiedFactor.id);
        if (ok) setState('verify-code');
        return;
      }

      // No factors at all — fresh enrollment
      const { data: enrollData, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
      });

      if (enrollError) {
        setError(enrollError.message);
        setState('error');
        return;
      }

      if (enrollData) {
        setFactorId(enrollData.id);
        setQrCode(enrollData.totp.qr_code);
        setSecret(enrollData.totp.secret);

        // Persist QR data in sessionStorage for page refresh resilience
        storeEnrollment({
          factorId: enrollData.id,
          qrCode: enrollData.totp.qr_code,
          secret: enrollData.totp.secret,
        });

        const ok = await createChallenge(enrollData.id);
        if (ok) setState('show-qr');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      setState('error');
    }
  }, []);

  const verifyCode = async (code: string) => {
    if (!factorId) return;

    setError(null);

    // If we don't have a challengeId yet, create one
    let cId = challengeId;
    if (!cId) {
      const { data, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId,
      });
      if (challengeError) {
        setError(challengeError.message);
        return;
      }
      cId = data.id;
      setChallengeId(cId);
    }

    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: cId!,
      code,
    });

    if (verifyError) {
      setError('Invalid code. Check your authenticator app and try again.');
      // Create a fresh challenge for retry
      const { data: newChallenge } = await supabase.auth.mfa.challenge({ factorId });
      if (newChallenge) setChallengeId(newChallenge.id);
      return;
    }

    clearStoredEnrollment();
    setState('verified');
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
