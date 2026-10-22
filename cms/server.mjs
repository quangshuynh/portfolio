// Local photography CMS: `npm run cms`. Serves the admin dashboard at
// http://127.0.0.1:4317/admin/photography/ and a preview of the proposed public gallery at
// /photography/, both only to the person holding the sign-in link printed at start-up.
// See docs/photography-cms.md for the security model and setup.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCatalog, serializeCatalog } from '../scripts/photography-catalog.mjs';
import { projectRoot } from '../scripts/photography-catalog-files.mjs';
import { createApi, sendJson } from './lib/api.mjs';
import { createGit, parseGitHubRemote, redact } from './lib/git.mjs';
import { createGitHubClient, resolveGitHubToken } from './lib/github.mjs';
import { loadPreview } from './lib/preview.mjs';
import { resolveBase } from './lib/publish.mjs';
import {
  SESSION_COOKIE, allowedHosts, clearedSessionCookie, createSessions, guardRequest, readCookie, sessionCookie,
} from './lib/session.mjs';
import { cleanInterruptedUploads, initWorkspace, resolveWorkspaceDir } from './lib/workspace.mjs';

const ADMIN_PATH = '/admin/photography/';
// Files already public on quanghuynh.com that browsers fetch without cookies (the web app
// manifest is always requested without credentials). Everything else needs a session.
const PUBLIC_FILES = new Set(['/manifest.json', '/favicon.ico', '/logo192.png', '/logo512.png']);
const SECURITY_HEADERS = {
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

const escapeHtml = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function page(response, status, title, body) {
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  response.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;background:#101913;color:#ece7da">
<h1 style="font-size:1.4rem">${escapeHtml(title)}</h1>${body}</body>`);
}

const PREVIEW_BANNER = `<div role="status" style="position:fixed;z-index:2147483647;left:50%;bottom:16px;transform:translateX(-50%);
display:flex;gap:12px;align-items:center;padding:10px 16px;border-radius:999px;background:#e3b36e;color:#1b221e;
font:600 14px/1.2 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.4)">Preview · unpublished workspace changes, not the live site
<a href="${ADMIN_PATH}" style="color:inherit">Back to the CMS</a></div>`;

/**
 * Starts the CMS. Options mirror the command-line flags; `vite: false` serves the API only
 * (tests). Resolves to { url, signInUrl, close }.
 */
export async function startCmsServer({
  port = 4317, workspace, baseBranch = 'main', remote = 'origin', offline = false, vite: useVite = true,
  repoDir = projectRoot, github: githubOverride, githubSource: sourceOverride, sessions = createSessions(), log = console.log,
} = {}) {
  const git = createGit(repoDir);
  const workspaceDir = resolveWorkspaceDir(workspace, repoDir);
  const tip = await resolveBase(git, { remote, baseBranch, offline });
  if (await initWorkspace(workspaceDir, { baseRef: tip.ref, baseCommit: tip.commit, baseCatalog: parseCatalog(serializeCatalog(tip.catalog)) })) {
    log(`Created the CMS workspace at ${workspaceDir} from ${tip.ref} (${tip.commit.slice(0, 12)}).`);
  }
  for (const name of await cleanInterruptedUploads(workspaceDir)) log(`Removed an interrupted upload (${name}).`);

  let github = githubOverride ?? null;
  let githubSource = sourceOverride ?? 'none';
  if (githubOverride === undefined && !offline) {
    const target = parseGitHubRemote(await git(['remote', 'get-url', remote]));
    const { token, source } = await resolveGitHubToken();
    githubSource = source;
    if (token && target) github = createGitHubClient({ ...target, token });
  }

  let viteServer = null;
  const api = createApi({
    repoDir, workspaceDir, git, github, githubSource, remote, baseBranch, offline,
    onCatalogChanged: () => {
      const module = viteServer?.moduleGraph.getModuleById('\0virtual:photography-catalog');
      if (module) viteServer.moduleGraph.invalidateModule(module);
    },
  });

  if (useVite) {
    // No SEO plugin: production head tags are a build concern, and the preview app sets its
    // own title, as it does on the live site.
    const [{ createServer: createViteServer }, react, catalogPlugin] = await Promise.all([
      import('vite'), import('@vitejs/plugin-react'), import('../scripts/photography-catalog-plugin.mjs'),
    ]);
    viteServer = await createViteServer({
      root: repoDir,
      configFile: false,
      appType: 'custom',
      logLevel: 'warn',
      plugins: [react.default(), catalogPlugin.default({
        loadPreview: async () => (await loadPreview(workspaceDir)).collection,
      })],
      // No HMR socket: every request, including module requests, goes through the guard.
      server: { middlewareMode: true, hmr: false, fs: { strict: true, allow: [repoDir] } },
      optimizeDeps: { entries: ['index.html', 'cms/admin/index.html'] },
    });
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
    try {
      // Sign-in: exchange the printed token for a session cookie, then drop it from the URL.
      if (request.method === 'GET' && url.pathname === ADMIN_PATH && url.searchParams.has('token')) {
        const id = sessions.signIn(url.searchParams.get('token'));
        if (!id) return page(response, 401, 'Sign-in link not valid', '<p>Use the link printed by <code>npm run cms</code> in your terminal.</p>');
        response.writeHead(303, { Location: ADMIN_PATH, 'Set-Cookie': sessionCookie(id), 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
        return response.end();
      }
      if (viteServer && request.method === 'GET' && PUBLIC_FILES.has(url.pathname)
        && allowedHosts(server.address().port).has(String(request.headers.host ?? '').toLowerCase())) {
        return viteServer.middlewares(request, response, () => page(response, 404, 'Not found', ''));
      }
      const refusal = guardRequest(request, { port: server.address().port, sessions });
      if (refusal) {
        if (url.pathname.startsWith('/api/')) return sendJson(response, refusal.status, { error: { code: 'unauthorized', message: refusal.message } });
        return page(response, refusal.status, 'Photography CMS', `<p>${escapeHtml(refusal.message)}</p>`);
      }
      if (url.pathname === '/api/session/sign-out' && request.method === 'POST') {
        sessions.signOut(readCookie(request, SESSION_COOKIE));
        response.writeHead(204, { 'Set-Cookie': clearedSessionCookie() });
        return response.end();
      }
      if (url.pathname.startsWith('/api/')) return api(request, response, url);
      if (!viteServer) return page(response, 404, 'Not found', '');

      if (url.pathname === ADMIN_PATH || url.pathname === '/admin/photography') {
        const html = await readFile(path.join(repoDir, 'cms', 'admin', 'index.html'), 'utf8');
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
        return response.end(await viteServer.transformIndexHtml(ADMIN_PATH, html));
      }
      if (url.pathname === '/photography/' || url.pathname === '/photography') {
        const { errors } = await loadPreview(workspaceDir);
        if (errors.length) {
          return page(response, 422, 'Preview unavailable', `<p>The workspace cannot be published as it is, so there is nothing to preview:</p><ul>${errors.map((error) => `<li>${escapeHtml(error)}</li>`).join('')}</ul><p><a style="color:#a9c09b" href="${ADMIN_PATH}">Back to the CMS</a></p>`);
        }
        const html = (await readFile(path.join(repoDir, 'index.html'), 'utf8')).replace('</body>', `${PREVIEW_BANNER}</body>`);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
        return response.end(await viteServer.transformIndexHtml('/photography/', html));
      }
      return viteServer.middlewares(request, response, () => page(response, 404, 'Not found', ''));
    } catch (error) {
      log(redact(error.stack ?? error.message));
      if (!response.headersSent) page(response, 500, 'Something went wrong', '<p>See the terminal running the CMS.</p>');
      return undefined;
    }
  });

  // Loopback only: the CMS is never reachable from another machine.
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    url: `${origin}${ADMIN_PATH}`,
    signInUrl: `${origin}${ADMIN_PATH}?token=${sessions.token}`,
    workspaceDir,
    github: { available: Boolean(github) && !offline, source: githubSource },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await viteServer?.close();
    },
  };
}

function readFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--offline') flags.offline = true;
    else if (['--port', '--workspace', '--base', '--remote'].includes(arg)) flags[arg.slice(2)] = argv[++i];
    else throw new Error(`Unknown option ${arg}. Options: --port, --workspace, --base, --remote, --offline.`);
  }
  return flags;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const flags = readFlags(process.argv.slice(2));
    const cms = await startCmsServer({
      port: flags.port ? Number(flags.port) : 4317,
      workspace: flags.workspace ?? process.env.PHOTOGRAPHY_CMS_WORKSPACE,
      baseBranch: flags.base ?? 'main',
      remote: flags.remote ?? 'origin',
      offline: Boolean(flags.offline),
    });
    console.log([
      '',
      'Photography CMS (local only, 127.0.0.1)',
      `  Workspace: ${cms.workspaceDir}`,
      `  GitHub:    ${cms.github.available ? `pull requests via ${cms.github.source}` : 'unavailable (dry runs only)'}`,
      '',
      `  Sign in:   ${cms.signInUrl}`,
      '',
      'Keep this link private; it works until the CMS stops. Press Ctrl+C to stop.',
    ].join('\n'));
  } catch (error) {
    console.error(redact(error.message));
    process.exitCode = 1;
  }
}
