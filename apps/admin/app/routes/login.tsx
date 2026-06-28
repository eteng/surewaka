import { SignIn } from '@clerk/react';

export function meta() {
  return [{ title: 'SureWaka Admin - Sign In' }];
}

export default function Login() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <SignIn
        afterSignInUrl="/"
        appearance={{
          variables: {
            colorPrimary: '#16a34a',
            borderRadius: '0.5rem',
          },
        }}
      />
    </div>
  );
}
