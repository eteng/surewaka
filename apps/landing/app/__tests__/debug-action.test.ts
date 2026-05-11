import { describe, it, expect, vi } from 'vitest';

vi.mock('~/lib/supabase.server', () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { action } from '../routes/home';
import { getSupabaseAdmin } from '~/lib/supabase.server';

describe('debug', () => {
  it('shows response', async () => {
    const mockInsert = vi.fn().mockResolvedValue({ error: null });
    const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });
    vi.mocked(getSupabaseAdmin).mockReturnValue({ from: mockFrom } as any);

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
