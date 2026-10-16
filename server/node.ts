/**
 * Production Node server for UI Extension Builder.
 *
 * - Serves the built builder app (dist/) with long-lived caching for hashed assets, no-cache for
 *   HTML, an SPA fallback, security headers and brotli/gzip compression (cached in memory).
 * - Hands every /api request to the hosted connector core (createConnector(...).handle), converting
 *   node:http IncomingMessage → Web Request and Web Response → ServerResponse.
 * - `--api-only` runs just the connector (used by `npm run dev`, where Vite serves the app).
 *
 * Run: `npm run build && npm start` (bundled to dist-server/node.mjs by scripts/build-server.mjs).
 * Env: PORT (default 3000), HOST, STATIC_DIR, API_ONLY, LOG_REQUESTS, TRUST_PROXY + everything
 * configFromEnv reads (APP_URL, HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET, SESSION_SECRET, …).
 *
 * The helpers (toWebRequest, writeWebResponse, createStaticHandler, createNodeServer) are exported
 * for the fake HubSpot dev server and for tests. Importing this module has no side effects.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, promises as fsp, realpathSync, type Stats } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import type { ServerConfig } from './core/types';
import { allowPlainHealthCheck, normalizeHostingEnv } from './hosting';
import { isLoopbackAddress } from './core/ssrf';

/** Replaced by scripts/build-server.mjs (esbuild `define`). */
declare const __UIEX_BUNDLED__: boolean | undefined;

export const DEFAULT_BODY_LIMIT = 5 * 1024 * 1024;
const DEFAULT_PORT = 3000;
const CALLBACK_PATH = '/api/auth/callback';
const HEALTH_PATH = '/api/health';

/** The part of the connector the HTTP layer needs (createConnector(config) satisfies it). */
export interface ApiHandler {
  /** Resolves to null when the request is not an /api route. `meta.clientIp`: see clientAddress. */
  handle(request: Request, meta?: { clientIp?: string }): Promise<Response | null>;
}

export type Logger = (line: string) => void;

// ---------------------------------------------------------------------------------------------
// IncomingMessage → Request
// ---------------------------------------------------------------------------------------------

/** Headers that describe a single hop and must not be forwarded. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'proxy-authenticate',
  'proxy-authorization',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'http2-settings',
]);

export class BodyTooLargeError extends Error {
  constructor(public limit: number) {
    super(`The request body is larger than ${limit} bytes.`);
    this.name = 'BodyTooLargeError';
  }
}

export interface ToWebRequestOptions {
  /** Origin the absolute request URL is built on, e.g. the APP_URL origin. The Host header is never trusted for this. */
  origin: string;
  /** Maximum request body size in bytes (default 5 MB). */
  bodyLimit?: number;
  /** Aborted when the client goes away. */
  signal?: AbortSignal;
}

/**
 * Path + query of a request target, safe to append to an origin. Absolute-form targets
 * ("http://other/x") and protocol-relative paths ("//other/x") can never change the host.
 */
export function requestTarget(rawUrl: string | undefined): string {
  const raw = rawUrl ?? '/';
  if (raw.startsWith('/')) return raw;
  try {
    const u = new URL(raw);
    return `${u.pathname}${u.search}`;
  } catch {
    return '/';
  }
}

/** Decoded-free pathname of a request target (no query). */
export function requestPathname(rawUrl: string | undefined): string {
  const target = requestTarget(rawUrl);
  const q = target.search(/[?#]/);
  return q === -1 ? target : target.slice(0, q);
}

/** Read a node request body into memory, enforcing `limit` (the connection stays usable for a 413). */
export function readNodeBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume(); // drain and ignore
      reject(new BodyTooLargeError(limit));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (err: Error | null) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(Buffer.concat(chunks, size));
    };
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        finish(new BodyTooLargeError(limit));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(null));
    req.on('error', (err) => finish(err));
    req.on('close', () => finish(new Error('The client closed the connection before the request body was received.')));
  });
}

/** Convert a node:http request into a standard Web Request (the body is buffered, up to bodyLimit). */
export async function toWebRequest(req: IncomingMessage, opts: ToWebRequestOptions): Promise<Request> {
  const method = (req.method ?? 'GET').toUpperCase();
  const origin = new URL(opts.origin).origin;
  const url = `${origin}${requestTarget(req.url)}`;

  const headers = new Headers();
  const raw = req.rawHeaders;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i];
    const lower = name.toLowerCase();
    if (lower.startsWith(':') || lower === 'cookie' || HOP_BY_HOP.has(lower)) continue;
    try {
      headers.append(name, raw[i + 1]);
    } catch {
      // An invalid header value: drop it rather than failing the whole request.
    }
  }
  // Several Cookie headers (HTTP/2) must be joined with "; " — node already does that for us.
  const cookie = req.headers.cookie;
  if (cookie) headers.set('cookie', Array.isArray(cookie) ? cookie.join('; ') : cookie);

  const init: RequestInit & { duplex?: 'half' } = { method, headers };
  if (opts.signal) init.signal = opts.signal;
  if (method !== 'GET' && method !== 'HEAD') {
    const body = await readNodeBody(req, opts.bodyLimit ?? DEFAULT_BODY_LIMIT);
    if (body.length > 0) init.body = new Uint8Array(body);
  }
  return new Request(url, init);
}

// ---------------------------------------------------------------------------------------------
// Response → ServerResponse
// ---------------------------------------------------------------------------------------------

export interface WriteResponseOptions {
  /** HEAD request: send headers only. */
  head?: boolean;
  /** Headers added only when the response does not already set them. */
  defaults?: Record<string, string>;
}

const PRINTABLE_STATUS_TEXT = /^[\t\x20-\x7e]*$/;

/** Stream a Web Response to a node ServerResponse (multiple Set-Cookie headers, backpressure, client aborts). */
export async function writeWebResponse(res: ServerResponse, response: Response, opts: WriteResponseOptions = {}): Promise<void> {
  res.statusCode = response.status;
  if (response.statusText && PRINTABLE_STATUS_TEXT.test(response.statusText)) res.statusMessage = response.statusText;

  response.headers.forEach((value, name) => {
    if (name === 'set-cookie' || HOP_BY_HOP.has(name)) return;
    res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);
  for (const [name, value] of Object.entries(opts.defaults ?? {})) {
    if (!res.hasHeader(name)) res.setHeader(name, value);
  }

  const noBody = opts.head || response.status === 204 || response.status === 304 || response.status < 200;
  if (!response.body || noBody) {
    if (response.body) await response.body.cancel().catch(() => {});
    res.end();
    return;
  }

  const reader = response.body.getReader();
  let closed = false;
  const onClose = () => {
    closed = true;
    reader.cancel().catch(() => {});
  };
  res.on('close', onClose);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || closed) break;
      if (!res.write(value)) await drainOrClose(res);
    }
    if (!closed) res.end();
  } catch (err) {
    if (!res.destroyed) res.destroy(err instanceof Error ? err : new Error(String(err)));
  } finally {
    res.off('close', onClose);
  }
}

function drainOrClose(res: ServerResponse): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = () => {
      res.off('drain', done);
      res.off('close', done);
      resolve();
    };
    res.on('drain', done);
    res.on('close', done);
  });
}

// ---------------------------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------------------------

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
};

export function contentTypeFor(file: string): string {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

function isCompressible(contentType: string): boolean {
  return /^(text\/|application\/(json|javascript|manifest\+json|xml|wasm)|image\/svg\+xml)/.test(contentType);
}

/**
 * Security headers for the builder's pages. Cross-Origin-Opener-Policy is deliberately NOT set:
 * "Connect HubSpot" opens a popup that must keep `window.opener` to report back.
 * The Content-Security-Policy is kept compatible with the app (expressions use `new Function`,
 * previews load user-chosen images/iframes/URLs) and only blocks framing, plugins and <base>/form hijacks.
 */
export function staticSecurityHeaders(hsts: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  if (hsts) headers['Strict-Transport-Security'] = 'max-age=15552000';
  return headers;
}

export type ResolvedStaticPath =
  | { kind: 'ok'; file: string; pathname: string }
  | { kind: 'bad-request' }
  | { kind: 'forbidden' };

/**
 * Map a request target to a file inside `root`. Rejects malformed encodings, NUL bytes, `..`
 * segments, backslashes and hidden files (dotfiles other than /.well-known).
 */
export function resolveStaticPath(root: string, rawUrl: string | undefined): ResolvedStaticPath {
  const encoded = requestPathname(rawUrl);
  let pathname: string;
  try {
    pathname = decodeURIComponent(encoded);
  } catch {
    return { kind: 'bad-request' };
  }
  if (pathname.includes('\0')) return { kind: 'bad-request' };
  if (pathname.includes('\\')) return { kind: 'forbidden' };
  const segments = pathname.split('/');
  for (const seg of segments) {
    if (seg === '..') return { kind: 'forbidden' };
    if (seg.startsWith('.') && seg !== '.well-known' && seg !== '.') return { kind: 'forbidden' };
  }
  const base = path.resolve(root);
  const file = path.resolve(base, `.${path.posix.normalize(`/${pathname}`)}`);
  if (file !== base && !file.startsWith(base + path.sep)) return { kind: 'forbidden' };
  return { kind: 'ok', file, pathname };
}

/** Paths that should get index.html when no file matches (client-side routes), e.g. /projects/42. */
export function wantsSpaFallback(pathname: string): boolean {
  if (pathname === '/api' || pathname.startsWith('/api/')) return false;
  if (pathname.startsWith('/assets/')) return false;
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  const ext = path.extname(last).toLowerCase();
  return ext === '' || ext === '.html';
}

export function cacheControlFor(pathname: string, file: string): string {
  if (file.endsWith('.html')) return 'no-cache';
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
}

/** Pick br or gzip from an Accept-Encoding header (q=0 means "not acceptable"). */
export function pickEncoding(acceptEncoding: string | string[] | undefined): 'br' | 'gzip' | null {
  const header = Array.isArray(acceptEncoding) ? acceptEncoding.join(',') : (acceptEncoding ?? '');
  const accepted = new Map<string, number>();
  for (const part of header.split(',')) {
    const [rawName, ...params] = part.trim().split(';');
    const name = rawName.trim().toLowerCase();
    if (!name) continue;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q=([0-9.]+)\s*$/i.exec(p);
      if (m) q = Number(m[1]);
    }
    accepted.set(name, Number.isFinite(q) ? q : 0);
  }
  const ok = (name: string) => (accepted.get(name) ?? accepted.get('*') ?? 0) > 0;
  if (ok('br')) return 'br';
  if (ok('gzip')) return 'gzip';
  return null;
}

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);
const MAX_COMPRESS_IN_MEMORY = 16 * 1024 * 1024;
const MIN_COMPRESS_SIZE = 1024;

/** Compressed copies of static files, keyed by path + size + mtime + encoding, bounded in bytes. */
class CompressionCache {
  private entries = new Map<string, Buffer>();
  private bytes = 0;
  private pending = new Map<string, Promise<Buffer>>();
  constructor(private maxBytes: number) {}

  async get(file: string, stat: Stats, encoding: 'br' | 'gzip'): Promise<Buffer> {
    const key = `${file}\0${stat.size}\0${stat.mtimeMs}\0${encoding}`;
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key); // refresh LRU position
      this.entries.set(key, hit);
      return hit;
    }
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const work = (async () => {
      const data = await fsp.readFile(file);
      const out =
        encoding === 'br'
          ? await brotli(data, {
              params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length },
            })
          : await gzip(data, { level: 6 });
      this.store(key, out);
      return out;
    })();
    this.pending.set(key, work);
    try {
      return await work;
    } finally {
      this.pending.delete(key);
    }
  }

  private store(key: string, value: Buffer) {
    if (value.length > this.maxBytes) return;
    this.entries.set(key, value);
    this.bytes += value.length;
    for (const [k, v] of this.entries) {
      if (this.bytes <= this.maxBytes) break;
      this.entries.delete(k);
      this.bytes -= v.length;
    }
  }
}

export interface StaticHandlerOptions {
  /** Directory with the built app (index.html + assets/). */
  root: string;
  /** Send Strict-Transport-Security (the public URL is https). */
  hsts?: boolean;
  /** Compress text assets with brotli/gzip (default true). */
  compress?: boolean;
  /** Memory budget for compressed copies (default 64 MB). */
  cacheBytes?: number;
}

export interface StaticHandler {
  (req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** Pre-compress hashed assets in the background so the first visitor does not wait. */
  warm(): Promise<void>;
}

function etagFor(stat: Stats, encoding: string | null): string {
  return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}${encoding ? `-${encoding}` : ''}"`;
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const bare = etag.replace(/^W\//, '');
  return header.split(',').some((t) => {
    const v = t.trim();
    return v === '*' || v.replace(/^W\//, '') === bare;
  });
}

async function statOrNull(file: string): Promise<Stats | null> {
  try {
    return await fsp.stat(file);
  } catch {
    return null;
  }
}

export function createStaticHandler(opts: StaticHandlerOptions): StaticHandler {
  const root = path.resolve(opts.root);
  let realRoot = root;
  try {
    realRoot = realpathSync(root);
  } catch {
    // root does not exist (yet); every request will 404 / fall back gracefully
  }
  const compress = opts.compress !== false;
  const cache = new CompressionCache(opts.cacheBytes ?? 64 * 1024 * 1024);
  const security = staticSecurityHeaders(!!opts.hsts);

  async function insideRoot(file: string): Promise<boolean> {
    try {
      const real = await fsp.realpath(file);
      return real === realRoot || real.startsWith(realRoot + path.sep);
    } catch {
      return false;
    }
  }

  const sendPlain = (res: ServerResponse, status: number, text: string, extra: Record<string, string> = {}) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
    res.end(text);
  };

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    for (const [k, v] of Object.entries(security)) res.setHeader(k, v);
    const method = (req.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      sendPlain(res, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
      return;
    }
    const resolved = resolveStaticPath(root, req.url);
    if (resolved.kind === 'bad-request') return sendPlain(res, 400, 'Bad request.');
    if (resolved.kind === 'forbidden') return sendPlain(res, 404, 'Not found.');

    let file = resolved.file;
    let stat = await statOrNull(file);
    if (stat?.isDirectory()) {
      file = path.join(file, 'index.html');
      stat = await statOrNull(file);
    }
    if (stat && stat.isFile() && !(await insideRoot(file))) stat = null;
    if (!stat || !stat.isFile()) {
      if (!wantsSpaFallback(resolved.pathname)) return sendPlain(res, 404, 'Not found.');
      file = path.join(root, 'index.html');
      stat = await statOrNull(file);
      if (!stat || !stat.isFile()) {
        return sendPlain(res, 503, 'The builder has not been built yet. Run "npm run build" and restart the server.');
      }
    }

    const type = contentTypeFor(file);
    const compressible = compress && isCompressible(type) && stat.size >= MIN_COMPRESS_SIZE;
    const encoding = compressible && stat.size <= MAX_COMPRESS_IN_MEMORY ? pickEncoding(req.headers['accept-encoding']) : null;
    const etag = etagFor(stat, encoding);

    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', cacheControlFor(resolved.pathname, file));
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', stat.mtime.toUTCString());
    if (compressible) res.setHeader('Vary', 'Accept-Encoding');

    if (etagMatches(req.headers['if-none-match'], etag)) {
      res.statusCode = 304;
      res.end();
      return;
    }

    if (encoding) {
      let body: Buffer;
      try {
        body = await cache.get(file, stat, encoding);
      } catch {
        return sendPlain(res, 500, 'Could not read the file.');
      }
      res.statusCode = 200;
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Content-Length', String(body.length));
      res.end(method === 'HEAD' ? undefined : body);
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Length', String(stat.size));
    if (method === 'HEAD') {
      res.end();
      return;
    }
    await new Promise<void>((resolve) => {
      const stream = createReadStream(file);
      stream.on('error', () => {
        if (!res.headersSent) sendPlain(res, 500, 'Could not read the file.');
        else res.destroy();
        resolve();
      });
      res.on('close', () => {
        stream.destroy();
        resolve();
      });
      stream.pipe(res);
      stream.on('end', resolve);
    });
  };

  const warm = async () => {
    if (!compress) return;
    const dir = path.join(root, 'assets');
    let names: string[] = [];
    try {
      names = await fsp.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      const stat = await statOrNull(file);
      if (!stat?.isFile() || stat.size < MIN_COMPRESS_SIZE || stat.size > MAX_COMPRESS_IN_MEMORY) continue;
      if (!isCompressible(contentTypeFor(file))) continue;
      await cache.get(file, stat, 'br').catch(() => {});
      await cache.get(file, stat, 'gzip').catch(() => {});
    }
  };

  return Object.assign(handler, { warm });
}

// ---------------------------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------------------------

export interface NodeServerOptions {
  /** The connector. Null → /api answers 503 (e.g. it failed to start). */
  connector: ApiHandler | null;
  /** Built app directory; null = API-only mode. */
  staticRoot: string | null;
  /** Pre-built static handler (takes precedence over staticRoot; lets the caller warm its cache). */
  staticHandler?: StaticHandler | null;
  /** Public origin used to build Request URLs (APP_URL). */
  origin: string;
  bodyLimit?: number;
  hsts?: boolean;
  /** Where server errors (and access lines, see accessLog) are written. Paths only, never query strings. */
  log?: Logger;
  /** One line per /api request (default true when `log` is set). */
  accessLog?: boolean;
  /** Use X-Forwarded-Proto / X-Forwarded-Host / X-Forwarded-For in log lines. */
  trustProxy?: boolean;
  /** Shown on non-API pages in API-only mode. */
  apiOnlyHint?: string;
}

function errorResponse(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { code, message, status } }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

const API_DEFAULT_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };

function firstHeader(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v?.split(',')[0]?.trim() || undefined;
}

/** "::ffff:127.0.0.1" → "127.0.0.1" (Node reports IPv4 clients of dual-stack sockets this way). */
function plainIp(ip: string | undefined): string | undefined {
  const v = ip?.trim();
  if (!v) return undefined;
  return /^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(v) ? v.slice(7) : v;
}

/**
 * The client's IP address for rate limits and the local-development check. Behind a proxy
 * (trustProxy) it is the LAST X-Forwarded-For entry — the one the proxy in front of this server
 * appended (Render's load balancer, the Vite dev proxy); earlier entries are whatever the client
 * sent and can't be trusted. Otherwise the socket address.
 */
export function clientAddress(req: IncomingMessage, trustProxy: boolean): string | undefined {
  return pickClientAddress(req.headers['x-forwarded-for'], req.socket.remoteAddress, trustProxy);
}

/**
 * clientAddress from its parts. A loopback address in X-Forwarded-For is only believed when the
 * proxy itself is on this computer (the Vite dev proxy): a remote caller that talks to this server
 * directly and sends `X-Forwarded-For: 127.0.0.1` is not on this computer.
 */
export function pickClientAddress(forwardedFor: string | string[] | undefined, socketAddress: string | undefined, trustProxy: boolean): string | undefined {
  const socket = plainIp(socketAddress);
  if (trustProxy) {
    const joined = Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor;
    const last = plainIp(joined?.split(',').map((p) => p.trim()).filter(Boolean).pop());
    if (last) return isLoopbackAddress(last) && !isLoopbackAddress(socket) ? socket : last;
  }
  return socket;
}

/** Access-log path: deploy job tokens in old-style status URLs are replaced by "…". */
export function logPath(pathname: string): string {
  return pathname.replace(/^\/api\/deploy\/(?!key$|status$)[^/]+/, '/api/deploy/…');
}

/** Where a request came from, for log lines only (never used for URLs or security decisions). */
export function describeClient(req: IncomingMessage, trustProxy: boolean): string {
  const ip = (trustProxy && firstHeader(req.headers['x-forwarded-for'])) || req.socket.remoteAddress || '-';
  if (!trustProxy) return ip;
  const proto = firstHeader(req.headers['x-forwarded-proto']);
  const host = firstHeader(req.headers['x-forwarded-host']);
  return proto || host ? `${ip} via ${proto ?? 'http'}://${host ?? req.headers.host ?? '?'}` : ip;
}

export function createRequestListener(opts: NodeServerOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const statics = opts.staticHandler ?? (opts.staticRoot ? createStaticHandler({ root: opts.staticRoot, hsts: opts.hsts }) : null);
  const bodyLimit = opts.bodyLimit ?? DEFAULT_BODY_LIMIT;
  const log = opts.log;

  async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string, started: number): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    let response: Response | null = null;
    if (!opts.connector) {
      response = errorResponse(503, 'connector_unavailable', 'The HubSpot connector is not running on this server.');
    } else {
      const abort = new AbortController();
      res.on('close', () => {
        if (!res.writableFinished) abort.abort();
      });
      let request: Request | null = null;
      try {
        request = await toWebRequest(req, { origin: opts.origin, bodyLimit, signal: abort.signal });
      } catch (err) {
        if (err instanceof BodyTooLargeError) {
          response = errorResponse(
            413,
            'payload_too_large',
            `This upload is too big (the limit is ${Math.round(bodyLimit / (1024 * 1024))} MB). Remove large files and try again.`,
            { Connection: 'close' },
          );
        } else {
          if (abort.signal.aborted || res.destroyed) return;
          response = errorResponse(400, 'bad_request', 'The request could not be read.');
        }
      }
      if (request) {
        try {
          response = await opts.connector.handle(request, { clientIp: clientAddress(req, !!opts.trustProxy) });
        } catch (err) {
          log?.(`[api] ${method} ${logPath(pathname)} failed: ${err instanceof Error ? err.message : String(err)}`);
          response = errorResponse(500, 'internal_error', 'Something went wrong on the connector server. Please try again.');
        }
        if (!response) response = errorResponse(404, 'not_found', 'There is no connector endpoint at this address.');
      }
    }
    if (!response) return;
    await writeWebResponse(res, response, { head: method === 'HEAD', defaults: API_DEFAULT_HEADERS });
    if (opts.accessLog !== false) log?.(`[api] ${method} ${logPath(pathname)} ${response.status} ${Math.round(performance.now() - started)}ms ${describeClient(req, !!opts.trustProxy)}`);
  }

  return (req, res) => {
    const started = performance.now();
    const pathname = requestPathname(req.url);
    const isApi = pathname === '/api' || pathname.startsWith('/api/');
    const work = isApi
      ? handleApi(req, res, pathname, started)
      : statics
        ? statics(req, res)
        : Promise.resolve().then(() => {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            res.end(opts.apiOnlyHint ?? 'This server only answers /api requests (HubSpot connector).');
          });
    work.catch((err: unknown) => {
      log?.(`[server] ${req.method ?? 'GET'} ${pathname} failed: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end('Internal server error.');
      } else if (!res.writableEnded) {
        res.destroy();
      }
    });
  };
}

export function createNodeServer(opts: NodeServerOptions): Server {
  return tuneServer(createServer(createRequestListener(opts)));
}

// ---------------------------------------------------------------------------------------------
// Startup: config, logging, graceful shutdown
// ---------------------------------------------------------------------------------------------

export interface CliArgs {
  apiOnly: boolean;
  port?: number;
  host?: string;
  staticDir?: string;
}

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { apiOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
    const value = () => inline ?? argv[++i];
    if (flag === '--api-only') out.apiOnly = true;
    else if (flag === '--port') out.port = Number(value());
    else if (flag === '--host') out.host = value();
    else if (flag === '--static' || flag === '--dist') out.staticDir = value();
  }
  return out;
}

function truthy(v: string | undefined): boolean {
  return !!v && /^(1|true|yes|on)$/i.test(v.trim());
}

/**
 * The public address to use when APP_URL is not set: the address the hosting platform reports
 * (Render, Railway, Fly, Vercel), else http://localhost:<port> outside production. In production
 * with nothing detected it returns null, so the connector reports APP_URL as missing instead of
 * guessing (OAuth needs the exact public address).
 */
export function detectAppUrl(env: Record<string, string | undefined>, port: number): { url: string | null; source: string } {
  const clean = (u: string) => u.trim().replace(/\/+$/, '');
  if (env.APP_URL?.trim()) return { url: clean(env.APP_URL), source: 'APP_URL' };
  if (env.RENDER_EXTERNAL_URL?.trim()) return { url: clean(env.RENDER_EXTERNAL_URL), source: 'detected on Render' };
  if (env.RAILWAY_PUBLIC_DOMAIN?.trim()) return { url: `https://${clean(env.RAILWAY_PUBLIC_DOMAIN)}`, source: 'detected on Railway' };
  if (env.FLY_APP_NAME?.trim()) return { url: `https://${env.FLY_APP_NAME.trim()}.fly.dev`, source: 'detected on Fly.io' };
  if (env.VERCEL_PROJECT_PRODUCTION_URL?.trim()) {
    return { url: `https://${clean(env.VERCEL_PROJECT_PRODUCTION_URL)}`, source: 'detected on Vercel' };
  }
  if ((env.NODE_ENV ?? '').trim() === 'production') return { url: null, source: 'APP_URL is not set' };
  return { url: `http://localhost:${port}`, source: 'local default - APP_URL is not set' };
}

/** Which of the settings needed for "Connect HubSpot" are missing or invalid (names only). */
export function missingOAuthSettings(config: Pick<ServerConfig, 'appUrl' | 'hubspotClientId' | 'hubspotClientSecret' | 'sessionSecret'>): string[] {
  const missing: string[] = [];
  if (!config.appUrl) missing.push('APP_URL');
  if (!config.hubspotClientId) missing.push('HUBSPOT_CLIENT_ID');
  if (!config.hubspotClientSecret) missing.push('HUBSPOT_CLIENT_SECRET');
  if (!config.sessionSecret) missing.push('SESSION_SECRET');
  else if (config.sessionSecret.length < 32) missing.push('SESSION_SECRET (must be at least 32 characters)');
  return missing;
}

export interface StartupInfo {
  listenUrl: string;
  appUrlSource: string;
  staticRoot: string | null;
  staticFound: boolean;
  /** From the connector's own /api/health (authoritative); falls back to missingOAuthSettings. */
  oauthConfigured?: boolean;
}

/** Human-readable startup summary. Never includes secrets. */
export function describeStartup(config: ServerConfig, info: StartupInfo): string[] {
  const missing = missingOAuthSettings(config);
  const configured = info.oauthConfigured ?? missing.length === 0;
  const lines = [
    `UI Extension Builder is running (connector ${config.version || 'dev'}).`,
    `  Listening on:     ${info.listenUrl}`,
    config.appUrl
      ? `  Public address:   ${config.appUrl}   (${info.appUrlSource})`
      : '  Public address:   NOT SET - set APP_URL to the address people open, e.g. https://builder.example.com',
    info.staticRoot
      ? `  Builder files:    ${info.staticFound ? info.staticRoot : `${info.staticRoot} (NOT FOUND - run "npm run build")`}`
      : '  Builder files:    not served (API-only mode)',
  ];
  if (configured) {
    lines.push(`  HubSpot sign-in:  ready (client id ${config.hubspotClientId})`);
  } else {
    lines.push(`  HubSpot sign-in:  NOT CONFIGURED${missing.length ? ` - missing ${missing.join(', ')}` : ''}.`);
    lines.push('                    The builder still works; "Connect HubSpot" stays unavailable until these are set.');
  }
  if (config.appUrl) {
    lines.push(`  Redirect URL:     ${config.appUrl}${CALLBACK_PATH}`);
    lines.push("                    (add exactly this address to your HubSpot app's redirect URLs)");
  }
  lines.push(`  Required scopes:  ${config.requiredScopes.join(' ') || '(none)'}`);
  lines.push(`  Optional scopes:  ${config.optionalScopes.join(' ') || '(none)'}`);
  lines.push(`  HubSpot hosts:    ${config.hubspotApiBase} | ${config.hubspotAppBase}`);
  // Same rules as the connector's /api/health features: CRM data and the fetch proxy need sign-in;
  // deploy needs a usable SESSION_SECRET (its job state is encrypted with it).
  const secretUsable = config.sessionSecret.length >= 32;
  const crm = configured ? 'on' : 'off until sign-in is set up';
  const proxy = !config.enableFetchProxy ? 'off' : configured ? 'on' : 'off until sign-in is set up';
  const deploy = !config.enableDeploy ? 'off' : secretUsable ? 'on' : 'off until SESSION_SECRET is set';
  lines.push(`  Features:         live CRM data ${crm} | fetch proxy ${proxy} | deploy to HubSpot (beta) ${deploy}`);
  if (config.allowedOrigins.length > 0) lines.push(`  Extra origins:    ${config.allowedOrigins.join(', ')}`);
  if (config.allowedPortals?.length) lines.push(`  Allowed accounts: ${config.allowedPortals.join(', ')} (ALLOWED_PORTALS)`);
  else if (configured) lines.push('  Allowed accounts: any HubSpot account that installs your app (set ALLOWED_PORTALS to limit it)');
  lines.push(`  Health check:     ${config.appUrl || info.listenUrl}${HEALTH_PATH}`);
  return lines;
}

function findStaticRoot(explicit: string | undefined): string {
  if (explicit) return path.resolve(explicit);
  const fromCwd = path.resolve(process.cwd(), 'dist');
  if (existsSync(path.join(fromCwd, 'index.html'))) return fromCwd;
  // Next to the bundle: dist-server/node.mjs → ../dist
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const sibling = path.resolve(here, '..', 'dist');
    if (existsSync(path.join(sibling, 'index.html'))) return sibling;
  } catch {
    // import.meta.url unavailable: fall through
  }
  return fromCwd;
}

export interface StartOptions {
  argv?: string[];
  env?: Record<string, string | undefined>;
  log?: Logger;
  /** Install SIGTERM/SIGINT handlers (default true). */
  handleSignals?: boolean;
  /** Overrides passed to configFromEnv (tests inject fetch etc.). */
  overrides?: Partial<ServerConfig>;
}

export interface RunningServer {
  server: Server;
  config: ServerConfig;
  /** Base URL the server listens on, e.g. http://127.0.0.1:3000 */
  url: string;
  close(): Promise<void>;
}

async function probeHealth(connector: ApiHandler, origin: string): Promise<boolean | undefined> {
  try {
    const res = await connector.handle(new Request(`${origin}${HEALTH_PATH}`, { headers: { accept: 'application/json' } }));
    if (!res || !res.ok) return undefined;
    const body = (await res.json()) as { oauthConfigured?: unknown };
    return typeof body.oauthConfigured === 'boolean' ? body.oauthConfigured : undefined;
  } catch {
    return undefined;
  }
}

/** Configure timeouts on a node:http server (outlive load-balancer idle timeouts to avoid 502s). */
export function tuneServer(server: Server): Server {
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 120_000;
  return server;
}

/**
 * Start the production server (or the API-only dev server). Listens first, so `--port 0` works:
 * the local default public address then uses the real port.
 */
export async function startServer(opts: StartOptions = {}): Promise<RunningServer> {
  const { env, notes } = normalizeHostingEnv(opts.env ?? process.env);
  const args = parseArgs(opts.argv ?? process.argv.slice(2));
  const log: Logger = opts.log ?? ((line) => console.log(line));
  const port = args.port !== undefined && Number.isFinite(args.port) ? args.port : Number(env.PORT || DEFAULT_PORT);
  const host = args.host ?? (env.HOST?.trim() || undefined);
  const apiOnly = args.apiOnly || truthy(env.API_ONLY);

  const { configFromEnv, createConnector } = await import('./core/index');
  const { createGuardedFetch } = await import('./guardedFetch');

  const server = tuneServer(createServer());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const listenHost = !host || host === '0.0.0.0' || host === '::' ? 'localhost' : host.includes(':') ? `[${host}]` : host;
  const url = `http://${listenHost}:${actualPort}`;

  // No await between here and attaching the request listener: nothing can be served half-configured.
  const detected = detectAppUrl(env, actualPort);
  // The preview fetch proxy resolves names itself and refuses private / internal addresses.
  const overrides: Partial<ServerConfig> = { proxyFetch: createGuardedFetch(), ...(opts.overrides ?? {}) };
  if (!env.APP_URL?.trim() && overrides.appUrl === undefined && detected.url) overrides.appUrl = detected.url;
  const config = configFromEnv(env, overrides);
  const core = createConnector(config);
  const connector: ApiHandler = { handle: (request, meta) => core.handle(allowPlainHealthCheck(request), meta) };

  const staticRoot = apiOnly ? null : findStaticRoot(args.staticDir ?? env.STATIC_DIR);
  const staticFound = !!staticRoot && existsSync(path.join(staticRoot, 'index.html'));
  const accessLog = env.LOG_REQUESTS === undefined || env.LOG_REQUESTS.trim() === '' || truthy(env.LOG_REQUESTS);
  const hsts = config.appUrl.startsWith('https://');
  const staticHandler = staticRoot ? createStaticHandler({ root: staticRoot, hsts }) : null;
  const origin = config.appUrl || `http://localhost:${actualPort}`;

  server.on(
    'request',
    createRequestListener({
      connector,
      staticRoot,
      staticHandler,
      origin,
      hsts,
      log,
      accessLog,
      trustProxy: env.TRUST_PROXY === undefined ? true : truthy(env.TRUST_PROXY),
      apiOnlyHint: `This is the HubSpot connector API for UI Extension Builder. Open the builder at ${config.appUrl || 'its public address'}.`,
    }),
  );

  const oauthConfigured = await probeHealth(connector, origin);
  const appUrlSource = env.APP_URL?.trim() ? 'APP_URL' : overrides.appUrl && overrides.appUrl === detected.url ? detected.source : 'configured';
  for (const line of describeStartup(config, { listenUrl: url, appUrlSource, staticRoot, staticFound, oauthConfigured })) log(line);
  for (const note of notes) log(`  Note:             ${note}`);

  if (staticHandler && staticFound) void staticHandler.warm();

  const close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });

  if (opts.handleSignals !== false) installShutdown(server, log);
  return { server, config, url, close };
}

function installShutdown(server: Server, log: Logger) {
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) {
      log(`${signal} received again - exiting now.`);
      process.exit(1);
    }
    stopping = true;
    log(`${signal} received - finishing open requests, then stopping.`);
    server.close(() => {
      log('Server stopped.');
      process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => {
      server.closeAllConnections();
      process.exit(0);
    }, 10_000).unref();
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

/** CLI entry (dist-server/node.mjs calls this; so does `tsx server/node.ts`). */
export function runCli(): void {
  startServer().catch((err: unknown) => {
    console.error(`Could not start UI Extension Builder: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}

function isDirectRun(): boolean {
  if (typeof __UIEX_BUNDLED__ !== 'undefined' && __UIEX_BUNDLED__) return false; // bundles call runCli() explicitly
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) runCli();
