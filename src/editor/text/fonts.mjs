// Fonts for text overlays: the two OFL-1.1 families the site already ships (Schibsted
// Grotesk, variable 400–900 with italic; Martian Mono 400 and 700), loaded from this site's
// own hashed assets with the FontFace API under editor-only family names. No font service,
// no network request beyond these same-origin files (CSP font-src 'self'). Characters outside
// their subsets (Latin, Latin Extended; Cyrillic for Martian Mono) fall back to a system font;
// the Text panel says which.

import sansLatin from '@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2?url';
import sansLatinExt from '@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-ext-wght-normal.woff2?url';
import sansItalicLatin from '@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-italic.woff2?url';
import sansItalicLatinExt from '@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-ext-wght-italic.woff2?url';
import mono400Latin from '@fontsource/martian-mono/files/martian-mono-latin-400-normal.woff2?url';
import mono400LatinExt from '@fontsource/martian-mono/files/martian-mono-latin-ext-400-normal.woff2?url';
import mono400Cyrillic from '@fontsource/martian-mono/files/martian-mono-cyrillic-400-normal.woff2?url';
import mono400CyrillicExt from '@fontsource/martian-mono/files/martian-mono-cyrillic-ext-400-normal.woff2?url';
import mono700Latin from '@fontsource/martian-mono/files/martian-mono-latin-700-normal.woff2?url';
import mono700LatinExt from '@fontsource/martian-mono/files/martian-mono-latin-ext-700-normal.woff2?url';
import mono700Cyrillic from '@fontsource/martian-mono/files/martian-mono-cyrillic-700-normal.woff2?url';
import mono700CyrillicExt from '@fontsource/martian-mono/files/martian-mono-cyrillic-ext-700-normal.woff2?url';
import { fontOf } from '../model/overlays.mjs';

// Unicode ranges of the subsets, as Fontsource publishes them.
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const CYRILLIC = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';
const CYRILLIC_EXT = 'U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F';

const FAMILIES = { sans: 'PE Schibsted Grotesk', mono: 'PE Martian Mono' };

const FACES = [
  ...[[sansLatin, LATIN], [sansLatinExt, LATIN_EXT]].map(([url, range]) => ({ font: 'sans', url, range, weight: '400 900', style: 'normal' })),
  ...[[sansItalicLatin, LATIN], [sansItalicLatinExt, LATIN_EXT]].map(([url, range]) => ({ font: 'sans', url, range, weight: '400 900', style: 'italic' })),
  ...[[mono400Latin, LATIN], [mono400LatinExt, LATIN_EXT], [mono400Cyrillic, CYRILLIC], [mono400CyrillicExt, CYRILLIC_EXT]].map(([url, range]) => ({ font: 'mono', url, range, weight: '400', style: 'normal' })),
  ...[[mono700Latin, LATIN], [mono700LatinExt, LATIN_EXT], [mono700Cyrillic, CYRILLIC], [mono700CyrillicExt, CYRILLIC_EXT]].map(([url, range]) => ({ font: 'mono', url, range, weight: '700', style: 'normal' })),
];

/** CSS font-family list for an overlay's font: the bundled face, then the generic family. */
export const fontFamily = (overlay) => `"${FAMILIES[fontOf(overlay).id]}", ${fontOf(overlay).generic}`;

/** Canvas font shorthand for an overlay at `px` pixels. */
export const fontString = (overlay, px) => `${overlay.italic ? 'italic ' : ''}${overlay.weight} ${px}px ${fontFamily(overlay)}`;

const parseRanges = (text) => text.split(',').map((part) => {
  const [from, to = from] = part.replace('U+', '').split('-');
  return [Number.parseInt(from, 16), Number.parseInt(to, 16)];
});
const COVERAGE = {
  sans: parseRanges(`${LATIN},${LATIN_EXT}`),
  mono: parseRanges(`${LATIN},${LATIN_EXT},${CYRILLIC},${CYRILLIC_EXT}`),
};

/** Characters of `text` that the overlay's bundled font does not contain (shown with a system font). */
export function uncoveredCharacters(overlay) {
  const ranges = COVERAGE[fontOf(overlay).id];
  const missing = new Set();
  for (const char of overlay.text) {
    const code = char.codePointAt(0);
    if (char === '\n' || ranges.some(([from, to]) => code >= from && code <= to)) continue;
    missing.add(char);
  }
  return [...missing];
}

let loading = null;

/**
 * Loads every bundled face once (about 300 kB, from this site). Text is drawn only after
 * this resolves, so previews and exports never use a substitute for a bundled font.
 */
export function loadTextFonts(fontSet = globalThis.document?.fonts) {
  if (!fontSet || typeof FontFace !== 'function') return Promise.resolve(false);
  loading ??= Promise.all(FACES.map(async (face) => {
    const fontFace = new FontFace(FAMILIES[face.font], `url(${face.url}) format('woff2')`, { weight: face.weight, style: face.style, unicodeRange: face.range });
    fontSet.add(fontFace);
    await fontFace.load();
  })).then(() => true).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}
