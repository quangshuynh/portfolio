// Captures full-page screenshots of the primary routes across themes and viewports.
// Usage: node scripts/capture-redesign.mjs <baseUrl> <outDir> [--viewport-only]
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createRequire } from 'node:module';

// Playwright is not a project dependency; resolve a local or globally installed copy.
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try { return require('playwright'); } catch { return require('/opt/node22/lib/node_modules/playwright'); }
})();

const [baseUrl = 'http://127.0.0.1:4173', outDir = 'docs/nature-revamp/after'] = process.argv.slice(2);
const routes = [['home', '/'], ['about', '/about'], ['photography', '/photography/']];
const viewports = [['desktop', 1440, 900], ['tablet', 1024, 768], ['mobile', 390, 844]];
const themes = ['dark', 'light'];
const only = process.env.ONLY_VIEWPORTS?.split(',');

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const report = [];
for (const [vpName, width, height] of viewports) {
  if (only && !only.includes(vpName)) continue;
  for (const theme of themes) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await context.addInitScript((t) => { try { localStorage.setItem('portfolio-theme', t); } catch {} }, theme);
    await context.route(/workers\.dev|googleapis|gstatic/, (route) => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));
    for (const [name, route] of routes) {
      await page.goto(baseUrl + route, { waitUntil: 'networkidle' });
      // Scroll through to trigger lazy images / reveals, then back to top.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const file = path.join(outDir, `${name}-${vpName}-${theme}.webp`);
      const png = await page.screenshot({ fullPage: true });
      const img = sharp(png);
      const meta = await img.metadata();
      await img.resize({ width: Math.min(meta.width, 1440) }).webp({ quality: 58 }).toFile(file);
      report.push({ file, overflow, errors: [...errors] });
      errors.length = 0;
    }
    await context.close();
  }
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
