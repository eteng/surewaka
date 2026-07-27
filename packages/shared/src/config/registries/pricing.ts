import { z } from 'zod';
import type { ConfigEntry } from '../types';

export const pricingConfig = {} satisfies Record<`pricing.${string}`, ConfigEntry<z.ZodTypeAny>>;
