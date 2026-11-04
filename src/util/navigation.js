export const locationChangeEvent = 'portfolio:locationchange';

const normalizedBasePath = (basePath = import.meta.env.BASE_URL) => {
  const base = basePath.replace(/\/$/, '');
  return base === '/' ? '' : base;
};

export function appHref(path = '/', basePath = import.meta.env.BASE_URL) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBasePath(basePath)}${normalizedPath}` || '/';
}

export function photographyHref(slug, basePath = import.meta.env.BASE_URL) {
  const galleryHref = appHref('/photography/', basePath);
  return slug ? `${galleryHref}#${encodeURIComponent(slug)}` : galleryHref;
}

export function getAppPathname(pathname = window.location.pathname, basePath = import.meta.env.BASE_URL) {
  const base = normalizedBasePath(basePath);
  if (base && pathname !== base && !pathname.startsWith(`${base}/`)) return null;
  const appPath = base ? pathname.slice(base.length) : pathname;
  return appPath.replace(/\/+$/, '') || '/';
}

// WebKit refuses more than 100 history writes per 10 s (SecurityError); a held arrow key or
// fast swiping in the photo viewer reaches it. The app then follows the requested location
// without the history entry, and writes the latest one once the browser accepts it again.
const HISTORY_RETRY_MS = 1000;
let pending = null;
let retryTimer = null;

function writeHistory({ href, replace, state }) {
  window.history[replace ? 'replaceState' : 'pushState'](state, '', href);
}

function retryPendingHistory() {
  retryTimer = null;
  if (!pending) return;
  try {
    writeHistory(pending);
    pending = null;
  } catch {
    retryTimer = setTimeout(retryPendingHistory, HISTORY_RETRY_MS);
  }
}

/** The location the app shows: the last requested one while a history write is pending. */
export function currentLocation() {
  if (pending) {
    const { pathname, search, hash } = new URL(pending.href, window.location.href);
    return { pathname, search, hash };
  }
  const { pathname, search, hash } = window.location;
  return { pathname, search, hash };
}

/** Back, Forward or a hash change made by the browser supersedes a pending write. */
export function discardPendingNavigation() {
  pending = null;
  clearTimeout(retryTimer);
  retryTimer = null;
}

export function navigate(href, { replace = false, state = {} } = {}) {
  const request = { href, replace, state };
  if (pending) {
    // A refused push still owes the user its history entry.
    pending = { ...request, replace: replace && pending.replace };
  } else {
    try {
      writeHistory(request);
    } catch (error) {
      if (error?.name !== 'SecurityError') throw error;
      pending = request;
      retryTimer = setTimeout(retryPendingHistory, HISTORY_RETRY_MS);
    }
  }
  window.dispatchEvent(new Event(locationChangeEvent));
}
