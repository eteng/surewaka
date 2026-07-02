import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { classifyZone } from '../lib/zone-classifier';

vi.stubGlobal('fetch', vi.fn());

beforeAll(() => {
  process.env.LOCATIONIQ_API_KEY = 'test-key';
});

afterAll(() => {
  delete process.env.LOCATIONIQ_API_KEY;
});

describe('classifyZone', () => {
  it('returns Lekki for a Lekki address suburb', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        address: { suburb: 'Lekki Phase 1', city: 'Lagos' },
      }),
    });
    const zone = await classifyZone(6.4457, 3.4711);
    expect(zone).toBe('Lekki');
  });

  it('returns Victoria Island for VI neighbourhood', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        address: { neighbourhood: 'Victoria Island', city: 'Lagos' },
      }),
    });
    const zone = await classifyZone(6.4281, 3.4219);
    expect(zone).toBe('Victoria Island');
  });

  it('returns Other when no keyword matches', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        address: { suburb: 'Badagry', city: 'Lagos' },
      }),
    });
    const zone = await classifyZone(6.4104, 2.8849);
    expect(zone).toBe('Other');
  });

  it('returns Other on fetch failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));
    const zone = await classifyZone(6.5244, 3.3792);
    expect(zone).toBe('Other');
  });
});
