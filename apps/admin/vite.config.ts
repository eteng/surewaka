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
