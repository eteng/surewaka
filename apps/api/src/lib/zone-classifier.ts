import type { LagosZone } from '@surewaka/shared';

const LOCATIONIQ_BASE = 'https://api.locationiq.com/v1';

const ZONE_KEYWORDS: Array<{ zone: LagosZone; keywords: string[] }> = [
  { zone: 'Lekki', keywords: ['lekki', 'ajah', 'chevron', 'sangotedo', 'abraham adesanya', 'eleko'] },
  { zone: 'Victoria Island', keywords: ['victoria island', 'vi ', 'v.i', 'eko atlantic'] },
  { zone: 'Ikeja', keywords: ['ikeja', 'maryland', 'alausa', 'toyin', 'allen', 'oregun', 'agidingbi'] },
  { zone: 'Surulere', keywords: ['surulere', 'bode thomas', 'ojuelegba', 'itire', 'aguda', 'ijesha'] },
  { zone: 'Mainland', keywords: ['mainland', 'yaba', 'ebute metta', 'mushin', 'mile 12', 'ketu', 'ojota', 'ogudu'] },
  { zone: 'Island', keywords: ['island', 'ikoyi', 'oniru', 'banana island', 'lagos island', 'bar beach'] },
];

function matchZone(text: string): LagosZone {
  const lower = text.toLowerCase();
  for (const { zone, keywords } of ZONE_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) return zone;
  }
  return 'Other';
}

export async function classifyZone(lat: number, lng: number): Promise<LagosZone> {
  const apiKey = process.env.LOCATIONIQ_API_KEY;
  if (!apiKey) return 'Other';

  try {
    const params = new URLSearchParams({
      key: apiKey,
      lat: String(lat),
      lon: String(lng),
      format: 'json',
      addressdetails: '1',
    });
    const res = await fetch(`${LOCATIONIQ_BASE}/reverse?${params}`);
    if (!res.ok) return 'Other';
    const data = (await res.json()) as { address?: Record<string, string> };
    const addressText = Object.values(data.address ?? {}).join(' ');
    return matchZone(addressText);
  } catch {
    return 'Other';
  }
}
