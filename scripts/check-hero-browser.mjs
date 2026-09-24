import assert from 'node:assert/strict';
import { heroViewports } from './hero-viewports.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  send,
  evaluate,
  pause,
  screenshot,
  close,
} from './hero-browser-session.mjs';

const origin = process.env.HERO_PREVIEW_URL || 'http://localhost:4173';
const output = process.env.HERO_CHECK_OUTPUT || '/tmp/portfolio-hero-check';
await mkdir(output, { recursive: true });
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
  window.heroMetrics={cls:0,lcp:0,errors:[],shifts:[]};
  addEventListener('error',e=>heroMetrics.errors.push(e.message));
  new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput){heroMetrics.cls+=e.value;heroMetrics.shifts.push({value:e.value,time:e.startTime,sources:e.sources.map(s=>({node:(s.node?.outerHTML || s.node?.parentElement?.outerHTML || "unknown").slice(0,200),before:{x:s.previousRect.x,y:s.previousRect.y,width:s.previousRect.width,height:s.previousRect.height},after:{x:s.currentRect.x,y:s.currentRect.y,width:s.currentRect.width,height:s.currentRect.height}}))})}}).observe({type:'layout-shift',buffered:true});
  new PerformanceObserver(l=>{heroMetrics.lcp=l.getEntries().at(-1).startTime}).observe({type:'largest-contentful-paint',buffered:true});
`,
});
async function waitFor(expression, message) {
  for (let i = 0; i < 60; i++) {
    if (await evaluate(expression)) return;
    await pause(100);
  }
  throw Error(message);
}
const sceneFrames = () =>
  evaluate(
    `Number(document.querySelector('.hero-desk canvas')?.dataset.frames || 0)`,
  );
const sceneResources = () =>
  evaluate(
    `performance.getEntriesByType('resource').filter(r=>r.name.includes('interactiveHeroScene')).map(r=>({name:r.name.split('/').at(-1),bytes:r.encodedBodySize,start:r.startTime}))`,
  );
async function navigate() {
  await send('Page.navigate', { url: origin });
  await waitFor(`!!document.querySelector('.hero-desk')`, 'Hero did not load');
  await pause(1700);
}
async function showScene() {
  await evaluate(
    `document.querySelector('.hero-desk').scrollIntoView({block:'center',behavior:'instant'})`,
  );
  await waitFor(
    `document.querySelector('.hero-desk').dataset.ready==='true'`,
    'Scene did not initialize',
  );
}
const results = [];
try {
  for (const [name, width, height, mobile] of heroViewports) {
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });
    await send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
    await navigate();
    const initial = await evaluate(
      `({...heroMetrics,navBottom:document.querySelector('.site-nav').getBoundingClientRect().bottom,introTop:document.querySelector('.hero .eyebrow').getBoundingClientRect().top,sceneBottom:document.querySelector('.hero-desk__stage').getBoundingClientRect().bottom,overflow:document.documentElement.scrollWidth>innerWidth,cta:document.querySelector('.hero-actions').getBoundingClientRect().toJSON(),entry:performance.getEntriesByType('resource').find(r=>r.name.includes('/assets/index-') && r.name.endsWith('.js'))?.encodedBodySize})`,
    );
    assert.equal(initial.overflow, false, `${name}: initial overflow`);
    // Cold Circular font swapping shifts these same text nodes in the retained
    // baseline. Any new initial source (including the scene) is a regression.
    assert.ok(
      initial.shifts.every((shift) =>
        shift.sources.every(
          (source) =>
            source.node.startsWith('<h1 id="hero-title"') ||
            source.node.startsWith('<span class="brand-domain"') ||
            source.node.startsWith('<span class="brand-tld"'),
        ),
      ),
      `${name}: new initial layout shift ${JSON.stringify(initial.shifts)}`,
    );
    if (width > 620) {
      assert.ok(
        initial.sceneBottom <= height,
        `${name}: incomplete initial hero`,
      );
      assert.ok(
        initial.introTop >= initial.navBottom,
        `${name}: navigation overlaps introduction`,
      );
    }
    assert.equal(initial.errors.length, 0, `${name}: script errors`);
    await screenshot(`${output}/${name}-initial.png`);
    await showScene();
    await pause(900);
    const stats = await evaluate(
      `({...document.querySelector('.hero-desk canvas').dataset,buffer:[document.querySelector('.hero-desk canvas').width,document.querySelector('.hero-desk canvas').height],cls:heroMetrics.cls})`,
    );
    assert.ok(Number(stats.drawCalls) <= 20, 'Draw-call budget exceeded');
    assert.ok(Number(stats.triangles) <= 3000, 'Triangle budget exceeded');
    assert.equal(
      await evaluate(`document.querySelectorAll('.hero-desk canvas').length`),
      1,
    );
    const idle = await sceneFrames();
    await pause(600);
    assert.equal(await sceneFrames(), idle, 'Idle scene rendered');
    const rect = await evaluate(
      `document.querySelector('.hero-desk__stage').getBoundingClientRect().toJSON()`,
    );
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: rect.x + rect.width * 0.8,
      y: rect.y + rect.height * 0.5,
    });
    await pause(100);
    const moved = await sceneFrames();
    if (mobile)
      assert.equal(moved, idle, 'Mobile mouse emulation moved camera');
    else assert.ok(moved > idle, 'Desktop pointer did not render');
    await screenshot(`${output}/${name}-scene.png`);
    // Scroll out and return: no background rendering and exactly one retained canvas.
    await evaluate(
      `window.scrollTo({top:document.body.scrollHeight,behavior:'instant'})`,
    );
    await pause(350);
    const offscreen = await sceneFrames();
    await pause(600);
    assert.equal(await sceneFrames(), offscreen, 'Offscreen rendering');
    await showScene();
    await pause(100);
    // Orientation/resize must update the drawing buffer without a remount.
    await send('Emulation.setDeviceMetricsOverride', {
      width: height,
      height: width,
      deviceScaleFactor: 1,
      mobile,
    });
    await pause(900);
    assert.equal(
      await evaluate(`document.documentElement.scrollWidth>innerWidth`),
      false,
      'Orientation overflow',
    );
    await send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });
    await pause(900);
    if (mobile) {
      await showScene();
      const touchRect = await evaluate(
        `document.querySelector('.hero-desk__stage').getBoundingClientRect().toJSON()`,
      );
      const before = await evaluate('scrollY');
      await send('Input.synthesizeScrollGesture', {
        x: touchRect.x + touchRect.width / 2,
        y: Math.min(height - 32, touchRect.y + touchRect.height / 2),
        // Tablets retain the existing page scroll-snap: cross its threshold.
        yDistance: -Math.max(200, height * 0.8),
        gestureSourceType: 'touch',
      });
      await pause(200);
      assert.ok(
        (await evaluate('scrollY')) > before,
        `${name}: touch failed to scroll through scene`,
      );
    }
    results.push({
      name,
      initial,
      scene: stats,
      resources: await sceneResources(),
      idleFrames: 0,
      offscreenFrames: 0,
    });
  }
  // High-density screens remain capped; light mode keeps the scene readable.
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await navigate();
  await showScene();
  await pause(200);
  assert.ok(
    await evaluate(
      `document.querySelector('.hero-desk canvas').width / document.querySelector('.hero-desk__canvas').clientWidth <= 1.26`,
    ),
    'Mobile DPR cap exceeded',
  );
  await evaluate(`document.documentElement.dataset.theme='light'`);
  await screenshot(`${output}/iphone-light-dpr3.png`);
  // Exercise the visibility handler without relying on a headless tab UI.
  const hiddenFrames = await sceneFrames();
  await evaluate(
    `Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))`,
  );
  await pause(1000);
  assert.equal(await sceneFrames(), hiddenFrames, 'Hidden document rendered');
  await evaluate(
    `delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))`,
  );
  await pause(200);
  // Reported data-saving / low-core devices receive only the fallback.
  for (const source of [
    `Object.defineProperty(navigator,'connection',{value:{saveData:true}})`,
    `Object.defineProperty(navigator,'hardwareConcurrency',{value:2})`,
  ]) {
    const injection = await send('Page.addScriptToEvaluateOnNewDocument', {
      source,
    });
    await navigate();
    await evaluate(
      `document.querySelector('.hero-desk').scrollIntoView({block:'center',behavior:'instant'})`,
    );
    await pause(1800);
    assert.equal(
      (await sceneResources()).length,
      0,
      'Constrained device downloaded 3D',
    );
    await send('Page.removeScriptToEvaluateOnNewDocument', {
      identifier: injection.identifier,
    });
  }
  // Real browser, reduced-motion preference: static source loaded, no 3D request.
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  await navigate();
  await evaluate(
    `document.querySelector('.hero-desk').scrollIntoView({block:'center',behavior:'instant'})`,
  );
  await pause(1800);
  assert.equal(
    (await sceneResources()).length,
    0,
    'Reduced motion downloaded 3D',
  );
  assert.ok(
    await evaluate(
      `document.querySelector('picture img').complete && document.querySelector('picture img').naturalWidth>0`,
    ),
  );
  await screenshot(`${output}/reduced-motion.png`);
  await send('Emulation.setEmulatedMedia', { features: [] });
  await showScene();
  // Context loss after readiness restores fallback and disposes the canvas.
  await evaluate(
    `document.querySelector('.hero-desk canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()`,
  );
  await pause(200);
  assert.equal(
    await evaluate(`document.querySelector('.hero-desk').dataset.ready`),
    'false',
  );
  assert.equal(
    await evaluate(`document.querySelectorAll('.hero-desk canvas').length`),
    0,
  );
  // Actual initialization failure in the renderer, without stubbing the module.
  const injected = await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `const getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return type.includes('webgl')?null:getContext.call(this,type,...args)}`,
  });
  await navigate();
  await evaluate(
    `document.querySelector('.hero-desk').scrollIntoView({block:'center',behavior:'instant'})`,
  );
  await pause(2000);
  assert.equal(
    await evaluate(`document.querySelector('.hero-desk').dataset.ready`),
    'false',
  );
  assert.equal(
    await evaluate(`document.querySelectorAll('.hero-desk canvas').length`),
    0,
  );
  await send('Page.removeScriptToEvaluateOnNewDocument', {
    identifier: injected.identifier,
  });
  await send('Network.setBlockedURLs', { urls: ['*interactiveHeroScene*'] });
  await navigate();
  await evaluate(
    `document.querySelector('.hero-desk').scrollIntoView({block:'center',behavior:'instant'})`,
  );
  await pause(1800);
  assert.equal(
    await evaluate(`document.querySelector('.hero-desk').dataset.ready`),
    'false',
  );
  // Existing CTA, résumé and navigation remain available with the module blocked.
  assert.equal(
    await evaluate(
      `document.querySelector('.hero-actions a').getAttribute('href')`,
    ),
    '#projects',
  );
  await evaluate(`document.querySelector('.hero-actions a').focus()`);
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
  });
  await send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
  });
  assert.ok(
    await evaluate(
      `document.activeElement.href.endsWith('Quang_Huynh_Resume.pdf')`,
    ),
  );
  assert.ok(
    await evaluate(
      `parseFloat(getComputedStyle(document.activeElement).outlineWidth)>0`,
    ),
    'Missing focus outline',
  );
  await evaluate(`document.querySelector('.hero-actions a').click()`);
  await pause(500);
  assert.equal(await evaluate('location.hash'), '#projects');
  await send('Network.setBlockedURLs', { urls: [] });
  await evaluate(`document.querySelector('.meet-quang-card').click()`);
  await waitFor(
    `location.pathname==='/about' && !!document.querySelector('.about-hero')`,
    'About navigation failed',
  );
  await writeFile(`${output}/metrics.json`, JSON.stringify(results, null, 2));
  console.log(
    JSON.stringify(
      {
        passed: true,
        results,
        checks: [
          'viewport layouts',
          'idle/offscreen rendering',
          'pointer bounds',
          'touch scrolling',
          'orientation',
          'reduced motion',
          'context loss',
          'WebGL initialization failure',
          'blocked module',
          'keyboard focus',
          'CTA anchors',
          'About navigation',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await close();
}
