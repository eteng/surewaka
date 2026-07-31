import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { Pool as NeonPool } from '@neondatabase/serverless';
import { Pool as PgPool } from 'pg';
import * as schema from './schema';

/**
 * Database client using Drizzle ORM.
 *
 * Automatically selects the driver based on DATABASE_URL:
 * - Neon URLs (contains 'neon.tech' or 'neon.com') → @neondatabase/serverless (WebSocket Pool)
 * - Local/standard Postgres URLs → node-postgres (TCP Pool)
 *
 * Both support transactions (db.transaction() works with either driver).
 */
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL must be set');
}

const isNeon = connectionString.includes('neon.tech') || connectionString.includes('neon.com');

export const db = isNeon
  ? drizzleNeon(new NeonPool({ connectionString }), { schema })
  : drizzlePg(new PgPool({ connectionString }), { schema });
