// @vitest-environment node
import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { crc32, createZip, dosDateTime, readStoredZip } from './zip';

const enc = new TextEncoder();

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(enc.encode('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('createZip', () => {
  const entries = [
    { path: 'app/app-hsmeta.json', data: '{"uid":"deal_desk","type":"app"}\n' },
    { path: 'app/cards/DealCard.tsx', data: 'const x = "Héllo ✓ 世界";\n' },
    { path: 'app/cards/empty.txt', data: '' },
    { path: 'app/functions/données.js', data: new Uint8Array([0, 1, 2, 255]) },
  ];

  it('produces an archive JSZip reads back byte for byte (UTF-8 names, empty and binary files)', async () => {
    const bytes = createZip(entries, { mtime: new Date('2026-03-04T05:06:08Z') });
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual(['app/app-hsmeta.json', 'app/cards/DealCard.tsx', 'app/cards/empty.txt', 'app/functions/données.js']);
    expect(await zip.file('app/cards/DealCard.tsx')!.async('string')).toBe('const x = "Héllo ✓ 世界";\n');
    expect(await zip.file('app/cards/empty.txt')!.async('string')).toBe('');
    expect([...(await zip.file('app/functions/données.js')!.async('uint8array'))]).toEqual([0, 1, 2, 255]);
    const file = zip.file('app/app-hsmeta.json')!;
    expect(file.dir).toBe(false);
    // DOS timestamps have 2-second resolution.
    expect(file.date.toISOString().slice(0, 16)).toBe('2026-03-04T05:06');
    // JSZip checks CRCs when asked to.
    await expect(JSZip.loadAsync(bytes, { checkCRC32: true })).resolves.toBeTruthy();
  });

  it('starts with a local header and ends with the end-of-central-directory record', () => {
    const bytes = createZip(entries);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const eocd = bytes.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 10, true)).toBe(entries.length);
  });

  it('writes an empty archive', async () => {
    const bytes = createZip([]);
    expect(bytes.length).toBe(22);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toEqual([]);
  });

  it('round-trips through readStoredZip and detects corruption', () => {
    const bytes = createZip(entries);
    const back = readStoredZip(bytes);
    expect(back.map((e) => e.path)).toEqual(entries.map((e) => e.path));
    expect(new TextDecoder().decode(back[1].data)).toBe('const x = "Héllo ✓ 世界";\n');
    const corrupt = bytes.slice();
    corrupt[30 + enc.encode(entries[0].path).length] ^= 0xff; // first data byte
    expect(() => readStoredZip(corrupt)).toThrow(/bad CRC/);
    expect(() => readStoredZip(new Uint8Array([1, 2, 3]))).toThrow(/not a zip/);
  });

  it('reads archives JSZip wrote when they are stored', async () => {
    const z = new JSZip();
    z.file('a/b.txt', 'hello');
    const bytes = await z.generateAsync({ type: 'uint8array', compression: 'STORE' });
    expect(readStoredZip(bytes).map((e) => [e.path, new TextDecoder().decode(e.data)])).toEqual([['a/b.txt', 'hello']]);
  });

  it('encodes DOS dates', () => {
    expect(dosDateTime(new Date('1980-01-01T00:00:00Z'))).toEqual({ time: 0, date: (1 << 5) | 1 });
    const { date } = dosDateTime(new Date('1970-01-01T00:00:00Z'));
    expect(date >> 9).toBe(0); // clamped to 1980
  });
});
