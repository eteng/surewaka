import { SignUp } from '@clerk/react';

export function meta() {
  return [{ title: 'SureWaka Admin - Create Account' }];
}

export default function SignUpPage() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-4">
      <SignUp
        afterSignUpUrl="/"
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
