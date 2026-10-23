// Independent ZIP reader for tests and browser checks (Node only): walks the central
// directory, checks each local header against it and the CRC-32 of every stored entry.
// Throws on any inconsistency. Supports stored entries and ZIP64 sizes and offsets.

import { crc32 } from 'node:zlib';

/** :returns: [{ name, size, crc, data (Buffer), modified (Date) }] */
export function readZip(buffer) {
  const zip = Buffer.from(buffer);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i -= 1) if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('No end of central directory record.');
  let count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const locator = eocd - 20;
  if (locator >= 0 && zip.readUInt32LE(locator) === 0x07064b50) {
    const record = Number(zip.readBigUInt64LE(locator + 8));
    if (zip.readUInt32LE(record) !== 0x06064b50) throw new Error('Bad ZIP64 end record.');
    count = Number(zip.readBigUInt64LE(record + 32));
    offset = Number(zip.readBigUInt64LE(record + 48));
  }
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error(`Bad central directory entry ${i}.`);
    const method = zip.readUInt16LE(offset + 10);
    const time = zip.readUInt16LE(offset + 12);
    const date = zip.readUInt16LE(offset + 14);
    const crc = zip.readUInt32LE(offset + 16);
    let size = zip.readUInt32LE(offset + 20);
    let local = zip.readUInt32LE(offset + 42);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    // ZIP64 extra field: the 64-bit values appear in order for each field set to 0xFFFFFFFF.
    for (let e = offset + 46 + nameLength; e < offset + 46 + nameLength + extraLength;) {
      const id = zip.readUInt16LE(e);
      const length = zip.readUInt16LE(e + 2);
      if (id === 1) {
        let field = e + 4;
        if (zip.readUInt32LE(offset + 24) === 0xffffffff) field += 8;
        if (size === 0xffffffff) { size = Number(zip.readBigUInt64LE(field)); field += 8; }
        if (local === 0xffffffff) local = Number(zip.readBigUInt64LE(field));
      }
      e += 4 + length;
    }
    if (method !== 0) throw new Error(`${name}: compression method ${method}, expected stored.`);
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`${name}: bad local header.`);
    const localName = zip.toString('utf8', local + 30, local + 30 + zip.readUInt16LE(local + 26));
    if (localName !== name) throw new Error(`${name}: local header names ${localName}.`);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    if (data.length !== size) throw new Error(`${name}: truncated.`);
    if (crc32(data) >>> 0 !== crc) throw new Error(`${name}: CRC mismatch.`);
    const modified = new Date(1980 + (date >> 9), ((date >> 5) & 15) - 1, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2);
    entries.push({ name, size, crc, data, modified });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
