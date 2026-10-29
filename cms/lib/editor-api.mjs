// CMS routes for the QuangEdit editor (/admin/photography/editor/). Behind the same
// guardRequest as every other route: loopback Host, session cookie, and X-CMS-Request plus
// same-origin checks on changes. Sources are served by index, never by path, and only for
// photographs in the workspace catalog; no response contains a filesystem path.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { derivativeFilenames } from '../../scripts/photography-utils.mjs';
import path from 'node:path';
import { DERIVATIVES_PATH, approvedImageChanges } from './treatment-publish.mjs';
import {
  TreatmentError, approveTreatment, attachSource, clearSources, discardTreatment, editingSources, publicSources,
  readTreatment, rejectTreatment, renderImage, renderIsFresh, saveTreatment, storeRender,
} from './treatments.mjs';
import { paths, readWorkspace } from './workspace.mjs';

const ROUTE = /^\/api\/editor\/photos\/([A-Za-z0-9_-]+)(?:\/(.*))?$/;
const IMAGE = /^images\/(current|approved)-(gallery|viewer|full)$/;
const CONTENT_TYPES = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const PRIVATE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" };

async function sendFile(response, file, type) {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) throw new TreatmentError('not-found', 'No such file.', 404);
  response.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, ...PRIVATE });
  await new Promise((resolve, reject) => {
    createReadStream(file).on('error', reject).pipe(response).on('finish', resolve).on('error', reject);
  });
}

const revisionParam = (url) => {
  const value = Number(url.searchParams.get('revision'));
  if (!Number.isInteger(value) || value < 0) throw new TreatmentError('bad-revision', 'A treatment revision is required.', 400);
  return value;
};

/**
 * :param options.readJsonBody: (request) => object, from api.mjs
 * :param options.exclusive: serialises mutations with the rest of the API
 * :returns: handler (request, response, url) => Promise<object | undefined> or null when the path is not an editor route
 */
export function createEditorRoutes({ repoDir, workspaceDir, libraryDir, git, exclusive, readJsonBody, sendJson }) {
  const derivativesDir = path.join(repoDir, DERIVATIVES_PATH);
  async function context(id) {
    const workspace = await readWorkspace(workspaceDir);
    const record = workspace.catalog.photographs.find((photo) => photo.id === id);
    if (!record) throw new TreatmentError('not-found', `No photograph "${id}" in the workspace.`, 404);
    const treatment = await readTreatment(workspaceDir, id);
    const sources = await editingSources({ workspaceDir, libraryDir, record, treatment, derivativesDir });
    return { workspace, record, treatment, sources };
  }

  async function describe(id) {
    const { workspace, record, treatment, sources } = await context(id);
    const needed = treatment.document ? treatment.document.photos[0].source : null;
    const known = new Set(sources.filter(({ available }) => available).map(({ sha256 }) => sha256));
    const staleSource = Boolean(needed && (needed.hdr ? needed.hdr.inputs.map(({ sha256 }) => sha256) : [needed.sha256]).some((hash) => !known.has(hash)));
    const live = treatment.approved && record.status === 'published' && workspace.base.photographs.some((photo) => photo.id === id && photo.status === 'published')
      ? !(await approvedImageChanges({ git, commit: workspace.meta.baseCommit, workspaceDir, ids: [id] }).catch(() => [null])).length
      : false;
    return {
      photo: { id: record.id, slug: record.slug, caption: record.caption, alt: record.alt, status: record.status, sourceFilename: record.sourceFilename },
      treatment,
      sources: publicSources(sources),
      staleSource,
      renderFresh: renderIsFresh(treatment),
      approvedLive: live,
    };
  }

  const json = (handler) => ({ json: handler });
  const routes = {
    'GET ': json((id) => describe(id)),
    'POST sources': json((id, request, url) => exclusive(async () => {
      await context(id);
      await attachSource(workspaceDir, id, { request, filename: url.searchParams.get('filename'), revision: revisionParam(url) });
      return describe(id);
    })),
    'POST sources/clear': json((id, request) => exclusive(async () => {
      const { revision } = await readJsonBody(request);
      await context(id);
      await clearSources(workspaceDir, id, revision);
      return describe(id);
    })),
    'PUT treatment': json((id, request) => exclusive(async () => {
      const { document, revision } = await readJsonBody(request);
      const { sources } = await context(id);
      await saveTreatment(workspaceDir, id, { text: typeof document === 'string' ? document : JSON.stringify(document), revision, sources });
      return describe(id);
    })),
    'PUT render': json((id, request, url) => exclusive(async () => {
      await context(id);
      await storeRender(workspaceDir, id, { request, name: url.searchParams.get('name'), documentHash: url.searchParams.get('documentHash'), revision: revisionParam(url) });
      return describe(id);
    })),
    ...Object.fromEntries([['approve', approveTreatment], ['reject', rejectTreatment], ['discard', discardTreatment]].map(([name, action]) => [`POST ${name}`, json((id, request) => exclusive(async () => {
      const { revision } = await readJsonBody(request);
      await context(id);
      await action(workspaceDir, id, revision);
      return describe(id);
    }))])),
  };

  return async function handleEditor(request, response, url) {
    const match = url.pathname.match(ROUTE);
    if (!match) return null;
    const [, id, rest = ''] = match;
    if (request.method === 'GET' && /^sources\/\d+$/.test(rest)) {
      const { sources } = await context(id);
      const source = sources[Number(rest.split('/')[1])];
      if (!source?.available) throw new TreatmentError('not-found', 'That source is not available.', 404);
      await sendFile(response, source.file, 'application/octet-stream');
      return undefined;
    }
    if (request.method === 'GET' && rest === 'images/original') {
      // The photograph as it is now: the repository's public image, or an upload's preview.
      await context(id);
      const { viewerFilename } = derivativeFilenames(id);
      for (const directory of [derivativesDir, paths(workspaceDir).previewDir]) {
        const file = path.join(directory, viewerFilename);
        if (await stat(file).then(() => true, () => false)) return sendFile(response, file, CONTENT_TYPES.jpeg);
      }
      throw new TreatmentError('not-found', 'No image yet.', 404);
    }
    const image = request.method === 'GET' && rest.match(IMAGE);
    if (image) {
      const { treatment } = await context(id);
      const render = image[1] === 'approved' ? treatment.approved?.render : treatment.render;
      const file = renderImage(workspaceDir, id, render, image[2]);
      if (!file) throw new TreatmentError('not-found', 'No render yet.', 404);
      return sendFile(response, file, CONTENT_TYPES.jpeg);
    }
    const route = routes[`${request.method} ${rest}`];
    if (!route) throw new TreatmentError('not-found', `No route ${request.method} ${url.pathname}.`, 404);
    sendJson(response, 200, await route.json(id, request, url));
    return undefined;
  };
}
