import { z } from 'zod';
import type { ConfigEntry } from '../types';

export const routingConfig = {} satisfies Record<`routing.${string}`, ConfigEntry<z.ZodTypeAny>>;
