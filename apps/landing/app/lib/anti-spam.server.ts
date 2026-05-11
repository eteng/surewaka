/**
 * Anti-spam utilities for form submissions.
 * - Honeypot: hidden field that bots fill but humans don't
 * - Rate limiting: in-memory IP-based throttle
 */

// --- Honeypot ---

/**
 * Check if the honeypot field was filled (indicates a bot).
 * Returns true if the submission looks like spam.
 */
export function isHoneypotFilled(formData: FormData): boolean {
  const honeypot = formData.get('website');
  return honeypot !== null && honeypot !== '';
}

// --- Rate Limiting ---

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

// In-memory store (resets on cold start — acceptable for serverless)
const rateLimitStore = new Map<string, RateLimitEntry>();

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX_REQUESTS = 5; // max 5 submissions per IP per hour

/**
 * Check if an IP has exceeded the rate limit.
 * Returns true if the request should be blocked.
 */
export function isRateLimited(request: Request): boolean {
  const ip = getClientIP(request);
  if (!ip) return false; // Can't rate limit without IP

  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now > entry.resetAt) {
    // First request or window expired — start fresh
    rateLimitStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count++;

  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }

  return false;
}

function getClientIP(request: Request): string | null {
  // Vercel/Cloudflare forward the real IP in these headers
  const headers = request.headers;
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    headers.get('cf-connecting-ip') ||
    null
  );
}
