// Synthetic DNG files for tests: a real DNG structure (uncompressed 16-bit RGGB CFA,
// colour matrix, as-shot neutral, black and white levels, orientation, exposure
// tags) with known sensor values, so the genuine decoder can be checked numerically
// without committing photographs. Generated in memory; a 64×48 file is about 7 KB.

const TYPES = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5, SRATIONAL: 10 };
const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 10: 8 };

export const XYZ_TO_LINEAR_SRGB = [
  3.2404542, -1.5371385, -0.4985314,
  -0.9692660, 1.8760108, 0.0415560,
  0.0556434, -0.2040259, 1.0572252,
];

/**
 * :param options:
 *   width, height  sensor size (even numbers)
 *   scene(x, y)    -> [r, g, b] linear camera values before white balance, 0–1 = black–white
 *   neutral        AsShotNeutral (camera values of a white surface), green 1
 *   colorMatrix    ColorMatrix1, XYZ -> camera (defaults to a camera with sRGB primaries)
 *   orientation    TIFF orientation (1–8)
 *   black, white   sensor levels
 * :returns: Uint8Array of the DNG file
 */
export function createSyntheticDng({
  width = 64,
  height = 48,
  scene = () => [0.18, 0.18, 0.18],
  neutral = [0.5, 1, 0.8],
  colorMatrix = XYZ_TO_LINEAR_SRGB,
  orientation = 1,
  black = 512,
  white = 16383,
  make = 'Synthetic',
  model = 'Test DNG',
} = {}) {
  const pattern = [0, 1, 1, 2]; // RGGB
  const pixels = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const c = pattern[(y & 1) * 2 + (x & 1)];
      const value = scene(x, y)[c] * neutral[c];
      pixels[y * width + x] = Math.round(black + Math.min(1, Math.max(0, value)) * (white - black));
    }
  }
  const rational = (value, denominator = 1_000_000) => [Math.round(value * denominator), denominator];
  const entries = [
    [254, 'LONG', [0]],
    [256, 'LONG', [width]],
    [257, 'LONG', [height]],
    [258, 'SHORT', [16]],
    [259, 'SHORT', [1]],
    [262, 'SHORT', [32803]],
    [271, 'ASCII', make],
    [272, 'ASCII', model],
    [273, 'LONG', ['STRIP']],
    [274, 'SHORT', [orientation]],
    [277, 'SHORT', [1]],
    [278, 'LONG', [height]],
    [279, 'LONG', [pixels.byteLength]],
    [284, 'SHORT', [1]],
    [33421, 'SHORT', [2, 2]],
    [33422, 'BYTE', pattern],
    [33434, 'RATIONAL', [[1, 125]]],
    [33437, 'RATIONAL', [[56, 10]]],
    [34855, 'SHORT', [200]],
    [50706, 'BYTE', [1, 4, 0, 0]],
    [50708, 'ASCII', `${make} ${model}`],
    [50714, 'LONG', [black]],
    [50717, 'LONG', [white]],
    [50721, 'SRATIONAL', colorMatrix.map((value) => rational(value, 10000))],
    [50728, 'RATIONAL', neutral.map((value) => rational(value))],
    [50778, 'SHORT', [21]],
  ];
  const encoded = entries.map(([tag, typeName, values]) => {
    const type = TYPES[typeName];
    const list = typeName === 'ASCII' ? [...new TextEncoder().encode(values), 0] : values;
    const count = list.length;
    return { tag, type, list, count, bytes: count * SIZES[type] };
  });
  const ifdOffset = 8;
  const ifdSize = 2 + encoded.length * 12 + 4;
  let dataOffset = ifdOffset + ifdSize;
  encoded.forEach((entry) => {
    if (entry.bytes > 4) {
      entry.offset = dataOffset;
      dataOffset += entry.bytes + (entry.bytes % 2);
    }
  });
  const stripOffset = dataOffset;
  const buffer = new ArrayBuffer(stripOffset + pixels.byteLength);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set([0x49, 0x49]);
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, encoded.length, true);
  const write = (at, type, value) => {
    if (type === TYPES.BYTE || type === TYPES.ASCII) view.setUint8(at, value);
    else if (type === TYPES.SHORT) view.setUint16(at, value, true);
    else if (type === TYPES.LONG) view.setUint32(at, value === 'STRIP' ? stripOffset : value, true);
    else if (type === TYPES.RATIONAL) { view.setUint32(at, value[0], true); view.setUint32(at + 4, value[1], true); }
    else { view.setInt32(at, value[0], true); view.setInt32(at + 4, value[1], true); }
  };
  encoded.forEach((entry, index) => {
    const at = ifdOffset + 2 + index * 12;
    view.setUint16(at, entry.tag, true);
    view.setUint16(at + 2, entry.type, true);
    view.setUint32(at + 4, entry.count, true);
    if (entry.bytes > 4) view.setUint32(at + 8, entry.offset, true);
    const base = entry.bytes > 4 ? entry.offset : at + 8;
    entry.list.forEach((value, i) => write(base + i * SIZES[entry.type], entry.type, value));
  });
  view.setUint32(ifdOffset + 2 + encoded.length * 12, 0, true);
  bytes.set(new Uint8Array(pixels.buffer), stripOffset);
  return bytes;
}
