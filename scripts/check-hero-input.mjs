import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { send, evaluate, pause, close } from './hero-browser-session.mjs';

const output = process.env.HERO_CHECK_OUTPUT || 'docs/hero-scroll-music';
const baseline = process.env.HERO_INPUT_BASELINE === '1';
const results = [];
const state = () =>
  evaluate(`(() => {
  const h = document.querySelector('.hero-desk__canvas'), c = h.querySelector('canvas');
  return {y:scrollY, angle:+c.dataset.orbit, target:+c.dataset.target,
    dragging:h.dataset.dragging==='true', capture:h.hasPointerCapture(1),
    frames:+c.dataset.frames, calls:+c.dataset.drawCalls, triangles:+c.dataset.triangles,
    selection:String(getSelection()), wheels:window.wheels};
})()`);
const box = () =>
  evaluate(
    `document.querySelector('.hero-desk__canvas').getBoundingClientRect().toJSON()`,
  );
async function center() {
  await evaluate(
    `document.querySelector('.hero-desk').scrollIntoView({block:'center',behavior:'instant'})`,
  );
  await pause(350);
  const r = await box();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
async function mouse(type, p, buttons = 0) {
  await send('Input.dispatchMouseEvent', {
    type,
    ...p,
    button: buttons || type === 'mouseReleased' ? 'left' : 'none',
    buttons,
    clickCount: type === 'mouseMoved' ? 0 : 1,
  });
}
async function wheel(p, deltaY, deltaX = 0) {
  await send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    ...p,
    deltaX,
    deltaY,
  });
  await pause(150);
}
async function dragStart(p) {
  await mouse('mousePressed', p, 1);
  for (let i = 1; i <= 5; i++) {
    await mouse('mouseMoved', { x: p.x + i * 20, y: p.y }, 1);
    await pause(20);
  }
}
try {
  await mkdir(output, { recursive: true });
  for (const [name, width, height, touch] of [
    ['desktop', 1440, 900, false],
    ['laptop', 1366, 768, false],
    ['mac-short', 1440, 650, false],
    ['tablet', 768, 1024, true],
    ['mobile', 390, 844, true],
  ].filter(
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
    await send('Page.navigate', {
      url: process.env.HERO_PREVIEW_URL || 'http://localhost:4173',
    });
    await pause(2200);
    let p = await center();
    for (let i = 0; i < 60; i++) {
      if (
        await evaluate(
          `document.querySelector('.hero-desk')?.dataset.ready==='true'`,
        )
      )
        break;
      await pause(100);
    }
    await evaluate(
      `window.wheels=[];window.addEventListener('wheel',e=>{queueMicrotask(()=>wheels.push({prevented:e.defaultPrevented,x:e.deltaX,y:e.deltaY}))},{passive:true})`,
    );
    const record = { name, start: await state() };
    if (!touch) {
      await mouse('mouseMoved', p);
      for (let i = 0; i < 3; i++) {
        await wheel(p, 100);
        await pause(600);
      }
      record.wheel = await state();
      p = await center();
      const trackpadStart = await state();
      for (let i = 0; i < 12; i++) await wheel(p, 8);
      await pause(600);
      record.trackpad = { before: trackpadStart.y, after: (await state()).y };
      if (!baseline) {
        assert.ok(
          record.wheel.y > record.start.y + 200,
          `${name}: wheel snapped back`,
        );
        assert.ok(
          record.trackpad.after > record.trackpad.before + 60,
          `${name}: small trackpad deltas lost`,
        );
        assert.ok(
          record.wheel.target > record.start.target,
          'Native scroll did not drive camera',
        );
      }
      p = await center();
      const before = await state();
      await dragStart(p);
      record.duringDrag = await state();
      assert.equal(record.duringDrag.y, before.y, 'Mouse orbit scrolled page');
      await mouse('mouseReleased', { x: p.x + 100, y: p.y });
      await pause(1100);
      record.afterDrag = await state();
      assert.ok(
        record.afterDrag.angle < before.angle - 0.3,
        `${name}: mouse drag failed`,
      );
      assert.equal(record.afterDrag.dragging, false);
      assert.equal(record.afterDrag.selection, '');
      if (!baseline) {
        await wheel(p, 70);
        assert.ok(
          (await state()).y > record.afterDrag.y + 40,
          'Scroll failed after release',
        );
        // Horizontal trackpad input must not become orbit.
        p = await center();
        const horizontal = await state();
        await wheel(p, 0, 100);
        await pause(500);
        assert.equal((await state()).target, horizontal.target);
        // Cancel, blur and releasing outside must all relinquish ownership.
        for (const ending of ['cancel', 'blur', 'outside', 'resize']) {
          p = await center();
          await dragStart(p);
          if (ending === 'cancel')
            await evaluate(
              `window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1}))`,
            );
          if (ending === 'blur')
            await evaluate(`window.dispatchEvent(new Event('blur'))`);
          if (ending === 'cancel' || ending === 'blur') {
            assert.equal(
              (await state()).dragging,
              false,
              `${ending}: ownership not released`,
            );
            assert.equal(
              (await state()).capture,
              false,
              `${ending}: capture not released`,
            );
          }
          if (ending === 'outside')
            await mouse('mouseMoved', { x: width - 10, y: p.y }, 1);
          if (ending === 'resize') {
            await send('Emulation.setDeviceMetricsOverride', {
              width: width - 20,
              height,
              deviceScaleFactor: 1,
              mobile: false,
            });
            await pause(200);
          }
          await mouse('mouseReleased', { x: width - 10, y: p.y });
          const ended = await state();
          assert.equal(ended.dragging, false, `${ending}: stuck drag`);
          assert.equal(ended.capture, false, `${ending}: stuck capture`);
          await wheel(p, 60);
          assert.ok(
            (await state()).y > ended.y + 30,
            `${ending}: scroll blocked`,
          );
        }
        // A click without motion does not rotate, and ordinary keyboard navigation exits.
        p = await center();
        await mouse('mouseMoved', p);
        await pause(1100);
        const clicked = await state();
        await mouse('mousePressed', p, 1);
        await mouse('mouseReleased', p);
        await pause(1100);
        assert.ok(Math.abs((await state()).angle - clicked.angle) < 0.02);
        await evaluate(
          `document.querySelector('.hero-desk__canvas').focus({preventScroll:true})`,
        );
        const keyboardStart = (await state()).y;
        await send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'PageDown',
          windowsVirtualKeyCode: 34,
        });
        await send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'PageDown',
          windowsVirtualKeyCode: 34,
        });
        await pause(600);
        assert.ok(
          (await state()).y > keyboardStart,
          'Keyboard page scrolling blocked',
        );
        await send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Tab',
          windowsVirtualKeyCode: 9,
        });
        await send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Tab',
          windowsVirtualKeyCode: 9,
        });
        assert.equal(
          await evaluate(
            `document.activeElement.matches('.hero-desk__canvas')`,
          ),
          false,
        );
        // Fast scroll through Experience and back, without moving the pointer.
        for (let i = 0; i < 12; i++) await wheel(p, 100);
        record.pastHero = await state();
        assert.ok(record.pastHero.y > height);
        const frames = record.pastHero.frames;
        await pause(600);
        assert.equal((await state()).frames, frames);
        for (let i = 0; i < 60 && (await state()).y >= 100; i++)
          await wheel(p, -100);
        assert.ok((await state()).y < 100);
        const outsideStart = await state();
        await wheel({ x: 20, y: height / 2 }, 100);
        assert.ok((await state()).y > outsideStart.y);
      }
    } else {
      for (const [label, dx, dy] of [
        ['horizontal', 100, 0],
        ['vertical', 0, -150],
        ['diagonal', 100, -100],
      ]) {
        p = await center();
        const before = await state();
        await send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ ...p, id: 1 }],
        });
        for (let i = 1; i <= 10; i++) {
          await send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
              { x: p.x + (dx * i) / 10, y: p.y + (dy * i) / 10, id: 1 },
            ],
          });
          await pause(30);
        }
        await send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        });
        await pause(1100);
        const after = await state();
        record[label] = { before, after };
        if (label === 'horizontal') assert.ok(after.angle < before.angle - 0.3);
        else if (!baseline)
          assert.ok(after.y > before.y + 40, `${label}: page did not pan`);
        assert.equal(after.dragging, false);
      }
    }
    const final = await state();
    assert.ok(
      final.wheels.every((e) => !e.prevented),
      'Wheel was canceled',
    );
    await pause(1100);
    const idle = await state();
    await pause(500);
    record.idleFrames = (await state()).frames - idle.frames;
    assert.equal(record.idleFrames, 0);
    assert.equal(
      await evaluate('document.documentElement.scrollWidth>innerWidth'),
      false,
    );
    results.push(record);
  }
  await writeFile(
    `${output}/input-${baseline ? 'before' : 'after'}.json`,
    JSON.stringify(results, null, 2),
  );
  console.log(
    `PASS: ${baseline ? 'baseline recorded' : 'native wheel, small trackpad deltas, mouse/touch orbit, cancel/blur/resize/outside, keyboard, idle/offscreen'} (${results.length} viewports)`,
  );
} finally {
  await close();
}
