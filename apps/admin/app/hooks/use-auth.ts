import { useUser } from '@clerk/react';

type AuthState = {
  user: ReturnType<typeof useUser>['user'];
  loading: boolean;
  mfaEnabled: boolean;
};

export function useAuth(): AuthState {
  const { user, isLoaded } = useUser();

  return {
    user: user ?? null,
    loading: !isLoaded,
    mfaEnabled: user?.totpEnabled ?? false,
  };
}
