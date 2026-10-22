// Minimal TIFF walker: just enough to find where a RAW file keeps its sensor data,
// so tests can corrupt that data and prove the decoder reads it. Not a general parser.

const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8, 13: 4 };

export const TAGS = Object.freeze({
  width: 0x0100,
  height: 0x0101,
  bitsPerSample: 0x0102,
  compression: 0x0103,
  photometric: 0x0106,
  make: 0x010f,
  model: 0x0110,
  stripOffsets: 0x0111,
  stripByteCounts: 0x0117,
  subIfds: 0x014a,
});

// Photometric interpretation 32803 is a colour filter array: undemosaiced sensor data.
export const PHOTOMETRIC_CFA = 32803;

function reader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = String.fromCharCode(bytes[0], bytes[1]);
  if (order !== 'II' && order !== 'MM') throw new Error('Not a TIFF-based file.');
  const little = order === 'II';
  if (view.getUint16(2, little) !== 42) throw new Error('Not a TIFF-based file.');
  return {
    little,
    u16: (offset) => view.getUint16(offset, little),
    u32: (offset) => view.getUint32(offset, little),
    firstIfd: view.getUint32(4, little),
  };
}

function readValues(r, bytes, type, count, valueOffset) {
  const size = TYPE_SIZES[type] ?? 1;
  const start = size * count <= 4 ? valueOffset : r.u32(valueOffset);
  if (type === 2) return String.fromCharCode(...bytes.subarray(start, start + count)).replace(/\0+$/, '');
  const values = [];
  for (let i = 0; i < count; i += 1) {
    const at = start + i * size;
    values.push(size === 2 ? r.u16(at) : size === 4 ? r.u32(at) : bytes[at]);
  }
  return values;
}

function readIfd(r, bytes, offset) {
  const entries = new Map();
  const count = r.u16(offset);
  for (let i = 0; i < count; i += 1) {
    const at = offset + 2 + i * 12;
    entries.set(r.u16(at), readValues(r, bytes, r.u16(at + 2), r.u32(at + 4), at + 8));
  }
  return { entries, next: r.u32(offset + 2 + count * 12) };
}

/**
 * Lists every IFD reachable from IFD0 through the IFD chain and SubIFD pointers.
 * :param bytes: Uint8Array of the whole file
 * :returns: array of Map(tag -> values)
 */
export function listIfds(bytes) {
  const r = reader(bytes);
  const seen = new Set();
  const ifds = [];
  const queue = [r.firstIfd];
  while (queue.length) {
    const offset = queue.shift();
    if (!offset || seen.has(offset) || offset >= bytes.length) continue;
    seen.add(offset);
    const { entries, next } = readIfd(r, bytes, offset);
    ifds.push(entries);
    queue.push(next, ...(entries.get(TAGS.subIfds) ?? []));
  }
  return ifds;
}

/**
 * Finds the CFA (sensor mosaic) image stored as a single strip.
 * :returns: { width, height, bitsPerSample, compression, offset, byteCount, make, model }
 */
export function findCfaStrip(bytes) {
  const ifds = listIfds(bytes);
  const cfa = ifds.find((ifd) => ifd.get(TAGS.photometric)?.[0] === PHOTOMETRIC_CFA);
  if (!cfa) throw new Error('No colour filter array image found.');
  const offsets = cfa.get(TAGS.stripOffsets) ?? [];
  const counts = cfa.get(TAGS.stripByteCounts) ?? [];
  if (offsets.length !== 1 || counts.length !== 1) throw new Error('Expected the sensor data in one strip.');
  return {
    width: cfa.get(TAGS.width)[0],
    height: cfa.get(TAGS.height)[0],
    bitsPerSample: cfa.get(TAGS.bitsPerSample)?.[0] ?? null,
    compression: cfa.get(TAGS.compression)?.[0] ?? null,
    offset: offsets[0],
    byteCount: counts[0],
    make: ifds[0].get(TAGS.make) ?? null,
    model: ifds[0].get(TAGS.model) ?? null,
  };
}
