// @vitest-environment node
// The CMS server's security boundary and API, over real HTTP on the loopback interface.
import { request as httpRequest } from 'node:http';
import { photograph, fixtureRepo } from './test-helpers.mjs';
import { createSessions } from './lib/session.mjs';
import { startCmsServer } from './server.mjs';

let fixture;
let cms;
let sessions;
let now;
let port;

function call(method, path, { headers = {}, body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      method,
      path,
      headers: {
        Host: `127.0.0.1:${port}`,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(payload ? { 'Content-Length': payload.length } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* HTML or binary */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function signIn() {
  const response = await call('GET', `/admin/photography/?token=${sessions.token}`);
  expect(response.status).toBe(303);
  return response.headers['set-cookie'][0].split(';')[0];
}
const mutate = (cookie) => ({ cookie, headers: { 'X-CMS-Request': '1', Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/json' } });

beforeEach(async () => {
  fixture = await fixtureRepo();
  now = Date.now();
  sessions = createSessions({ idleMs: 60_000, now: () => now });
  cms = await startCmsServer({
    port: 0, repoDir: fixture.repo, workspace: fixture.workspace, offline: true, vite: false, sessions, log: () => {},
  });
  port = new URL(cms.url).port;
}, 60_000);
afterEach(async () => {
  await cms.close();
  fixture.cleanup();
});

describe('authentication and authorization', () => {
  test('listens on the loopback interface only', () => {
    expect(new URL(cms.url).hostname).toBe('127.0.0.1');
  });

  test('every route refuses requests without a session', async () => {
    for (const [method, path] of [['GET', '/api/workspace'], ['PUT', '/api/catalog'], ['POST', '/api/uploads'], ['POST', '/api/publication/prepare'], ['GET', '/api/images/alpha-gallery.jpg'], ['GET', '/admin/photography/'], ['GET', '/photography/'],
      ['GET', '/package.json'], ['GET', '/src/data/photography.catalog.json'], ['GET', '/cms/server.mjs']]) {
      const response = await call(method, path, { headers: { 'X-CMS-Request': '1' } });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  test('a wrong sign-in token is refused and does not create a session', async () => {
    const response = await call('GET', `/admin/photography/?token=${'x'.repeat(sessions.token.length)}`);
    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  test('the session cookie is HttpOnly and SameSite=Strict, and expires after inactivity', async () => {
    const response = await call('GET', `/admin/photography/?token=${sessions.token}`);
    expect(response.headers['set-cookie'][0]).toMatch(/HttpOnly; SameSite=Strict; Path=\//);
    expect(response.headers.location).toBe('/admin/photography/');
    const cookie = response.headers['set-cookie'][0].split(';')[0];
    expect((await call('GET', '/api/workspace', { cookie })).status).toBe(200);
    now += 61_000;
    const expired = await call('GET', '/api/workspace', { cookie });
    expect(expired.status).toBe(401);
    expect(expired.json.error.code).toBe('unauthorized');
  });

  test('refuses foreign Host headers (DNS rebinding) even with a valid session', async () => {
    const cookie = await signIn();
    const response = await call('GET', '/api/workspace', { cookie, headers: { Host: `evil.example:${port}` } });
    expect(response.status).toBe(421);
  });

  test('state-changing requests need the CSRF header and a same-origin Origin', async () => {
    const cookie = await signIn();
    const { json } = await call('GET', '/api/workspace', { cookie });
    const body = { catalog: json.catalog, revision: json.revision };
    expect((await call('PUT', '/api/catalog', { cookie, body })).status).toBe(403);
    expect((await call('PUT', '/api/catalog', { cookie, body, headers: { 'X-CMS-Request': '1', Origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call('PUT', '/api/catalog', { cookie, body, headers: { 'X-CMS-Request': '1', 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    expect((await call('PUT', '/api/catalog', { ...mutate(cookie), body })).status).toBe(200);
  });

  test('responses never contain the sign-in token or a GitHub credential', async () => {
    const cookie = await signIn();
    const { text } = await call('GET', '/api/workspace', { cookie });
    expect(text).not.toContain(sessions.token);
    expect(text).not.toMatch(/gh[pousr]_|github_pat_|Bearer/);
  });

  test('signing out ends the session', async () => {
    const cookie = await signIn();
    expect((await call('POST', '/api/session/sign-out', mutate(cookie))).status).toBe(204);
    expect((await call('GET', '/api/workspace', { cookie })).status).toBe(401);
  });
});

describe('catalog API', () => {
  test('saves edits with optimistic concurrency and keeps them across reloads', async () => {
    const cookie = await signIn();
    const first = (await call('GET', '/api/workspace', { cookie })).json;
    const reordered = { ...first.catalog, photographs: [...first.catalog.photographs].reverse() };
    const saved = await call('PUT', '/api/catalog', { ...mutate(cookie), body: { catalog: reordered, revision: first.revision } });
    expect(saved.status).toBe(200);
    expect(saved.json.summary.moved.length).toBeGreaterThan(0);
    const stale = await call('PUT', '/api/catalog', { ...mutate(cookie), body: { catalog: first.catalog, revision: first.revision } });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('stale-revision');
    const again = (await call('GET', '/api/workspace', { cookie })).json;
    expect(again.catalog.photographs.map(({ id }) => id)).toEqual(['gamma', 'beta', 'alpha']);
  });

  test('rejects malformed catalogs and edits that break published URLs', async () => {
    const cookie = await signIn();
    const { json } = await call('GET', '/api/workspace', { cookie });
    const bad = await call('PUT', '/api/catalog', { ...mutate(cookie), body: { catalog: { schemaVersion: 1, photographs: 'nope' }, revision: json.revision } });
    expect(bad.status).toBe(400);
    const notJson = await call('PUT', '/api/catalog', { ...mutate(cookie), body: Buffer.from('{not json') });
    expect(notJson.status).toBe(400);
    const renamed = { ...json.catalog, photographs: json.catalog.photographs.map((r) => (r.id === 'alpha' ? { ...r, slug: 'moved' } : r)) };
    const identity = await call('PUT', '/api/catalog', { ...mutate(cookie), body: { catalog: renamed, revision: json.revision } });
    expect(identity.status).toBe(422);
    expect(identity.json.error.details.errors).toEqual(['"alpha" is published, so its slug cannot change (was "alpha").']);
  });

  test('invalid public edits are saved as work in progress but reported as problems', async () => {
    const cookie = await signIn();
    const { json } = await call('GET', '/api/workspace', { cookie });
    const blank = { ...json.catalog, photographs: json.catalog.photographs.map((r) => (r.id === 'beta' ? { ...r, alt: '' } : r)) };
    const saved = await call('PUT', '/api/catalog', { ...mutate(cookie), body: { catalog: blank, revision: json.revision } });
    expect(saved.status).toBe(200);
    expect(saved.json.problems.publication).toEqual(['photographs[1] ("beta"): "alt" must be non-empty text without surrounding spaces.']);
  });
});

describe('uploads and images', () => {
  test('uploads become drafts at the top; duplicates and fakes are reported', async () => {
    const cookie = await signIn();
    const bytes = await photograph();
    const uploadHeaders = { ...mutate(cookie).headers, 'Content-Type': 'application/octet-stream' };
    const first = await call('POST', '/api/uploads?filename=DSC00001.JPG', { cookie, headers: uploadHeaders, body: bytes });
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ duplicate: false, id: 'DSC00001' });
    expect(first.json.catalog.photographs[0]).toMatchObject({ id: 'DSC00001', status: 'draft' });
    expect(first.json.summary.count).toBe(0);
    const again = await call('POST', '/api/uploads?filename=other.jpg', { cookie, headers: uploadHeaders, body: bytes });
    expect(again.json).toMatchObject({ duplicate: true, id: 'DSC00001' });
    const fake = await call('POST', '/api/uploads?filename=evil.jpg', { cookie, headers: uploadHeaders, body: Buffer.from('<script>alert(1)</script>') });
    expect(fake.status).toBe(415);
    const image = await call('GET', '/api/images/DSC00001-gallery.jpg', { cookie });
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(image.headers['cache-control']).toBe('private, no-store');
  }, 60_000);

  test('image names cannot escape the derivative folders', async () => {
    const cookie = await signIn();
    for (const name of ['..%2F..%2Fpackage.json', '..%5C..%5Cpackage.json', 'alpha-gallery.jpg%00.txt', 'catalog.json', '%2E%2E%2Fworkspace.json']) {
      const response = await call('GET', `/api/images/${name}`, { cookie });
      expect(response.status, name).toBe(400);
    }
    expect((await call('GET', '/api/images/missing-gallery.jpg', { cookie })).status).toBe(404);
  });
});

describe('publication API', () => {
  test('offline servers can only dry-run, and GitHub errors are not reported as a lost session', async () => {
    const cookie = await signIn();
    const { json } = await call('GET', '/api/workspace', { cookie });
    expect(json.github).toMatchObject({ available: false, offline: true });
    const reordered = { ...json.catalog, photographs: [...json.catalog.photographs].reverse() };
    await call('PUT', '/api/catalog', { ...mutate(cookie), body: { catalog: reordered, revision: json.revision } });
    const refused = await call('POST', '/api/publication/prepare', { ...mutate(cookie), body: { dryRun: false } });
    expect(refused.status).toBe(400);
    expect(refused.json.error.code).toBe('publishing-unavailable');
    const dry = await call('POST', '/api/publication/prepare', { ...mutate(cookie), body: { dryRun: true, allowUnwatermarked: true } });
    expect(dry.status).toBe(200);
    expect(dry.json.result).toMatchObject({ status: 'dry-run' });
    expect(dry.json.result).not.toHaveProperty('submittedCatalog');
  }, 120_000);
});
