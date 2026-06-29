import { createClerkClient, verifyToken as clerkVerifyToken, type ClerkClient } from '@clerk/backend';

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
 * Uses clerkVerifyToken (the correct approach for bearer tokens in pure APIs).
 * authenticateRequest is for full web request objects with cookies and domain logic.
 *
 * Note: This does NOT return an internal user ID. The auth middleware
 * must look up the clerk_id in the users table to resolve the UUID.
 */
export async function verifyToken(token: string): Promise<ClerkUserInfo | null> {
  try {
    const payload = await clerkVerifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY!,
    });

    const userId = payload.sub;
    if (!userId) return null;

    const clerk = getClerkClient();
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
  } catch (err) {
    console.error('[verifyToken] Token verification failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

export { getClerkClient };
