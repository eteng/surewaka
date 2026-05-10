import type { Config } from '@react-router/dev/config';

export default {
  // Admin panel doesn't need SSR — SPA mode for simplicity
  ssr: false,
} satisfies Config;
