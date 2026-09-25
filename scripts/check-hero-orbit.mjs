import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
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
const output = process.env.HERO_CHECK_OUTPUT || '/tmp/hero-orbit-check';
await mkdir(output, { recursive: true });
async function waitFor(expression) {
  for (let i = 0; i < 100; i++) {
    if (await evaluate(expression)) return;
    await pause(100);
  }
  throw Error(`Timed out: ${expression}`);
}
const state = () =>
  evaluate(
    `(()=>{const c=document.querySelector('.hero-desk canvas');const h=document.querySelector('.hero-desk__canvas');return {frames:+c.dataset.frames,angle:+c.dataset.orbit,target:+c.dataset.target,drags:+(h.dataset.drags||0),dragging:h.dataset.dragging==='true',calls:+c.dataset.drawCalls,triangles:+c.dataset.triangles}})()`,
  );
const rect = () =>
  evaluate(
    `document.querySelector('.hero-desk__canvas').getBoundingClientRect().toJSON()`,
  );
async function settle() {
  await pause(1100);
  const before = await state();
  await pause(250);
  assert.equal(
    (await state()).frames,
    before.frames,
    'Convergence never settled',
  );
  return before;
}
async function shot(name) {
  const path = `${output}/${name}.png`;
  await screenshot(path);
  await sharp(path).webp({ quality: 85 }).toFile(`${output}/${name}.webp`);
}
async function key(key) {
  await evaluate(
    `document.querySelector('.hero-desk__canvas').focus({preventScroll:true})`,
  );
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key });
  return settle();
}
async function drag(touch, dx, dy = 0) {
  const r = await rect(),
    x = r.x + r.width / 2,
    y = r.y + r.height / 2;
  if (touch) {
    await send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }],
    });
    for (let i = 1; i <= 6; i++) {
      await send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (dx * i) / 6, y: y + (dy * i) / 6, id: 1 }],
      });
      await pause(25);
    }
    await send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  } else {
    await send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    for (let i = 1; i <= 6; i++) {
      await send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: x + (dx * i) / 6,
        y: y + (dy * i) / 6,
        button: 'left',
        buttons: 1,
      });
      await pause(25);
    }
    await send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: x + dx,
      y: y + dy,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
  }
  return settle();
}
const measurements = [];
try {
  for (const [name, width, height, touch] of heroViewports.filter(
    ([name]) =>
      !process.env.HERO_VIEWPORT || name === process.env.HERO_VIEWPORT,
  )) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: touch,
    });
    await send('Emulation.setTouchEmulationEnabled', { enabled: touch });
    await send('Page.navigate', { url: origin });
    await waitFor(`!!document.querySelector('.hero-desk')`);
    if (width <= 620)
      await evaluate(
        `document.querySelector('.hero-desk').scrollIntoView({block:'center',behavior:'instant'})`,
      );
    await waitFor(
      `document.querySelector('.hero-desk').dataset.ready==='true'`,
    );
    const front = await key('Escape');
    await shot(`${name}-front`);
    await evaluate(
      `window.sceneClicks=0;document.addEventListener('click',()=>window.sceneClicks++)`,
    );
    const beforeHref = await evaluate('location.href');
    const box = await rect();
    const dragged = await drag(touch, box.width * 0.38);
    assert.ok(dragged.angle < -0.8, `${name}: horizontal drag did not rotate`);
    assert.ok(!dragged.dragging, `${name}: drag stuck after release`);
    assert.equal(
      await evaluate('sceneClicks'),
      0,
      'Drag emitted an accidental click',
    );
    assert.equal(await evaluate('location.href'), beforeHref, 'Drag navigated');
    const left = await key('Home');
    assert.ok(Math.abs(left.angle + Math.PI / 2) < 0.00001);
    await shot(`${name}-left`);
    // Repeated drags at the boundary cannot accumulate full spins.
    const clamped = await drag(touch, box.width * 0.25);
    assert.ok(Math.abs(clamped.angle) <= Math.PI / 2 + 0.00001);
    const right = await key('End');
    assert.ok(Math.abs(right.angle - Math.PI / 2) < 0.00001);
    await shot(`${name}-right`);
    await key('Escape');
    if (touch) {
      const before = await state();
      const scrollBefore = await evaluate('scrollY');
      // Dispatch the same touch stream used by the horizontal drag checks.
      // synthesizeScrollGesture does not pan on this Windows headless backend.
      await drag(true, 0, -Math.min(150, height * 0.2));
      await pause(500);
      const after = await state();
      assert.ok(
        (await evaluate('scrollY')) > scrollBefore,
        `${name}: vertical swipe did not scroll`,
      );
      assert.equal(
        after.drags,
        before.drags,
        `${name}: vertical swipe entered drag`,
      );
    }
    measurements.push({ name, front, left, right });
  }
  // Inspect actual sticky/collapse geometry and native scroll movement.
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await send('Page.navigate', { url: origin });
  await waitFor(`document.querySelector('.hero-desk')?.dataset.ready==='true'`);
  await key('Escape');
  const geometry = () =>
    evaluate(
      `(()=>{const n=document.querySelector('.site-nav').getBoundingClientRect(),s=document.querySelector('.home-nav-slot').getBoundingClientRect(),h=document.querySelector('.home-header').getBoundingClientRect(),intro=document.querySelector('.hero .eyebrow').getBoundingClientRect();return {nav:n.height,slot:s.height,heroDocumentTop:h.top+scrollY,introTop:intro.top,navBottom:n.bottom}})()`,
    );
  const start = await geometry();
  assert.ok(start.introTop > start.navBottom);
  const targetBefore = (await state()).target;
  await evaluate(`window.scrollTo({top:140,behavior:'instant'})`);
  const scrolling = await settle();
  assert.ok(
    scrolling.target > targetBefore && scrolling.target - targetBefore <= 0.061,
    'Scroll target not bounded/deterministic',
  );
  const midway = await geometry();
  assert.ok(
    midway.nav < start.nav && midway.nav > 72,
    'Expanded nav did not interpolate toward collapsed height',
  );
  assert.equal(midway.slot, start.slot);
  assert.equal(midway.heroDocumentTop, start.heroDocumentTop);
  await evaluate(`window.scrollTo({top:550,behavior:'instant'})`);
  await pause(500);
  const collapsed = await geometry();
  assert.ok(Math.abs(collapsed.nav - 72) < 1);
  assert.equal(collapsed.heroDocumentTop, start.heroDocumentTop);
  await evaluate(
    `window.scrollTo({top:document.body.scrollHeight,behavior:'instant'})`,
  );
  await pause(300);
  const offscreen = await state();
  await evaluate(
    `window.scrollBy({top:-100,behavior:'instant'});window.dispatchEvent(new Event('scroll'))`,
  );
  await pause(600);
  assert.deepEqual(
    await state(),
    offscreen,
    'Offscreen scroll updated/rendered camera',
  );
  await evaluate(`window.scrollTo({top:0,behavior:'instant'})`);
  await settle();
  assert.ok((await geometry()).introTop > (await geometry()).navBottom);
  await key('ArrowRight');
  const chosen = (await state()).angle;
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1024,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await settle();
  assert.ok(
    Math.abs((await state()).angle - chosen) < 0.061,
    'Resize reset manual orbit',
  );
  // Browser-chrome-like shorter heights and effective viewport at 125% zoom.
  for (const [w, h, zoom] of [
    [1280, 600, 1],
    [1152, 650, 1],
    [1152, 520, 1.25],
  ]) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: zoom,
      mobile: false,
    });
    await evaluate(`window.scrollTo({top:0,behavior:'instant'})`);
    await settle();
    const g = await geometry();
    assert.ok(g.introTop >= g.navBottom + 8, `${w}x${h}: nav overlap`);
    await shot(`nav-${w}x${h}`);
  }
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await settle();
  const reducedBefore = await state();
  await evaluate(`window.scrollTo({top:150,behavior:'instant'})`);
  await pause(500);
  assert.equal(
    await evaluate(`document.querySelectorAll('.hero-desk canvas').length`),
    1,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.hero-desk__canvas').getAttribute('tabindex')`,
    ),
    '0',
  );
  assert.equal((await state()).target, reducedBefore.target);
  await key('ArrowLeft');
  assert.ok((await state()).angle < reducedBefore.angle);
  await writeFile(
    `${output}/metrics.json`,
    JSON.stringify(
      { measurements, start, midway, collapsed, offscreen },
      null,
      2,
    ),
  );
  console.log(
    'PASS: bounded mouse/touch drag, gesture arbitration, scroll, keyboard, no clicks, idle/offscreen, nav reserve/collapse/resize/zoom, reduced motion.',
  );
} finally {
  await close();
}
