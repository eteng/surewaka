import { matchingConfig } from './registries/matching';
import { pricingConfig } from './registries/pricing';
import { routingConfig } from './registries/routing';

export type { ConfigCategory, ConfigEntry } from './types';

export const configRegistry = {
  ...matchingConfig,
  ...pricingConfig,
  ...routingConfig,
};

export type ConfigKey = keyof typeof configRegistry;
