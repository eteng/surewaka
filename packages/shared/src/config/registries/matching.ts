import { z } from 'zod';
import type { ConfigEntry } from '../types';

export const matchingConfig = {
  'matching.first_mile_dispatch_buffer_min': {
    label: 'First-Mile Dispatch Buffer (min)',
    description:
      'Minutes before carrier departure to trigger driver matching (5min matching + 10min driver-to-pickup + 30min Lagos traffic headroom)',
    category: 'matching',
    schema: z.number().int().min(10).max(120),
    default: 45,
  },
  'matching.tier1_radius_km': {
    label: 'Tier 1 Search Radius (km)',
    description: 'Initial GEOSEARCH radius for the first broadcast tier',
    category: 'matching',
    schema: z.number().min(1).max(20),
    default: 5,
  },
  'matching.tier1_batch_size': {
    label: 'Tier 1 Batch Size',
    description: 'Max drivers offered the job simultaneously in tier 1',
    category: 'matching',
    schema: z.number().int().min(1).max(20),
    default: 5,
  },
  'matching.tier1_timeout_sec': {
    label: 'Tier 1 Timeout (sec)',
    description: 'Wait time for driver acceptance before escalating to tier 2',
    category: 'matching',
    schema: z.number().int().min(10).max(120),
    default: 30,
  },
  'matching.tier2_radius_km': {
    label: 'Tier 2 Search Radius (km)',
    category: 'matching',
    schema: z.number().min(1).max(30),
    default: 8,
  },
  'matching.tier2_batch_size': {
    label: 'Tier 2 Batch Size',
    category: 'matching',
    schema: z.number().int().min(1).max(30),
    default: 10,
  },
  'matching.tier2_timeout_sec': {
    label: 'Tier 2 Timeout (sec)',
    category: 'matching',
    schema: z.number().int().min(10).max(120),
    default: 30,
  },
  'matching.tier3_radius_km': {
    label: 'Tier 3 Search Radius (km)',
    category: 'matching',
    schema: z.number().min(1).max(50),
    default: 12,
  },
  'matching.tier3_timeout_sec': {
    label: 'Tier 3 Timeout (sec)',
    category: 'matching',
    schema: z.number().int().min(30).max(600),
    default: 180,
  },
  'matching.total_timeout_sec': {
    label: 'Total Match Timeout (sec)',
    description:
      'After this total elapsed time, the delivery is auto-cancelled and refund triggered',
    category: 'matching',
    schema: z.number().int().min(60).max(600),
    default: 300,
  },
  'matching.scoring_weights': {
    label: 'Driver Scoring Weights',
    description:
      'Composite score factors for ranking candidates. distancePerKm is negative (penalty per km away).',
    category: 'matching',
    schema: z.object({
      distancePerKm: z.number().min(-50).max(0),
      acceptanceRate: z.number().min(0).max(50),
      completionRate: z.number().min(0).max(50),
      highRatingBonus: z.number().min(0).max(50),
      lowRatingPenalty: z.number().min(-50).max(0),
      idleBonus30min: z.number().min(0).max(50),
      idleBonus60min: z.number().min(0).max(50),
      headingBonus: z.number().min(0).max(50),
    }),
    default: {
      distancePerKm: -10,
      acceptanceRate: 20,
      completionRate: 15,
      highRatingBonus: 10,
      lowRatingPenalty: -15,
      idleBonus30min: 10,
      idleBonus60min: 5,
      headingBonus: 8,
    },
  },
} satisfies Record<`matching.${string}`, ConfigEntry<z.ZodTypeAny>>;
