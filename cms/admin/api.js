// Browser client for the local CMS API. Every state-changing request carries the
// X-CMS-Request header the server requires; the session itself is an HttpOnly cookie.
export class ApiError extends Error {
  constructor(status, error) {
    super(error?.message ?? `Request failed (${status}).`);
    this.status = status;
    this.code = error?.code ?? 'error';
    this.details = error?.details;
  }
}

async function request(method, url, body) {
  let response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'X-CMS-Request': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { code: 'offline', message: 'The CMS server is not reachable. Is `npm run cms` still running?' });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, data?.error);
  return data;
}

export const api = {
  workspace: () => request('GET', '/api/workspace'),
  saveCatalog: (catalog, revision) => request('PUT', '/api/catalog', { catalog, revision }),
  discard: (revision) => request('POST', '/api/workspace/discard', { revision }),
  rebase: () => request('POST', '/api/workspace/rebase', {}),
  prepare: (dryRun) => request('POST', '/api/publication/prepare', { dryRun }),
  status: () => request('GET', '/api/publication/status'),
  forget: () => request('POST', '/api/publication/forget', {}),
  signOut: () => fetch('/api/session/sign-out', { method: 'POST', headers: { 'X-CMS-Request': '1' } }),
};

export const imageUrl = (id, size = 'gallery') => `/api/images/${encodeURIComponent(`${id}-${size}.jpg`)}`;

/** Uploads one file with progress; resolves to the server's response. */
export function uploadFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/uploads?filename=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('X-CMS-Request', '1');
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(event.loaded / event.total);
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data?.error));
    };
    xhr.onerror = () => reject(new ApiError(0, { code: 'offline', message: 'The upload was interrupted. Retry it.' }));
    xhr.send(file);
  });
}
