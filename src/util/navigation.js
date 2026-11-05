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

// ---------- history synchronisation ----------
// The app shows a requested location at once; the browser's history follows within a write
// budget. WebKit throws a SecurityError past 100 pushState/replaceState calls per 10 s (other
// engines have their own limits), which a held arrow key in the photo viewer reached. The budget (20 at once, then 4 per second, so at most 60 in
// any 10 s) keeps writes well below them: a burst coalesces into one trailing write of the latest
// location. A refused write is retried; Back/Forward made by the browser supersede pending work.
const BURST = 20;
const REFILL_PER_SECOND = 4;
const RETRY_MS = 1000;
const TRAVERSE_TIMEOUT_MS = 1000;

let shown = null; // { href, state } the app displays while the browser has not caught up
let pending = null; // { href, replace, state } owed to the browser
let traversing = null; // { href, timer } while a history.back() of ours is on its way
let tokens = BURST;
let refilledAt = 0;
let timer = null;
let reported = false;
let seen = typeof window === 'undefined' ? '' : window.location.href;

const absolute = (href) => new URL(href, window.location.href).href;
const sameLocation = (a, b) => {
  const [x, y] = [new URL(a, window.location.href), new URL(b, window.location.href)];
  const path = ({ pathname }) => pathname.replace(/\/+$/, '');
  return x.origin === y.origin && path(x) === path(y) && x.search === y.search && x.hash === y.hash;
};
const notify = () => window.dispatchEvent(new Event(locationChangeEvent));

function takeToken(urgent) {
  const now = Date.now();
  tokens = Math.min(BURST, tokens + ((now - refilledAt) / 1000) * REFILL_PER_SECOND);
  refilledAt = now;
  if (tokens < 1 && !urgent) return false;
  tokens -= 1;
  return true;
}

function schedule(delay) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    flush();
  }, delay);
}

// Visible in development, never in the user's way.
function report(error) {
  if (reported || !import.meta.env.DEV) return;
  reported = true;
  console.warn(`History write deferred: ${error?.name}: ${error?.message}`);
}

function flush({ urgent = false } = {}) {
  if (!pending || traversing) return;
  if (!takeToken(urgent)) {
    schedule(Math.ceil(((1 - tokens) / REFILL_PER_SECOND) * 1000));
    return;
  }
  const write = pending;
  try {
    window.history[write.replace ? 'replaceState' : 'pushState'](write.state, '', write.href);
  } catch (error) {
    tokens = Math.min(tokens, 0);
    if (error?.name === 'SecurityError') {
      report(error);
      schedule(RETRY_MS);
      return;
    }
    // Not a limit, so retrying cannot help: the app keeps the location and the error surfaces.
    pending = null;
    setTimeout(() => { throw error; });
    return;
  }
  pending = null;
  reported = false;
  seen = window.location.href;
  if (shown && write.href === shown.href) shown = null;
}

function cancelTimer() {
  clearTimeout(timer);
  timer = null;
}

/** The location the app shows: the last requested one while the browser has not caught up. */
export function currentLocation() {
  const { pathname, search, hash } = shown ? new URL(shown.href, window.location.href) : window.location;
  return { pathname, search, hash };
}

/** The state of the entry the app shows. */
export function currentState() {
  return shown ? shown.state : window.history.state;
}

/**
 * `replace` changes the current entry; `keepState` keeps its state; `returnable` marks a new
 * entry that `navigateBack` may leave with the browser's Back (so Forward returns to it).
 */
export function navigate(href, { replace = false, state, keepState = false, returnable = false } = {}) {
  let entryState = state ?? (keepState ? currentState() : null) ?? {};
  if (returnable) entryState = { ...entryState, returnTo: absolute(shown?.href ?? window.location.href) };
  // A push not yet written still owes the user its entry.
  pending = { href, replace: replace && (!pending || pending.replace), state: entryState };
  shown = { href, state: entryState };
  flush();
  notify();
}

/**
 * Shows `href` at once. When the current entry was pushed from it (`returnable`), the browser
 * goes Back, so Forward reopens what was left; otherwise the current entry is replaced.
 */
export function navigateBack(href) {
  if (pending && !pending.replace) {
    // The entry was never written, so the browser is still where it came from.
    pending = null;
    cancelTimer();
    if (!traversing && sameLocation(window.location.href, href)) {
      shown = null;
      notify();
      return;
    }
  }
  const { returnTo } = window.history.state ?? {};
  if (!traversing && returnTo && sameLocation(returnTo, href) && !sameLocation(window.location.href, href)) {
    settleBeforeBack();
    traversing = { href, timer: setTimeout(traverseTimedOut, TRAVERSE_TIMEOUT_MS) };
    shown = { href, state: {} };
    window.history.back();
    notify();
    return;
  }
  navigate(href, { replace: true });
}

// The current entry's latest step is written first, so Forward reopens the photograph left.
function settleBeforeBack() {
  if (pending?.replace) flush({ urgent: true });
  pending = null;
  cancelTimer();
}

function traverseTimedOut() {
  const { href } = traversing;
  traversing = null;
  if (sameLocation(window.location.href, href)) return;
  if (!pending) pending = { href, replace: true, state: {} };
  flush({ urgent: true });
}

function browserNavigated(event) {
  const href = window.location.href;
  if (traversing) {
    // Our own Back has arrived; anything requested since is newer, so it is written now.
    clearTimeout(traversing.timer);
    traversing = null;
    seen = href;
    if (pending) flush();
    else shown = null;
    notify();
    return;
  }
  // The hashchange that follows a popstate (or our own write) is not a new navigation.
  if (event.type === 'hashchange' && href === seen) return;
  seen = href;
  pending = null;
  shown = null;
  cancelTimer();
  notify();
}


/** Whether a Back of ours has not arrived yet; for tests. */
export const isTraversing = () => Boolean(traversing);

/** Forgets all pending work; for tests. */
export function resetHistorySync() {
  cancelTimer();
  if (traversing) clearTimeout(traversing.timer);
  shown = pending = traversing = null;
  tokens = BURST;
  refilledAt = Date.now();
  reported = false;
  seen = window.location.href;
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', browserNavigated);
  window.addEventListener('hashchange', browserNavigated);
  // A page being hidden (an app or tab switch) gets the latest location at once, so the entry
  // it leaves is right even while its timers are throttled.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush({ urgent: true });
  });
}
