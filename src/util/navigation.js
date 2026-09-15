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

export function navigate(href, { replace = false } = {}) {
  window.history[replace ? 'replaceState' : 'pushState']({}, '', href);
  window.dispatchEvent(new Event(locationChangeEvent));
}
