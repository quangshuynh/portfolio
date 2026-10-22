// Content identity for files: SHA-256 where crypto.subtle exists (secure contexts).
// Elsewhere (plain-http LAN testing) LUTs still need a stable id, so a non-
// cryptographic 256-bit FNV-1a variant stands in; it identifies, it does not protect.

const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

function fallbackHash(bytes) {
  const out = new Uint8Array(32);
  for (let lane = 0; lane < 8; lane += 1) {
    let h = (0x811c9dc5 ^ Math.imul(lane + 1, 0x9e3779b1)) >>> 0;
    for (let i = 0; i < bytes.length; i += 1) h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
    h = Math.imul(h ^ bytes.length, 0x01000193) >>> 0;
    out.set([h >>> 24, (h >>> 16) & 255, (h >>> 8) & 255, h & 255], lane * 4);
  }
  return hex(out);
}

/** 64 hex characters identifying these bytes. */
export async function contentHash(bytes) {
  if (globalThis.crypto?.subtle) return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  return fallbackHash(bytes);
}
