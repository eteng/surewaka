import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { useAuth } from '~/hooks/use-auth';

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading, aal } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;

    if (!user) {
      navigate('/login', { replace: true });
      return;
    }

    // Check MFA status
    if (aal) {
      if (aal.nextLevel === 'aal2' && aal.currentLevel === 'aal1') {
        // Has MFA enrolled but needs to verify this session
        navigate('/mfa/verify', { replace: true });
      } else if (aal.currentLevel === 'aal1' && aal.nextLevel === 'aal1') {
        // No MFA enrolled — force enrollment
        navigate('/mfa/enroll', { replace: true });
      }
    }
  }, [user, loading, aal, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // If MFA is required but not at aal2, don't render children
  if (aal && aal.currentLevel !== 'aal2' && aal.nextLevel === 'aal2') {
    return null;
  }

  return <>{children}</>;
}
