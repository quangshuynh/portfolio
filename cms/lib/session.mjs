// Access control for the local CMS server. The server listens on the loopback interface
// only, and every request must also pass these checks:
//
// - Host must be this server's loopback address, which defeats DNS rebinding (a public
//   site cannot point a hostname at 127.0.0.1 and read the responses).
// - A session cookie, obtained by opening the sign-in link printed in the terminal. The
//   link's token is random (256 bits) and compared in constant time. The cookie is
//   HttpOnly and SameSite=Strict, and sessions expire after a period without use.
// - State-changing requests must also carry `X-CMS-Request: 1` and, when the browser
//   sends one, a same-origin Origin. Cross-site pages cannot add that header without a
//   CORS preflight, which this server never approves.
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'photography_cms_session';
export const DEFAULT_IDLE_MS = 8 * 60 * 60 * 1000;

export function createSessions({ idleMs = DEFAULT_IDLE_MS, now = () => Date.now(), token = randomBytes(32).toString('base64url') } = {}) {
  const sessions = new Map();
  const expected = Buffer.from(token);
  return {
    token,
    /** Exchanges the sign-in token for a session id, or returns null. */
    signIn(candidate) {
      const given = Buffer.from(String(candidate ?? ''));
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
      const id = randomBytes(32).toString('base64url');
      sessions.set(id, now() + idleMs);
      return id;
    },
    /** True for a live session; each use extends it. */
    check(id) {
      const expires = id && sessions.get(id);
      if (!expires) return false;
      if (expires < now()) {
        sessions.delete(id);
        return false;
      }
      sessions.set(id, now() + idleMs);
      return true;
    },
    signOut(id) {
      sessions.delete(id);
    },
  };
}

export function readCookie(request, name) {
  for (const part of String(request.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

export const sessionCookie = (id) => `${SESSION_COOKIE}=${encodeURIComponent(id)}; HttpOnly; SameSite=Strict; Path=/`;
export const clearedSessionCookie = () => `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;

export function allowedHosts(port) {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
}

/**
 * :returns: null when the request may proceed, else { status, message }
 */
export function guardRequest(request, { port, sessions }) {
  if (!allowedHosts(port).has(String(request.headers.host ?? '').toLowerCase())) {
    return { status: 421, message: 'This CMS only answers on its loopback address.' };
  }
  if (!sessions.check(readCookie(request, SESSION_COOKIE))) {
    return { status: 401, message: 'Not signed in, or the session expired. Open the sign-in link printed by `npm run cms`.' };
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    if (request.headers['x-cms-request'] !== '1') return { status: 403, message: 'Missing X-CMS-Request header.' };
    const origin = request.headers.origin;
    if (origin && !allowedHosts(port).has(origin.replace(/^http:\/\//, '').toLowerCase())) {
      return { status: 403, message: 'Cross-origin requests are refused.' };
    }
    const site = request.headers['sec-fetch-site'];
    if (site && site !== 'same-origin') return { status: 403, message: 'Cross-site requests are refused.' };
  }
  return null;
}
