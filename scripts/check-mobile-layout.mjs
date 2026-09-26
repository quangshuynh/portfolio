/**
 * Real-layout mobile regression checks for About modal galleries, the Photography
 * gallery and viewer, and Featured project ordering (jsdom has no layout).
 * Start Vite and a disposable Chromium browser with --remote-debugging-port=9222,
 * then run: node scripts/check-mobile-layout.mjs
 * Optional: PORTFOLIO_URL and CDP_URL override the local server/debugger URLs.
 */
import assert from 'node:assert/strict';

const origin = process.env.PORTFOLIO_URL || 'http://127.0.0.1:5173';
const debuggerUrl = process.env.CDP_URL || 'http://127.0.0.1:9222';
const tab = await (await fetch(`${debuggerUrl}/json/new?about:blank`, { method: 'PUT' })).json();
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  clearTimeout(request.timeout);
  if (message.error) request.reject(new Error(JSON.stringify(message.error)));
  else request.resolve(message.result);
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(expression) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await evaluate(expression)) return;
    await delay(50);
  }
  throw new Error(`Condition not reached: ${expression}`);
}
async function enter(path, ready) {
  await send('Page.navigate', { url: 'about:blank' });
  await send('Page.navigate', { url: `${origin}${path}` });
  await waitFor(ready);
  await evaluate('document.fonts.ready.then(() => true)');
  await delay(400);
}
const decodeImages = scope => evaluate(`Promise.all([...${scope}.querySelectorAll('img')].map(image => { image.loading = 'eager'; return image.decode().catch(() => {}); })).then(() => true)`);
async function viewport(width, height, mobile = true) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
}
const ratioError = `(image) => { const box = image.getBoundingClientRect(); return Math.abs(box.width / box.height - image.naturalWidth / image.naturalHeight); }`;

const phones = [[320, 740], [360, 800], [375, 812], [390, 844], [393, 852], [430, 932]];
const phoneOrder = ['title', 'type', 'visual', 'purpose', 'stack', 'actions'];

try {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  for (const [width, height] of phones) {
    const label = `${width}x${height}`;
    await viewport(width, height);

    const measureCells = `(gallery) => [...gallery.querySelectorAll('figure')].map(figure => { const box = figure.getBoundingClientRect(); const image = figure.querySelector('img'); const caption = figure.querySelector('figcaption').getBoundingClientRect();
      return { portrait: figure.classList.contains('photography-gallery-portrait'), width: box.width, cellRatio: box.width / box.height, fit: getComputedStyle(image).objectFit, captionInside: caption.top >= box.top && caption.bottom <= box.bottom + .5, captionShare: caption.width * caption.height / (box.width * box.height) }; })`;
    const assertCells = (cells, name) => cells.forEach((cell, index) => {
      assert.ok(cell.width >= width * .35, `${label}: ${name} cell ${index} is ${cell.width}px wide`);
      assert.ok(Math.abs(cell.cellRatio - (cell.portrait ? 3 / 4 : 4 / 3)) < .03, `${label}: ${name} cell ${index} is ${cell.portrait ? '3:4' : '4:3'}, not a narrow strip`);
      assert.equal(cell.fit, 'cover', `${label}: ${name} image ${index} crops instead of stretching`);
      assert.ok(cell.captionInside, `${label}: ${name} caption ${index} stays inside its photo`);
      assert.ok(cell.captionShare < .5, `${label}: ${name} caption ${index} covers ${Math.round(cell.captionShare * 100)}%`);
    });

    await enter('/about', "!!document.querySelector('.about-portrait-button')");
    await evaluate("document.querySelector('.about-portrait-button').click()");
    await waitFor("!!document.querySelector('.personal-gallery')");
    await decodeImages("document.querySelector('.personal-gallery')");
    const about = await evaluate(`(() => { const gallery = document.querySelector('.personal-gallery'); const close = document.querySelector('.photography-modal-close').getBoundingClientRect();
      return { columns: getComputedStyle(gallery).gridTemplateColumns.split(' ').length, cells: (${measureCells})(gallery),
        closeVisible: close.top >= 0 && close.right <= innerWidth, pageOverflow: document.documentElement.scrollWidth > innerWidth, pageSnap: getComputedStyle(document.documentElement).scrollSnapType }; })()`);
    assert.equal(about.columns, 2, `${label}: About modal uses two columns`);
    assert.equal(about.pageSnap, 'none', `${label}: no page-level scroll snapping`);
    assertCells(about.cells, 'About');
    assert.ok(about.closeVisible, `${label}: modal close button is reachable`);
    assert.ok(!about.pageOverflow, `${label}: About has no horizontal page overflow`);

    for (const [gallery, heading] of [['cars', 'Cars'], ['gaming', 'Gaming']]) {
      await enter('/about', "!!document.querySelector('.interest-card')");
      await evaluate(`[...document.querySelectorAll('.interest-card')].find(card => card.querySelector('h3').textContent.trim() === '${heading}').querySelector('.interest-view-more').click()`);
      await waitFor(`!!document.querySelector('.${gallery}-gallery img')`);
      assertCells(await evaluate(`(${measureCells})(document.querySelector('.${gallery}-gallery'))`), heading);
    }

    await enter('/about#photography', "!!document.querySelector('#photography-modal-gallery img')");
    await decodeImages("document.querySelector('#photography-modal-gallery')");
    const photoModal = await evaluate(`(() => { const gallery = document.querySelector('#photography-modal-gallery'); return { columns: getComputedStyle(gallery).gridTemplateColumns.split(' ').length, cells: (${measureCells})(gallery) }; })()`);
    assert.equal(photoModal.columns, 2, `${label}: photography modal uses two columns`);
    assertCells(photoModal.cells, 'photography modal');

    await enter('/photography/', "!!document.querySelector('.photography-page-grid img')");
    await decodeImages('document');
    const gallery = await evaluate(`(() => { const ratio = ${ratioError}; const grid = document.querySelector('#photography-gallery'); const images = [...grid.querySelectorAll('img')];
      return { columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, minWidth: Math.min(...images.map(image => image.getBoundingClientRect().width)), maxRatioError: Math.max(...images.map(ratio)), pageOverflow: document.documentElement.scrollWidth > innerWidth }; })()`);
    assert.ok(gallery.columns <= 2, `${label}: Photography never uses three phone columns`);
    assert.ok(gallery.minWidth >= 160, `${label}: narrowest photograph is ${gallery.minWidth}px`);
    assert.ok(gallery.maxRatioError < .02, `${label}: gallery photographs keep their proportions`);
    assert.ok(!gallery.pageOverflow, `${label}: Photography has no horizontal page overflow`);

    await evaluate("document.querySelector('[data-photo-slug=\"_DSC0023\"] a').click()");
    await waitFor("(() => { const image = document.querySelector('.photography-lightbox img'); return image?.complete && image.getBoundingClientRect().width > 10; })()");
    await delay(300);
    const viewer = await evaluate(`(() => { const ratio = ${ratioError}; const image = document.querySelector('.photography-lightbox img'); const box = image.getBoundingClientRect(); const toolbar = document.querySelector('.photography-lightbox-toolbar').getBoundingClientRect();
      const buttons = ['Previous photograph', 'Next photograph', 'Show photograph information', 'Close photograph'].map(name => { const rect = document.querySelector('[aria-label="' + name + '"]').getBoundingClientRect(); return rect.width > 0 && rect.bottom <= innerHeight && rect.right <= innerWidth; });
      return { widthShare: box.width / innerWidth, ratioError: ratio(image), contained: box.left >= 0 && box.right <= innerWidth + .5 && box.top >= toolbar.bottom - .5 && box.bottom <= innerHeight + .5, buttons }; })()`);
    assert.ok(viewer.widthShare >= .85 || viewer.contained, `${label}: viewer photograph uses the phone width`);
    assert.ok(viewer.ratioError < .02, `${label}: viewer photograph keeps its proportions`);
    assert.ok(viewer.contained, `${label}: viewer photograph is fully visible`);
    assert.deepEqual(viewer.buttons, [true, true, true, true], `${label}: viewer controls are visible`);
    await evaluate("document.querySelector('[aria-label=\"Next photograph\"]').click()");
    await waitFor("location.hash === '#DIBS2164'");
    await evaluate("document.querySelector('[aria-label=\"Show photograph information\"]').click()");
    await waitFor("!!document.querySelector('.photography-lightbox-sheet')");
    await evaluate("document.querySelector('[aria-label=\"Close photograph information\"]').click()");
    await evaluate("document.querySelector('[aria-label=\"Close photograph\"]').click()");
    await waitFor("!document.querySelector('.photography-lightbox')");

    await enter('/', "!!document.querySelector('#projects .featured-project')");
    const projects = await evaluate(`(() => { const heading = document.querySelector('#projects-title'); const range = document.createRange(); range.selectNodeContents(heading);
      return { headingFits: [...range.getClientRects()].every(rect => rect.right <= innerWidth - 8), pageOverflow: document.documentElement.scrollWidth > innerWidth,
        articles: [...document.querySelectorAll('#projects .featured-project')].map(article => { const top = selector => article.querySelector(selector).getBoundingClientRect().top;
          const parts = { title: top('h3'), type: top('.project-number'), visual: top('.case-file__visual'), purpose: top('.project-purpose'), stack: top('.project-stack'), actions: top('.project-actions') };
          const index = article.querySelector('.case-file__index'); const title = article.querySelector('h3');
          return { order: Object.keys(parts).sort((first, second) => parts[first] - parts[second]), indexDemoted: parseFloat(getComputedStyle(index).fontSize) < parseFloat(getComputedStyle(title).fontSize) / 2 }; }) }; })()`);
    assert.ok(projects.headingFits, `${label}: Featured projects heading fits`);
    assert.ok(!projects.pageOverflow, `${label}: home has no horizontal page overflow`);
    projects.articles.forEach((article, index) => {
      assert.deepEqual(article.order, phoneOrder, `${label}: project ${index + 1} hierarchy`);
      assert.ok(article.indexDemoted, `${label}: project ${index + 1} number is demoted`);
    });
  }

  await viewport(1440, 900, false);
  await enter('/', "!!document.querySelector('#projects .featured-project')");
  const desktop = await evaluate(`[...document.querySelectorAll('#projects .featured-project')].map(article => ({ display: getComputedStyle(article).display, rail: getComputedStyle(article.querySelector('.case-file__rail')).display }))`);
  desktop.forEach(({ display, rail }, index) => {
    assert.equal(display, 'grid', `desktop project ${index + 1} keeps its grid composition`);
    assert.notEqual(rail, 'contents', `desktop project ${index + 1} keeps its rail`);
  });
  await enter('/about', "!!document.querySelector('.about-portrait-button')");
  await evaluate("document.querySelector('.about-portrait-button').click()");
  await waitFor("!!document.querySelector('.personal-gallery')");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.personal-gallery')).gridTemplateColumns.split(' ').length"), 3, 'desktop About modal keeps three cards');
  console.log(`PASS: ${phones.length} phone viewports (About/Cars/Gaming/photography modal grids and captions, gallery columns, viewer containment and controls, project hierarchy, heading fit) and desktop composition.`);
} finally {
  socket.close();
  await fetch(`${debuggerUrl}/json/close/${tab.id}`);
}
