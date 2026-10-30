// JSON API of the local CMS server. Every route is behind guardRequest (session.mjs).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DERIVATIVES_DIRECTORY, readGeneratedManifest } from '../../scripts/photography-catalog-files.mjs';
import { serializeCatalog } from '../../scripts/photography-catalog.mjs';
import { addDraft, stableIdentityErrors, workspaceProblems } from './catalog-ops.mjs';
import { summarizeChanges } from './changes.mjs';
import { GitError, redact } from './git.mjs';
import { GitHubError } from './github.mjs';
import { createEditorRoutes } from './editor-api.mjs';
import { mergeCatalogs } from './merge.mjs';
import { PublishError, preparePublication, publicationStatus, resolveBase } from './publish.mjs';
import { DERIVATIVES_PATH, approvedImageChanges } from './treatment-publish.mjs';
import { TreatmentError, listTreatments, treatmentSummary } from './treatments.mjs';
import { MAX_UPLOAD_BYTES, UploadError, ingestUpload } from './uploads.mjs';
import { WatermarkError, portfolioOverview, readWatermarkPreference, saveWatermarkPreference } from './watermark.mjs';
import { unwatermarkedPhotographs } from './watermark-rules.mjs';
import { WorkspaceError, paths, readWorkspace, saveCatalog, setBase, writePublication } from './workspace.mjs';

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const IMAGE_NAME = /^[A-Za-z0-9_-]+-(gallery|viewer)\.jpg$/;

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'too-large', `Request bodies are limited to ${Math.round(limit / 1024 / 1024)} MB.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(request) {
  const text = (await readBody(request, MAX_JSON_BYTES)).toString('utf8');
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, 'bad-json', 'The request body is not valid JSON.');
  }
}

/** Shape checks for a submitted catalog; content rules come from the shared validator. */
function structuralErrors(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) return ['The catalog must be an object.'];
  const errors = [];
  if (catalog.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
  if (!Array.isArray(catalog.categories) || !catalog.categories.every((name) => typeof name === 'string')) errors.push('categories must be a list of names.');
  if (!Array.isArray(catalog.photographs)) return [...errors, 'photographs must be a list.'];
  catalog.photographs.forEach((record, index) => {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string' || typeof record.sourceFilename !== 'string') {
      errors.push(`photographs[${index}] must be an object with an id and a sourceFilename.`);
    }
  });
  const ids = catalog.photographs.map((record) => record?.id);
  if (new Set(ids).size !== ids.length) errors.push('Photograph ids must be unique.');
  return errors;
}

export function createApi({ repoDir, workspaceDir, libraryDir = null, git, github, githubSource, remote, baseBranch, offline, onCatalogChanged = () => {} }) {
  // One mutation at a time, so two quick saves cannot interleave.
  let queue = Promise.resolve();
  const exclusive = (action) => {
    const result = queue.then(action, action);
    queue = result.catch(() => {});
    return result;
  };

  async function state() {
    const workspace = await readWorkspace(workspaceDir);
    const submitted = workspace.publication?.submittedCatalog;
    const treatments = await listTreatments(workspaceDir);
    const publishedNow = workspace.catalog.photographs.filter(({ status }) => status === 'published').map(({ id }) => id);
    const images = await approvedImageChanges({ git, commit: workspace.meta.baseCommit, workspaceDir, ids: publishedNow }).catch(() => []);
    return {
      catalog: workspace.catalog,
      base: workspace.base,
      revision: workspace.revision,
      baseRef: workspace.meta.baseRef,
      baseCommit: workspace.meta.baseCommit,
      problems: workspaceProblems(workspace.catalog, { base: workspace.base }),
      summary: summarizeChanges(workspace.base, workspace.catalog),
      // Approved QuangEdit images that publication would replace (published photographs only).
      images: images.map(({ id }) => id),
      // Published photographs without an approved watermark (publication refuses them unless overridden).
      unwatermarked: unwatermarkedPhotographs(workspace.catalog, treatments),
      treatments: Object.fromEntries(Object.entries(treatments).map(([id, treatment]) => [id, treatmentSummary(treatment)])),
      publication: workspace.publication && { ...workspace.publication, submittedCatalog: undefined },
      submittedUnchanged: Boolean(submitted && submitted === serializeCatalog(workspace.catalog)),
      uploads: Object.keys(workspace.originals).length,
      previewIds: workspace.previewManifest.map(({ id }) => id),
      // Extracted EXIF and sizes, for display: repository records, then uploads.
      generated: Object.fromEntries([...(await readGeneratedManifest()), ...workspace.previewManifest].map((entry) => [entry.id, entry])),
      github: { available: Boolean(github) && !offline, source: githubSource, offline },
      workspaceDir,
    };
  }

  const routes = {
    'GET /api/workspace': () => state(),

    'PUT /api/catalog': (request) => exclusive(async () => {
      const { catalog, revision } = await readJsonBody(request);
      const shape = structuralErrors(catalog);
      if (shape.length) throw new HttpError(400, 'bad-catalog', 'The catalog is malformed.', { errors: shape });
      const { base } = await readWorkspace(workspaceDir);
      const identity = stableIdentityErrors(base, catalog);
      if (identity.length) throw new HttpError(422, 'identity', 'Published photographs keep their id, slug and source file.', { errors: identity });
      await saveCatalog(workspaceDir, catalog, revision);
      onCatalogChanged();
      return state();
    }),

    'POST /api/uploads': (request, url) => exclusive(async () => {
      const filename = url.searchParams.get('filename') ?? 'photograph.jpg';
      const declared = Number(request.headers['content-length']);
      if (declared > MAX_UPLOAD_BYTES) throw new UploadError('too-large', `Files are limited to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, 413);
      const bytes = await readBody(request, MAX_UPLOAD_BYTES);
      const workspace = await readWorkspace(workspaceDir);
      const result = await ingestUpload(workspaceDir, { filename, bytes }, workspace.catalog);
      if (result.duplicate) return { duplicate: true, id: result.id, ...(await state()) };
      const fresh = await readWorkspace(workspaceDir);
      await saveCatalog(workspaceDir, addDraft(fresh.catalog, result.record, { index: 0 }), fresh.revision);
      onCatalogChanged();
      return { duplicate: false, id: result.record.id, ...(await state()) };
    }),

    'POST /api/workspace/discard': (request) => exclusive(async () => {
      const { revision } = await readJsonBody(request);
      const workspace = await readWorkspace(workspaceDir);
      // Keeps uploaded originals and their drafts; resets everything public to the base.
      const drafts = workspace.catalog.photographs.filter(({ id, status }) => status === 'draft' && !workspace.base.photographs.some((record) => record.id === id));
      await saveCatalog(workspaceDir, { ...workspace.base, photographs: [...drafts, ...workspace.base.photographs] }, revision);
      onCatalogChanged();
      return state();
    }),

    'POST /api/workspace/rebase': () => exclusive(async () => {
      const workspace = await readWorkspace(workspaceDir);
      const tip = await resolveBase(git, { remote, baseBranch, offline });
      if (tip.commit === workspace.meta.baseCommit) return { ...(await state()), rebased: false };
      const { catalog, conflicts } = mergeCatalogs(workspace.base, workspace.catalog, tip.catalog);
      if (conflicts.length) throw new HttpError(409, 'conflict', `The public catalog on ${tip.ref} changed in ways that collide with the workspace.`, { conflicts });
      await saveCatalog(workspaceDir, catalog, workspace.revision);
      await setBase(workspaceDir, { baseCatalog: tip.catalog, baseCommit: tip.commit });
      onCatalogChanged();
      return { ...(await state()), rebased: true };
    }),

    'POST /api/publication/prepare': (request) => exclusive(async () => {
      const { dryRun, allowUnwatermarked } = await readJsonBody(request);
      if (!dryRun && (offline || !github)) {
        throw new HttpError(400, 'publishing-unavailable', offline
          ? 'The CMS was started with --offline, so it can only prepare a local branch (dry run).'
          : 'No GitHub token: set CMS_GITHUB_TOKEN or run `gh auth login`, then restart the CMS.');
      }
      const publication = await preparePublication({ git, workspaceDir, github, remote, baseBranch, offline, dryRun: Boolean(dryRun), allowUnwatermarked: allowUnwatermarked === true });
      onCatalogChanged();
      return { result: { ...publication, submittedCatalog: undefined }, ...(await state()) };
    }),

    'GET /api/publication/status': async () => {
      await publicationStatus({ github: offline ? null : github, workspaceDir });
      return state();
    },

    // The global watermark preference and the portfolio overview for bulk staging (cms/lib/watermark.mjs).
    'GET /api/watermark': () => readWatermarkPreference(workspaceDir),
    'PUT /api/watermark': (request) => exclusive(async () => {
      const { settings } = await readJsonBody(request);
      return saveWatermarkPreference(workspaceDir, settings);
    }),
    'GET /api/watermark/portfolio': () => portfolioOverview({ workspaceDir, libraryDir, derivativesDir: path.join(repoDir, DERIVATIVES_PATH), manifestFile: path.join(repoDir, 'src', 'data', 'photographs.generated.json') }),

    'POST /api/publication/forget': () => exclusive(async () => {
      const { publication } = await readWorkspace(workspaceDir);
      if (publication && ['pr-open', 'committed', 'pushed'].includes(publication.status)) {
        throw new HttpError(409, 'in-flight', 'A publication is still open or unfinished; merge or close its pull request first.');
      }
      await writePublication(workspaceDir, null);
      return state();
    }),
  };

  async function serveImage(response, name) {
    if (!IMAGE_NAME.test(name)) throw new HttpError(400, 'bad-name', 'Not a derivative name.');
    for (const directory of [DERIVATIVES_DIRECTORY, paths(workspaceDir).previewDir]) {
      const file = path.join(directory, name);
      if (path.dirname(file) !== directory) continue;
      try {
        const bytes = await readFile(file);
        response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
        response.end(bytes);
        return;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    throw new HttpError(404, 'not-found', 'No such image.');
  }

  const editorRoutes = createEditorRoutes({ repoDir, workspaceDir, libraryDir, git, exclusive, readJsonBody, sendJson });

  return async function handleApi(request, response, url) {
    try {
      if (url.pathname.startsWith('/api/editor/')) {
        const handled = await editorRoutes(request, response, url);
        if (handled !== null) {
          if (request.method !== 'GET') onCatalogChanged();
          return handled;
        }
      }
      if (request.method === 'GET' && url.pathname.startsWith('/api/images/')) {
        return await serveImage(response, decodeURIComponent(url.pathname.slice('/api/images/'.length)));
      }
      const route = routes[`${request.method} ${url.pathname}`];
      if (!route) throw new HttpError(404, 'not-found', `No route ${request.method} ${url.pathname}.`);
      return sendJson(response, 200, await route(request, url));
    } catch (error) {
      return sendError(response, error);
    }
  };
}

export function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
}

const STATUS_BY_CODE = {
  'stale-revision': 409, busy: 409, 'already-open': 409, conflict: 409, nothing: 409, invalid: 422, assets: 422,
  'draft-leak': 500, 'missing-original': 422, 'base-missing-catalog': 409, 'unexpected-changes': 500, 'render-missing': 422,
};

export function sendError(response, error) {
  // A failure while a file was streaming: the status line is gone, so end the response.
  if (response.headersSent) {
    console.error(redact(error.stack ?? error.message));
    response.destroy();
    return;
  }
  const known = error instanceof HttpError || error instanceof WorkspaceError || error instanceof PublishError
    || error instanceof UploadError || error instanceof GitHubError || error instanceof GitError || error instanceof TreatmentError || error instanceof WatermarkError;
  // GitHub failures are reported as 502 so the browser never mistakes them for its own
  // session expiring (401).
  const fromGitHub = error instanceof GitHubError;
  const status = fromGitHub ? 502 : error.status ?? STATUS_BY_CODE[error.code] ?? 500;
  if (!known) console.error(redact(error.stack ?? error.message));
  sendJson(response, status, {
    error: {
      code: fromGitHub ? `github-${error.code}` : error.code ?? (error instanceof GitError ? 'git' : 'internal'),
      message: known ? redact(error.message) : 'Unexpected server error; see the terminal running the CMS.',
      ...(error.details ? { details: error.details } : {}),
    },
  });
}
