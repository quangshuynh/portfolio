import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import photographyCatalogPlugin from './scripts/photography-catalog-plugin.mjs';
import seoPlugin from './scripts/seo-plugin.mjs';

// The commit a build was made from ("+changes" with uncommitted edits), shown in the photo
// editor's Diagnostics report so a phone can tell which build it has open.
function buildCommit() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7);
  const git = (args) => execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  try {
    return `${git('rev-parse --short HEAD')}${git('status --porcelain --untracked-files=no') ? '+changes' : ''}`;
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  define: { __EDITOR_BUILD__: JSON.stringify(buildCommit()) },
  plugins: [react(), photographyCatalogPlugin(), seoPlugin()],
  test: {
    include: ['src/**/*.test.{js,jsx}', 'scripts/**/*.test.mjs', 'cms/**/*.test.{mjs,jsx}'],
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
    css: true,
  },
});
