// @vitest-environment node
// The CMS watermark preference and portfolio overview over real HTTP on the loopback interface:
// session boundary, validation, no paths, and a global change never touching saved treatments.
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import path from 'node:path';
import { createEditDocument, parseEditDocument, serializeEditDocument } from '../src/editor/model/editDocument.mjs';
import { neutralAdjustments } from '../src/editor/model/adjustments.mjs';
import { WATERMARK_DEFAULTS } from '../src/editor/watermark/watermark.mjs';
import { fixtureRepo, photograph } from './test-helpers.mjs';
import { addDraft } from './lib/catalog-ops.mjs';
import { ingestUpload } from './lib/uploads.mjs';
import { readWorkspace, saveCatalog } from './lib/workspace.mjs';
import { autoDraftPlan, unwatermarkedPhotographs, watermarkStatus, watermarkTreatmentState } from './lib/watermark-rules.mjs';
import { createSessions } from './lib/session.mjs';
import { startCmsServer } from './server.mjs';

let fixture;
let cms;
let sessions;
let port;
let cookie;

function call(method, url, { headers = {}, body, auth = true } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = httpRequest({
      host: '127.0.0.1', port, method, path: url,
      headers: {
        Host: `127.0.0.1:${port}`,
        ...(auth && cookie ? { Cookie: cookie } : {}),
        ...(method !== 'GET' ? { 'X-CMS-Request': '1', Origin: `http://127.0.0.1:${port}` } : {}),
        ...(payload ? { 'Content-Length': payload.length, 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
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

test('the watermark routes need the session, the header and the same origin', async () => {
  expect((await call('GET', '/api/watermark', { auth: false })).status).toBe(401);
  expect((await call('GET', '/api/watermark/portfolio', { auth: false })).status).toBe(401);
  expect((await call('PUT', '/api/watermark', { body: { settings: WATERMARK_DEFAULTS }, headers: { 'X-CMS-Request': '' } })).status).toBe(403);
  expect((await call('PUT', '/api/watermark', { body: { settings: WATERMARK_DEFAULTS }, headers: { Origin: 'https://evil.example' } })).status).toBe(403);
});

test('the global preference: approved defaults, validated, clamped, stored as a watermark file', async () => {
  let { json } = await call('GET', '/api/watermark');
  // Until one is saved: the approved defaults (11%, 65%, bottom right, outline) with automatic white or charcoal.
  expect(json).toEqual({ settings: { ...WATERMARK_DEFAULTS, color: 'auto' }, saved: false, updatedAt: null });
  expect((await call('PUT', '/api/watermark', { body: { settings: { preset: 'someone-else' } } })).status).toBe(422);
  ({ json } = await call('PUT', '/api/watermark', { body: { settings: { position: 'top-left', size: 50, opacity: 0.4, text: 'NOT HUYNH' } } }));
  expect(json.saved).toBe(true);
  expect(json.settings).toMatchObject({ position: 'top-left', size: 0.3, opacity: 0.4, enabled: true });
  const stored = JSON.parse(readFileSync(path.join(fixture.workspace, 'watermark.json'), 'utf8'));
  expect(stored.config).toMatchObject({ type: 'quanghuynh.watermark', version: 1 });
  expect(JSON.stringify(stored)).not.toContain('NOT HUYNH');
});

test('the portfolio overview lists published photographs without paths, and a preference change leaves treatments alone', async () => {
  const describe = await call('GET', '/api/editor/photos/alpha');
  const [source] = describe.json.sources;
  const watermark = { ...WATERMARK_DEFAULTS, position: 'bottom-left' };
  const text = serializeEditDocument(createEditDocument([{
    name: source.name, size: source.size, lastModified: 0, sha256: source.sha256, format: 'jpeg', width: 2200, height: 1467,
    adjustments: { ...neutralAdjustments(), watermark },
  }], {}));
  expect((await call('PUT', '/api/editor/photos/alpha/treatment', { body: { document: text, revision: describe.json.treatment.revision } })).status).toBe(200);

  let { json, text: body } = await call('GET', '/api/watermark/portfolio');
  expect(json.count).toBe(3);
  const alpha = json.photographs.find(({ id }) => id === 'alpha');
  expect(alpha).toMatchObject({ width: 2200, height: 1467, source: { kind: 'derivative', limited: true, available: true }, treatment: { status: 'draft', watermarked: true, approvedWatermarked: false } });
  expect(alpha.treatment.watermark.position).toBe('bottom-left');
  expect(body).not.toContain(path.basename(fixture.workspace));
  expect(body).not.toMatch(/"file":|"sha256":/);

  await call('PUT', '/api/watermark', { body: { settings: { ...WATERMARK_DEFAULTS, position: 'center', color: 'dark' } } });
  ({ json } = await call('GET', '/api/watermark/portfolio'));
  expect(json.preference.settings).toMatchObject({ position: 'center', color: 'dark' });
  expect(json.photographs.find(({ id }) => id === 'alpha').treatment.watermark.position).toBe('bottom-left');
  const saved = (await call('GET', '/api/editor/photos/alpha')).json.treatment.document;
  expect(parseEditDocument(JSON.stringify(saved)).photos[0].adjustments.watermark).toEqual(watermark);
});

test('an imported photograph is listed as missing a watermark; statuses come from disk and survive a restart', async () => {
  const workspace = await readWorkspace(fixture.workspace);
  const { record } = await ingestUpload(fixture.workspace, { filename: 'new-lake.jpg', bytes: await photograph({ color: { r: 20, g: 140, b: 90 } }) }, workspace.catalog);
  await saveCatalog(fixture.workspace, addDraft(workspace.catalog, { ...record, caption: 'New lake', alt: 'A lake' }), workspace.revision);
  const describe = await call('GET', '/api/editor/photos/alpha');
  const [source] = describe.json.sources;
  const text = serializeEditDocument(createEditDocument([{ name: source.name, size: source.size, lastModified: 0, sha256: source.sha256, format: 'jpeg', width: 2200, height: 1467, adjustments: { ...neutralAdjustments(), watermark: { ...WATERMARK_DEFAULTS } } }], {}));
  await call('PUT', '/api/editor/photos/alpha/treatment', { body: { document: text, revision: describe.json.treatment.revision } });
  const statuses = async () => {
    const { json } = await call('GET', '/api/watermark/portfolio');
    return { count: json.count, drafts: json.drafts, rows: json.photographs.map(({ id, published, source: from, treatment }) => [id, published, from?.kind, treatment.watermarkStatus]) };
  };
  const before = await statuses();
  expect(before.count).toBe(3);
  expect(before.drafts).toBe(1);
  expect(before.rows).toContainEqual([record.id, false, 'original', 'missing']);
  expect(before.rows).toContainEqual(['alpha', true, 'derivative', 'draft']);
  await cms.close();
  cms = await startCmsServer({ port: 0, repoDir: fixture.repo, workspace: fixture.workspace, offline: true, vite: false, sessions, log: () => {} });
  port = new URL(cms.url).port;
  expect(await statuses()).toEqual(before);
});

describe('bulk staging rules', () => {
  const source = { name: 'a.jpg', size: 3, lastModified: 0, sha256: 'a'.repeat(64), format: 'jpeg', width: 600, height: 400 };
  const doc = (adjustments, sha = source.sha256) => JSON.parse(serializeEditDocument(createEditDocument([{ ...source, sha256: sha, adjustments: { ...neutralAdjustments(), ...adjustments } }], {})));
  const mark = { ...WATERMARK_DEFAULTS };
  const fresh = (document) => ({ document, documentHash: 'h', render: { documentHash: 'h' } });

  test('no treatment, or a watermark-only draft: safe to stage; the same settings again change nothing', () => {
    expect(watermarkTreatmentState({ document: null, approved: null }, mark)).toMatchObject({ unapprovedEdits: false, upToDate: false });
    const staged = { ...fresh(doc({ watermark: mark })), status: 'draft', approved: null };
    expect(watermarkTreatmentState(staged, mark)).toMatchObject({ unapprovedEdits: false, upToDate: true });
    expect(watermarkTreatmentState(staged, { ...mark, position: 'top-left' }).upToDate).toBe(false);
    expect(watermarkTreatmentState({ ...staged, render: null }, mark).upToDate).toBe(false);
  });

  test('approved grading is kept and counts as approved; unapproved edits block staging', () => {
    const approvedDoc = doc({ exposure: 0.4, geometry: { angle: 2 } });
    const approved = { document: approvedDoc, approved: { document: approvedDoc }, status: 'approved' };
    expect(watermarkTreatmentState(approved, mark).unapprovedEdits).toBe(false);
    expect(watermarkTreatmentState({ ...approved, document: doc({ exposure: 0.4, geometry: { angle: 2 }, watermark: mark }), status: 'draft' }, mark).unapprovedEdits).toBe(false);
    expect(watermarkTreatmentState({ ...approved, document: doc({ exposure: 0.9, geometry: { angle: 2 } }), status: 'draft' }, mark).unapprovedEdits).toBe(true);
    expect(watermarkTreatmentState({ ...approved, document: doc({ exposure: 0.4, geometry: { angle: 2 } }, 'b'.repeat(64)), status: 'draft' }, mark).unapprovedEdits).toBe(true);
    expect(watermarkTreatmentState({ document: doc({ contrast: 10 }), approved: null, status: 'draft' }, mark).unapprovedEdits).toBe(true);
  });

  test('watermark status from the treatment: missing, draft, needs regeneration, needs review, approved', () => {
    const marked = doc({ watermark: mark });
    const edited = doc({ exposure: 0.5, watermark: mark });
    expect(watermarkStatus(null)).toBe('missing');
    expect(watermarkStatus({ document: doc({ exposure: 0.5 }), documentHash: 'e', render: null })).toBe('missing');
    expect(watermarkStatus({ document: marked, documentHash: 'h', render: null, status: 'draft' })).toBe('draft');
    // A treatment edit (exposure, crop, geometry, watermark settings) changes the document hash: the render is stale.
    expect(watermarkStatus({ document: edited, documentHash: 'h2', render: { documentHash: 'h' }, status: 'draft' })).toBe('needs-regeneration');
    expect(watermarkStatus({ document: marked, documentHash: 'h', render: { documentHash: 'h' }, status: 'draft', approved: null })).toBe('needs-review');
    const approved = { document: marked, documentHash: 'h', render: { documentHash: 'h' }, status: 'approved', approved: { document: marked, documentHash: 'h' } };
    expect(watermarkStatus(approved)).toBe('approved');
    // A newer draft over an approved version needs review; the approved one stays what publication uses.
    expect(watermarkStatus({ ...approved, document: edited, documentHash: 'h3', render: { documentHash: 'h3' }, status: 'draft' })).toBe('needs-review');
  });

  test('automatic drafts: missing photos get the policy (calmer corner when flagged), stale ones keep their own settings', () => {
    const policy = { ...WATERMARK_DEFAULTS, color: 'auto' };
    const own = { ...WATERMARK_DEFAULTS, position: 'top-left', color: 'dark', size: 0.09 };
    const photo = (id, watermarkStatus, extra = {}) => ({ id, source: { available: true, limited: false }, treatment: { watermarkStatus, watermark: null, hdr: false, ...extra.treatment }, ...extra.photo });
    const photos = [
      photo('new', 'missing'),
      photo('busy', 'missing'),
      photo('stale', 'needs-regeneration', { treatment: { watermark: own } }),
      photo('unrendered', 'draft', { treatment: { watermark: own } }),
      photo('waiting', 'needs-review', { treatment: { watermark: own } }),
      photo('done', 'approved', { treatment: { watermark: policy } }),
      photo('hdr', 'missing', { treatment: { hdr: true, hdrSources: { ready: false, missing: ['DSC09642.ARW'] } } }),
      photo('hdr-ready', 'needs-regeneration', { treatment: { hdr: true, hdrSources: { ready: true, missing: [] }, watermark: own } }),
      photo('public-only', 'missing', { photo: { source: { available: true, limited: true } } }),
      photo('no-source', 'missing', { photo: { source: null } }),
      photo('editing', 'missing'),
      photo('new', 'missing'),
    ];
    const plan = autoDraftPlan(photos, policy, { busy: { flags: ['busy'], suggestion: 'bottom-left' }, new: { flags: [] } }, new Set(['editing']));
    // A merged HDR is drafted once its three exposures are all attached (the editor merges them again).
    expect(plan.ids).toEqual(['new', 'busy', 'stale', 'unrendered', 'hdr-ready']);
    expect(plan.hdr).toEqual(['hdr-ready']);

    expect(plan.settings.new).toMatchObject({ position: 'bottom-right', color: 'auto', size: 0.11, opacity: 0.65, outline: true, enabled: true });
    expect(plan.settings.busy.position).toBe('bottom-left');
    expect(plan.settings.stale).toMatchObject({ position: 'top-left', color: 'dark', size: 0.09 });
    // Running it again over the result changes nothing: drafts awaiting review and approved photos are left alone.
    expect(autoDraftPlan(photos.map((entry) => ({ ...entry, treatment: { ...entry.treatment, watermarkStatus: plan.ids.includes(entry.id) ? 'needs-review' : entry.treatment.watermarkStatus } })), policy).ids).toEqual(['editing']);
  });

  test('publication coverage: only an approved, enabled watermark counts; drafts and unpublished photos do not', () => {
    const catalog = { photographs: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, status: id === 'e' ? 'draft' : 'published' })) };
    const marked = doc({ watermark: mark });
    const treatments = {
      a: { document: marked, approved: { document: marked }, status: 'approved' },
      b: { document: marked, approved: null, status: 'draft' },
      c: { document: marked, approved: { document: doc({ watermark: { ...mark, enabled: false } }) }, status: 'draft' },
      e: { document: marked, approved: null, status: 'draft' },
    };
    expect(unwatermarkedPhotographs(catalog, treatments)).toEqual(['b', 'c', 'd']);
    expect(unwatermarkedPhotographs(catalog, { ...treatments, b: treatments.a, c: treatments.a, d: treatments.a })).toEqual([]);
  });
});
