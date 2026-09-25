import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { send, evaluate, pause, close } from './hero-browser-session.mjs';

const output = 'docs/hero-reduced-input';
await mkdir(output, { recursive: true });
const results = [];
const state = () =>
  evaluate(
    `(()=>{const h=document.querySelector('.hero-desk__canvas'),c=h.querySelector('canvas');return {angle:+c.dataset.orbit,target:+c.dataset.target,frames:+c.dataset.frames,calls:+c.dataset.drawCalls,triangles:+c.dataset.triangles,dragging:h.dataset.dragging==='true',capture:h.hasPointerCapture(1),y:scrollY}})()`,
  );
async function waitForScene() {
  for (let i = 0; i < 70; i++) {
    if (
      await evaluate(
        `document.querySelector('.hero-desk')?.dataset.ready==='true'`,
      )
    )
      return;
    await pause(100);
  }
  throw Error('Reduced-motion scene did not initialize');
}
async function key(key) {
  await evaluate(
    `document.querySelector('.hero-desk__canvas').focus({preventScroll:true})`,
  );
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key });
  await pause(100);
}
try {
  // Undo the older helper's override: record this host's actual media preference.
  await send('Emulation.setEmulatedMedia', { features: [] });
  const nativePreferences = await evaluate(
    `({reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,fine:matchMedia('(pointer: fine)').matches,hover:matchMedia('(hover: hover)').matches,touch:navigator.maxTouchPoints})`,
  );
  // Run under reduce on every machine; record whether an override was necessary.
  if (!nativePreferences.reduced)
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
  for (const url of ['http://localhost:5173', 'http://localhost:4173']) {
    for (const [width, height] of [
      [1440, 900],
      [742, 1277],
    ]) {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await send('Page.navigate', { url });
      await waitForScene();
      assert.equal(
        await evaluate(
          `!!window.__heroInputDebug || !!document.querySelector('[data-hero-input-hud]')`,
        ),
        false,
      );
      const hits = [];
      for (const [name, rx, ry] of [
        ['center', 0.5, 0.5],
        ['left-monitor', 0.4, 0.35],
        ['right-monitor', 0.57, 0.3],
        ['keyboard', 0.46, 0.68],
        ['pc', 0.69, 0.6],
        ['background', 0.08, 0.12],
      ]) {
        await key('Escape');
        const rect = await evaluate(
          `document.querySelector('.hero-desk__canvas').getBoundingClientRect().toJSON()`,
        );
        const x = rect.x + rect.width * rx,
          y = rect.y + rect.height * ry;
        const before = await state();
        const hit = await evaluate(
          `document.elementFromPoint(${x},${y}).tagName`,
        );
        assert.equal(hit, 'CANVAS');
        await send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          x,
          y,
          button: 'left',
          buttons: 1,
          clickCount: 1,
        });
        for (let i = 1; i <= 5; i++) {
          await send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x: x + i * 15,
            y,
            buttons: 1,
          });
          await pause(30);
        }
        const dragging = await state();
        assert.ok(dragging.dragging && dragging.capture);
        assert.ok(
          dragging.angle < before.angle - 0.25,
          `${name}: reduced-motion drag did not rotate`,
        );
        await send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: x + 75,
          y,
          button: 'left',
          buttons: 0,
          clickCount: 1,
        });
        await pause(150);
        const released = await state();
        assert.equal(released.dragging, false);
        assert.equal(released.capture, false);
        assert.equal(released.angle, released.target);
        await pause(300);
        assert.equal((await state()).frames, released.frames);
        hits.push({ name, hit, angle: released.angle, idleFrames: 0 });
      }
      await key('Home');
      assert.equal((await state()).angle, -Math.PI / 2);
      await key('End');
      assert.equal((await state()).angle, Math.PI / 2);
      await key('Escape');
      const before = await state();
      const rect = await evaluate(
        `document.querySelector('.hero-desk__canvas').getBoundingClientRect().toJSON()`,
      );
      const x = rect.x + rect.width / 2,
        y = rect.y + rect.height / 2;
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: x + 90,
        y,
      });
      await pause(150);
      assert.equal(
        (await state()).frames,
        before.frames,
        'Reduced-motion hover rendered',
      );
      await send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x,
        y,
        deltaX: 0,
        deltaY: 80,
      });
      await pause(500);
      const scrolled = await state();
      assert.ok(scrolled.y > before.y, 'Native page wheel blocked');
      assert.equal(
        scrolled.target,
        before.target,
        'Reduced-motion scroll changed orbit',
      );
      assert.equal(
        scrolled.frames,
        before.frames,
        'Reduced-motion scroll rendered',
      );
      await evaluate(
        `window.scrollTo({top:document.body.scrollHeight,behavior:'instant'})`,
      );
      await pause(200);
      const offscreen = await state();
      await pause(500);
      assert.equal((await state()).frames, offscreen.frames);
      await evaluate(`window.scrollTo({top:0,behavior:'instant'})`);
      await pause(200);
      await key('ArrowRight');
      assert.ok((await state()).angle > 0);
      results.push({
        url,
        width,
        height,
        nativePreferences,
        hits,
        scrolled,
        offscreenFrames: 0,
      });
    }
  }
  await writeFile(`${output}/metrics.json`, JSON.stringify(results, null, 2));
  console.log(
    'PASS: reduced-motion cold load and mouse drag at six card positions, both limits, keyboard, no automatic hover/scroll/easing, idle/offscreen, native wheel; dev and preview, including user viewport.',
  );
} finally {
  await close();
}
