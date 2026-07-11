import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property-based tests for the zone classifier.
 *
 * We test the internal logic by reimplementing the pure functions (matchZone, isInBoundingBox)
 * locally, matching the production implementation exactly. This avoids needing to export
 * internal functions or mock the DB for pure-logic property tests.
 *
 * For Property 8 (Two-Phase Order), we test via the public classifyZone function with mocked DB.
 */

// ─── Reimplementation of pure internal functions for property testing ───

type ZoneDef = {
  id: string;
  name: string;
  city: string;
  keywords: string[];
  swLat: number | null;
  swLng: number | null;
  neLat: number | null;
  neLng: number | null;
};

type ClassifyResult = { id: string; name: string } | null;

function isInBoundingBox(lat: number, lng: number, zone: ZoneDef): boolean {
  if (zone.swLat == null || zone.swLng == null || zone.neLat == null || zone.neLng == null) {
    return true; // No bounding box = no pre-filter
  }
  return lat >= zone.swLat && lat <= zone.neLat && lng >= zone.swLng && lng <= zone.neLng;
}

function matchZone(addressText: string, zoneDefs: ZoneDef[], lat: number, lng: number): ClassifyResult {
  const lower = addressText.toLowerCase();
  let bestMatch: ClassifyResult = null;
  let bestKeywordLen = 0;
  let bestIndex = Infinity;

  for (const zone of zoneDefs) {
    if (!isInBoundingBox(lat, lng, zone)) continue;
    for (const kw of zone.keywords) {
      const idx = lower.indexOf(kw.toLowerCase());
      if (idx === -1) continue;
      if (kw.length > bestKeywordLen || (kw.length === bestKeywordLen && idx < bestIndex)) {
        bestMatch = { id: zone.id, name: zone.name };
        bestKeywordLen = kw.length;
        bestIndex = idx;
      }
    }
  }

  return bestMatch;
}

// ─── Arbitraries / Generators ───

const zoneDefArb = (overrides?: Partial<ZoneDef>): fc.Arbitrary<ZoneDef> =>
  fc.record({
    id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 30 }),
    city: fc.constant('Lagos'),
    keywords: fc.array(fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length > 0), {
      minLength: 1,
      maxLength: 5,
    }),
    swLat: fc.constant(null),
    swLng: fc.constant(null),
    neLat: fc.constant(null),
    neLng: fc.constant(null),
  }).map((z) => ({ ...z, ...overrides }));

/** Generate a zone with a valid bounding box */
const zoneWithBboxArb: fc.Arbitrary<ZoneDef> = fc
  .record({
    id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 30 }),
    city: fc.constant('Lagos'),
    keywords: fc.array(fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length > 0), {
      minLength: 1,
      maxLength: 5,
    }),
    swLat: fc.double({ min: -89, max: 89, noNaN: true }),
    swLng: fc.double({ min: -179, max: 179, noNaN: true }),
    latSpan: fc.double({ min: 0.01, max: 5, noNaN: true }),
    lngSpan: fc.double({ min: 0.01, max: 5, noNaN: true }),
  })
  .map((z) => ({
    id: z.id,
    name: z.name,
    city: z.city,
    keywords: z.keywords,
    swLat: z.swLat,
    swLng: z.swLng,
    neLat: Math.min(z.swLat + z.latSpan, 90),
    neLng: Math.min(z.swLng + z.lngSpan, 180),
  }));

/** Generate a zone without a bounding box */
const zoneWithoutBboxArb: fc.Arbitrary<ZoneDef> = zoneDefArb();

// ─── Property Tests ───

describe('Zone Classifier — Property Tests', () => {
  /**
   * **Validates: Requirements 3.1, 3.2**
   *
   * Property 2: Classifier Determinism
   * matchZone always returns the zone with the longest matching keyword,
   * ties broken by earliest index in the address text.
   */
  describe('Property 2: Classifier Determinism', () => {
    it('always returns the zone with the longest matching keyword', () => {
      fc.assert(
        fc.property(
          // Generate 2+ zones with distinct keywords, and an address that contains at least one keyword from each
          fc.array(fc.uuid(), { minLength: 2, maxLength: 5 }).chain((ids) => {
            // Create zones with controlled, distinct keywords
            const keywordsPerZone = ids.map((_, i) => {
              // Each zone gets a keyword of increasing length
              const base = 'kw' + String.fromCharCode(97 + i); // kwa, kwb, kwc...
              return base.repeat(i + 1); // 'kwa', 'kwbkwb', 'kwckwckwc'...
            });

            const zones: ZoneDef[] = ids.map((id, i) => ({
              id,
              name: `Zone${i}`,
              city: 'Lagos',
              keywords: [keywordsPerZone[i]!],
              swLat: null,
              swLng: null,
              neLat: null,
              neLng: null,
            }));

            // Build an address text that contains ALL keywords
            const addressText = keywordsPerZone.join(' test ');

            return fc.constant({ zones, addressText, keywordsPerZone });
          }),
          ({ zones, addressText, keywordsPerZone }) => {
            const result = matchZone(addressText, zones, 6.5, 3.4);

            // The longest keyword belongs to the last zone (since length increases)
            const longestKw = keywordsPerZone.reduce((a, b) => (b.length > a.length ? b : a));
            const expectedZoneIdx = keywordsPerZone.indexOf(longestKw);
            const expectedZone = zones[expectedZoneIdx];

            expect(result).not.toBeNull();
            expect(result!.id).toBe(expectedZone!.id);
            expect(result!.name).toBe(expectedZone!.name);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('breaks ties by earliest keyword index in address text', () => {
      fc.assert(
        fc.property(
          fc.record({
            id1: fc.uuid(),
            id2: fc.uuid(),
            // Two distinct keywords of the same length
            kwBase: fc.string({ minLength: 3, maxLength: 8 }).map((s) => s.replace(/\s+/g, '').toLowerCase()).filter((s) => s.length >= 3),
          }).filter(({ id1, id2 }) => id1 !== id2),
          ({ id1, id2, kwBase }) => {
            // Generate two distinct keywords of the same length
            const kw1 = kwBase + 'aa';
            const kw2 = kwBase + 'bb';

            const zone1: ZoneDef = {
              id: id1,
              name: 'ZoneA',
              city: 'Lagos',
              keywords: [kw1],
              swLat: null,
              swLng: null,
              neLat: null,
              neLng: null,
            };
            const zone2: ZoneDef = {
              id: id2,
              name: 'ZoneB',
              city: 'Lagos',
              keywords: [kw2],
              swLat: null,
              swLng: null,
              neLat: null,
              neLng: null,
            };

            // Address text where kw1 appears BEFORE kw2
            const addressText = `${kw1} then ${kw2} end`;

            // kw1 and kw2 have the same length, but kw1 appears earlier in the text
            // So zone1 should win regardless of zone array ordering
            const result1 = matchZone(addressText, [zone1, zone2], 6.5, 3.4);
            const result2 = matchZone(addressText, [zone2, zone1], 6.5, 3.4);

            // Zone1 should always win since its keyword appears first (lower index)
            expect(result1).not.toBeNull();
            expect(result2).not.toBeNull();
            expect(result1!.id).toBe(id1);
            expect(result2!.id).toBe(id1);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('result is independent of zone array ordering', () => {
      fc.assert(
        fc.property(
          fc.record({
            id1: fc.uuid(),
            id2: fc.uuid(),
            id3: fc.uuid(),
          }).chain(({ id1, id2, id3 }) => {
            // Three zones with different-length keywords
            const zones: ZoneDef[] = [
              { id: id1, name: 'Short', city: 'Lagos', keywords: ['lek'], swLat: null, swLng: null, neLat: null, neLng: null },
              { id: id2, name: 'Medium', city: 'Lagos', keywords: ['lekki'], swLat: null, swLng: null, neLat: null, neLng: null },
              { id: id3, name: 'Long', city: 'Lagos', keywords: ['lekki phase'], swLat: null, swLng: null, neLat: null, neLng: null },
            ];
            return fc.shuffledSubarray(zones, { minLength: 3, maxLength: 3 }).map((shuffled) => ({ zones, shuffled }));
          }),
          ({ zones, shuffled }) => {
            const addressText = 'delivery to lekki phase 1 area';
            const resultOriginal = matchZone(addressText, zones, 6.5, 3.4);
            const resultShuffled = matchZone(addressText, shuffled, 6.5, 3.4);

            // Both should return the zone with the longest keyword ('lekki phase')
            expect(resultOriginal).not.toBeNull();
            expect(resultShuffled).not.toBeNull();
            expect(resultOriginal!.id).toBe(resultShuffled!.id);
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Property 3: Bounding Box Pre-Filter
   * Zones excluded if point outside box; zones without bbox always pass.
   */
  describe('Property 3: Bounding Box Pre-Filter', () => {
    it('zones without bounding box always pass the pre-filter', () => {
      fc.assert(
        fc.property(
          fc.double({ min: -90, max: 90, noNaN: true }),
          fc.double({ min: -180, max: 180, noNaN: true }),
          zoneWithoutBboxArb,
          (lat, lng, zone) => {
            // A zone without a bounding box always passes
            expect(isInBoundingBox(lat, lng, zone)).toBe(true);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('point inside bounding box passes pre-filter', () => {
      fc.assert(
        fc.property(
          zoneWithBboxArb.chain((zone) => {
            // Generate a point guaranteed to be inside the bbox
            const lat = fc.double({ min: zone.swLat!, max: zone.neLat!, noNaN: true });
            const lng = fc.double({ min: zone.swLng!, max: zone.neLng!, noNaN: true });
            return fc.record({ zone: fc.constant(zone), lat, lng });
          }),
          ({ zone, lat, lng }) => {
            expect(isInBoundingBox(lat, lng, zone)).toBe(true);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('point outside bounding box fails pre-filter', () => {
      // Use a constrained bbox generator that leaves room on all sides
      const constrainedBboxZone: fc.Arbitrary<ZoneDef> = fc
        .record({
          id: fc.uuid(),
          name: fc.string({ minLength: 1, maxLength: 10 }),
          city: fc.constant('Lagos'),
          keywords: fc.array(fc.string({ minLength: 1, maxLength: 10 }).map((s) => s.replace(/\s+/g, ' ').trim()).filter((s) => s.length > 0), {
            minLength: 1,
            maxLength: 3,
          }),
          swLat: fc.double({ min: -80, max: 80, noNaN: true }),
          swLng: fc.double({ min: -170, max: 170, noNaN: true }),
          latSpan: fc.double({ min: 0.1, max: 5, noNaN: true }),
          lngSpan: fc.double({ min: 0.1, max: 5, noNaN: true }),
        })
        .map((z) => ({
          id: z.id,
          name: z.name,
          city: z.city,
          keywords: z.keywords,
          swLat: z.swLat,
          swLng: z.swLng,
          neLat: Math.min(z.swLat + z.latSpan, 89),
          neLng: Math.min(z.swLng + z.lngSpan, 179),
        }));

      fc.assert(
        fc.property(
          constrainedBboxZone.chain((zone) => {
            // Choose one of 4 strategies for generating a point outside the bbox
            return fc.constantFrom('above', 'below', 'left', 'right').chain((dir) => {
              let lat: fc.Arbitrary<number>;
              let lng: fc.Arbitrary<number>;

              switch (dir) {
                case 'above':
                  lat = fc.double({ min: zone.neLat! + 0.01, max: 90, noNaN: true });
                  lng = fc.double({ min: -180, max: 180, noNaN: true });
                  break;
                case 'below':
                  lat = fc.double({ min: -90, max: zone.swLat! - 0.01, noNaN: true });
                  lng = fc.double({ min: -180, max: 180, noNaN: true });
                  break;
                case 'left':
                  lat = fc.double({ min: -90, max: 90, noNaN: true });
                  lng = fc.double({ min: -180, max: zone.swLng! - 0.01, noNaN: true });
                  break;
                case 'right':
                default:
                  lat = fc.double({ min: -90, max: 90, noNaN: true });
                  lng = fc.double({ min: zone.neLng! + 0.01, max: 180, noNaN: true });
                  break;
              }

              return fc.record({ zone: fc.constant(zone), lat, lng });
            });
          }),
          ({ zone, lat, lng }) => {
            expect(isInBoundingBox(lat, lng, zone)).toBe(false);
          },
        ),
        { numRuns: 200 },
      );
    });

    it('zones excluded by bounding box are never returned by matchZone', () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.uuid(),
            keyword: fc.string({ minLength: 3, maxLength: 10 }).map((s) => s.replace(/\s+/g, '').toLowerCase()).filter((s) => s.length >= 3),
          }),
          ({ id, keyword }) => {
            // A zone with a bounding box around Lagos (6.4-6.6, 3.3-3.5)
            const zone: ZoneDef = {
              id,
              name: 'TestZone',
              city: 'Lagos',
              keywords: [keyword],
              swLat: 6.4,
              swLng: 3.3,
              neLat: 6.6,
              neLng: 3.5,
            };

            // Address text contains the keyword
            const addressText = `delivery to ${keyword} area`;

            // Point clearly outside the bounding box
            const outsideLat = 7.0;
            const outsideLng = 4.0;

            const result = matchZone(addressText, [zone], outsideLat, outsideLng);
            expect(result).toBeNull();
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  /**
   * **Validates: Requirements 3.1, 3.4**
   *
   * Property 8: Two-Phase Order
   * Phase 1 result prevents Phase 2 execution.
   */
  describe('Property 8: Two-Phase Order', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.resetModules();
    });

    it('if Phase 1 (local match) returns a result, Phase 2 (remote) never executes', async () => {
      // We need to test the actual classifyZone function with mocked DB
      // Mock the DB module to return controlled zone data
      vi.doMock('@surewaka/db', () => ({
        db: {
          select: () => ({
            from: () => ({
              where: () =>
                Promise.resolve([
                  {
                    id: '11111111-1111-1111-1111-111111111111',
                    name: 'Lekki',
                    city: 'Lagos',
                    keywords: ['lekki', 'ajah', 'chevron'],
                    swLat: null,
                    swLng: null,
                    neLat: null,
                    neLng: null,
                    isActive: true,
                  },
                  {
                    id: '22222222-2222-2222-2222-222222222222',
                    name: 'Ikeja',
                    city: 'Lagos',
                    keywords: ['ikeja', 'maryland', 'alausa'],
                    swLat: null,
                    swLng: null,
                    neLat: null,
                    neLng: null,
                    isActive: true,
                  },
                ]),
            }),
          }),
        },
        zones: {},
      }));

      vi.doMock('drizzle-orm', () => ({
        eq: () => ({}),
      }));

      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock;
      process.env.LOCATIONIQ_API_KEY = 'test-key';

      // Import the classifier fresh with mocked deps
      const { classifyZone, invalidateZoneCache } = await import('../zone-classifier');
      invalidateZoneCache();

      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('lekki', 'ajah', 'chevron', 'ikeja', 'maryland', 'alausa'),
          fc.double({ min: 6.0, max: 7.0, noNaN: true }),
          fc.double({ min: 3.0, max: 4.0, noNaN: true }),
          async (keyword, lat, lng) => {
            fetchMock.mockClear();
            invalidateZoneCache();

            const addressText = `delivery to ${keyword} area`;
            const result = await classifyZone(addressText, lat, lng);

            // Phase 1 matched — should have a result
            expect(result).not.toBeNull();
            // Phase 2 (fetch) should NOT have been called
            expect(fetchMock).not.toHaveBeenCalled();
          },
        ),
        { numRuns: 30 },
      );

      delete process.env.LOCATIONIQ_API_KEY;
    });
  });
});
