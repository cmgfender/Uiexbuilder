/**
 * DNS-checked outbound fetch for the preview fetch proxy on Node (Render, Docker, any Node host).
 *
 * The connector core checks host NAMES (server/core/ssrf.ts). A public name can still resolve to a
 * private address (127.0.0.1.nip.io, a record pointing at 10.0.0.5, or DNS rebinding: public for
 * the check, private for the connection). This fetch closes that gap:
 *  - the connection's own DNS lookup is replaced: every address the name resolves to is checked
 *    (addressBlocked), and if any is private / internal the request fails with BlockedAddressError;
 *  - the socket connects to exactly the addresses that were checked (Node does not resolve again),
 *    so a second, different DNS answer can never be used;
 *  - IP literals (where Node skips the lookup) are checked before connecting.
 * Redirects are not followed (the proxy route checks and follows them hop by hop).
 */
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import { BlockedAddressError, addressBlocked } from './core/ssrf';
import type { ProxyFetch, ProxyFetchInit } from './core/types';

export type DnsLookupAll = (hostname: string, callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

const defaultLookupAll: DnsLookupAll = (hostname, callback) => {
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => callback(err, Array.isArray(addresses) ? addresses : []));
};

export interface GuardedFetchOptions {
  /** DNS resolver (tests). Defaults to node:dns lookup with { all: true }. */
  lookupAll?: DnsLookupAll;
  /** Extra https options (tests: a CA for a local TLS server). */
  tls?: Pick<https.RequestOptions, 'ca' | 'rejectUnauthorized'>;
}

/** A `lookup` for net/tls connections that refuses blocked addresses and returns only checked ones. */
export function guardedLookup(allowLoopback: boolean, lookupAll: DnsLookupAll = defaultLookupAll): LookupFunction {
  return (hostname, options, callback) => {
    lookupAll(hostname, (err, addresses) => {
      if (err) {
        callback(err, '', 0);
        return;
      }
      const family = typeof options === 'object' && options ? options.family : undefined;
      const wanted = addresses.filter((a) => !family || family === 0 || a.family === family);
      if (wanted.length === 0) {
        const e: NodeJS.ErrnoException = new Error(`No address found for ${hostname}`);
        e.code = 'ENOTFOUND';
        callback(e, '', 0);
        return;
      }
      if (wanted.some((a) => addressBlocked(a.address, { allowLoopback }))) {
        callback(new BlockedAddressError(`${hostname} points to a private or internal network address, which the preview proxy does not reach.`), '', 0);
        return;
      }
      const all = typeof options === 'object' && options && (options as { all?: boolean }).all;
      if (all) (callback as unknown as (e: null, list: LookupAddress[]) => void)(null, wanted);
      else callback(null, wanted[0].address, wanted[0].family);
    });
  };
}

/** Creates the ProxyFetch the Node adapter passes as ServerConfig.proxyFetch. */
export function createGuardedFetch(opts: GuardedFetchOptions = {}): ProxyFetch {
  const lookupAll = opts.lookupAll ?? defaultLookupAll;
  return (rawUrl: string, init: ProxyFetchInit) =>
    new Promise<Response>((resolve, reject) => {
      let url: URL;
      try {
        url = new URL(rawUrl);
      } catch {
        reject(new TypeError('Invalid URL'));
        return;
      }
      const secure = url.protocol === 'https:';
      if (!secure && url.protocol !== 'http:') {
        reject(new TypeError(`Unsupported protocol ${url.protocol}`));
        return;
      }
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      if (isIP(hostname) && addressBlocked(hostname, { allowLoopback: init.allowLoopback })) {
        reject(new BlockedAddressError());
        return;
      }
      if (init.signal?.aborted) {
        reject(init.signal.reason ?? new Error('aborted'));
        return;
      }
      const headers: Record<string, string> = { ...init.headers };
      if (init.body !== undefined && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-length')) {
        headers['Content-Length'] = String(Buffer.byteLength(init.body));
      }
      const requestOptions: https.RequestOptions = {
        protocol: url.protocol,
        hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: init.method,
        headers,
        // A fresh connection per request: every socket comes from a checked lookup.
        agent: false,
        lookup: guardedLookup(init.allowLoopback, lookupAll),
        signal: init.signal,
        ...(secure ? (opts.tls ?? {}) : {}),
      };
      const req = (secure ? https : http).request(requestOptions, (res) => {
        const status = res.statusCode ?? 502;
        const responseHeaders = new Headers();
        for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) {
          try {
            responseHeaders.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
          } catch {
            // an invalid header value: drop it
          }
        }
        const noBody = init.method === 'HEAD' || status === 204 || status === 205 || status === 304;
        if (status < 200 || status > 599) {
          res.resume();
          reject(new Error(`Unexpected status ${status}`));
          return;
        }
        const body = noBody ? null : (Readable.toWeb(res) as unknown as ReadableStream<Uint8Array>);
        if (noBody) res.resume();
        resolve(new Response(body, { status, statusText: res.statusMessage ?? '', headers: responseHeaders }));
      });
      req.on('error', reject);
      if (init.body !== undefined) req.end(init.body);
      else req.end();
    });
}
