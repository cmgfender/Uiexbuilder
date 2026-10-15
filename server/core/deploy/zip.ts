/**
 * Minimal store-only ZIP writer (no compression, no dependencies, Web APIs only).
 *
 * Produces a standard PKZIP archive: one local file header + data per entry, a central directory
 * and the end-of-central-directory record. Names are UTF-8 (general purpose flag bit 11). No ZIP64,
 * so archives are limited to 65 535 entries and 4 GiB — far above the deploy limits.
 */

export interface ZipEntry {
  /** POSIX path inside the archive, e.g. "app/cards/MyCard.tsx". */
  path: string;
  data: Uint8Array | string;
}

export interface ZipOptions {
  /** Modification time stamped on every entry (default: now). */
  mtime?: Date;
}

const encoder = new TextEncoder();

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}

/** CRC-32 (IEEE 802.3, the checksum ZIP uses). */
export function crc32(data: Uint8Array): number {
  const t = table();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = t[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time (UTC fields of the given date — servers have no meaningful local zone; 2-second resolution, 1980–2107). */
export function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time: time & 0xffff, date: day & 0xffff };
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIR = 0x06054b50;
/** Bit 11: file name is UTF-8. */
const FLAG_UTF8 = 0x0800;
const VERSION_NEEDED = 20;
/** Made by UNIX (3), spec version 2.0. */
const VERSION_MADE_BY = (3 << 8) | 20;
/** Regular file, rw-r--r--, in the high 16 bits (UNIX). */
const EXTERNAL_ATTRS = (0o100644 << 16) >>> 0;

/** Build a store-only ZIP archive. Entry paths must already be validated (see paths.ts). */
export function createZip(entries: ZipEntry[], options: ZipOptions = {}): Uint8Array<ArrayBuffer> {
  if (entries.length > 0xffff) throw new Error('Too many files for a ZIP archive');
  const { time, date } = dosDateTime(options.mtime ?? new Date());
  const prepared = entries.map((e) => {
    const name = encoder.encode(e.path);
    const data = typeof e.data === 'string' ? encoder.encode(e.data) : e.data;
    if (name.length > 0xffff) throw new Error(`File name too long: ${e.path.slice(0, 80)}`);
    return { name, data, crc: crc32(data) };
  });

  let localSize = 0;
  for (const p of prepared) localSize += 30 + p.name.length + p.data.length;
  let centralSize = 0;
  for (const p of prepared) centralSize += 46 + p.name.length;
  const total = localSize + centralSize + 22;
  if (total > 0xffffffff) throw new Error('ZIP archive too large');

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;
  const offsets: number[] = [];

  for (const p of prepared) {
    offsets.push(offset);
    view.setUint32(offset, LOCAL_HEADER, true);
    view.setUint16(offset + 4, VERSION_NEEDED, true);
    view.setUint16(offset + 6, FLAG_UTF8, true);
    view.setUint16(offset + 8, 0, true); // method: stored
    view.setUint16(offset + 10, time, true);
    view.setUint16(offset + 12, date, true);
    view.setUint32(offset + 14, p.crc, true);
    view.setUint32(offset + 18, p.data.length, true); // compressed size
    view.setUint32(offset + 22, p.data.length, true); // uncompressed size
    view.setUint16(offset + 26, p.name.length, true);
    view.setUint16(offset + 28, 0, true); // extra field length
    out.set(p.name, offset + 30);
    out.set(p.data, offset + 30 + p.name.length);
    offset += 30 + p.name.length + p.data.length;
  }

  const centralStart = offset;
  prepared.forEach((p, i) => {
    view.setUint32(offset, CENTRAL_HEADER, true);
    view.setUint16(offset + 4, VERSION_MADE_BY, true);
    view.setUint16(offset + 6, VERSION_NEEDED, true);
    view.setUint16(offset + 8, FLAG_UTF8, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, time, true);
    view.setUint16(offset + 14, date, true);
    view.setUint32(offset + 16, p.crc, true);
    view.setUint32(offset + 20, p.data.length, true);
    view.setUint32(offset + 24, p.data.length, true);
    view.setUint16(offset + 28, p.name.length, true);
    view.setUint16(offset + 30, 0, true); // extra
    view.setUint16(offset + 32, 0, true); // comment
    view.setUint16(offset + 34, 0, true); // disk number start
    view.setUint16(offset + 36, 0, true); // internal attributes
    view.setUint32(offset + 38, EXTERNAL_ATTRS, true);
    view.setUint32(offset + 42, offsets[i], true);
    out.set(p.name, offset + 46);
    offset += 46 + p.name.length;
  });

  view.setUint32(offset, END_OF_CENTRAL_DIR, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, prepared.length, true);
  view.setUint16(offset + 10, prepared.length, true);
  view.setUint32(offset + 12, centralSize, true);
  view.setUint32(offset + 16, centralStart, true);
  view.setUint16(offset + 20, 0, true); // comment length
  return out;
}

export interface ZipReadEntry {
  path: string;
  data: Uint8Array;
}

/**
 * Read a store-only archive written by createZip (used by the fake HubSpot to check uploads).
 * Walks the central directory; throws on anything malformed, compressed or with a bad CRC.
 * Directory entries are skipped.
 */
export function readStoredZip(bytes: Uint8Array): ZipReadEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw new Error('not a zip archive');
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL_DIR) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive (no end of central directory)');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const out: ZipReadEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_HEADER) throw new Error('bad central directory');
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const path = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    if (method !== 0) throw new Error(`entry ${path} is compressed`);
    if (view.getUint32(local, true) !== LOCAL_HEADER) throw new Error('bad local header');
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (crc32(data) !== crc) throw new Error(`bad CRC for ${path}`);
    if (!path.endsWith('/')) out.push({ path, data }); // skip directory entries
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
