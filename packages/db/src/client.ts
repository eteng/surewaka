import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

/**
 * Database client using Drizzle ORM connected to Neon Postgres.
 *
 * Uses DATABASE_URL (Neon connection string) for all queries.
 * Neon's serverless driver handles connection pooling automatically.
 */
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL must be set');
}

const sql = neon(connectionString);

export const db = drizzle(sql, { schema });
