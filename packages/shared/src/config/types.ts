import type { z } from 'zod';

export type ConfigCategory = 'matching' | 'routing' | 'pricing';

export type ConfigEntry<T extends z.ZodTypeAny> = {
  label: string;
  description?: string;
  category: ConfigCategory;
  schema: T;
  default: z.infer<T>;
};
