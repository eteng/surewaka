import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { requestLogger } from './middleware/logging';
import authRoutes from './routes/auth';
import addressRoutes from './routes/addresses';
import carrierRoutes from './routes/carriers';
import deliveryRoutes from './routes/deliveries';
import notificationRoutes from './routes/notifications';
import profileRoutes from './routes/profile';
import adminNameChangeRoutes from './routes/admin/name-change-requests';
import adminRoleRoutes from './routes/admin/roles';
import adminUserRoutes from './routes/admin/users';
import adminWaitlistRoutes from './routes/admin/waitlist';
import adminCarrierRoutes from './routes/admin/carriers';
import carrierApplicationRoutes from './routes/carrier-applications';
import walletRoutes from './routes/wallet';
import webhookRoutes from './routes/webhook';
import bookingPaymentRoutes from './routes/booking-payment';
import payoutRoutes from './routes/payouts';

const app = new Hono();

// Middleware
app.use('*', requestLogger);
app.use('*', cors({
  origin: '*',
  allowHeaders: ['Authorization', 'Content-Type'],
  allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  exposeHeaders: ['Content-Length'],
  maxAge: 86400,
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', service: 'surewaka-api' }));

// API routes
app.get('/api/v1', (c) => c.json({ message: 'SureWaka API v1' }));
app.route('/api/v1/auth', authRoutes);
app.route('/api/v1/addresses', addressRoutes);
app.route('/api/v1/carriers', carrierRoutes);
app.route('/api/v1/deliveries', deliveryRoutes);
app.route('/api/v1/notifications', notificationRoutes);
app.route('/api/v1/profile', profileRoutes);
app.route('/api/v1/admin/name-change-requests', adminNameChangeRoutes);
app.route('/api/v1/admin/roles', adminRoleRoutes);
app.route('/api/v1/admin/users', adminUserRoutes);
app.route('/api/v1/admin/waitlist', adminWaitlistRoutes);
app.route('/api/v1/admin/carriers', adminCarrierRoutes);
app.route('/api/v1/carrier-applications', carrierApplicationRoutes);
app.route('/api/v1/wallet', walletRoutes);
app.route('/api/v1/webhook', webhookRoutes);
app.route('/api/v1', bookingPaymentRoutes);
app.route('/api/v1/payouts', payoutRoutes);

// Start server
const port = Number(process.env.PORT) || 4000;
console.log(`🚀 SureWaka API running on port ${port}`);

serve({ fetch: app.fetch, port });

export default app;
