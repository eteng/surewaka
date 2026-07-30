import type { Context, Next } from 'hono';

/**
 * Maintenance mode middleware.
 *
 * When MAINTENANCE_MODE=true, all routes except /health return 503
 * with a MAINTENANCE error code. The /health endpoint handles its own
 * maintenance response separately (returns 503 with status:'maintenance').
 *
 * Activate: flyctl secrets set MAINTENANCE_MODE=true --app surewaka-api
 * Deactivate: flyctl secrets unset MAINTENANCE_MODE --app surewaka-api
 */
export async function maintenanceMode(c: Context, next: Next) {
  if (process.env.MAINTENANCE_MODE !== 'true') {
    return next();
  }

  // Always let /health through (it has its own maintenance response)
  if (c.req.path === '/health') {
    return next();
  }

  return c.json(
    {
      data: null,
      error: {
        code: 'MAINTENANCE',
        message: process.env.MAINTENANCE_MESSAGE || 'Scheduled maintenance in progress. Back shortly.',
      },
      meta: {
        eta: process.env.MAINTENANCE_ETA || null,
      },
    },
    503,
  );
}
