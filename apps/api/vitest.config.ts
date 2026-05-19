import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@surewaka/shared': path.resolve(__dirname, '../../packages/shared/src'),
      '@surewaka/db': path.resolve(__dirname, '../../packages/db/src'),
      '@surewaka/supabase': path.resolve(__dirname, '../../packages/supabase/src'),
    },
  },
});
