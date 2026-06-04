import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

process.env.PAYSTACK_SECRET_KEY = 'test-secret-key';

describe('Paystack client', () => {
  beforeEach(() => mockFetch.mockReset());

  it('initializeTransaction calls correct endpoint and returns reference + url', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({
        status: true,
        data: { reference: 'ref_abc123', authorization_url: 'https://paystack.com/pay/ref_abc123' },
      }),
    });

    const { initializeTransaction } = await import('../lib/paystack');
    const result = await initializeTransaction(350000, 'user@example.com', { topup_type: 'manual' });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.paystack.co/transaction/initialize',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-secret-key' }),
      }),
    );
    expect(result.reference).toBe('ref_abc123');
    expect(result.authorization_url).toBe('https://paystack.com/pay/ref_abc123');
  });

  it('verifyWebhookSignature returns true for valid signature', async () => {
    const { verifyWebhookSignature } = await import('../lib/paystack');
    const crypto = await import('crypto');
    const body = JSON.stringify({ event: 'charge.success' });
    const sig = crypto.createHmac('sha512', 'test-secret-key').update(body).digest('hex');
    expect(verifyWebhookSignature(body, sig)).toBe(true);
  });

  it('verifyWebhookSignature returns false for wrong signature', async () => {
    const { verifyWebhookSignature } = await import('../lib/paystack');
    expect(verifyWebhookSignature('{"event":"charge.success"}', 'wrong-sig')).toBe(false);
  });
});
