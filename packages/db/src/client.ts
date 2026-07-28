import { drizzle } from 'drizzle-orm/neon-serverless';
import { Pool } from '@neondatabase/serverless';
import * as schema from './schema';

/**
 * Database client using Drizzle ORM connected to Neon Postgres.
 *
 * Uses DATABASE_URL (Neon connection string) for all queries.
 * neon-serverless's Pool (websocket-based) is required over neon-http —
 * neon-http's driver has no transaction support, and db.transaction() is
 * used throughout escrow, payouts, refunds, and wallet credit/debit paths.
 */
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL must be set');
}

const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });
