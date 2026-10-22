// 3D LUTs from .cube files (Adobe/Resolve text format) and their tetrahedral
// interpolation. The parser only reads numbers and a small set of keywords; anything
// it does not understand is rejected with a message rather than reinterpreted.
//
// Colour assumptions: the LUT's input is the editor's sRGB-encoded (display) RGB after
// every other adjustment, scaled from DOMAIN_MIN..DOMAIN_MAX to the grid; its output
// is read as sRGB-encoded RGB and clamped to 0–1. LUTs built for other inputs (camera
// log curves, Rec.2020, linear) will not look as intended.

export const MIN_LUT_SIZE = 2;
export const MAX_LUT_SIZE = 65;
export const MAX_CUBE_BYTES = 16 * 1024 * 1024;

export class LutError extends Error {}

const parseNumbers = (parts, count, line) => {
  if (parts.length !== count) throw new LutError(`Line ${line}: expected ${count} numbers.`);
  return parts.map((part) => {
    const value = Number(part);
    if (!Number.isFinite(value) || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(part)) throw new LutError(`Line ${line}: "${part.slice(0, 20)}" is not a number.`);
    return value;
  });
};

/**
 * Parses a .cube file.
 * :param text: file contents
 * :returns: { title, size, domainMin: [3], domainMax: [3], data: Float32Array(size³ × 3) }
 *   with red changing fastest, then green, then blue (the .cube order)
 */
export function parseCube(text) {
  if (typeof text !== 'string' || !text.trim()) throw new LutError('The LUT file is empty.');
  if (text.length > MAX_CUBE_BYTES) throw new LutError(`The LUT file is larger than ${MAX_CUBE_BYTES / 1024 / 1024} MB.`);
  let title = '';
  let size = 0;
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];
  let data = null;
  let count = 0;
  const lines = text.split(/\r\n|\r|\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const hash = lines[index].indexOf('#');
    const line = (hash === -1 ? lines[index] : lines[index].slice(0, hash)).trim();
    if (!line) continue;
    if (/^[-+.\d]/.test(line)) {
      if (!size) throw new LutError(`Line ${lineNumber}: data before LUT_3D_SIZE. Only 3D LUTs are supported.`);
      if (count >= size ** 3) throw new LutError(`Line ${lineNumber}: more than ${size}³ = ${size ** 3} entries.`);
      const [r, g, b] = parseNumbers(line.split(/\s+/), 3, lineNumber);
      data[count * 3] = r;
      data[count * 3 + 1] = g;
      data[count * 3 + 2] = b;
      count += 1;
      continue;
    }
    if (data && count) throw new LutError(`Line ${lineNumber}: keywords must come before the data.`);
    const [keyword, ...rest] = line.split(/\s+/);
    switch (keyword) {
      case 'TITLE': {
        const match = line.match(/^TITLE\s+"([^"]*)"\s*$/);
        if (!match) throw new LutError(`Line ${lineNumber}: TITLE must be quoted.`);
        title = match[1].slice(0, 120);
        break;
      }
      case 'LUT_3D_SIZE': {
        if (size) throw new LutError(`Line ${lineNumber}: LUT_3D_SIZE appears twice.`);
        const [value] = parseNumbers(rest, 1, lineNumber);
        if (!Number.isInteger(value) || value < MIN_LUT_SIZE || value > MAX_LUT_SIZE) {
          throw new LutError(`LUT_3D_SIZE ${value} is not supported; use a size from ${MIN_LUT_SIZE} to ${MAX_LUT_SIZE} (17, 33 and 65 are common).`);
        }
        size = value;
        data = new Float32Array(size ** 3 * 3);
        break;
      }
      case 'DOMAIN_MIN':
        domainMin = parseNumbers(rest, 3, lineNumber);
        break;
      case 'DOMAIN_MAX':
        domainMax = parseNumbers(rest, 3, lineNumber);
        break;
      case 'LUT_3D_INPUT_RANGE': {
        const [min, max] = parseNumbers(rest, 2, lineNumber);
        domainMin = [min, min, min];
        domainMax = [max, max, max];
        break;
      }
      case 'LUT_1D_SIZE':
      case 'LUT_1D_INPUT_RANGE':
        throw new LutError('This is a 1D LUT. Only 3D LUTs (LUT_3D_SIZE) are supported; export it as a 3D .cube.');
      default:
        throw new LutError(`Line ${lineNumber}: unsupported keyword "${keyword.slice(0, 40)}". The editor reads TITLE, LUT_3D_SIZE, DOMAIN_MIN, DOMAIN_MAX and LUT_3D_INPUT_RANGE.`);
    }
  }
  if (!size) throw new LutError('No LUT_3D_SIZE line found; this is not a 3D .cube LUT.');
  if (count !== size ** 3) throw new LutError(`The LUT has ${count} of ${size ** 3} entries (${size}³); the file is incomplete.`);
  if (domainMin.some((min, c) => !(domainMax[c] > min))) throw new LutError('DOMAIN_MAX must be greater than DOMAIN_MIN for every channel.');
  return { title, size, domainMin, domainMax, data };
}

/** Identity LUT of a given size (tests, and a reference for "no change"). */
export function identityLut(size) {
  const data = new Float32Array(size ** 3 * 3);
  let i = 0;
  for (let b = 0; b < size; b += 1) for (let g = 0; g < size; g += 1) for (let r = 0; r < size; r += 1) {
    data[i] = r / (size - 1); data[i + 1] = g / (size - 1); data[i + 2] = b / (size - 1);
    i += 3;
  }
  return { title: 'Identity', size, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data };
}

/**
 * Tetrahedral interpolation of `rgb` (encoded 0–1, mutated) through the LUT: the grid
 * cube around the colour is split into six tetrahedra by the order of the fractional
 * coordinates, and the colour is a weighted sum of four corners. Exact for linear LUTs,
 * continuous across cells, and neutral on the grey axis for a neutral LUT.
 */
export function sampleLut(lut, rgb) {
  const { size, data, domainMin, domainMax } = lut;
  const n = size - 1;
  // Grid position per channel; locals rather than arrays, as this runs once per pixel.
  const pr = Math.min(1, Math.max(0, (rgb[0] - domainMin[0]) / (domainMax[0] - domainMin[0]))) * n;
  const pg = Math.min(1, Math.max(0, (rgb[1] - domainMin[1]) / (domainMax[1] - domainMin[1]))) * n;
  const pb = Math.min(1, Math.max(0, (rgb[2] - domainMin[2]) / (domainMax[2] - domainMin[2]))) * n;
  const ir = Math.min(n - 1, Math.floor(pr));
  const ig = Math.min(n - 1, Math.floor(pg));
  const ib = Math.min(n - 1, Math.floor(pb));
  const fr = pr - ir;
  const fg = pg - ig;
  const fb = pb - ib;
  const base = ((ib * size + ig) * size + ir) * 3;
  const dr = 3;
  const dg = size * 3;
  const db = size * size * 3;
  // Corner offsets and weights for the tetrahedron containing (fr, fg, fb).
  let o1; let o2; let w0; let w1; let w2; let w3;
  if (fr > fg) {
    if (fg > fb) { o1 = dr; o2 = dr + dg; w0 = 1 - fr; w1 = fr - fg; w2 = fg - fb; w3 = fb; }
    else if (fr > fb) { o1 = dr; o2 = dr + db; w0 = 1 - fr; w1 = fr - fb; w2 = fb - fg; w3 = fg; }
    else { o1 = db; o2 = dr + db; w0 = 1 - fb; w1 = fb - fr; w2 = fr - fg; w3 = fg; }
  } else if (fb > fg) { o1 = db; o2 = dg + db; w0 = 1 - fb; w1 = fb - fg; w2 = fg - fr; w3 = fr; }
  else if (fb > fr) { o1 = dg; o2 = dg + db; w0 = 1 - fg; w1 = fg - fb; w2 = fb - fr; w3 = fr; }
  else { o1 = dg; o2 = dr + dg; w0 = 1 - fg; w1 = fg - fr; w2 = fr - fb; w3 = fb; }
  const o3 = dr + dg + db;
  for (let c = 0; c < 3; c += 1) {
    const v = w0 * data[base + c] + w1 * data[base + o1 + c] + w2 * data[base + o2 + c] + w3 * data[base + o3 + c];
    rgb[c] = Math.min(1, Math.max(0, v));
  }
  return rgb;
}
