import path from 'node:path';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './app'),
    },
  },
  ssr: {
    noExternal: ['@surewaka/supabase', '@surewaka/shared'],
  },
  server: {
    port: 3002,
  },
});
