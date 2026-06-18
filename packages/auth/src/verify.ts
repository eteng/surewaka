import { createClerkClient, type ClerkClient } from '@clerk/backend';
import type { AuthUser } from './types';

let clerkClient: ClerkClient | null = null;

function getClerkClient(): ClerkClient {
  if (!clerkClient) {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) {
      throw new Error('CLERK_SECRET_KEY must be set');
    }
    clerkClient = createClerkClient({ secretKey });
  }
  return clerkClient;
}

/**
 * Verify a Clerk session token (from Authorization: Bearer <token>).
 * Returns the authenticated user or null if invalid.
 *
 * Uses authenticateRequest() which handles JWT verification, expiry checks,
 * and signature validation.
 */
export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const clerk = getClerkClient();

    // Use authenticateRequest with a minimal Request object
    const url = 'http://localhost/api'; // dummy URL, only token matters
    const request = new Request(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const requestState = await clerk.authenticateRequest(request, {
      secretKey: process.env.CLERK_SECRET_KEY!,
      publishableKey: process.env.CLERK_PUBLISHABLE_KEY!,
    });

    if (!requestState.isSignedIn) {
      return null;
    }

    const auth = requestState.toAuth();
    const userId = auth.userId;

    if (!userId) {
      return null;
    }

    // fva = [firstFactorAge, secondFactorAge] in seconds; -1 means not verified
    const fva = (auth.sessionClaims as Record<string, unknown>)?.fva as [number, number] | undefined;
    const mfaVerified = Array.isArray(fva) && fva[1] !== -1;

    // Fetch full user details from Clerk
    const user = await clerk.users.getUser(userId);

    return {
      id: user.id,
      email: user.emailAddresses[0]?.emailAddress ?? undefined,
      phone: user.phoneNumbers[0]?.phoneNumber ?? undefined,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
      avatarUrl: user.imageUrl ?? undefined,
      role: (user.publicMetadata as Record<string, unknown>)?.primary_role as string | undefined,
      roles: ((user.publicMetadata as Record<string, unknown>)?.roles as string[]) ?? ['customer'],
      carrierId: (user.publicMetadata as Record<string, unknown>)?.carrier_id as string | undefined,
      mfaVerified,
    };
  } catch {
    return null;
  }
}

export { getClerkClient };
