// Deterministic LUTs for tests and the GPU parity harness (not a build input).
import { identityLut } from '../pipeline/lut.mjs';

/** A smooth non-linear "look": warm highlights, cool shadows, a little contrast. */
export function lookLut(size = 17) {
  const lut = identityLut(size);
  for (let i = 0; i < lut.data.length; i += 3) {
    const [r, g, b] = lut.data.subarray(i, i + 3);
    const y = 0.3 * r + 0.6 * g + 0.1 * b;
    const s = (v) => v * v * (3 - 2 * v);
    lut.data[i] = Math.min(1, s(r) * 0.9 + 0.08 * y);
    lut.data[i + 1] = s(g) * 0.95 + 0.02;
    lut.data[i + 2] = Math.min(1, s(b) * 0.85 + 0.1 * (1 - y));
  }
  return lut;
}

/** The look as .cube text, for import tests. */
export function lookCube(size = 17, title = 'Test look') {
  const { data } = lookLut(size);
  const rows = [];
  for (let i = 0; i < data.length; i += 3) rows.push(`${data[i].toFixed(6)} ${data[i + 1].toFixed(6)} ${data[i + 2].toFixed(6)}`);
  return `TITLE "${title}"\nLUT_3D_SIZE ${size}\n${rows.join('\n')}\n`;
}
