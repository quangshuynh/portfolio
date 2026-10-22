import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import photographyCatalogPlugin from './scripts/photography-catalog-plugin.mjs';
import seoPlugin from './scripts/seo-plugin.mjs';

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react(), photographyCatalogPlugin(), seoPlugin()],
  test: {
    include: ['src/**/*.test.{js,jsx}', 'scripts/**/*.test.mjs'],
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
    css: true,
  },
});
