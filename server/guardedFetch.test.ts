// @vitest-environment node
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGuardedFetch, type DnsLookupAll } from './guardedFetch';
import { BlockedAddressError } from './core/ssrf';

let server: Server;
let port = 0;
const hits: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url} host=${req.headers.host}`);
    if (req.url === '/slow') return; // never answers
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Test', 'yes');
      res.end(JSON.stringify({ ok: true, method: req.method, body }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** A DNS that answers every name with the given addresses. */
const dns =
  (...addresses: string[]): DnsLookupAll =>
  (_host, cb) =>
    cb(null, addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));

const init = (extra: Partial<Parameters<ReturnType<typeof createGuardedFetch>>[1]> = {}) => ({ method: 'GET', headers: {}, allowLoopback: false, ...extra });

describe('guarded fetch (Node fetch proxy)', () => {
  it('refuses a public-looking name that resolves to a private address, without connecting', async () => {
    const f = createGuardedFetch({ lookupAll: dns('127.0.0.1') });
    const before = hits.length;
    await expect(f(`http://127.0.0.1.nip.io:${port}/admin`, init())).rejects.toBeInstanceOf(BlockedAddressError);
    expect(hits.length).toBe(before);
  });

  it('refuses when ANY resolved address is private (DNS rebinding / mixed answers)', async () => {
    const f = createGuardedFetch({ lookupAll: dns('93.184.216.34', '10.0.0.5') });
    await expect(f('https://rebind.example/', init())).rejects.toBeInstanceOf(BlockedAddressError);
    const v6 = createGuardedFetch({ lookupAll: dns('64:ff9b:1::a00:1') });
    await expect(v6('https://nat64.example/', init())).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it('refuses private IP literals before connecting', async () => {
    const f = createGuardedFetch({ lookupAll: dns('8.8.8.8') });
    await expect(f(`http://127.0.0.1:${port}/`, init())).rejects.toBeInstanceOf(BlockedAddressError);
    await expect(f('https://[fd00::1]/', init())).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it('connects to exactly the address it checked (no second DNS lookup) and returns a normal Response', async () => {
    // "pinned.test" does not exist in real DNS: the request can only work through the checked answer.
    const f = createGuardedFetch({ lookupAll: dns('127.0.0.1') });
    const res = await f(`http://pinned.test:${port}/echo?x=1`, init({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}', allowLoopback: true }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-test')).toBe('yes');
    expect(await res.json()).toEqual({ ok: true, method: 'POST', body: '{"a":1}' });
    expect(hits.at(-1)).toBe(`POST /echo?x=1 host=pinned.test:${port}`);
  });

  it('stops when the signal aborts', async () => {
    const f = createGuardedFetch({ lookupAll: dns('127.0.0.1') });
    const controller = new AbortController();
    const pending = f(`http://slow.test:${port}/slow`, init({ allowLoopback: true, signal: controller.signal }));
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toThrow();
  });
});
