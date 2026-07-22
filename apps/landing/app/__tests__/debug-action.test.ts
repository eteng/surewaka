import { describe, it, vi } from 'vitest';

const mockValues = vi.fn().mockResolvedValue([]);
const mockInsert = vi.fn().mockReturnValue({ values: mockValues });

vi.mock('@surewaka/db', () => ({
  db: { insert: (...args: unknown[]) => mockInsert(...args) },
  waitlistSignups: 'waitlist_signups',
}));

import { action } from '../routes/home';

describe('debug', () => {
  it('shows response', async () => {
    const formData = new URLSearchParams();
    formData.set('fullName', 'Aa');
    formData.set('email', 'a@a.aa');
    formData.set('userType', 'sender');

    const request = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });

    const response = await action({ request, params: {}, context: {} } as any);
    console.log('RESPONSE:', JSON.stringify(response, null, 2));
    console.log('TYPE:', typeof response);
    console.log('KEYS:', Object.keys(response as any));
  });
});
