import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { useAuth } from '~/hooks/use-auth';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, mfaEnabled } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;

    if (!user) {
      navigate('/login', { replace: true });
      return;
    }

    if (!mfaEnabled) {
      navigate('/mfa/enroll', { replace: true });
    }
  }, [user, loading, mfaEnabled, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user || !mfaEnabled) {
    return null;
  }

  return <>{children}</>;
}
