import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import seoPlugin from './scripts/seo-plugin.mjs';

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react(), seoPlugin()],
  test: {
    include: ['src/**/*.test.{js,jsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
    css: true,
  },
});
