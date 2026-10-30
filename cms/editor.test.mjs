// @vitest-environment node
// QuangEdit in the CMS: editing sources, treatments, renders, review and their security
// boundary, over real HTTP on the loopback interface. Synthetic images only.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import { createEditDocument, serializeEditDocument } from '../src/editor/model/editDocument.mjs';
import { neutralAdjustments } from '../src/editor/model/adjustments.mjs';
import { WATERMARK_DEFAULTS } from '../src/editor/watermark/watermark.mjs';
import { watermarkStatus } from './lib/watermark-rules.mjs';
import { fixtureRepo, photograph } from './test-helpers.mjs';
import { createSessions } from './lib/session.mjs';
import { startCmsServer } from './server.mjs';

let fixture;
let cms;
let sessions;
let port;
let cookie;

function call(method, url, { headers = {}, body, auth = true } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const req = httpRequest({
      host: '127.0.0.1', port, method, path: url,
      headers: {
        Host: `127.0.0.1:${port}`,
        ...(auth && cookie ? { Cookie: cookie } : {}),
        ...(method !== 'GET' ? { 'X-CMS-Request': '1', Origin: `http://127.0.0.1:${port}` } : {}),
        ...(payload ? { 'Content-Length': payload.length, 'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json' } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(bytes.toString('utf8')); } catch { /* binary */ }
        resolve({ status: res.statusCode, headers: res.headers, bytes, text: bytes.toString('utf8'), json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** A one-photo edit document for a source, as the editor's host saves it. */
function documentFor(source, adjustments = {}) {
  return serializeEditDocument(createEditDocument([{
    name: source.name, size: source.size, lastModified: 0, sha256: source.sha256, format: source.format ?? 'jpeg', width: 1600, height: 1000,
    adjustments: { ...neutralAdjustments(), ...adjustments },
  }], {}));
}

async function uploadDraft(name = 'lake.jpg', color = { r: 20, g: 140, b: 90 }) {
  const bytes = await photograph({ color });
  const response = await call('POST', `/api/uploads?filename=${name}`, { body: bytes });
  expect(response.status).toBe(200);
  return { id: response.json.id, bytes };
}

const describe_ = (id) => call('GET', `/api/editor/photos/${id}`);
async function save(id, text) {
  const { json } = await describe_(id);
  return call('PUT', `/api/editor/photos/${id}/treatment`, { body: { document: text, revision: json.treatment.revision } });
}
async function render(id, bytes, overrides = {}) {
  const { json } = await describe_(id);
  const query = new URLSearchParams({ name: 'lake.jpg', documentHash: json.treatment.documentHash ?? '', revision: String(json.treatment.revision), ...overrides });
  return call('PUT', `/api/editor/photos/${id}/render?${query}`, { body: bytes });
}
async function review(id, action) {
  const { json } = await describe_(id);
  return call('POST', `/api/editor/photos/${id}/${action}`, { body: { revision: json.treatment.revision } });
}

beforeEach(async () => {
  fixture = await fixtureRepo();
  sessions = createSessions();
  cms = await startCmsServer({ port: 0, repoDir: fixture.repo, workspace: fixture.workspace, offline: true, vite: false, sessions, log: () => {} });
  port = new URL(cms.url).port;
  cookie = null;
  const signIn = await call('GET', `/admin/photography/?token=${sessions.token}`);
  cookie = signIn.headers['set-cookie'][0].split(';')[0];
}, 60_000);
afterEach(async () => {
  await cms.close();
  fixture.cleanup();
});

describe('security boundary', () => {
  test('every editor route needs the session, the header and the same origin', async () => {
    expect((await call('GET', '/api/editor/photos/alpha', { auth: false })).status).toBe(401);
    expect((await call('GET', '/api/editor/photos/alpha/sources/0', { auth: false })).status).toBe(401);
    expect((await call('PUT', '/api/editor/photos/alpha/treatment', { body: {}, headers: { 'X-CMS-Request': '' } })).status).toBe(403);
    expect((await call('POST', '/api/editor/photos/alpha/approve', { body: {}, headers: { Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call('GET', '/api/editor/photos/alpha', { headers: { Host: 'evil.example' } })).status).toBe(421);
  });

  test('ids are validated and no response names a filesystem path', async () => {
    const { id } = await uploadDraft();
    expect((await call('GET', '/api/editor/photos/..%2F..%2Fetc')).status).toBe(404);
    expect((await call('GET', '/api/editor/photos/nope')).status).toBe(404);
    expect((await call('GET', `/api/editor/photos/${id}/sources/7`)).status).toBe(404);
    expect((await call('GET', `/api/editor/photos/${id}/sources/..%2F..%2Fcatalog.json`)).status).toBe(404);
    const { text } = await describe_(id);
    expect(text).not.toContain(fixture.workspace.replace(/\\/g, '\\\\'));
    expect(text).not.toContain(path.basename(fixture.workspace));
    expect(text).not.toMatch(/"file":/);
  });
});

describe('opening a photograph in QuangEdit', () => {
  test('a draft upload opens from its original, byte for byte, privately', async () => {
    const { id, bytes } = await uploadDraft();
    const { json } = await describe_(id);
    expect(json.photo).toMatchObject({ id, status: 'draft' });
    expect(json.sources).toEqual([expect.objectContaining({ kind: 'original', available: true, sha256: sha256(bytes), index: 0 })]);
    expect(json.treatment).toMatchObject({ status: 'none', document: null });
    const source = await call('GET', `/api/editor/photos/${id}/sources/0`);
    expect(source.status).toBe(200);
    expect(source.headers['cache-control']).toBe('private, no-store');
    expect(sha256(source.bytes)).toBe(sha256(bytes));
  });

  test('a published photograph without an original is limited to its public image, and says so', async () => {
    const { json } = await describe_('alpha');
    expect(json.sources).toEqual([expect.objectContaining({ kind: 'derivative', limited: true, name: 'alpha-viewer.jpg' })]);
    expect(json.sources[0].problem).toMatch(/2200 px/);
  });

  test('a missing original is reported instead of failing', async () => {
    const { id } = await uploadDraft();
    const originals = path.join(fixture.workspace, 'originals');
    for (const name of readdirSync(originals)) rmSync(path.join(originals, name));
    const { json } = await describe_(id);
    expect(json.sources[0]).toMatchObject({ available: false });
    expect(json.sources[0].problem).toMatch(/missing/);
    expect((await call('GET', `/api/editor/photos/${id}/sources/0`)).status).toBe(404);
  });
});

describe('treatments', () => {
  test('save and reopen keeps the full document; a stale tab cannot overwrite it', async () => {
    const { id } = await uploadDraft();
    const { json } = await describe_(id);
    const local = [{ id: 'l1', name: 'Sky', enabled: true, amount: 100, settings: { exposure: -0.5 }, mask: { space: 'image', base: 0, enabled: true, invert: false, opacity: 100, components: [{ id: 'c1', type: 'linear', name: 'Sky', enabled: true, op: 'add', invert: false, opacity: 100, x0: 0.5, y0: 0, x1: 0.5, y1: 0.5, feather: 0.5 }] } }];
    const text = documentFor(json.sources[0], { exposure: 0.4, local, geometry: { angle: 2 } });
    const saved = await save(id, text);
    expect(saved.status).toBe(200);
    expect(saved.json.treatment).toMatchObject({ status: 'draft', revision: 1 });
    const reopened = (await describe_(id)).json.treatment.document;
    expect(reopened.photos[0].adjustments.exposure).toBe(0.4);
    expect(reopened.photos[0].adjustments.local[0].mask.components[0]).toMatchObject({ type: 'linear', y1: 0.5 });
    expect(reopened.photos[0].adjustments.geometry).toEqual({ angle: 2 });
    expect(reopened.savedAt).toBeUndefined();
    const stale = await call('PUT', `/api/editor/photos/${id}/treatment`, { body: { document: documentFor(json.sources[0], { exposure: 1 }), revision: 0 } });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('stale-revision');
    expect(readdirSync(path.join(fixture.workspace, 'treatments'))).toEqual([`${id}.json`]);
  });

  test('invalid documents and documents of another file are refused, the saved one kept', async () => {
    const { id } = await uploadDraft();
    const { json } = await describe_(id);
    await save(id, documentFor(json.sources[0], { contrast: 10 }));
    for (const bad of ['not json', '{"type":"other"}', serializeEditDocument(createEditDocument([], {}))]) {
      const response = await save(id, bad);
      expect(response.status).toBe(422);
      expect(response.json.error.code).toBe('invalid-document');
    }
    const other = await save(id, documentFor({ name: 'x.jpg', size: 10, sha256: 'f'.repeat(64) }));
    expect(other.json.error.code).toBe('source-mismatch');
    expect((await describe_(id)).json.treatment.document.photos[0].adjustments.contrast).toBe(10);
  });

  test('render, approve, edit again, reject and revert', async () => {
    const { id } = await uploadDraft();
    const source = (await describe_(id)).json.sources[0];
    expect((await render(id, await photograph())).json.error.code).toBe('no-treatment');
    await save(id, documentFor(source, { exposure: 0.3 }));
    expect((await review(id, 'approve')).json.error.code).toBe('stale-render');
    expect((await render(id, await photograph(), { documentHash: 'a'.repeat(64) })).json.error.code).toBe('stale-render');
    expect((await render(id, Buffer.from('not an image'))).status).toBe(415);

    const rendered = await render(id, await photograph({ width: 3000, height: 2000, color: { r: 200, g: 100, b: 40 } }), { name: 'lake.jpg' });
    expect(rendered.status).toBe(200);
    expect(rendered.json).toMatchObject({ renderFresh: true });
    expect(rendered.json.treatment.render).toMatchObject({ file: 'lake-quangedit.jpg', width: 3000, height: 2000, viewer: { width: 2200, height: 1467 }, gallery: { width: 900, height: 600 } });
    const viewer = await call('GET', `/api/editor/photos/${id}/images/current-viewer`);
    expect(viewer.status).toBe(200);
    expect(viewer.headers['content-type']).toBe('image/jpeg');
    expect((await call('GET', `/api/editor/photos/${id}/images/approved-viewer`)).status).toBe(404);

    const approved = await review(id, 'approve');
    expect(approved.json.treatment).toMatchObject({ status: 'approved', approved: { documentHash: rendered.json.treatment.documentHash } });
    expect((await call('GET', `/api/editor/photos/${id}/images/approved-viewer`)).status).toBe(200);

    // A new edit is a draft; the approved treatment and its render stand until replaced.
    await save(id, documentFor(source, { exposure: 0.9 }));
    let state = (await describe_(id)).json;
    expect(state).toMatchObject({ renderFresh: false, treatment: { status: 'draft' } });
    expect(state.treatment.approved.document.photos[0].adjustments.exposure).toBe(0.3);
    state = (await review(id, 'reject')).json;
    expect(state.treatment.status).toBe('rejected');
    state = (await review(id, 'discard')).json;
    expect(state.treatment).toMatchObject({ status: 'approved' });
    expect(state.treatment.document.photos[0].adjustments.exposure).toBe(0.3);
    expect(state.renderFresh).toBe(true);
    // Only the approved render folder is left.
    expect(readdirSync(path.join(fixture.workspace, 'renders', id))).toEqual([state.treatment.render.folder]);
  });

  test('the comparison original is the camera original; remove-approved needs the current revision', async () => {
    const { id } = await uploadDraft();
    const state = (await describe_(id)).json;
    expect(state.original).toBe('source');
    const original = await call('GET', `/api/editor/photos/${id}/images/original`);
    expect(original.status).toBe(200);
    expect(original.headers['content-type']).toBe('image/jpeg');
    expect(original.headers['cache-control']).toBe('private, no-store');
    expect(readdirSync(path.join(fixture.workspace, 'cache', 'originals'))).toEqual([`${id}-${state.sources[0].sha256.slice(0, 16)}-viewer.jpg`]);
    expect((await review(id, 'remove-approved')).json.error.code).toBe('no-approved');
    await save(id, documentFor(state.sources[0], { exposure: 0.2 }));
    await render(id, await photograph({ color: { r: 200, g: 10, b: 10 } }));
    await review(id, 'approve');
    const stale = await call('POST', `/api/editor/photos/${id}/remove-approved`, { body: { revision: 0 } });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('stale-revision');
    const removed = (await review(id, 'remove-approved')).json;
    expect(removed.treatment).toMatchObject({ approved: null, status: 'draft' });
    expect(removed.treatment.restore.viewer.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(removed.approvedLive).toBe(false);
  });

  test('retouch (clone and heal) is kept with the treatment; changing it makes the watermarked render stale, the approved version untouched', async () => {
    const { id } = await uploadDraft();
    const source = (await describe_(id)).json.sources[0];
    const watermark = { ...WATERMARK_DEFAULTS };
    const retouch = [
      { id: 'h1', type: 'heal', enabled: true, points: [[0.4, 0.41]], radius: 0.02, hardness: 0.5, opacity: 1, spacing: 0.25, offset: { x: 0.05, y: -0.01 } },
      { id: 'c1', type: 'clone', enabled: true, points: [[0.1, 0.2], [0.12, 0.21]], radius: 0.01, hardness: 0.8, opacity: 0.6, spacing: 0.2, offset: { x: 0.2, y: 0 } },
    ];
    await save(id, documentFor(source, { exposure: 0.2, retouch, watermark }));
    let { json } = await describe_(id);
    expect(json.treatment.document.photos[0].adjustments.retouch).toEqual(retouch);
    await render(id, await photograph({ width: 3000, height: 2000 }));
    expect(watermarkStatus((await describe_(id)).json.treatment)).toBe('needs-review');
    const approved = (await review(id, 'approve')).json.treatment;
    expect(watermarkStatus(approved)).toBe('approved');
    // Moving a repair's source is a change to the photograph: a new draft, its render stale.
    await save(id, documentFor(source, { exposure: 0.2, retouch: [{ ...retouch[0], offset: { x: -0.05, y: 0.02 } }, retouch[1]], watermark }));
    ({ json } = await describe_(id));
    expect(json.treatment.status).toBe('draft');
    expect(watermarkStatus(json.treatment)).toBe('needs-regeneration');
    expect(json.treatment.approved.documentHash).toBe(approved.approved.documentHash);
    expect(json.treatment.approved.document.photos[0].adjustments.retouch[0].offset).toEqual({ x: 0.05, y: -0.01 });
  });

  test('a treatment without an approval discards to nothing', async () => {
    const { id } = await uploadDraft();
    await save(id, documentFor((await describe_(id)).json.sources[0], { exposure: 0.2 }));
    const state = (await review(id, 'discard')).json;
    expect(state.treatment).toMatchObject({ status: 'none', document: null, render: null });
  });
});

describe('attached editing sources', () => {
  const fakeArw = () => Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(4096, 7)]);

  test('a RAW file is stored once by content and becomes the editing source', async () => {
    const { json } = await describe_('alpha');
    const raw = fakeArw();
    const attached = await call('POST', `/api/editor/photos/alpha/sources?filename=DSC09640.ARW&revision=${json.treatment.revision}`, { body: raw });
    expect(attached.status).toBe(200);
    expect(attached.json.sources).toEqual([expect.objectContaining({ kind: 'attached', format: 'arw', name: 'DSC09640.ARW', sha256: sha256(raw), available: true })]);
    const again = await call('POST', `/api/editor/photos/alpha/sources?filename=copy.ARW&revision=${attached.json.treatment.revision}`, { body: raw });
    expect(again.json.sources).toHaveLength(1);
    expect(readdirSync(path.join(fixture.workspace, 'sources'))).toEqual([`${sha256(raw)}.arw`]);
    const served = await call('GET', '/api/editor/photos/alpha/sources/0');
    expect(sha256(served.bytes)).toBe(sha256(raw));
  });

  test('a Nikon NEF is accepted as an editing source and stored privately by content', async () => {
    const { json } = await describe_('gamma');
    const raw = Buffer.concat([Buffer.from([0x4d, 0x4d, 0x00, 0x2a]), Buffer.alloc(4096, 9)]);
    const attached = await call('POST', `/api/editor/photos/gamma/sources?filename=_DSC0051.NEF&revision=${json.treatment.revision}`, { body: raw });
    expect(attached.status).toBe(200);
    expect(attached.json.sources).toEqual([expect.objectContaining({ kind: 'attached', format: 'nef', name: '_DSC0051.NEF', sha256: sha256(raw), available: true })]);
    expect(readdirSync(path.join(fixture.workspace, 'sources'))).toContain(`${sha256(raw)}.nef`);
  });

  test('unsupported files, a fourth source and a TIFF that is not ARW or DNG are refused', async () => {
    let revision = (await describe_('beta')).json.treatment.revision;
    expect((await call('POST', `/api/editor/photos/beta/sources?filename=a.txt&revision=${revision}`, { body: Buffer.from('hello') })).status).toBe(415);
    expect((await call('POST', `/api/editor/photos/beta/sources?filename=scan.tif&revision=${revision}`, { body: fakeArw() })).status).toBe(415);
    for (const shade of [10, 120, 230]) {
      const response = await call('POST', `/api/editor/photos/beta/sources?filename=b${shade}.jpg&revision=${revision}`, { body: await photograph({ color: { r: shade, g: 50, b: 50 } }) });
      expect(response.status).toBe(200);
      revision = response.json.treatment.revision;
    }
    const fourth = await call('POST', `/api/editor/photos/beta/sources?filename=d.jpg&revision=${revision}`, { body: await photograph({ color: { r: 1, g: 2, b: 3 } }) });
    expect(fourth.status).toBe(409);
  });

  test('changing the source marks the saved treatment stale instead of applying it to another file', async () => {
    const { id } = await uploadDraft();
    const first = (await describe_(id)).json;
    await save(id, documentFor(first.sources[0], { exposure: 0.5 }));
    const revision = (await describe_(id)).json.treatment.revision;
    const other = await photograph({ color: { r: 5, g: 5, b: 200 } });
    const state = (await call('POST', `/api/editor/photos/${id}/sources?filename=other.jpg&revision=${revision}`, { body: other })).json;
    expect(state.staleSource).toBe(true);
    expect(state.treatment.document.photos[0].adjustments.exposure).toBe(0.5);
    // Clearing the attachment brings the original back, and the treatment matches again.
    const cleared = (await call('POST', `/api/editor/photos/${id}/sources/clear`, { body: { revision: state.treatment.revision } })).json;
    expect(cleared.staleSource).toBe(false);
    expect(readdirSync(path.join(fixture.workspace, 'sources'))).toEqual([]);
  });

  test('an HDR treatment needs all three of its exposures', async () => {
    let revision = (await describe_('gamma')).json.treatment.revision;
    const inputs = [];
    for (const [role, shade] of [['under', 30], ['normal', 120], ['over', 220]]) {
      const bytes = await photograph({ color: { r: shade, g: shade, b: shade } });
      const response = await call('POST', `/api/editor/photos/gamma/sources?filename=${role}.jpg&revision=${revision}`, { body: bytes });
      revision = response.json.treatment.revision;
      inputs.push({ name: `${role}.jpg`, size: bytes.length, sha256: sha256(bytes), format: 'jpeg', role });
    }
    const hdr = { mode: 'fusion', inputs, settings: { align: true, deghost: true, deghostStrength: 50 } };
    const document = serializeEditDocument(createEditDocument([{ name: 'normal-HDR', size: 1, sha256: 'e'.repeat(64), format: 'hdr', width: 1600, height: 1000, hdr, adjustments: neutralAdjustments() }], {}));
    expect((await save('gamma', document)).status).toBe(200);
    const missing = serializeEditDocument(createEditDocument([{ name: 'normal-HDR', size: 1, sha256: 'e'.repeat(64), format: 'hdr', width: 1600, height: 1000,
      hdr: { ...hdr, inputs: inputs.map((input, i) => (i === 2 ? { ...input, sha256: 'd'.repeat(64) } : input)) }, adjustments: { ...neutralAdjustments(), exposure: 1 } }], {}));
    expect((await save('gamma', missing)).json.error.code).toBe('source-mismatch');
  });
});

describe('camera library sources', () => {
  test('read in place without copying; a moved file falls back to the public image and says so', async () => {
    await cms.close();
    const library = path.join(fixture.root, 'library');
    const relative = path.join('nikon-d3100', '2026-03-20');
    mkdirSync(path.join(library, relative), { recursive: true });
    const bytes = await photograph({ color: { r: 9, g: 99, b: 199 } });
    writeFileSync(path.join(library, relative, '_DSC0009.JPG'), bytes);
    // A published id that photography-sources.mjs maps into the library.
    const catalog = JSON.parse(readFileSync(path.join(fixture.workspace, 'catalog.json'), 'utf8'));
    catalog.photographs.push({ ...catalog.photographs[1], id: 'fog-parking-lot', slug: 'fog-parking-lot', sourceFilename: '_DSC0009.JPG', status: 'draft' });
    writeFileSync(path.join(fixture.workspace, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
    cms = await startCmsServer({ port: 0, repoDir: fixture.repo, workspace: fixture.workspace, libraryDir: library, offline: true, vite: false, sessions, log: () => {} });
    port = new URL(cms.url).port;
    let { json } = await describe_('fog-parking-lot');
    expect(json.sources).toEqual([expect.objectContaining({ kind: 'library', sha256: sha256(bytes), available: true })]);
    expect(readdirSync(fixture.workspace)).not.toContain('sources');
    rmSync(path.join(library, relative, '_DSC0009.JPG'));
    writeFileSync(path.join(fixture.repo, 'src', 'assets', 'photography', 'generated', 'fog-parking-lot-viewer.jpg'), await photograph({ width: 220, height: 146 }));
    ({ json } = await describe_('fog-parking-lot'));
    expect(json.sources).toEqual([expect.objectContaining({ kind: 'derivative', limited: true })]);
    expect(json.sources[0].problem).toMatch(/moved or renamed/);
  });
});
