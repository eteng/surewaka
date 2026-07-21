import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist mock fns so they're accessible in the mock factories and test bodies
const mockSelect = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() => vi.fn());
const mockWhere = vi.hoisted(() => vi.fn());

// Chainable query builder: db.select().from().where()
mockSelect.mockReturnValue({ from: mockFrom });
mockFrom.mockReturnValue({ where: mockWhere });
mockWhere.mockResolvedValue([]);

// Mock the DB client — zone-classifier imports { db } from './client'
vi.mock('../client', () => ({
  db: { select: mockSelect },
}));

// Mock the schema — zone-classifier imports { zones } from './schema'
vi.mock('../schema', () => ({
  zones: { isActive: 'is_active' },
}));

// Must import after mock setup
import { classifyZone, invalidateZoneCache } from '../zone-classifier';

// Stub fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Helpers to build zone rows matching the DB select shape
function makeZoneRow(overrides: Partial<{
  id: string;
  name: string;
  city: string;
  keywords: string[];
  swLat: number | null;
  swLng: number | null;
  neLat: number | null;
  neLng: number | null;
  isActive: boolean;
}> = {}) {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? 'TestZone',
    city: overrides.city ?? 'Lagos',
    country: 'Nigeria',
    keywords: overrides.keywords ?? ['testkeyword'],
    swLat: overrides.swLat ?? null,
    swLng: overrides.swLng ?? null,
    neLat: overrides.neLat ?? null,
    neLng: overrides.neLng ?? null,
    isActive: overrides.isActive ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('zone-classifier', () => {
  beforeEach(() => {
    // Reset cache before each test so DB is re-fetched
    invalidateZoneCache();
    vi.clearAllMocks();
    // Restore chainable mock chain after clearAllMocks
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue([]);
    process.env.LOCATIONIQ_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.LOCATIONIQ_API_KEY;
  });

  describe('Two-phase: local match skips remote', () => {
    it('returns zone from Phase 1 and never calls fetch (Phase 2 skipped)', async () => {
      const lekki = makeZoneRow({ id: 'zone-lekki', name: 'Lekki', keywords: ['lekki', 'ajah'] });
      mockWhere.mockResolvedValueOnce([lekki]);

      const result = await classifyZone('123 Lekki Phase 1, Lagos', 6.45, 3.47);

      expect(result).toEqual({ id: 'zone-lekki', name: 'Lekki' });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('falls through to Phase 2 when Phase 1 has no match', async () => {
      const lekki = makeZoneRow({ id: 'zone-lekki', name: 'Lekki', keywords: ['lekki'] });
      mockWhere.mockResolvedValueOnce([lekki]);

      // Address text has no matching keywords
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ address: { suburb: 'Lekki Phase 1', city: 'Lagos' } }),
      });

      const result = await classifyZone('No matching text here', 6.45, 3.47);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ id: 'zone-lekki', name: 'Lekki' });
    });
  });

  describe('Keyword matching priority (longest wins, earliest index breaks ties)', () => {
    it('selects the zone with the longest matching keyword', async () => {
      const short = makeZoneRow({ id: 'zone-vi', name: 'Victoria Island', keywords: ['vi'] });
      const long = makeZoneRow({
        id: 'zone-island',
        name: 'Island',
        keywords: ['victoria island'],
      });
      mockWhere.mockResolvedValueOnce([short, long]);

      // "victoria island" (16 chars) is longer than "vi" (2 chars)
      const result = await classifyZone('Deliver to victoria island area', 6.43, 3.42);

      expect(result).toEqual({ id: 'zone-island', name: 'Island' });
    });

    it('breaks ties by earliest index in address text', async () => {
      const zoneA = makeZoneRow({ id: 'zone-a', name: 'ZoneA', keywords: ['ikeja'] });
      const zoneB = makeZoneRow({ id: 'zone-b', name: 'ZoneB', keywords: ['yaba'] });
      // Both keywords are 4-5 chars. "yaba" appears at index 0, "ikeja" appears later
      mockWhere.mockResolvedValueOnce([zoneA, zoneB]);

      const result = await classifyZone('yaba street near ikeja bus stop', 6.5, 3.37);

      // "yaba" (4 chars) vs "ikeja" (5 chars) - ikeja is longer, so it wins
      expect(result).toEqual({ id: 'zone-a', name: 'ZoneA' });
    });

    it('breaks ties by earliest index when keywords have same length', async () => {
      const zoneA = makeZoneRow({ id: 'zone-a', name: 'ZoneA', keywords: ['abcde'] });
      const zoneB = makeZoneRow({ id: 'zone-b', name: 'ZoneB', keywords: ['fghij'] });
      // Both keywords are 5 chars
      mockWhere.mockResolvedValueOnce([zoneA, zoneB]);

      // "fghij" appears at index 0, "abcde" appears at index 15
      const result = await classifyZone('fghij is before abcde here', 6.5, 3.37);

      // Same length → earliest index wins → "fghij" at index 0
      expect(result).toEqual({ id: 'zone-b', name: 'ZoneB' });
    });
  });

  describe('Bounding box filtering (inside, outside, no bbox)', () => {
    it('matches a zone when the point is inside its bounding box', async () => {
      const zone = makeZoneRow({
        id: 'zone-lekki',
        name: 'Lekki',
        keywords: ['lekki'],
        swLat: 6.40,
        swLng: 3.40,
        neLat: 6.50,
        neLng: 3.60,
      });
      mockWhere.mockResolvedValueOnce([zone]);

      // Point (6.45, 3.47) is inside the box
      const result = await classifyZone('Lekki Phase 1', 6.45, 3.47);

      expect(result).toEqual({ id: 'zone-lekki', name: 'Lekki' });
    });

    it('skips a zone when the point is outside its bounding box', async () => {
      const zone = makeZoneRow({
        id: 'zone-lekki',
        name: 'Lekki',
        keywords: ['lekki'],
        swLat: 6.40,
        swLng: 3.40,
        neLat: 6.50,
        neLng: 3.60,
      });
      mockWhere.mockResolvedValueOnce([zone]);

      // Point (7.0, 4.0) is outside the box
      const result = await classifyZone('Lekki Phase 1', 7.0, 4.0, { skipRemote: true });

      expect(result).toBeNull();
    });

    it('always passes the pre-filter when zone has no bounding box', async () => {
      const zone = makeZoneRow({
        id: 'zone-mainland',
        name: 'Mainland',
        keywords: ['mainland'],
        swLat: null,
        swLng: null,
        neLat: null,
        neLng: null,
      });
      mockWhere.mockResolvedValueOnce([zone]);

      // Any coordinate should pass since there's no bbox
      const result = await classifyZone('Deliver to mainland area', 99.0, 99.0);

      expect(result).toEqual({ id: 'zone-mainland', name: 'Mainland' });
    });
  });

  describe('LocationIQ failure returns null', () => {
    it('returns null when LocationIQ returns non-2xx status', async () => {
      const zone = makeZoneRow({ id: 'zone-lekki', name: 'Lekki', keywords: ['lekki'] });
      mockWhere.mockResolvedValueOnce([zone]);

      // No local match, Phase 2 needed
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await classifyZone('unknown address text', 6.45, 3.47);

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });

    it('returns null when fetch throws a network error', async () => {
      const zone = makeZoneRow({ id: 'zone-lekki', name: 'Lekki', keywords: ['lekki'] });
      mockWhere.mockResolvedValueOnce([zone]);

      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await classifyZone('unknown address text', 6.45, 3.47);

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });

    it('returns null when LOCATIONIQ_API_KEY is not set', async () => {
      delete process.env.LOCATIONIQ_API_KEY;

      const zone = makeZoneRow({ id: 'zone-lekki', name: 'Lekki', keywords: ['lekki'] });
      mockWhere.mockResolvedValueOnce([zone]);

      const result = await classifyZone('unknown address text', 6.45, 3.47);

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Cache invalidation resets cached data', () => {
    it('fetches from DB again after invalidateZoneCache is called', async () => {
      const zoneV1 = makeZoneRow({ id: 'zone-a', name: 'ZoneA', keywords: ['alpha'] });
      const zoneV2 = makeZoneRow({ id: 'zone-b', name: 'ZoneB', keywords: ['alpha'] });

      // First call populates cache
      mockWhere.mockResolvedValueOnce([zoneV1]);
      const result1 = await classifyZone('alpha street', 6.5, 3.4, { skipRemote: true });
      expect(result1).toEqual({ id: 'zone-a', name: 'ZoneA' });

      // Second call uses cache (no new DB call)
      const result2 = await classifyZone('alpha street', 6.5, 3.4, { skipRemote: true });
      expect(result2).toEqual({ id: 'zone-a', name: 'ZoneA' });
      expect(mockWhere).toHaveBeenCalledTimes(1);

      // Invalidate cache
      invalidateZoneCache();

      // Third call fetches from DB again with updated data
      mockWhere.mockResolvedValueOnce([zoneV2]);
      const result3 = await classifyZone('alpha street', 6.5, 3.4, { skipRemote: true });
      expect(result3).toEqual({ id: 'zone-b', name: 'ZoneB' });
      expect(mockWhere).toHaveBeenCalledTimes(2);
    });
  });

  describe('skipRemote option prevents Phase 2', () => {
    it('returns null without calling fetch when skipRemote is true and Phase 1 fails', async () => {
      const zone = makeZoneRow({ id: 'zone-lekki', name: 'Lekki', keywords: ['lekki'] });
      mockWhere.mockResolvedValueOnce([zone]);

      // Address text has no matching keywords
      const result = await classifyZone('no match here', 6.45, 3.47, { skipRemote: true });

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('still returns Phase 1 result when skipRemote is true and Phase 1 succeeds', async () => {
      const zone = makeZoneRow({ id: 'zone-lekki', name: 'Lekki', keywords: ['lekki'] });
      mockWhere.mockResolvedValueOnce([zone]);

      const result = await classifyZone('deliver to lekki', 6.45, 3.47, { skipRemote: true });

      expect(result).toEqual({ id: 'zone-lekki', name: 'Lekki' });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
