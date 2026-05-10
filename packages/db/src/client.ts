import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Database client using Drizzle ORM connected to Supabase Postgres.
 *
 * Uses the pooled connection (DATABASE_POOL_URL) for server queries
 * and direct connection (DATABASE_URL) for migrations.
 */
const connectionString = process.env.DATABASE_POOL_URL || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL or DATABASE_POOL_URL must be set');
}

const client = postgres(connectionString, {
  prepare: false, // Required for Supabase connection pooling (PgBouncer)
});

export const db = drizzle(client, { schema });
