import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Health check
app.get('/health', (c) => c.json({ status: 'ok', service: 'surewaka-api' }));

// API routes
app.get('/api/v1', (c) => c.json({ message: 'SureWaka API v1' }));

// Start server
const port = Number(process.env.PORT) || 4000;
console.log(`🚀 SureWaka API running on port ${port}`);

serve({ fetch: app.fetch, port });

export default app;
