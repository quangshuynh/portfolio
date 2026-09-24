import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { heroViewports } from './hero-viewports.mjs';
import {
  send,
  evaluate,
  pause,
  screenshot,
  close,
} from './hero-browser-session.mjs';
const origin = process.env.HERO_PREVIEW_URL || 'http://localhost:4173';
const output = process.env.HERO_CHECK_OUTPUT || '/tmp/hero-layouts';
await mkdir(output, { recursive: true });
const measurements = [];
try {
  for (const [name, width, height, touch] of heroViewports) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: touch,
    });
    await send('Emulation.setTouchEmulationEnabled', { enabled: touch });
    await send('Page.navigate', { url: origin });
    await pause(2600);
    const bounds = await evaluate(
      `(()=>{const selectors=['.site-nav','.hero .eyebrow','.hero-intro','.hero h1','.hero-lede','.hero-meta','.hero-actions','.hero-photo-wrap','.about-float-link','.meet-quang-card','.hero-desk__stage','.hero-desk__caption'];return {width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,elements:Object.fromEntries(selectors.map(s=>{const e=document.querySelector(s);return [s,!e.getClientRects().length?null:e.getBoundingClientRect().toJSON()]})),font: getComputedStyle(document.querySelector('.hero h1')).fontSize}})()`,
    );
    if (process.env.HERO_ASSERT_FIT === '1') {
      assert.equal(bounds.overflow, false, `${name}: horizontal overflow`);
      if (width > 620)
        for (const [selector, rect] of Object.entries(bounds.elements))
          if (rect) {
            assert.ok(
              rect.top >=
                (selector === '.site-nav'
                  ? 0
                  : bounds.elements['.site-nav'].bottom) &&
                rect.bottom <= height,
              `${name}: ${selector} outside viewport (${rect.bottom})`,
            );
          }
    }
    const path = `${output}/${name}.png`;
    await screenshot(path);
    await sharp(path).webp({ quality: 85 }).toFile(`${output}/${name}.webp`);
    measurements.push({ name, ...bounds });
  }
  await writeFile(
    `${output}/layout.json`,
    JSON.stringify(measurements, null, 2),
  );
  console.log(
    JSON.stringify(
      measurements.map((x) => ({
        name: x.name,
        headline: x.font,
        captionBottom: x.elements['.hero-desk__caption'].bottom,
        height: x.height,
      })),
      null,
      2,
    ),
  );
} finally {
  await close();
}
