/**
 * Shared DB connection for seed scripts.
 * Auto-detects Neon vs local Postgres from DATABASE_URL.
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle as drizzleNeonHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { neon } from '@neondatabase/serverless';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '../../../../.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must be set in root .env');

const isNeon = connectionString.includes('neon.tech') || connectionString.includes('neon.com');

export const db = isNeon
  ? drizzleNeonHttp(neon(connectionString))
  : drizzlePg(new pg.Pool({ connectionString }));
