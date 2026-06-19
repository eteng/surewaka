import { createClerkClient, type ClerkClient } from '@clerk/backend';

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
 * Clerk user info returned after token verification.
 * This is NOT the final AuthUser — the middleware resolves the internal UUID
 * by looking up the clerk_id in the users table.
 */
export type ClerkUserInfo = {
  clerkId: string;
  email?: string;
  phone?: string;
  name?: string;
  avatarUrl?: string;
  roles: string[];
  carrierId?: string;
};

/**
 * Verify a Clerk session token (from Authorization: Bearer <token>).
 * Returns Clerk user info or null if invalid.
 *
 * Note: This does NOT return an internal user ID. The auth middleware
 * must look up the clerk_id in the users table to resolve the UUID.
 */
export async function verifyToken(token: string): Promise<ClerkUserInfo | null> {
  try {
    const clerk = getClerkClient();

    // Use authenticateRequest with a minimal Request object
    const url = 'http://localhost/api';
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

    // Fetch full user details from Clerk
    const user = await clerk.users.getUser(userId);

    return {
      clerkId: user.id,
      email: user.emailAddresses[0]?.emailAddress ?? undefined,
      phone: user.phoneNumbers[0]?.phoneNumber ?? undefined,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
      avatarUrl: user.imageUrl ?? undefined,
      roles: ((user.publicMetadata as Record<string, unknown>)?.roles as string[]) ?? ['customer'],
      carrierId: (user.publicMetadata as Record<string, unknown>)?.carrier_id as string | undefined,
    };
  } catch {
    return null;
  }
}

export { getClerkClient };
