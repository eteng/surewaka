import path from 'node:path';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  define: {
    // Subscribe-only key — safe to ship to the browser because it carries
    // only the `subscribe` capability and cannot publish to any channel.
    // Create a subscribe-only key in the Ably dashboard and set VITE_ABLY_SUBSCRIBE_KEY.
    'process.env.ABLY_API_KEY': JSON.stringify(process.env.VITE_ABLY_SUBSCRIBE_KEY ?? ''),
  },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './app'),
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router',
      'radix-ui',
      '@clerk/react',
      '@tanstack/react-table',
      'lucide-react',
      'class-variance-authority',
      'clsx',
      'tailwind-merge',
    ],
  },
  server: {
    port: 3001,
  },
});
