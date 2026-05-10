import { Hono } from 'hono';

const deliveries = new Hono();

// List deliveries
deliveries.get('/', (c) => {
  return c.json({ deliveries: [], total: 0 });
});

// Create delivery request
deliveries.post('/', async (c) => {
  const body = await c.req.json();
  return c.json({ id: 'del_placeholder', ...body }, 201);
});

// Get delivery by ID
deliveries.get('/:id', (c) => {
  const id = c.req.param('id');
  return c.json({ id, status: 'pending' });
});

export default deliveries;
