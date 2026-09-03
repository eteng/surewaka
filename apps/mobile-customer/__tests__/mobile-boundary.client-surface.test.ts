// Task 10.1 (part A) — mobile boundary: the Recipients_Client exposes ONLY
// recipient CRUD methods and hits ONLY the /api/v1/recipients endpoint. It has
// no delivery-mutating path, so recipient edit/delete can never mutate a
// delivery / Delivery_Snapshot from the client surface (6.1, 6.4). DB-level
// snapshot immutability is covered separately by the API property test 3.5.
//
// _Requirements: 6.1, 6.4
import { createRecipientsClient } from '@surewaka/mobile-shared';
import { installFetch, ok } from '../test/helpers';

describe('Recipients_Client boundary — recipient-only surface (6.1, 6.4)', () => {
  it('exposes exactly list/get/create/update/remove and nothing delivery-related', () => {
    const client = createRecipientsClient('test-token');
    expect(Object.keys(client).sort()).toEqual(['create', 'get', 'list', 'remove', 'update']);
    // No delivery-mutating method exists on the client surface.
    for (const forbidden of [
      'createDelivery',
      'updateDelivery',
      'cancelDelivery',
      'deliveries',
      'book',
      'confirm',
    ]) {
      expect((client as any)[forbidden]).toBeUndefined();
    }
  });

  it('every recipient operation targets only the /api/v1/recipients endpoint (never /deliveries)', async () => {
    const f = installFetch();
    const client = createRecipientsClient('test-token');

    f.enqueue(ok([]));
    await client.list();
    f.enqueue(ok({ id: 'r1' }));
    await client.get('r1');
    f.enqueue(ok({ id: 'r1' }), { ok: true, status: 201 });
    await client.create({ recipientName: 'Bola Ade', recipientPhone: '08012345678' } as any);
    f.enqueue(ok({ id: 'r1' }));
    await client.update('r1', { recipientName: 'New' } as any);
    f.enqueue(ok(null));
    await client.remove('r1');

    // Every request path is under /api/v1/recipients; none touches deliveries.
    expect(f.calls.length).toBe(5);
    for (const c of f.calls) {
      expect(c.url).toContain('/api/v1/recipients');
      expect(c.url).not.toContain('/deliveries');
      expect(c.url).not.toContain('/delivery');
    }
    // Update uses PUT (standardized), delete uses DELETE — not any delivery verb.
    expect(f.calls.map((c) => c.method).sort()).toEqual(['DELETE', 'GET', 'GET', 'POST', 'PUT']);
  });
});
