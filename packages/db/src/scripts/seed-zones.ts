/**
 * Seed script: Insert Nigeria zone data for the dynamic zones system.
 *
 * Run: npx tsx packages/db/src/scripts/seed-zones.ts
 *
 * Prerequisites:
 * - DATABASE_URL set in root .env
 * - zones table must exist (run db:migrate or db:push first)
 *
 * Safe to run multiple times — skips zones that already exist by (name, city, country).
 *
 * Tiers:
 *   1. Lagos — 6 zones with full keyword sets and bounding boxes
 *   2. Major metros (Abuja, Port Harcourt, Ibadan, Kano) — 4–6 zones each
 *   3. State capitals (~30 zones, 1 each) — city name + common area keywords
 *
 * Total: ~60 rows. No "Other" zone anywhere.
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { zones } from '../schema/zones';
import { and, eq } from 'drizzle-orm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '../../../../.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must be set in root .env');

const db = drizzle(neon(connectionString));

type ZoneSeed = {
  name: string;
  city: string;
  country: string;
  keywords: string[];
  swLat?: number;
  swLng?: number;
  neLat?: number;
  neLng?: number;
};

// ─── Tier 1: Lagos (6 zones with bounding boxes) ────────────────────────────

const LAGOS_ZONES: ZoneSeed[] = [
  {
    name: 'Lekki',
    city: 'Lagos',
    country: 'Nigeria',
    keywords: ['lekki', 'ajah', 'chevron', 'sangotedo', 'abraham adesanya', 'eleko'],
    swLat: 6.42,
    swLng: 3.47,
    neLat: 6.49,
    neLng: 3.63,
  },
  {
    name: 'Victoria Island',
    city: 'Lagos',
    country: 'Nigeria',
    keywords: ['victoria island', 'vi ', 'v.i', 'eko atlantic'],
    swLat: 6.42,
    swLng: 3.40,
    neLat: 6.44,
    neLng: 3.47,
  },
  {
    name: 'Ikeja',
    city: 'Lagos',
    country: 'Nigeria',
    keywords: ['ikeja', 'maryland', 'alausa', 'toyin', 'allen', 'oregun', 'agidingbi'],
    swLat: 6.57,
    swLng: 3.33,
    neLat: 6.64,
    neLng: 3.38,
  },
  {
    name: 'Surulere',
    city: 'Lagos',
    country: 'Nigeria',
    keywords: ['surulere', 'bode thomas', 'ojuelegba', 'itire', 'aguda', 'ijesha'],
    swLat: 6.48,
    swLng: 3.34,
    neLat: 6.52,
    neLng: 3.38,
  },
  {
    name: 'Mainland',
    city: 'Lagos',
    country: 'Nigeria',
    keywords: ['mainland', 'yaba', 'ebute metta', 'mushin', 'mile 12', 'ketu', 'ojota', 'ogudu'],
    swLat: 6.51,
    swLng: 3.35,
    neLat: 6.60,
    neLng: 3.42,
  },
  {
    name: 'Island',
    city: 'Lagos',
    country: 'Nigeria',
    keywords: ['island', 'ikoyi', 'oniru', 'banana island', 'lagos island', 'bar beach'],
    swLat: 6.43,
    swLng: 3.38,
    neLat: 6.47,
    neLng: 3.44,
  },
];

// ─── Tier 2: Major Metros (4–6 zones each) ──────────────────────────────────

const ABUJA_ZONES: ZoneSeed[] = [
  {
    name: 'Central Area',
    city: 'Abuja',
    country: 'Nigeria',
    keywords: ['central area', 'wuse', 'wuse 2', 'garki', 'area 1', 'area 11'],
  },
  {
    name: 'Maitama',
    city: 'Abuja',
    country: 'Nigeria',
    keywords: ['maitama', 'asokoro', 'aso rock', 'three arms zone'],
  },
  {
    name: 'Gwarinpa',
    city: 'Abuja',
    country: 'Nigeria',
    keywords: ['gwarinpa', 'kado', 'jahi', 'life camp', 'nbora'],
  },
  {
    name: 'Kubwa',
    city: 'Abuja',
    country: 'Nigeria',
    keywords: ['kubwa', 'bwari', 'dutse', 'dawaki'],
  },
  {
    name: 'Lugbe',
    city: 'Abuja',
    country: 'Nigeria',
    keywords: ['lugbe', 'airport road', 'nnamdi azikiwe', 'idu'],
  },
];

const PORT_HARCOURT_ZONES: ZoneSeed[] = [
  {
    name: 'GRA Phase 2',
    city: 'Port Harcourt',
    country: 'Nigeria',
    keywords: ['gra', 'gra phase 2', 'old gra', 'new gra', 'tombia'],
  },
  {
    name: 'Trans Amadi',
    city: 'Port Harcourt',
    country: 'Nigeria',
    keywords: ['trans amadi', 'peter odili', 'slaughter', 'rainbow town'],
  },
  {
    name: 'Diobu',
    city: 'Port Harcourt',
    country: 'Nigeria',
    keywords: ['diobu', 'mile 1', 'mile 2', 'mile 3', 'aba road'],
  },
  {
    name: 'Rumuokoro',
    city: 'Port Harcourt',
    country: 'Nigeria',
    keywords: ['rumuokoro', 'choba', 'uniport', 'alakahia', 'rumuola'],
  },
  {
    name: 'Eleme',
    city: 'Port Harcourt',
    country: 'Nigeria',
    keywords: ['eleme', 'onne', 'refinery', 'alesa eleme'],
  },
];

const IBADAN_ZONES: ZoneSeed[] = [
  {
    name: 'Bodija',
    city: 'Ibadan',
    country: 'Nigeria',
    keywords: ['bodija', 'ui', 'university of ibadan', 'agbowo', 'secretariat'],
  },
  {
    name: 'Ring Road',
    city: 'Ibadan',
    country: 'Nigeria',
    keywords: ['ring road', 'challenge', 'molete', 'adamasingba'],
  },
  {
    name: 'Dugbe',
    city: 'Ibadan',
    country: 'Nigeria',
    keywords: ['dugbe', 'cocoa house', 'total garden', 'jericho'],
  },
  {
    name: 'Oluyole',
    city: 'Ibadan',
    country: 'Nigeria',
    keywords: ['oluyole', 'oluyole estate', 'sharp corner', 'odo ona'],
  },
];

const KANO_ZONES: ZoneSeed[] = [
  {
    name: 'Nassarawa',
    city: 'Kano',
    country: 'Nigeria',
    keywords: ['nassarawa', 'court road', 'hospital road', 'zoo road'],
  },
  {
    name: 'Sabon Gari',
    city: 'Kano',
    country: 'Nigeria',
    keywords: ['sabon gari', 'kano market', 'bompai', 'fagge'],
  },
  {
    name: 'Tarauni',
    city: 'Kano',
    country: 'Nigeria',
    keywords: ['tarauni', 'hotoro', 'kabuga', 'bayero university'],
  },
  {
    name: 'Gwale',
    city: 'Kano',
    country: 'Nigeria',
    keywords: ['gwale', 'goron dutse', 'kantin kwari', 'kurmi market'],
  },
];

// ─── Tier 3: State Capitals (1 zone each) ───────────────────────────────────

const STATE_CAPITAL_ZONES: ZoneSeed[] = [
  { name: 'Abeokuta', city: 'Abeokuta', country: 'Nigeria', keywords: ['abeokuta', 'olumo', 'kuto', 'panseke', 'ibara'] },
  { name: 'Akure', city: 'Akure', country: 'Nigeria', keywords: ['akure', 'alagbaka', 'oba ile', 'futa'] },
  { name: 'Asaba', city: 'Asaba', country: 'Nigeria', keywords: ['asaba', 'nnebisi', 'okpanam', 'cable point'] },
  { name: 'Awka', city: 'Awka', country: 'Nigeria', keywords: ['awka', 'unizik', 'aroma', 'amawbia'] },
  { name: 'Bauchi', city: 'Bauchi', country: 'Nigeria', keywords: ['bauchi', 'wunti', 'yelwa', 'dass road'] },
  { name: 'Benin City', city: 'Benin City', country: 'Nigeria', keywords: ['benin', 'ring road', 'sapele road', 'uselu', 'ugbowo'] },
  { name: 'Calabar', city: 'Calabar', country: 'Nigeria', keywords: ['calabar', 'marian', 'watt market', 'ekpo abasi'] },
  { name: 'Damaturu', city: 'Damaturu', country: 'Nigeria', keywords: ['damaturu', 'potiskum road', 'nayinawa'] },
  { name: 'Dutse', city: 'Dutse', country: 'Nigeria', keywords: ['dutse', 'jigawa', 'kiyawa road'] },
  { name: 'Ado Ekiti', city: 'Ado Ekiti', country: 'Nigeria', keywords: ['ado ekiti', 'fajuyi', 'basiri', 'eksu'] },
  { name: 'Enugu', city: 'Enugu', country: 'Nigeria', keywords: ['enugu', 'independence layout', 'ogui', 'new haven', 'coal camp'] },
  { name: 'Gombe', city: 'Gombe', country: 'Nigeria', keywords: ['gombe', 'federal low cost', 'pantami'] },
  { name: 'Ilorin', city: 'Ilorin', country: 'Nigeria', keywords: ['ilorin', 'gra', 'tanke', 'unilorin', 'fate road'] },
  { name: 'Jos', city: 'Jos', country: 'Nigeria', keywords: ['jos', 'bukuru', 'terminus', 'anglo jos', 'rayfield'] },
  { name: 'Kaduna', city: 'Kaduna', country: 'Nigeria', keywords: ['kaduna', 'barnawa', 'tudun wada', 'sabon tasha', 'kakuri'] },
  { name: 'Katsina', city: 'Katsina', country: 'Nigeria', keywords: ['katsina', 'gidan korau', 'barhim'] },
  { name: 'Lafia', city: 'Lafia', country: 'Nigeria', keywords: ['lafia', 'shendam road', 'nasarawa state'] },
  { name: 'Lokoja', city: 'Lokoja', country: 'Nigeria', keywords: ['lokoja', 'felele', 'adankolo', 'ganaja'] },
  { name: 'Maiduguri', city: 'Maiduguri', country: 'Nigeria', keywords: ['maiduguri', 'gra', 'custom area', 'monday market'] },
  { name: 'Makurdi', city: 'Makurdi', country: 'Nigeria', keywords: ['makurdi', 'high level', 'north bank', 'wurukum'] },
  { name: 'Minna', city: 'Minna', country: 'Nigeria', keywords: ['minna', 'bosso', 'tunga', 'chanchaga'] },
  { name: 'Osogbo', city: 'Osogbo', country: 'Nigeria', keywords: ['osogbo', 'oke fia', 'old garage', 'gbongan road'] },
  { name: 'Owerri', city: 'Owerri', country: 'Nigeria', keywords: ['owerri', 'douglas road', 'world bank', 'new owerri'] },
  { name: 'Sokoto', city: 'Sokoto', country: 'Nigeria', keywords: ['sokoto', 'achida road', 'mabera', 'arkilla'] },
  { name: 'Umuahia', city: 'Umuahia', country: 'Nigeria', keywords: ['umuahia', 'library avenue', 'aba road', 'world bank'] },
  { name: 'Uyo', city: 'Uyo', country: 'Nigeria', keywords: ['uyo', 'ikot ekpene road', 'aka road', 'ewet housing'] },
  { name: 'Warri', city: 'Warri', country: 'Nigeria', keywords: ['warri', 'effurun', 'dsc', 'enerhen', 'jakpa'] },
  { name: 'Yenagoa', city: 'Yenagoa', country: 'Nigeria', keywords: ['yenagoa', 'oxbow lake', 'tombia', 'biogbolo'] },
  { name: 'Yola', city: 'Yola', country: 'Nigeria', keywords: ['yola', 'jimeta', 'karewa', 'demsawo'] },
  { name: 'Abakaliki', city: 'Abakaliki', country: 'Nigeria', keywords: ['abakaliki', 'water works', 'kpirikpiri', 'ogoja road'] },
  { name: 'Birnin Kebbi', city: 'Birnin Kebbi', country: 'Nigeria', keywords: ['birnin kebbi', 'kebbi', 'gwandu road'] },
  { name: 'Jalingo', city: 'Jalingo', country: 'Nigeria', keywords: ['jalingo', 'taraba', 'magami'] },
  { name: 'Gusau', city: 'Gusau', country: 'Nigeria', keywords: ['gusau', 'zamfara', 'tudun wada', 'samaru'] },
  { name: 'Eket', city: 'Eket', country: 'Nigeria', keywords: ['eket', 'qua iboe', 'oron road', 'mobil'] },
  { name: 'Ijebu Ode', city: 'Ijebu Ode', country: 'Nigeria', keywords: ['ijebu ode', 'itoro', 'molipa', 'ibadan road'] },
];

// ─── All zones combined ─────────────────────────────────────────────────────

const ALL_ZONES: ZoneSeed[] = [
  ...LAGOS_ZONES,
  ...ABUJA_ZONES,
  ...PORT_HARCOURT_ZONES,
  ...IBADAN_ZONES,
  ...KANO_ZONES,
  ...STATE_CAPITAL_ZONES,
];

async function main() {
  console.log('Seeding zones...\n');
  console.log(`  Total zones to seed: ${ALL_ZONES.length}\n`);

  let inserted = 0;
  let skipped = 0;

  for (const zone of ALL_ZONES) {
    // Idempotent: skip if zone already exists by (name, city, country)
    const existing = await db
      .select({ id: zones.id })
      .from(zones)
      .where(
        and(
          eq(zones.name, zone.name),
          eq(zones.city, zone.city),
          eq(zones.country, zone.country),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      console.log(`  skip  ${zone.name} (${zone.city}) — already exists`);
      skipped++;
      continue;
    }

    await db.insert(zones).values({
      name: zone.name,
      city: zone.city,
      country: zone.country,
      keywords: zone.keywords,
      swLat: zone.swLat ?? null,
      swLng: zone.swLng ?? null,
      neLat: zone.neLat ?? null,
      neLng: zone.neLng ?? null,
    });

    console.log(`  added ${zone.name} (${zone.city}) — ${zone.keywords.length} keywords`);
    inserted++;
  }

  console.log(`\nDone. ${inserted} inserted, ${skipped} skipped. (Total: ${ALL_ZONES.length})`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
