export const locationChangeEvent = 'portfolio:locationchange';

const normalizedBasePath = () => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return base === '/' ? '' : base;
};

export function appHref(path = '/') {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBasePath()}${normalizedPath}` || '/';
}

export function photographyHref(slug) {
  return appHref(`/photography${slug ? `/${encodeURIComponent(slug)}` : ''}`);
}

export function getAppPathname(pathname = window.location.pathname) {
  const base = normalizedBasePath();
  if (base && pathname !== base && !pathname.startsWith(`${base}/`)) return null;
  const appPath = base ? pathname.slice(base.length) : pathname;
  return appPath.replace(/\/+$/, '') || '/';
}

export function navigate(href, { replace = false } = {}) {
  window.history[replace ? 'replaceState' : 'pushState']({}, '', href);
  window.dispatchEvent(new Event(locationChangeEvent));
}
