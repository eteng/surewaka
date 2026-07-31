import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(process.cwd(), '../../.env'), override: true });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must be set');

const isNeon = connectionString.includes('neon.tech');

const makeDb = async () => {
  if (isNeon) {
    const { drizzle } = await import('drizzle-orm/neon-http');
    const { neon } = await import('@neondatabase/serverless');
    return drizzle(neon(connectionString));
  }
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { Pool } = await import('pg');
  return drizzle(new Pool({ connectionString }));
};

export const db = await makeDb();
