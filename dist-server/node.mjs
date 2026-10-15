import { createRequire as __uiexCreateRequire } from 'node:module'; const require = __uiexCreateRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/core/types.ts
var HubSpotApiError;
var init_types = __esm({
  "server/core/types.ts"() {
    HubSpotApiError = class extends Error {
      constructor(message, status, code, correlationId, requiredScopes) {
        super(message);
        this.status = status;
        this.code = code;
        this.correlationId = correlationId;
        this.requiredScopes = requiredScopes;
      }
      status;
      code;
      correlationId;
      requiredScopes;
    };
  }
});

// server/core/http.ts
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}
function errorBody(status, code, message, extra = {}) {
  const error = { code, message, status };
  if (extra.correlationId) error.correlationId = extra.correlationId;
  if (extra.requiredScopes && extra.requiredScopes.length > 0) error.requiredScopes = extra.requiredScopes;
  return { error };
}
function errorJson(status, code, message, extra = {}) {
  return json(errorBody(status, code, message, extra), status, extra.headers ?? {});
}
function errorToResponse(err, redact = (s) => s) {
  if (err instanceof ConnectorError) {
    return errorJson(err.status, err.code, redact(err.message), err.extra);
  }
  if (err instanceof HubSpotApiError) {
    const headers = {};
    if (err instanceof RateLimitedError && err.retryAfterSeconds > 0) headers["Retry-After"] = String(err.retryAfterSeconds);
    return errorJson(err.status, err.code, redact(err.message), {
      correlationId: err.correlationId,
      requiredScopes: err.requiredScopes,
      headers
    });
  }
  return errorJson(500, "internal_error", "Something went wrong on the connector server. Please try again.");
}
function badRequest(message) {
  return new ConnectorError(400, "bad_request", message);
}
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function scriptSafeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
async function readBodyText(request, limit) {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) throw tooLarge(limit);
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {
      });
      throw tooLarge(limit);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
function tooLarge(limit) {
  return new ConnectorError(413, "payload_too_large", `The request is too large (limit ${Math.round(limit / 1024)} KB).`);
}
async function readJsonBody(request, limit = 256 * 1024) {
  const text = await readBodyText(request, limit);
  if (!text.trim()) throw badRequest("The request body is empty; JSON was expected.");
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest("The request body is not valid JSON.");
  }
}
function redactText(text, secrets) {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join("[redacted]");
  }
  out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]");
  out = out.replace(/((?:access_token|refresh_token|client_secret|code|token)=)[^&\s"']+/gi, "$1[redacted]");
  return out;
}
async function sleep(ms) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}
function clampInt(raw, min, max, fallback) {
  if (raw === null || raw === void 0 || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
var ConnectorError, RateLimitedError, API_SECURITY_HEADERS;
var init_http = __esm({
  "server/core/http.ts"() {
    init_types();
    ConnectorError = class extends Error {
      constructor(status, code, message, extra = {}) {
        super(message);
        this.status = status;
        this.code = code;
        this.extra = extra;
        this.name = "ConnectorError";
      }
      status;
      code;
      extra;
    };
    RateLimitedError = class extends HubSpotApiError {
      constructor(message, retryAfterSeconds2, correlationId) {
        super(message, 429, "rate_limited", correlationId);
        this.retryAfterSeconds = retryAfterSeconds2;
      }
      retryAfterSeconds;
    };
    API_SECURITY_HEADERS = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY"
    };
  }
});

// server/core/config.ts
function normalizeOrigin(raw) {
  const value = (raw ?? "").trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.origin;
  } catch {
    return "";
  }
}
function normalizeBase(raw, fallback) {
  const value = (raw ?? "").trim();
  if (!value) return fallback;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return fallback;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}
function parseScopeList(raw) {
  if (raw === void 0) return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.toLowerCase() === "none") return [];
  const out = [];
  for (const s of value.split(/[\s,]+/)) {
    if (s && /^[A-Za-z0-9._-]+$/.test(s) && !out.includes(s)) out.push(s);
  }
  return out;
}
function parseBool(raw, fallback) {
  if (raw === void 0) return fallback;
  const value = raw.trim().toLowerCase();
  if (!value) return fallback;
  if (["0", "false", "no", "off", "disabled"].includes(value)) return false;
  if (["1", "true", "yes", "on", "enabled"].includes(value)) return true;
  return fallback;
}
function parseOrigins(raw) {
  if (!raw) return [];
  const out = [];
  for (const part of raw.split(/[\s,]+/)) {
    const origin = normalizeOrigin(part);
    if (origin && !out.includes(origin)) out.push(origin);
  }
  return out;
}
function configFromEnv(env, overrides = {}) {
  const production = (env.NODE_ENV ?? "").trim() === "production";
  const rawAppUrl = env.APP_URL?.trim();
  const appUrl = rawAppUrl ? normalizeOrigin(rawAppUrl) : production ? "" : DEV_APP_URL;
  const required = parseScopeList(env.HUBSPOT_SCOPES) ?? [...DEFAULT_REQUIRED_SCOPES];
  if (!required.includes("oauth")) required.unshift("oauth");
  const optional = (parseScopeList(env.HUBSPOT_OPTIONAL_SCOPES) ?? [...DEFAULT_OPTIONAL_SCOPES]).filter((s) => !required.includes(s));
  const base = {
    appUrl,
    hubspotClientId: (env.HUBSPOT_CLIENT_ID ?? "").trim(),
    hubspotClientSecret: (env.HUBSPOT_CLIENT_SECRET ?? "").trim(),
    sessionSecret: env.SESSION_SECRET ?? "",
    requiredScopes: required,
    optionalScopes: optional,
    hubspotApiBase: normalizeBase(env.HUBSPOT_API_BASE, DEFAULT_API_BASE),
    hubspotAppBase: normalizeBase(env.HUBSPOT_APP_BASE, DEFAULT_APP_BASE),
    enableFetchProxy: parseBool(env.ENABLE_FETCH_PROXY, true),
    enableDeploy: parseBool(env.ENABLE_DEPLOY, true),
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
    secureCookies: appUrl.startsWith("https:"),
    fetch: defaultFetch,
    now: () => Date.now(),
    version: CONNECTOR_VERSION
  };
  const merged = { ...base, ...stripUndefined(overrides) };
  if (overrides.appUrl !== void 0) {
    merged.appUrl = normalizeOrigin(overrides.appUrl);
    if (overrides.secureCookies === void 0) merged.secureCookies = merged.appUrl.startsWith("https:");
  }
  if (overrides.allowedOrigins !== void 0) {
    merged.allowedOrigins = overrides.allowedOrigins.map((o) => normalizeOrigin(o)).filter(Boolean);
  }
  if (overrides.hubspotApiBase !== void 0) merged.hubspotApiBase = normalizeBase(overrides.hubspotApiBase, DEFAULT_API_BASE);
  if (overrides.hubspotAppBase !== void 0) merged.hubspotAppBase = normalizeBase(overrides.hubspotAppBase, DEFAULT_APP_BASE);
  return merged;
}
function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== void 0) out[k] = v;
  }
  return out;
}
function checkConfig(config) {
  const missing = [];
  if (!config.appUrl) missing.push({ name: "APP_URL", reason: "the public address of the builder, e.g. https://builder.example.com" });
  if (!config.hubspotClientId) missing.push({ name: "HUBSPOT_CLIENT_ID", reason: "your HubSpot app's client ID" });
  if (!config.hubspotClientSecret) missing.push({ name: "HUBSPOT_CLIENT_SECRET", reason: "your HubSpot app's client secret" });
  if (!config.sessionSecret || config.sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    missing.push({
      name: "SESSION_SECRET",
      reason: config.sessionSecret ? `too short \u2014 use at least ${MIN_SESSION_SECRET_LENGTH} random characters` : `at least ${MIN_SESSION_SECRET_LENGTH} random characters`
    });
  }
  return { oauthConfigured: missing.length === 0, missing };
}
function notConfiguredMessage(status) {
  const names = status.missing.map((m) => `${m.name} (${m.reason})`).join("; ");
  return `Sign in with HubSpot isn't set up on this server yet. Whoever hosts the builder needs to set: ${names}.`;
}
function isLocalAppUrl(appUrl) {
  try {
    const host = new URL(appUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost");
  } catch {
    return false;
  }
}
var CONNECTOR_VERSION, DEFAULT_REQUIRED_SCOPES, DEFAULT_OPTIONAL_SCOPES, DEFAULT_API_BASE, DEFAULT_APP_BASE, DEV_APP_URL, MIN_SESSION_SECRET_LENGTH, defaultFetch;
var init_config = __esm({
  "server/core/config.ts"() {
    CONNECTOR_VERSION = "1.0.0";
    DEFAULT_REQUIRED_SCOPES = [
      "oauth",
      "crm.objects.contacts.read",
      "crm.objects.companies.read",
      "crm.objects.deals.read",
      "crm.schemas.contacts.read",
      "crm.schemas.companies.read",
      "crm.schemas.deals.read"
    ];
    DEFAULT_OPTIONAL_SCOPES = [
      "tickets",
      "crm.objects.custom.read",
      "crm.schemas.custom.read",
      "crm.objects.owners.read",
      "crm.objects.line_items.read",
      "crm.objects.products.read",
      "crm.objects.quotes.read"
    ];
    DEFAULT_API_BASE = "https://api.hubapi.com";
    DEFAULT_APP_BASE = "https://app.hubspot.com";
    DEV_APP_URL = "http://localhost:5173";
    MIN_SESSION_SECRET_LENGTH = 32;
    defaultFetch = (input, init) => globalThis.fetch(input, init);
  }
});

// server/core/router.ts
function compile(route) {
  const keys = [];
  const source = route.path.split("/").map((seg) => {
    if (seg.startsWith(":")) {
      keys.push(seg.slice(1));
      return "([^/]+)";
    }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("/");
  return { route, regex: new RegExp(`^${source}$`), keys };
}
function normalizePath(pathname) {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
}
var Router;
var init_router = __esm({
  "server/core/router.ts"() {
    init_http();
    Router = class {
      compiled = [];
      constructor(routes = []) {
        for (const r of routes) this.add(r);
      }
      add(route) {
        this.compiled.push(compile(route));
        return this;
      }
      get routes() {
        return this.compiled.map((c) => c.route);
      }
      match(method, pathname) {
        const path2 = normalizePath(pathname);
        const allow = /* @__PURE__ */ new Set();
        for (const c of this.compiled) {
          const m = c.regex.exec(path2);
          if (!m) continue;
          if (c.route.method !== method) {
            allow.add(c.route.method);
            continue;
          }
          const params = {};
          c.keys.forEach((key, i) => {
            try {
              params[key] = decodeURIComponent(m[i + 1]);
            } catch {
              throw new ConnectorError(400, "bad_request", "The address contains invalid characters.");
            }
          });
          return { kind: "match", route: c.route, params };
        }
        if (allow.size > 0) return { kind: "method-not-allowed", allow: [...allow] };
        return { kind: "not-found" };
      }
    };
  }
});

// server/core/cookies.ts
function parseCookies(header) {
  const out = /* @__PURE__ */ new Map();
  if (!header) return out;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    if (name && !out.has(name)) out.set(name, value);
  }
  return out;
}
function serializeCookie(name, value, opts = {}) {
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) throw new Error("invalid cookie name");
  if (!/^[!#-+\--:<-[\]-~]*$/.test(value)) throw new Error("invalid cookie value");
  const parts = [`${name}=${value}`];
  parts.push(`Path=${opts.path ?? "/"}`);
  if (opts.maxAge !== void 0) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`);
    if (opts.maxAge <= 0) parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  }
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  return parts.join("; ");
}
var init_cookies = __esm({
  "server/core/cookies.ts"() {
  }
});

// server/core/crypto.ts
function bytesToBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("invalid base64url");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
function randomToken(bytes = 32) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return bytesToBase64Url(buf);
}
function timingSafeEqual(a, b) {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}
async function sha256Base64(text) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}
function deriveKey(secret, purpose) {
  const cacheKey = `${purpose}\0${secret}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    key = (async () => {
      const ikm = await crypto.subtle.importKey("raw", encoder.encode(secret), "HKDF", false, ["deriveKey"]);
      return crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: encoder.encode(KDF_SALT), info: encoder.encode(`uiex-connector/${purpose}`) },
        ikm,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
    })();
    if (keyCache.size > 32) keyCache.clear();
    keyCache.set(cacheKey, key);
  }
  return key;
}
async function seal(data, opts) {
  const key = await deriveKey(opts.secret, opts.purpose);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const nowSec = Math.floor(opts.now / 1e3);
  const payload = { v: 1, iat: nowSec, exp: nowSec + opts.ttlSeconds, d: data };
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(opts.aad) },
    key,
    encoder.encode(JSON.stringify(payload))
  );
  return `${SEAL_VERSION}.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}
async function unseal(value, opts) {
  try {
    const parts = value.split(".");
    if (parts.length !== 3 || parts[0] !== SEAL_VERSION) return null;
    const iv = base64UrlToBytes(parts[1]);
    if (iv.length !== 12) return null;
    const ciphertext = base64UrlToBytes(parts[2]);
    if (ciphertext.length < 17) return null;
    const key = await deriveKey(opts.secret, opts.purpose);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(opts.aad) }, key, ciphertext);
    const payload = JSON.parse(decoder.decode(plain));
    if (!payload || payload.v !== 1 || typeof payload.exp !== "number") return null;
    if (payload.exp * 1e3 <= opts.now) return null;
    return payload.d;
  } catch {
    return null;
  }
}
var KDF_SALT, SEAL_VERSION, encoder, decoder, keyCache;
var init_crypto = __esm({
  "server/core/crypto.ts"() {
    KDF_SALT = "uiex-connector/cookie-kdf/v1";
    SEAL_VERSION = "v1";
    encoder = new TextEncoder();
    decoder = new TextDecoder();
    keyCache = /* @__PURE__ */ new Map();
  }
});

// server/core/session.ts
function toWire(d) {
  const w = { a: d.accessToken, r: d.refreshToken, e: d.expiresAt, p: d.portalId, h: d.hubDomain, m: d.userEmail, s: d.scopes.join(" "), x: d.appHost };
  if (d.userId !== void 0) w.u = d.userId;
  if (d.personalAccessKey) w.k = d.personalAccessKey;
  return w;
}
function fromWire(w) {
  if (!w || typeof w !== "object") return null;
  const o = w;
  if (typeof o.a !== "string" || typeof o.r !== "string" || typeof o.e !== "number" || typeof o.p !== "number") return null;
  const data = {
    accessToken: o.a,
    refreshToken: o.r,
    expiresAt: o.e,
    portalId: o.p,
    hubDomain: typeof o.h === "string" ? o.h : "",
    userEmail: typeof o.m === "string" ? o.m : "",
    scopes: typeof o.s === "string" && o.s ? o.s.split(" ") : [],
    appHost: typeof o.x === "string" && o.x ? o.x : "app.hubspot.com"
  };
  if (typeof o.u === "number") data.userId = o.u;
  if (typeof o.k === "string" && o.k) data.personalAccessKey = o.k;
  return data;
}
function sessionSecretUsable(config) {
  return typeof config.sessionSecret === "string" && config.sessionSecret.length >= MIN_SESSION_SECRET_LENGTH;
}
var SESSION_COOKIE, OAUTH_COOKIE, SESSION_TTL_SECONDS, OAUTH_TTL_SECONDS, MAX_COOKIE_BYTES, CookieSession;
var init_session = __esm({
  "server/core/session.ts"() {
    init_cookies();
    init_crypto();
    init_config();
    SESSION_COOKIE = "uiex_session";
    OAUTH_COOKIE = "uiex_oauth";
    SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
    OAUTH_TTL_SECONDS = 10 * 60;
    MAX_COOKIE_BYTES = 4096;
    CookieSession = class {
      constructor(request, config) {
        this.config = config;
        this.cookies = parseCookies(request.headers.get("cookie"));
      }
      config;
      loaded = false;
      data = null;
      /** True when the request carried a session cookie that could not be read (tampered / old / expired). */
      invalidCookie = false;
      cookies;
      outgoing = /* @__PURE__ */ new Map();
      /** Tokens this request has seen (redacted from logs and error messages). */
      secrets = /* @__PURE__ */ new Set();
      cookieOptions(maxAge, path2 = "/") {
        return { httpOnly: true, secure: this.config.secureCookies, sameSite: "Lax", path: path2, maxAge };
      }
      async get() {
        if (this.loaded) return this.data;
        this.loaded = true;
        const raw = this.cookies.get(SESSION_COOKIE);
        if (!raw) return null;
        if (!sessionSecretUsable(this.config)) {
          this.invalidCookie = true;
          return null;
        }
        const wire = await unseal(raw, { secret: this.config.sessionSecret, purpose: "session", aad: SESSION_COOKIE, now: this.config.now() });
        const data = fromWire(wire);
        if (!data) {
          this.invalidCookie = true;
          this.clear();
          return null;
        }
        this.remember(data);
        this.data = data;
        return data;
      }
      remember(data) {
        for (const s of [data.accessToken, data.refreshToken, data.personalAccessKey]) if (s) this.secrets.add(s);
      }
      /** Every token read from or written to the session during this request. */
      knownSecrets() {
        return [...this.secrets];
      }
      async set(data) {
        if (!sessionSecretUsable(this.config)) throw new Error("SESSION_SECRET is not configured");
        const value = await seal(toWire(data), {
          secret: this.config.sessionSecret,
          purpose: "session",
          aad: SESSION_COOKIE,
          now: this.config.now(),
          ttlSeconds: SESSION_TTL_SECONDS
        });
        const cookie = serializeCookie(SESSION_COOKIE, value, this.cookieOptions(SESSION_TTL_SECONDS));
        if (new TextEncoder().encode(cookie).length > MAX_COOKIE_BYTES) {
          throw new Error("session cookie would exceed 4 KB");
        }
        this.outgoing.set(SESSION_COOKIE, cookie);
        this.remember(data);
        this.data = data;
        this.loaded = true;
      }
      clear() {
        this.outgoing.set(SESSION_COOKIE, serializeCookie(SESSION_COOKIE, "", this.cookieOptions(0)));
        this.data = null;
        this.loaded = true;
      }
      /** OAuth state cookie (scoped to /api/auth). */
      async getOAuthState() {
        const raw = this.cookies.get(OAUTH_COOKIE);
        if (!raw || !sessionSecretUsable(this.config)) return null;
        const data = await unseal(raw, { secret: this.config.sessionSecret, purpose: "oauth-state", aad: OAUTH_COOKIE, now: this.config.now() });
        if (!data || typeof data.state !== "string" || typeof data.returnTo !== "string") return null;
        return { state: data.state, returnTo: data.returnTo, mode: data.mode === "redirect" ? "redirect" : "popup" };
      }
      async setOAuthState(data) {
        const value = await seal(data, {
          secret: this.config.sessionSecret,
          purpose: "oauth-state",
          aad: OAUTH_COOKIE,
          now: this.config.now(),
          ttlSeconds: OAUTH_TTL_SECONDS
        });
        this.outgoing.set(OAUTH_COOKIE, serializeCookie(OAUTH_COOKIE, value, this.cookieOptions(OAUTH_TTL_SECONDS, "/api/auth")));
      }
      clearOAuthState() {
        this.outgoing.set(OAUTH_COOKIE, serializeCookie(OAUTH_COOKIE, "", this.cookieOptions(0, "/api/auth")));
      }
      hasOAuthCookie() {
        return this.cookies.has(OAUTH_COOKIE);
      }
      /** Set-Cookie header values to add to the response. */
      setCookieHeaders() {
        return [...this.outgoing.values()];
      }
    };
  }
});

// src/connect/types.ts
var CONNECTOR_ROUTES, CSRF_HEADER2;
var init_types2 = __esm({
  "src/connect/types.ts"() {
    CONNECTOR_ROUTES = {
      health: "/api/health",
      // GET  -> ConnectorHealth (no auth)
      authStart: "/api/auth/start",
      // GET  (browser navigation, opened in a popup) ?returnTo=<origin>
      authCallback: "/api/auth/callback",
      // GET  (HubSpot redirects here) -> HTML that notifies the opener
      logout: "/api/auth/logout",
      // POST -> { ok: true }
      me: "/api/me",
      // GET  -> ConnectionInfo
      objectTypes: "/api/crm/object-types",
      // GET  -> CrmObjectTypeInfo[]
      properties: "/api/crm/properties/:objectType",
      // GET  -> CrmPropertyDef[]
      pipelines: "/api/crm/pipelines/:objectType",
      // GET  -> CrmPipeline[]
      owners: "/api/crm/owners",
      // GET  -> CrmOwner[]
      searchRecords: "/api/crm/records/:objectType/search",
      // GET ?q=&limit= -> CrmRecordSummary[] (record picker)
      record: "/api/crm/records/:objectType/:id",
      // GET ?properties=a,b&formatted=1 -> CrmRecord
      associations: "/api/crm/records/:objectType/:id/associations/:toObjectType",
      // GET ?properties=&limit= -> AssociationResultDTO[]
      search: "/api/crm/search/:objectType",
      // POST CrmSearchRequestDTO -> CrmSearchResponseDTO
      proxyFetch: "/api/proxy/fetch",
      // POST ProxyFetchRequest -> ProxyFetchResponse (preview of hubspot.fetch)
      deployStart: "/api/deploy",
      // POST DeployRequest -> DeployStatus (beta)
      deployStatus: "/api/deploy/:deployId",
      // GET -> DeployStatus
      deployKey: "/api/deploy/key"
      // GET -> DeployKeyInfo; DELETE -> forget the remembered key -> DeployKeyInfo
    };
    CSRF_HEADER2 = "X-UIEX-Request";
  }
});

// server/core/oauth.ts
function redirectUri(config) {
  return `${config.appUrl}${CONNECTOR_ROUTES.authCallback}`;
}
function authorizeUrl(config, state) {
  const q = [
    ["client_id", config.hubspotClientId],
    ["redirect_uri", redirectUri(config)],
    ["scope", config.requiredScopes.join(" ")]
  ];
  if (config.optionalScopes.length > 0) q.push(["optional_scope", config.optionalScopes.join(" ")]);
  q.push(["state", state]);
  return `${config.hubspotAppBase}/oauth/authorize?${q.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}
async function fetchWithTimeout(config, url, init, timeoutMs = HUBSPOT_CALL_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await config.fetch(url, { ...init, signal: controller.signal, redirect: init.redirect ?? "follow" });
  } finally {
    clearTimeout(timer);
  }
}
async function readJson(res) {
  try {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}
async function tokenRequest(config, params) {
  const body = new URLSearchParams({ ...params, client_id: config.hubspotClientId, client_secret: config.hubspotClientSecret });
  let res;
  try {
    res = await fetchWithTimeout(config, `${config.hubspotApiBase}/oauth/v1/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8", Accept: "application/json" },
      body: body.toString()
    });
  } catch {
    throw new OAuthError("Couldn't reach HubSpot to finish signing in.", 502, false);
  }
  const data = await readJson(res);
  if (!res.ok) {
    const hsStatus = typeof data?.status === "string" ? data.status : void 0;
    const oauthError = typeof data?.error === "string" ? data.error : void 0;
    const revoked = res.status === 400 || res.status === 401 || oauthError === "invalid_grant";
    throw new OAuthError("HubSpot did not accept the sign-in.", res.status, revoked, hsStatus ?? oauthError);
  }
  if (!data || typeof data.access_token !== "string" || typeof data.expires_in !== "number") {
    throw new OAuthError("HubSpot sent an unexpected sign-in response.", 502, false);
  }
  return {
    access_token: data.access_token,
    refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : "",
    expires_in: data.expires_in
  };
}
function exchangeCode(config, code) {
  return tokenRequest(config, { grant_type: "authorization_code", redirect_uri: redirectUri(config), code });
}
function refreshAccessToken(config, refreshToken) {
  return tokenRequest(config, { grant_type: "refresh_token", redirect_uri: redirectUri(config), refresh_token: refreshToken });
}
async function getTokenInfo(config, accessToken) {
  let res;
  try {
    res = await fetchWithTimeout(config, `${config.hubspotApiBase}/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`, {
      method: "GET",
      headers: { Accept: "application/json" }
    });
  } catch {
    throw new OAuthError("Couldn't reach HubSpot to read the account details.", 502, false);
  }
  const data = await readJson(res);
  if (!res.ok || !data || typeof data.hub_id !== "number") {
    throw new OAuthError("HubSpot didn't return the account details.", res.ok ? 502 : res.status, res.status === 400 || res.status === 404);
  }
  return {
    user: typeof data.user === "string" ? data.user : void 0,
    user_id: typeof data.user_id === "number" ? data.user_id : void 0,
    hub_id: data.hub_id,
    hub_domain: typeof data.hub_domain === "string" ? data.hub_domain : void 0,
    scopes: Array.isArray(data.scopes) ? data.scopes.filter((s) => typeof s === "string") : void 0,
    expires_in: typeof data.expires_in === "number" ? data.expires_in : void 0
  };
}
async function revokeRefreshToken(config, refreshToken) {
  if (!refreshToken) return false;
  try {
    const res = await fetchWithTimeout(
      config,
      `${config.hubspotApiBase}/oauth/v1/refresh-tokens/${encodeURIComponent(refreshToken)}`,
      { method: "DELETE" },
      5e3
    );
    return res.ok;
  } catch {
    return false;
  }
}
function appHostFor(hints) {
  const fromToken = /^(?:pat-)?([a-z]{2}\d)-/i.exec(hints.refreshToken ?? "")?.[1]?.toLowerCase();
  if (fromToken && fromToken !== "na1") return `app-${fromToken}.hubspot.com`;
  const domain = (hints.hubDomain ?? "").toLowerCase();
  const fromDomain = /(?:^|[.-])(eu\d)(?:[.-]|$)/.exec(domain)?.[1];
  if (fromDomain) return `app-${fromDomain}.hubspot.com`;
  try {
    const host = new URL(hints.apiBase ?? "").hostname.toLowerCase();
    const fromApi = /(?:^|[.-])(eu\d)(?:[.-]|$)/.exec(host)?.[1];
    if (fromApi) return `app-${fromApi}.hubspot.com`;
  } catch {
  }
  return "app.hubspot.com";
}
function buildSessionData(config, tokens, info, previous) {
  const refreshToken = tokens.refresh_token || previous?.refreshToken || "";
  const hubDomain = info.hub_domain ?? previous?.hubDomain ?? "";
  const data = {
    accessToken: tokens.access_token,
    refreshToken,
    expiresAt: config.now() + tokens.expires_in * 1e3,
    portalId: info.hub_id,
    hubDomain,
    userEmail: info.user ?? previous?.userEmail ?? "",
    scopes: info.scopes ?? previous?.scopes ?? [],
    appHost: appHostFor({ refreshToken, hubDomain, apiBase: config.hubspotApiBase })
  };
  const userId = info.user_id ?? previous?.userId;
  if (userId !== void 0) data.userId = userId;
  if (previous?.personalAccessKey) data.personalAccessKey = previous.personalAccessKey;
  return data;
}
async function refreshSessionData(config, data) {
  const tokens = await refreshAccessToken(config, data.refreshToken);
  return {
    ...data,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || data.refreshToken,
    expiresAt: config.now() + tokens.expires_in * 1e3
  };
}
function needsRefresh(config, data) {
  return data.expiresAt - REFRESH_MARGIN_MS < config.now();
}
var HUBSPOT_CALL_TIMEOUT_MS, OAuthError, REFRESH_MARGIN_MS;
var init_oauth = __esm({
  "server/core/oauth.ts"() {
    init_types2();
    HUBSPOT_CALL_TIMEOUT_MS = 1e4;
    OAuthError = class extends Error {
      constructor(message, status, revoked, hubspotStatus) {
        super(message);
        this.status = status;
        this.revoked = revoked;
        this.hubspotStatus = hubspotStatus;
        this.name = "OAuthError";
      }
      status;
      revoked;
      hubspotStatus;
    };
    REFRESH_MARGIN_MS = 6e4;
  }
});

// server/core/hubspot.ts
function missingScopeMessage(scopes) {
  if (scopes.length === 0) {
    return "Your HubSpot connection doesn't include permission for this. Disconnect, connect again and approve all the requested access.";
  }
  const what = [...new Set(scopes.map((s) => SCOPE_FRIENDLY[s] ?? s))].join(", ");
  return `Your HubSpot connection doesn't include permission to read ${what}. Disconnect, connect again and approve access to ${what} (scope: ${scopes.join(", ")}).`;
}
function collectRequiredScopes(body) {
  const out = [];
  const add = (v) => {
    if (Array.isArray(v)) {
      for (const s of v) if (typeof s === "string" && !out.includes(s)) out.push(s);
    }
  };
  for (const e of body?.errors ?? []) {
    add(e.context?.requiredGranularScopes);
    add(e.context?.requiredScopes);
  }
  add(body?.context?.requiredGranularScopes);
  add(body?.context?.requiredScopes);
  return out;
}
function parseRetryAfter(value) {
  if (!value) return 1;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1e3));
  return 1;
}
function mapHubSpotError(status, body, retryAfter) {
  const correlationId = body?.correlationId;
  const hsMessage = typeof body?.message === "string" ? body.message.slice(0, 500) : "";
  if (status === 401) {
    return new HubSpotApiError("Your HubSpot sign-in has expired. Connect HubSpot again.", 401, "not_connected", correlationId);
  }
  if (status === 403) {
    const required = collectRequiredScopes(body);
    if (body?.category === "MISSING_SCOPES" || required.length > 0) {
      return new HubSpotApiError(missingScopeMessage(required), 403, "missing_scope", correlationId, required);
    }
    return new HubSpotApiError(hsMessage || "HubSpot says you don't have access to this.", 403, "forbidden", correlationId);
  }
  if (status === 404) {
    return new HubSpotApiError("HubSpot couldn't find that \u2014 it may have been deleted, or it isn't in this account.", 404, "not_found", correlationId);
  }
  if (status === 429) {
    const secs = parseRetryAfter(retryAfter ?? null);
    return new RateLimitedError(`HubSpot is receiving too many requests right now. Please wait ${Math.max(1, Math.ceil(secs))} seconds and try again.`, Math.max(1, Math.ceil(secs)), correlationId);
  }
  if (status === 400 || status === 409 || status === 422) {
    return new HubSpotApiError(hsMessage ? `HubSpot couldn't process the request: ${hsMessage}` : "HubSpot couldn't process the request.", 400, "bad_request", correlationId);
  }
  return new HubSpotApiError("HubSpot had a problem answering. Please try again in a moment.", 502, "hubspot_error", correlationId);
}
function revokedError() {
  return new HubSpotApiError("Your HubSpot connection was removed or has expired. Connect HubSpot again.", 401, "not_connected");
}
async function readErrorJson(res) {
  try {
    const text = await res.text();
    if (!text) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}
var MAX_RETRY_WAIT_MS, SCOPE_FRIENDLY, SessionHubSpotApi;
var init_hubspot = __esm({
  "server/core/hubspot.ts"() {
    init_types();
    init_http();
    init_oauth();
    MAX_RETRY_WAIT_MS = 2e3;
    SCOPE_FRIENDLY = {
      tickets: "tickets",
      "crm.objects.contacts.read": "contacts",
      "crm.objects.companies.read": "companies",
      "crm.objects.deals.read": "deals",
      "crm.objects.custom.read": "custom objects",
      "crm.schemas.custom.read": "custom object definitions",
      "crm.objects.owners.read": "record owners",
      "crm.objects.line_items.read": "line items",
      "crm.objects.products.read": "products",
      "crm.objects.quotes.read": "quotes",
      "crm.schemas.contacts.read": "contact properties",
      "crm.schemas.companies.read": "company properties",
      "crm.schemas.deals.read": "deal properties"
    };
    SessionHubSpotApi = class {
      constructor(config, session, data, opts = {}) {
        this.config = config;
        this.session = session;
        this.data = data;
        this.sleep = opts.sleep ?? sleep;
        this.timeoutMs = opts.timeoutMs ?? HUBSPOT_CALL_TIMEOUT_MS;
      }
      config;
      session;
      data;
      refreshing = null;
      sleep;
      timeoutMs;
      get current() {
        return this.data;
      }
      /** Refresh tokens (deduplicated within the request) and persist them in the cookie. */
      async refresh() {
        if (!this.refreshing) {
          this.refreshing = (async () => {
            try {
              const next = await refreshSessionData(this.config, this.data);
              this.data = next;
              await this.session.set(next);
              return next;
            } catch (err) {
              if (err instanceof OAuthError && err.revoked) {
                this.session.clear();
                throw revokedError();
              }
              throw new HubSpotApiError("Couldn't renew your HubSpot sign-in right now. Please try again in a moment.", 502, "hubspot_error");
            } finally {
              queueMicrotask(() => {
                this.refreshing = null;
              });
            }
          })();
        }
        return this.refreshing;
      }
      async ensureFresh() {
        if (needsRefresh(this.config, this.data)) return this.refresh();
        return this.data;
      }
      async request(method, path2, init = {}) {
        await this.ensureFresh();
        const url = new URL(`${this.config.hubspotApiBase}${path2.startsWith("/") ? path2 : `/${path2}`}`);
        for (const [k, v] of Object.entries(init.query ?? {})) {
          if (v !== void 0 && v !== "") url.searchParams.set(k, String(v));
        }
        let refreshed = false;
        let retried429 = false;
        for (; ; ) {
          const res = await this.send(method, url.toString(), init.body);
          if (res.ok) {
            if (res.status === 204) return void 0;
            const text = await res.text();
            if (!text) return void 0;
            try {
              return JSON.parse(text);
            } catch {
              throw new HubSpotApiError("HubSpot sent a response the connector could not read.", 502, "hubspot_error");
            }
          }
          const body = await readErrorJson(res);
          if (res.status === 401 && !refreshed) {
            refreshed = true;
            await this.refresh();
            continue;
          }
          if (res.status === 429 && !retried429) {
            retried429 = true;
            const waitMs = Math.min(MAX_RETRY_WAIT_MS, parseRetryAfter(res.headers.get("retry-after")) * 1e3);
            await this.sleep(waitMs);
            continue;
          }
          if (res.status === 401) {
            this.session.clear();
            throw revokedError();
          }
          throw mapHubSpotError(res.status, body, res.headers.get("retry-after"));
        }
      }
      async send(method, url, body) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        const headers = { Authorization: `Bearer ${this.data.accessToken}`, Accept: "application/json" };
        if (body !== void 0) headers["Content-Type"] = "application/json";
        try {
          return await this.config.fetch(url, {
            method,
            headers,
            body: body === void 0 ? void 0 : JSON.stringify(body),
            signal: controller.signal
          });
        } catch (err) {
          if (controller.signal.aborted) {
            throw new HubSpotApiError("HubSpot took too long to answer. Please try again.", 504, "timeout");
          }
          void err;
          throw new HubSpotApiError("Couldn't reach HubSpot. Check the connection and try again.", 502, "hubspot_unreachable");
        } finally {
          clearTimeout(timer);
        }
      }
    };
  }
});

// server/core/security.ts
function trustedOrigins(config) {
  return [config.appUrl, ...config.allowedOrigins].filter(Boolean);
}
function isTrustedOrigin(config, origin) {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  if (!normalized || normalized !== origin.replace(/\/+$/, "")) return false;
  return trustedOrigins(config).includes(normalized);
}
function assertCsrf(config, request) {
  const origin = request.headers.get("origin");
  if (origin !== null && !isTrustedOrigin(config, origin)) {
    throw new ConnectorError(403, "forbidden_origin", "This website is not allowed to use the HubSpot connector.");
  }
  const marker = request.headers.get(CSRF_HEADER2);
  if (!marker || !marker.trim()) {
    throw new ConnectorError(403, "csrf", `Missing ${CSRF_HEADER2} header. Requests must come from the builder.`);
  }
  const site = request.headers.get("sec-fetch-site");
  if (origin === null && site === "cross-site") {
    throw new ConnectorError(403, "forbidden_origin", "This website is not allowed to use the HubSpot connector.");
  }
}
function corsHeaders(config, request) {
  const origin = request.headers.get("origin");
  if (!origin || !config.allowedOrigins.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin"
  };
}
function preflightResponse(config, request) {
  const cors = corsHeaders(config, request);
  if (!cors["Access-Control-Allow-Origin"]) {
    return new Response(null, { status: 403, headers: { Vary: "Origin" } });
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      "Access-Control-Allow-Methods": "GET, POST, DELETE",
      "Access-Control-Allow-Headers": `Content-Type, ${CSRF_HEADER2}`,
      "Access-Control-Max-Age": "600"
    }
  });
}
function validateReturnTo(config, raw) {
  if (raw === null || raw === void 0 || raw === "") return config.appUrl || null;
  if (raw.length > 2048) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  if (!trustedOrigins(config).includes(url.origin)) return null;
  if (url.pathname === "/" && !url.search && !url.hash) return url.origin;
  return url.href;
}
var init_security = __esm({
  "server/core/security.ts"() {
    init_types2();
    init_http();
    init_config();
  }
});

// server/core/authPage.ts
async function renderAuthPage(opts) {
  const msg = { type: AUTH_MESSAGE_TYPE, ok: opts.ok };
  if (!opts.ok) {
    msg.error = opts.errorCode ?? "unknown_error";
    msg.message = opts.message;
  }
  const script = `(function(){var m=${scriptSafeJson(msg)};var o=${scriptSafeJson(opts.targetOrigin)};var sent=false;try{if(o&&window.opener&&!window.opener.closed){window.opener.postMessage(m,o);sent=true}}catch(e){}try{if(typeof BroadcastChannel==="function"){var c=new BroadcastChannel(${scriptSafeJson(AUTH_BROADCAST_CHANNEL)});c.postMessage(m);c.close();sent=true}}catch(e){}var b=document.getElementById("close");if(b){b.addEventListener("click",function(){window.close()})}if(m.ok&&sent){setTimeout(function(){window.close()},150)}})();`;
  const [scriptHash, styleHash] = await Promise.all([sha256Base64(script), sha256Base64(STYLE)]);
  const back = opts.returnTo ? `<a class="button secondary" href="${escapeHtml(opts.returnTo)}">Back to the builder</a>` : "";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(opts.title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main class="${opts.ok ? "ok" : "err"}" role="main" aria-live="polite">
<div class="icon" aria-hidden="true">${opts.ok ? "&#10003;" : "&#9888;"}</div>
<h1>${escapeHtml(opts.title)}</h1>
<p>${escapeHtml(opts.message)}</p>
<div class="actions"><button type="button" id="close">Close this window</button>${back}</div>
</main>
<script>${script}</script>
</body>
</html>`;
  return new Response(html, {
    status: opts.status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
    }
  });
}
function describeAuthError(code) {
  switch (code) {
    case "access_denied":
      return { title: "HubSpot was not connected", message: "You chose not to give the builder access. Nothing was shared. You can close this window and try again whenever you like." };
    case "state_mismatch":
    case "state_missing":
      return {
        title: "Sign-in expired",
        message: "This sign-in took too long or was started in another window. Close this window and click \u201CConnect HubSpot\u201D again."
      };
    case "invalid_scope":
      return { title: "HubSpot refused the requested access", message: "The builder asked for permissions this HubSpot app isn't set up for. Ask whoever hosts the builder to check the app's scopes." };
    case "token_exchange_failed":
      return { title: "Couldn't finish connecting", message: "HubSpot didn't accept the sign-in. Close this window and try again. If it keeps happening, ask whoever hosts the builder to check the app settings." };
    case "hubspot_unreachable":
      return { title: "Couldn't reach HubSpot", message: "HubSpot did not respond. Check your internet connection, close this window and try again." };
    case "not_configured":
      return { title: "Sign in with HubSpot is not set up", message: "This server isn't configured for HubSpot sign-in yet." };
    case "bad_return_to":
      return { title: "This sign-in link is not valid", message: "Open the builder and click \u201CConnect HubSpot\u201D from there." };
    default:
      return { title: "Couldn't connect HubSpot", message: "Something went wrong while connecting. Close this window and try again." };
  }
}
var AUTH_MESSAGE_TYPE, AUTH_BROADCAST_CHANNEL, STYLE;
var init_authPage = __esm({
  "server/core/authPage.ts"() {
    init_http();
    init_crypto();
    AUTH_MESSAGE_TYPE = "uiex-hubspot-auth";
    AUTH_BROADCAST_CHANNEL = "uiex-hubspot-auth";
    STYLE = `
:root{color-scheme:light dark;--bg:#f5f8fa;--card:#fff;--text:#33475b;--muted:#516f90;--accent:#ff7a59;--ok:#00a38d;--err:#d93f4c;--border:#cbd6e2}
@media (prefers-color-scheme:dark){:root{--bg:#1d2733;--card:#26323f;--text:#eaf0f6;--muted:#b0c1d4;--border:#3e5165}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:16px}
main{background:var(--card);border:1px solid var(--border);border-radius:8px;max-width:440px;width:100%;padding:28px 24px;text-align:center}
h1{font-size:20px;margin:0 0 8px}
p{margin:0 0 16px;color:var(--muted)}
.icon{font-size:32px;line-height:1;margin-bottom:12px}
.ok .icon{color:var(--ok)}
.err .icon{color:var(--err)}
.actions{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
button,a.button{appearance:none;border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:4px;padding:8px 16px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
a.button.secondary{background:transparent;color:var(--text);border-color:var(--border)}
button:focus-visible,a.button:focus-visible{outline:3px solid #0091ae;outline-offset:2px}
`.trim();
  }
});

// server/core/routes/auth.ts
function cookieSession(ctx) {
  if (!(ctx.session instanceof CookieSession)) throw new Error("cookie session required");
  return ctx.session;
}
function wantsHtml(request) {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html") || accept === "" || accept.includes("*/*") && !accept.includes("application/json");
}
function originOf(url) {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
function withAuthResult(returnTo, result) {
  const url = new URL(returnTo);
  url.searchParams.set("uiex_auth", result);
  return url.toString();
}
function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location } });
}
function authRoutes(status) {
  const notConfigured = async (ctx, returnTo) => {
    const message = notConfiguredMessage(status);
    if (ctx.request.method === "GET" && wantsHtml(ctx.request)) {
      return renderAuthPage({
        status: 503,
        ok: false,
        title: describeAuthError("not_configured").title,
        message,
        targetOrigin: originOf(returnTo),
        returnTo,
        errorCode: "not_configured"
      });
    }
    return errorJson(503, "not_configured", message);
  };
  const start = {
    method: "GET",
    path: CONNECTOR_ROUTES.authStart,
    csrf: false,
    handler: async (ctx) => {
      const { config, url } = ctx;
      const rawReturnTo = url.searchParams.get("returnTo");
      const returnTo = validateReturnTo(config, rawReturnTo);
      if (!status.oauthConfigured) return notConfigured(ctx, returnTo);
      if (!returnTo) {
        const d = describeAuthError("bad_return_to");
        return renderAuthPage({ status: 400, ok: false, title: d.title, message: d.message, targetOrigin: null, returnTo: config.appUrl, errorCode: "bad_return_to" });
      }
      const mode = url.searchParams.get("mode") === "redirect" ? "redirect" : "popup";
      const state = randomToken(32);
      await cookieSession(ctx).setOAuthState({ state, returnTo, mode });
      return redirect(authorizeUrl(config, state));
    }
  };
  const callback = {
    method: "GET",
    path: CONNECTOR_ROUTES.authCallback,
    csrf: false,
    handler: async (ctx) => {
      const { config, url } = ctx;
      const session = cookieSession(ctx);
      if (!status.oauthConfigured) return notConfigured(ctx, config.appUrl || null);
      const saved = await session.getOAuthState();
      session.clearOAuthState();
      const returnTo = saved ? validateReturnTo(config, saved.returnTo) ?? config.appUrl : config.appUrl;
      const targetOrigin = originOf(returnTo);
      const mode = saved?.mode ?? "popup";
      const fail2 = async (code2, httpStatus = 400, detail) => {
        if (mode === "redirect" && returnTo) return redirect(withAuthResult(returnTo, code2));
        const d = describeAuthError(code2);
        return renderAuthPage({ status: httpStatus, ok: false, title: d.title, message: detail ?? d.message, targetOrigin, returnTo, errorCode: code2 });
      };
      const stateParam = url.searchParams.get("state") ?? "";
      const errorParam = url.searchParams.get("error");
      if (!saved) return fail2("state_missing");
      if (!stateParam || !timingSafeEqual(stateParam, saved.state)) return fail2("state_mismatch");
      if (errorParam) {
        const code2 = /^[a-z_]{1,64}$/.test(errorParam) ? errorParam : "oauth_error";
        return fail2(code2);
      }
      const code = url.searchParams.get("code");
      if (!code || code.length > 2048) return fail2("token_exchange_failed");
      let data;
      try {
        const tokens = await exchangeCode(config, code);
        const info = await getTokenInfo(config, tokens.access_token);
        data = buildSessionData(config, tokens, info);
      } catch (err) {
        if (err instanceof OAuthError && !err.revoked && err.status >= 500) return fail2("hubspot_unreachable", 502);
        return fail2("token_exchange_failed");
      }
      await session.set(data);
      if (mode === "redirect" && returnTo) return redirect(withAuthResult(returnTo, "connected"));
      return renderAuthPage({
        status: 200,
        ok: true,
        title: "HubSpot is connected",
        message: "You can close this window and go back to the builder.",
        targetOrigin,
        returnTo
      });
    }
  };
  const logout = {
    method: "POST",
    path: CONNECTOR_ROUTES.logout,
    handler: async (ctx) => {
      if (!status.oauthConfigured) return notConfigured(ctx, null);
      const data = await ctx.session.get();
      if (data?.refreshToken) await revokeRefreshToken(ctx.config, data.refreshToken);
      ctx.session.clear();
      return json({ ok: true });
    }
  };
  const me = {
    method: "GET",
    path: CONNECTOR_ROUTES.me,
    handler: async (ctx) => {
      const signedOut = { connected: false, reason: "signed-out" };
      if (!status.oauthConfigured) return json(signedOut);
      let data = await ctx.session.get();
      if (!data) return json(signedOut);
      if (needsRefresh(ctx.config, data)) {
        try {
          data = await refreshSessionData(ctx.config, data);
          await ctx.session.set(data);
        } catch (err) {
          if (err instanceof OAuthError && err.revoked) {
            ctx.session.clear();
            return json({ connected: false, reason: "revoked" });
          }
          throw new ConnectorError(502, "hubspot_unreachable", "Couldn't reach HubSpot to renew your sign-in. Please try again in a moment.");
        }
      }
      const info = {
        connected: true,
        portalId: data.portalId,
        hubDomain: data.hubDomain,
        user: data.userId !== void 0 ? { id: data.userId, email: data.userEmail } : { email: data.userEmail },
        scopes: data.scopes,
        expiresAt: data.expiresAt,
        appHost: data.appHost
      };
      return json(info);
    }
  };
  const health = {
    method: "GET",
    path: CONNECTOR_ROUTES.health,
    handler: (ctx) => {
      const { config } = ctx;
      const body = {
        ok: true,
        version: config.version,
        oauthConfigured: status.oauthConfigured,
        features: {
          crm: status.oauthConfigured,
          fetchProxy: status.oauthConfigured && config.enableFetchProxy,
          deploy: config.enableDeploy
        },
        scopes: { required: [...config.requiredScopes], optional: [...config.optionalScopes] }
      };
      return json(body);
    }
  };
  return [health, start, callback, logout, me];
}
var init_auth = __esm({
  "server/core/routes/auth.ts"() {
    init_types2();
    init_http();
    init_config();
    init_session();
    init_crypto();
    init_security();
    init_oauth();
    init_authPage();
  }
});

// server/core/objectTypes.ts
function findStandardObjectType(input) {
  return STANDARD_BY_KEY.get(input.toLowerCase());
}
function assertObjectTypeParam(value, what = "object type") {
  if (!value || value.length > 100 || !OBJECT_TYPE_PATTERN.test(value)) {
    throw new ConnectorError(400, "bad_request", `"${(value ?? "").slice(0, 40)}" isn't a valid ${what}.`);
  }
  return value;
}
function standardInfo(t) {
  return {
    objectType: t.objectType,
    objectTypeId: t.objectTypeId,
    label: t.label,
    pluralLabel: t.pluralLabel,
    primaryDisplayProperty: t.primaryDisplayProperty,
    secondaryDisplayProperties: [...t.secondaryDisplayProperties],
    custom: false
  };
}
function schemaInfo(s) {
  const singular = s.labels?.singular || s.name;
  return {
    objectType: `p_${s.name}`,
    objectTypeId: s.objectTypeId,
    label: singular,
    pluralLabel: s.labels?.plural || singular,
    primaryDisplayProperty: s.primaryDisplayProperty || "hs_object_id",
    secondaryDisplayProperties: Array.isArray(s.secondaryDisplayProperties) ? s.secondaryDisplayProperties.filter((p) => typeof p === "string") : [],
    custom: true
  };
}
var STANDARD_OBJECT_TYPES, STANDARD_BY_KEY, OBJECT_TYPE_PATTERN, ObjectTypeResolver;
var init_objectTypes = __esm({
  "server/core/objectTypes.ts"() {
    init_types();
    init_http();
    STANDARD_OBJECT_TYPES = [
      { objectType: "contacts", objectTypeId: "0-1", label: "Contact", pluralLabel: "Contacts", primaryDisplayProperty: "firstname", secondaryDisplayProperties: ["email"], labelProperties: ["firstname", "lastname"], aliases: ["contact"] },
      { objectType: "companies", objectTypeId: "0-2", label: "Company", pluralLabel: "Companies", primaryDisplayProperty: "name", secondaryDisplayProperties: ["domain"], aliases: ["company"] },
      { objectType: "deals", objectTypeId: "0-3", label: "Deal", pluralLabel: "Deals", primaryDisplayProperty: "dealname", secondaryDisplayProperties: ["amount"], hasPipelines: true, aliases: ["deal"] },
      { objectType: "tickets", objectTypeId: "0-5", label: "Ticket", pluralLabel: "Tickets", primaryDisplayProperty: "subject", secondaryDisplayProperties: ["hs_pipeline_stage"], hasPipelines: true, aliases: ["ticket"] },
      { objectType: "products", objectTypeId: "0-7", label: "Product", pluralLabel: "Products", primaryDisplayProperty: "name", secondaryDisplayProperties: ["price"], aliases: ["product"] },
      { objectType: "line_items", objectTypeId: "0-8", label: "Line item", pluralLabel: "Line items", primaryDisplayProperty: "name", secondaryDisplayProperties: ["price"], aliases: ["line_item"] },
      { objectType: "quotes", objectTypeId: "0-14", label: "Quote", pluralLabel: "Quotes", primaryDisplayProperty: "hs_title", secondaryDisplayProperties: ["hs_expiration_date"], aliases: ["quote"] },
      { objectType: "calls", objectTypeId: "0-48", label: "Call", pluralLabel: "Calls", primaryDisplayProperty: "hs_call_title", secondaryDisplayProperties: ["hs_timestamp"], aliases: ["call"] },
      { objectType: "meetings", objectTypeId: "0-47", label: "Meeting", pluralLabel: "Meetings", primaryDisplayProperty: "hs_meeting_title", secondaryDisplayProperties: ["hs_meeting_start_time"], aliases: ["meeting"] },
      { objectType: "tasks", objectTypeId: "0-27", label: "Task", pluralLabel: "Tasks", primaryDisplayProperty: "hs_task_subject", secondaryDisplayProperties: ["hs_task_status"], aliases: ["task"] },
      { objectType: "notes", objectTypeId: "0-46", label: "Note", pluralLabel: "Notes", primaryDisplayProperty: "hs_note_body", secondaryDisplayProperties: ["hs_timestamp"], aliases: ["note"] },
      { objectType: "emails", objectTypeId: "0-49", label: "Email", pluralLabel: "Emails", primaryDisplayProperty: "hs_email_subject", secondaryDisplayProperties: ["hs_timestamp"], aliases: ["email"] },
      { objectType: "invoices", objectTypeId: "0-53", label: "Invoice", pluralLabel: "Invoices", primaryDisplayProperty: "hs_number", secondaryDisplayProperties: ["hs_invoice_status"], aliases: ["invoice"] },
      { objectType: "orders", objectTypeId: "0-123", label: "Order", pluralLabel: "Orders", primaryDisplayProperty: "hs_order_name", secondaryDisplayProperties: ["hs_total_price"], hasPipelines: true, aliases: ["order"] },
      { objectType: "carts", objectTypeId: "0-142", label: "Cart", pluralLabel: "Carts", primaryDisplayProperty: "hs_cart_name", secondaryDisplayProperties: ["hs_total_price"], aliases: ["cart"] },
      { objectType: "subscriptions", objectTypeId: "0-69", label: "Subscription", pluralLabel: "Subscriptions", primaryDisplayProperty: "hs_name", secondaryDisplayProperties: ["hs_status"], aliases: ["subscription"] },
      { objectType: "leads", objectTypeId: "0-136", label: "Lead", pluralLabel: "Leads", primaryDisplayProperty: "hs_lead_name", secondaryDisplayProperties: ["hs_pipeline_stage"], hasPipelines: true, aliases: ["lead"] },
      { objectType: "appointments", objectTypeId: "0-421", label: "Appointment", pluralLabel: "Appointments", primaryDisplayProperty: "hs_appointment_name", secondaryDisplayProperties: ["hs_appointment_start"], hasPipelines: true, aliases: ["appointment"] },
      { objectType: "courses", objectTypeId: "0-410", label: "Course", pluralLabel: "Courses", primaryDisplayProperty: "hs_course_name", secondaryDisplayProperties: [], hasPipelines: true, aliases: ["course"] },
      { objectType: "listings", objectTypeId: "0-420", label: "Listing", pluralLabel: "Listings", primaryDisplayProperty: "hs_name", secondaryDisplayProperties: ["hs_price"], hasPipelines: true, aliases: ["listing"] },
      { objectType: "services", objectTypeId: "0-162", label: "Service", pluralLabel: "Services", primaryDisplayProperty: "hs_name", secondaryDisplayProperties: ["hs_pipeline_stage"], hasPipelines: true, aliases: ["service"] }
    ];
    STANDARD_BY_KEY = /* @__PURE__ */ new Map();
    for (const t of STANDARD_OBJECT_TYPES) {
      STANDARD_BY_KEY.set(t.objectType, t);
      STANDARD_BY_KEY.set(t.objectTypeId, t);
      for (const a of t.aliases ?? []) STANDARD_BY_KEY.set(a, t);
    }
    OBJECT_TYPE_PATTERN = /^[A-Za-z0-9_-]+$/;
    ObjectTypeResolver = class {
      constructor(api) {
        this.api = api;
      }
      api;
      schemas = null;
      /** Custom object schemas, or null when the connection lacks the custom-object scope. */
      loadSchemas() {
        if (!this.schemas) {
          this.schemas = this.api.request("GET", "/crm/v3/schemas").then((r) => (r?.results ?? []).filter((s) => s && typeof s.name === "string" && typeof s.objectTypeId === "string" && !s.archived)).catch((err) => {
            if (err instanceof HubSpotApiError && (err.code === "missing_scope" || err.code === "forbidden")) return null;
            throw err;
          });
        }
        return this.schemas;
      }
      async resolve(input) {
        assertObjectTypeParam(input);
        const std = findStandardObjectType(input);
        if (std) {
          return { objectType: std.objectType, objectTypeId: std.objectTypeId, apiPath: std.objectType, info: standardInfo(std), labelProperties: std.labelProperties ?? [std.primaryDisplayProperty] };
        }
        const isCustomId = /^2-\d+$/.test(input);
        const isCustomName = /^p\d*_/i.test(input);
        if (isCustomId || isCustomName) {
          const schemas = await this.loadSchemas();
          const lower = input.toLowerCase();
          const match = schemas?.find(
            (s) => s.objectTypeId === input || (s.fullyQualifiedName ?? "").toLowerCase() === lower || `p_${s.name}`.toLowerCase() === lower
          );
          if (match) {
            const info3 = schemaInfo(match);
            return { objectType: info3.objectType, objectTypeId: match.objectTypeId, apiPath: match.objectTypeId, info: info3, labelProperties: [info3.primaryDisplayProperty] };
          }
          if (schemas) {
            throw new ConnectorError(404, "not_found", `There's no custom object called "${input}" in this HubSpot account.`);
          }
          const info2 = {
            objectType: input,
            objectTypeId: input,
            label: input,
            pluralLabel: input,
            primaryDisplayProperty: "hs_object_id",
            secondaryDisplayProperties: [],
            custom: true
          };
          return { objectType: input, objectTypeId: input, apiPath: input, info: info2, labelProperties: ["hs_object_id"] };
        }
        const info = {
          objectType: input,
          objectTypeId: input,
          label: input,
          pluralLabel: input,
          primaryDisplayProperty: "hs_object_id",
          secondaryDisplayProperties: [],
          custom: false
        };
        return { objectType: input, objectTypeId: input, apiPath: input, info, labelProperties: ["hs_object_id"] };
      }
    };
  }
});

// server/core/format.ts
function toDate(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = /^-?\d+$/.test(trimmed) ? Number(trimmed) : Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}
function formatPropertyValue(value, def) {
  if (value === null || value === void 0 || !def) return value ?? null;
  if (value === "") return value;
  switch (def.type) {
    case "date": {
      const d = toDate(value);
      return d ? dateFormat.format(d) : value;
    }
    case "datetime": {
      const d = toDate(value);
      return d ? dateTimeFormat.format(d) : value;
    }
    case "number": {
      const n = Number(value);
      return value.trim() !== "" && Number.isFinite(n) ? numberFormat.format(n) : value;
    }
    case "enumeration":
    case "bool": {
      const options = def.options ?? [];
      const parts = value.split(";").filter((p) => p !== "");
      const labels = parts.map((part) => {
        const opt = options.find((o) => o.value === part);
        if (opt) return opt.label;
        if (def.type === "bool" || def.fieldType === "booleancheckbox") {
          if (part === "true") return "Yes";
          if (part === "false") return "No";
        }
        return part;
      });
      return labels.join(", ");
    }
    default:
      return value;
  }
}
function formatProperties(properties, defs) {
  const out = {};
  for (const [name, value] of Object.entries(properties)) {
    out[name] = formatPropertyValue(value, defs.get(name));
  }
  return out;
}
var dateFormat, dateTimeFormat, numberFormat;
var init_format = __esm({
  "server/core/format.ts"() {
    dateFormat = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
    dateTimeFormat = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short"
    });
    numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
  }
});

// server/core/routes/crm.ts
function assertPropertyName(name) {
  if (typeof name !== "string" || !PROPERTY_NAME.test(name)) {
    throw badRequest(`"${String(name).slice(0, 60)}" isn't a valid property name.`);
  }
  return name;
}
function parsePropertyList(values) {
  const out = [];
  for (const raw of values) {
    for (const part of raw.split(",")) {
      const name = part.trim();
      if (!name) continue;
      assertPropertyName(name);
      if (!out.includes(name)) out.push(name);
    }
  }
  if (out.length > MAX_PROPERTIES) throw badRequest(`Ask for at most ${MAX_PROPERTIES} properties at a time.`);
  return out;
}
function propertiesParam(ctx) {
  return parsePropertyList(ctx.url.searchParams.getAll("properties"));
}
function assertRecordId(id) {
  if (!id || !RECORD_ID.test(id)) throw badRequest(`"${(id ?? "").slice(0, 30)}" isn't a valid record ID (record IDs are numbers).`);
  return id;
}
function truthy(value) {
  return value === "1" || value === "true" || value === "yes";
}
function pick(props, names) {
  const out = {};
  for (const n of names) out[n] = props?.[n] ?? null;
  return out;
}
function normalizeProps(props) {
  const out = {};
  for (const [k, v] of Object.entries(props ?? {})) out[k] = v === null || v === void 0 ? null : String(v);
  return out;
}
function mapProperty(p) {
  const def = {
    name: p.name,
    label: p.label || p.name,
    type: p.type || "string",
    fieldType: p.fieldType || "text"
  };
  if (p.description) def.description = p.description;
  if (p.groupName) def.groupName = p.groupName;
  if (Array.isArray(p.options) && p.options.length > 0) {
    def.options = p.options.filter((o) => o && typeof o.value === "string").map((o) => {
      const opt = { label: o.label || String(o.value), value: String(o.value) };
      if (o.description) opt.description = o.description;
      if (typeof o.displayOrder === "number") opt.displayOrder = o.displayOrder;
      if (o.hidden) opt.hidden = true;
      return opt;
    }).sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
  }
  if (p.hidden) def.hidden = true;
  if (p.calculated) def.calculated = true;
  if (p.hubspotDefined) def.hubspotDefined = true;
  if (p.modificationMetadata?.readOnlyValue || p.calculated) def.readOnlyValue = true;
  return def;
}
function mapPipelines(results) {
  return results.filter((p) => p && typeof p.id === "string" && !p.archived).map((p) => ({
    id: p.id,
    label: p.label || p.id,
    displayOrder: p.displayOrder ?? 0,
    stages: (p.stages ?? []).filter((s) => s && typeof s.id === "string" && !s.archived).map((s) => {
      const stage = { id: s.id, label: s.label || s.id, displayOrder: s.displayOrder ?? 0 };
      if (s.metadata && typeof s.metadata === "object") {
        const md = {};
        for (const [k, v] of Object.entries(s.metadata)) if (v !== null && v !== void 0) md[k] = String(v);
        stage.metadata = md;
      }
      return stage;
    }).sort((a, b) => a.displayOrder - b.displayOrder)
  })).sort((a, b) => a.displayOrder - b.displayOrder || a.label.localeCompare(b.label));
}
function prettySecondary(prop, value, stageLabels) {
  if (STAGE_PROPERTIES.has(prop) && stageLabels?.has(value)) return stageLabels.get(value);
  if (NUMERIC_SECONDARY.has(prop) && value.trim() !== "" && Number.isFinite(Number(value))) return numberFormat2.format(Number(value));
  if (/(_date|_time|timestamp|_start)$/.test(prop)) {
    const ms = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
    if (Number.isFinite(ms)) return dateFormat2.format(new Date(ms));
  }
  return value;
}
function summarize(t, obj, url, stageLabels) {
  const id = String(obj.id);
  const props = normalizeProps(obj.properties);
  let label = t.labelProperties.filter((p) => p !== "hs_object_id").map((p) => (props[p] ?? "").trim()).filter(Boolean).join(" ");
  const secondaryProps = t.info.secondaryDisplayProperties;
  if (!label && t.objectType === "contacts") label = (props.email ?? "").trim();
  if (!label) label = `${t.info.label} ${id}`;
  const summary = { id, objectType: t.objectType, objectTypeId: t.objectTypeId, label, url };
  for (const p of secondaryProps) {
    const v = (props[p] ?? "").trim();
    if (v && v !== label) {
      summary.secondary = prettySecondary(p, v, stageLabels);
      break;
    }
  }
  return summary;
}
function primitive(v, what) {
  if (typeof v === "string") {
    if (v.length > 1e3) throw badRequest(`${what} is too long.`);
    return v;
  }
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v;
  throw badRequest(`${what} must be text, a number or true/false.`);
}
function buildSearchBody(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw badRequest("The search request must be a JSON object.");
  const req = input;
  const body = {};
  let properties = [];
  if (req.properties !== void 0) {
    if (!Array.isArray(req.properties)) throw badRequest('"properties" must be a list of property names.');
    properties = parsePropertyList(req.properties.map((p) => assertPropertyName(p)));
    body.properties = properties;
  }
  if (req.query !== void 0 && req.query !== null && req.query !== "") {
    if (typeof req.query !== "string" || req.query.length > 3e3) throw badRequest('"query" must be text (at most 3000 characters).');
    body.query = req.query;
  }
  if (req.filterGroups !== void 0) {
    if (!Array.isArray(req.filterGroups)) throw badRequest('"filterGroups" must be a list.');
    if (req.filterGroups.length > 5) throw badRequest("HubSpot allows at most 5 filter groups.");
    let total = 0;
    body.filterGroups = req.filterGroups.map((g, gi) => {
      if (!g || !Array.isArray(g.filters)) throw badRequest(`Filter group ${gi + 1} needs a "filters" list.`);
      if (g.filters.length > 6) throw badRequest("HubSpot allows at most 6 filters per group.");
      total += g.filters.length;
      return {
        filters: g.filters.map((f, fi) => {
          const where = `Filter ${fi + 1} in group ${gi + 1}`;
          if (!f || typeof f !== "object") throw badRequest(`${where} is not valid.`);
          const operator = typeof f.operator === "string" ? f.operator.toUpperCase() : "";
          if (!SEARCH_OPERATORS.includes(operator)) {
            throw badRequest(`${where} uses an unknown operator "${String(f.operator).slice(0, 30)}".`);
          }
          const out = { propertyName: assertPropertyName(f.propertyName), operator };
          if (f.value !== void 0 && f.value !== null) out.value = String(primitive(f.value, `${where} value`));
          if (f.highValue !== void 0 && f.highValue !== null) out.highValue = String(primitive(f.highValue, `${where} high value`));
          if (f.values !== void 0 && f.values !== null) {
            if (!Array.isArray(f.values) || f.values.length > 100) throw badRequest(`${where} "values" must be a list of at most 100 items.`);
            out.values = f.values.map((v) => String(primitive(v, `${where} value`)));
          }
          return out;
        })
      };
    });
    if (total > 18) throw badRequest("HubSpot allows at most 18 filters in one search.");
  }
  if (req.sorts !== void 0) {
    if (!Array.isArray(req.sorts) || req.sorts.length > 5) throw badRequest('"sorts" must be a list (at most 5).');
    body.sorts = req.sorts.map((s) => {
      if (!s || typeof s !== "object") throw badRequest("Each sort needs a propertyName and direction.");
      const direction = s.direction === "DESCENDING" ? "DESCENDING" : "ASCENDING";
      return { propertyName: assertPropertyName(s.propertyName), direction };
    });
  }
  body.limit = clampInt(req.pageLength === void 0 ? void 0 : String(req.pageLength), 1, 200, 10);
  if (req.after !== void 0 && req.after !== null && req.after !== "") {
    if (typeof req.after !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(req.after)) throw badRequest('"after" is not a valid paging token.');
    body.after = req.after;
  }
  return { body, properties, formatted: req.formatted === true };
}
function crmRoutes() {
  const objectTypes = {
    method: "GET",
    path: CONNECTOR_ROUTES.objectTypes,
    handler: async (ctx) => {
      const crm = await CrmContext.create(ctx);
      const list = STANDARD_OBJECT_TYPES.map(standardInfo);
      if (crm.session.scopes.includes("crm.schemas.custom.read")) {
        const schemas = await crm.resolver.loadSchemas();
        const custom = (schemas ?? []).map(schemaInfo).sort((a, b) => a.label.localeCompare(b.label));
        list.push(...custom);
      }
      return json(list);
    }
  };
  const properties = {
    method: "GET",
    path: CONNECTOR_ROUTES.properties,
    handler: async (ctx) => {
      const crm = await CrmContext.create(ctx);
      const t = await crm.resolver.resolve(ctx.params.objectType);
      return json(await crm.properties(t));
    }
  };
  const pipelines = {
    method: "GET",
    path: CONNECTOR_ROUTES.pipelines,
    handler: async (ctx) => {
      const crm = await CrmContext.create(ctx);
      const t = await crm.resolver.resolve(ctx.params.objectType);
      return json(await crm.pipelinesFor(t));
    }
  };
  const owners = {
    method: "GET",
    path: CONNECTOR_ROUTES.owners,
    handler: async (ctx) => {
      const crm = await CrmContext.create(ctx);
      const out = [];
      let after;
      for (let page = 0; page < 5; page++) {
        const res = await crm.api.request("GET", "/crm/v3/owners", { query: { limit: 100, after } });
        for (const o of res?.results ?? []) {
          if (!o || o.archived) continue;
          const owner = { id: String(o.id), email: o.email ?? "" };
          if (o.firstName) owner.firstName = o.firstName;
          if (o.lastName) owner.lastName = o.lastName;
          if (typeof o.userId === "number") owner.userId = o.userId;
          out.push(owner);
        }
        after = res?.paging?.next?.after;
        if (!after) break;
      }
      return json(out);
    }
  };
  const searchRecords = {
    method: "GET",
    path: CONNECTOR_ROUTES.searchRecords,
    handler: async (ctx) => {
      const crm = await CrmContext.create(ctx);
      const t = await crm.resolver.resolve(ctx.params.objectType);
      const q = (ctx.url.searchParams.get("q") ?? "").trim().slice(0, 200);
      const limit = clampInt(ctx.url.searchParams.get("limit"), 1, 50, 10);
      const props = [.../* @__PURE__ */ new Set([...t.labelProperties, t.info.primaryDisplayProperty, ...t.info.secondaryDisplayProperties, ...t.objectType === "contacts" ? ["email"] : []])];
      const body = { properties: props, limit };
      if (q) body.query = q;
      else body.sorts = [{ propertyName: t.objectType === "contacts" ? "lastmodifieddate" : "hs_lastmodifieddate", direction: "DESCENDING" }];
      const [res, byId] = await Promise.all([
        crm.api.request("POST", `/crm/v3/objects/${encodeURIComponent(t.apiPath)}/search`, { body }),
        /^\d{1,20}$/.test(q) ? crm.api.request("GET", `/crm/v3/objects/${encodeURIComponent(t.apiPath)}/${q}`, { query: { properties: props.join(",") } }).catch((err) => {
          if (err instanceof HubSpotApiError && err.code === "not_found") return null;
          throw err;
        }) : Promise.resolve(null)
      ]);
      const objects = [...byId ? [byId] : [], ...(res?.results ?? []).filter((o) => !byId || String(o.id) !== String(byId.id))].slice(0, limit);
      let stageLabels = null;
      if (t.info.secondaryDisplayProperties.some((p) => STAGE_PROPERTIES.has(p)) && objects.length > 0) {
        try {
          const pls = await crm.pipelinesFor(t);
          stageLabels = new Map(pls.flatMap((p) => p.stages.map((s) => [s.id, s.label])));
        } catch {
          stageLabels = null;
        }
      }
      return json(objects.map((o) => summarize(t, o, crm.recordUrl(t, String(o.id)), stageLabels)));
    }
  };
  const record = {
    method: "GET",
    path: CONNECTOR_ROUTES.record,
    handler: async (ctx) => {
      const id = assertRecordId(ctx.params.id);
      const requested = propertiesParam(ctx);
      const formatted = truthy(ctx.url.searchParams.get("formatted"));
      const crm = await CrmContext.create(ctx);
      const t = await crm.resolver.resolve(ctx.params.objectType);
      const [obj, defs] = await Promise.all([
        crm.api.request("GET", `/crm/v3/objects/${encodeURIComponent(t.apiPath)}/${id}`, {
          query: { properties: requested.length > 0 ? requested.join(",") : void 0 }
        }),
        formatted ? crm.propertyDefs(t) : Promise.resolve(null)
      ]);
      let props = normalizeProps(obj?.properties);
      for (const name of requested) if (!(name in props)) props[name] = null;
      if (defs) props = formatProperties(props, defs);
      const body = { id: String(obj?.id ?? id), objectType: t.objectType, objectTypeId: t.objectTypeId, properties: props };
      return json(body);
    }
  };
  const associations = {
    method: "GET",
    path: CONNECTOR_ROUTES.associations,
    handler: async (ctx) => {
      const id = assertRecordId(ctx.params.id);
      const requested = propertiesParam(ctx);
      const limit = clampInt(ctx.url.searchParams.get("limit") ?? ctx.url.searchParams.get("pageLength"), 1, 500, 100);
      const formatted = truthy(ctx.url.searchParams.get("formatted"));
      const crm = await CrmContext.create(ctx);
      const [from, to] = await Promise.all([crm.resolver.resolve(ctx.params.objectType), crm.resolver.resolve(ctx.params.toObjectType)]);
      const res = await crm.api.request("GET", `/crm/v4/objects/${encodeURIComponent(from.apiPath)}/${id}/associations/${encodeURIComponent(to.apiPath)}`, { query: { limit } });
      const links = (res?.results ?? []).slice(0, limit);
      const propsById = /* @__PURE__ */ new Map();
      if (requested.length > 0 && links.length > 0) {
        const ids = [...new Set(links.map((l) => String(l.toObjectId)))];
        const [defs, ...batches] = await Promise.all([
          formatted ? crm.propertyDefs(to) : Promise.resolve(null),
          ...chunk(ids, 100).map(
            (chunkIds) => crm.api.request("POST", `/crm/v3/objects/${encodeURIComponent(to.apiPath)}/batch/read`, {
              body: { properties: requested, inputs: chunkIds.map((i) => ({ id: i })) }
            })
          )
        ]);
        for (const batch of batches) {
          for (const obj of batch?.results ?? []) {
            let props = pick(normalizeProps(obj.properties), requested);
            if (defs) props = formatProperties(props, defs);
            propsById.set(String(obj.id), props);
          }
        }
      }
      const out = links.map((l) => ({
        toObjectId: Number(l.toObjectId),
        associationTypes: (l.associationTypes ?? []).map((a) => ({ category: a.category ?? "HUBSPOT_DEFINED", typeId: Number(a.typeId ?? 0), label: a.label ?? "" })),
        properties: requested.length > 0 ? propsById.get(String(l.toObjectId)) ?? pick({}, requested) : {}
      }));
      return json(out);
    }
  };
  const search = {
    method: "POST",
    path: CONNECTOR_ROUTES.search,
    handler: async (ctx) => {
      const input = await readJsonBody(ctx.request, 64 * 1024);
      const { body, formatted } = buildSearchBody(input);
      const crm = await CrmContext.create(ctx);
      const t = await crm.resolver.resolve(ctx.params.objectType);
      const [res, defs] = await Promise.all([
        crm.api.request("POST", `/crm/v3/objects/${encodeURIComponent(t.apiPath)}/search`, { body }),
        formatted ? crm.propertyDefs(t) : Promise.resolve(null)
      ]);
      const after = res?.paging?.next?.after;
      const out = {
        results: (res?.results ?? []).map((o) => {
          const props = normalizeProps(o.properties);
          return { objectId: Number(o.id), properties: defs ? formatProperties(props, defs) : props };
        }),
        total: typeof res?.total === "number" ? res.total : (res?.results ?? []).length,
        hasMore: Boolean(after)
      };
      if (after) out.after = String(after);
      return json(out);
    }
  };
  return [objectTypes, properties, pipelines, owners, searchRecords, record, associations, search];
}
function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
var MAX_PROPERTIES, PROPERTY_NAME, RECORD_ID, SEARCH_OPERATORS, CrmContext, numberFormat2, dateFormat2, NUMERIC_SECONDARY, STAGE_PROPERTIES;
var init_crm = __esm({
  "server/core/routes/crm.ts"() {
    init_types2();
    init_types();
    init_http();
    init_objectTypes();
    init_format();
    MAX_PROPERTIES = 200;
    PROPERTY_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;
    RECORD_ID = /^\d{1,20}$/;
    SEARCH_OPERATORS = [
      "EQ",
      "NEQ",
      "LT",
      "LTE",
      "GT",
      "GTE",
      "BETWEEN",
      "IN",
      "NOT_IN",
      "HAS_PROPERTY",
      "NOT_HAS_PROPERTY",
      "CONTAINS_TOKEN",
      "NOT_CONTAINS_TOKEN"
    ];
    CrmContext = class _CrmContext {
      constructor(api, session) {
        this.api = api;
        this.session = session;
        this.resolver = new ObjectTypeResolver(api);
      }
      api;
      session;
      resolver;
      defs = /* @__PURE__ */ new Map();
      pipelines = /* @__PURE__ */ new Map();
      static async create(ctx) {
        const api = await ctx.hubspot();
        const session = await ctx.session.get();
        if (!session) throw new ConnectorError(401, "not_connected", "Connect HubSpot to see real data.");
        return new _CrmContext(api, session);
      }
      async properties(t) {
        const res = await this.api.request("GET", `/crm/v3/properties/${encodeURIComponent(t.apiPath)}`);
        return (res?.results ?? []).filter((p) => p && typeof p.name === "string" && !p.archived).map(mapProperty).sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }) || a.name.localeCompare(b.name));
      }
      propertyDefs(t) {
        let p = this.defs.get(t.apiPath);
        if (!p) {
          p = this.properties(t).then((list) => new Map(list.map((d) => [d.name, d])));
          this.defs.set(t.apiPath, p);
        }
        return p;
      }
      pipelinesFor(t) {
        let p = this.pipelines.get(t.apiPath);
        if (!p) {
          p = (async () => {
            const std = findStandardObjectType(t.objectType);
            if (std && !std.hasPipelines) return [];
            try {
              const res = await this.api.request("GET", `/crm/v3/pipelines/${encodeURIComponent(t.apiPath)}`);
              return mapPipelines(res?.results ?? []);
            } catch (err) {
              if (err instanceof HubSpotApiError && (err.code === "not_found" || err.code === "bad_request")) return [];
              throw err;
            }
          })();
          this.pipelines.set(t.apiPath, p);
        }
        return p;
      }
      recordUrl(t, id) {
        return `https://${this.session.appHost}/contacts/${this.session.portalId}/record/${t.objectTypeId}/${id}`;
      }
    };
    numberFormat2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
    dateFormat2 = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
    NUMERIC_SECONDARY = /* @__PURE__ */ new Set(["amount", "price", "hs_total_price", "hs_price", "quantity"]);
    STAGE_PROPERTIES = /* @__PURE__ */ new Set(["hs_pipeline_stage", "dealstage"]);
  }
});

// server/core/ssrf.ts
function parseIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}
function isBlockedIPv4(parts) {
  const [a, b, c] = parts;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}
function parseIPv6(host) {
  if (!host.includes(":")) return null;
  let h = host.toLowerCase();
  const zone = h.indexOf("%");
  if (zone >= 0) h = h.slice(0, zone);
  const v4tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (v4tail) {
    const v4 = parseIPv4(v4tail[1]);
    if (!v4) return null;
    h = h.slice(0, -v4tail[1].length) + `${(v4[0] << 8 | v4[1]).toString(16)}:${(v4[2] << 8 | v4[3]).toString(16)}`;
  }
  const halves = h.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (all.length !== 8) return null;
  const out = [];
  for (const part of all) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    out.push(parseInt(part, 16));
  }
  return out;
}
function isBlockedIPv6(h) {
  const allZeroPrefix = (n) => h.slice(0, n).every((x) => x === 0);
  if (allZeroPrefix(8)) return true;
  if (allZeroPrefix(7) && h[7] === 1) return true;
  if (allZeroPrefix(5) && (h[5] === 65535 || h[5] === 0)) {
    return isBlockedIPv4([h[6] >> 8, h[6] & 255, h[7] >> 8, h[7] & 255]);
  }
  if (h[0] === 100 && h[1] === 65435 && h.slice(2, 6).every((x) => x === 0)) {
    return isBlockedIPv4([h[6] >> 8, h[6] & 255, h[7] >> 8, h[7] & 255]);
  }
  if ((h[0] & 65024) === 64512) return true;
  if ((h[0] & 65472) === 65152) return true;
  if ((h[0] & 65472) === 65216) return true;
  if ((h[0] & 65280) === 65280) return true;
  if (h[0] === 8193 && h[1] === 3512) return true;
  if (h[0] === 8194) {
    return isBlockedIPv4([h[1] >> 8, h[1] & 255, h[2] >> 8, h[2] & 255]);
  }
  return false;
}
function isLoopbackHost(host) {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const v4 = parseIPv4(host);
  if (v4) return v4[0] === 127;
  const v6 = parseIPv6(host.replace(/^\[|\]$/g, ""));
  return !!v6 && v6.slice(0, 7).every((x) => x === 0) && v6[7] === 1;
}
function checkHostname(hostname, opts) {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return "The address has no host name.";
  if (opts.allowLoopback && isLoopbackHost(host)) return null;
  if (host === "localhost" || host.endsWith(".localhost")) return "Requests to localhost are not allowed.";
  if (host === "metadata.google.internal" || host.endsWith(".internal")) return "Requests to internal hosts are not allowed.";
  if (host.endsWith(".local") || host.endsWith(".home.arpa") || host.endsWith(".lan")) return "Requests to local network hosts are not allowed.";
  const v4 = parseIPv4(host);
  if (v4) return isBlockedIPv4(v4) ? "Requests to private or reserved IP addresses are not allowed." : null;
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const v6 = parseIPv6(bare);
  if (v6) return isBlockedIPv6(v6) ? "Requests to private or reserved IP addresses are not allowed." : null;
  if (bare.includes(":")) return "The address is not a valid host.";
  if (!host.includes(".")) return "Use a full public host name (like api.example.com).";
  return null;
}
function checkProxyUrl(raw, opts) {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, reason: "Enter the URL to fetch." };
  if (raw.length > 2048) return { ok: false, reason: "The URL is too long." };
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "That is not a valid URL." };
  }
  if (url.username || url.password) return { ok: false, reason: "URLs with a user name or password aren't allowed; send credentials in a header instead." };
  const loopback = isLoopbackHost(url.hostname.toLowerCase());
  if (url.protocol === "http:") {
    if (!(opts.devLocal && loopback)) return { ok: false, reason: "Only https:// URLs can be fetched (hubspot.fetch requires https)." };
  } else if (url.protocol !== "https:") {
    return { ok: false, reason: "Only https:// URLs can be fetched." };
  }
  const blocked = checkHostname(url.hostname, { allowLoopback: opts.devLocal });
  if (blocked) return { ok: false, reason: blocked };
  return { ok: true, url };
}
var init_ssrf = __esm({
  "server/core/ssrf.ts"() {
  }
});

// server/core/routes/proxy.ts
function sanitizeRequestHeaders(input) {
  if (input === void 0 || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) throw badRequest('"headers" must be an object of header names and values.');
  const out = {};
  const entries = Object.entries(input);
  if (entries.length > 50) throw badRequest("Send at most 50 headers.");
  for (const [name, value] of entries) {
    if (!HEADER_NAME.test(name)) throw badRequest(`"${name.slice(0, 40)}" isn't a valid header name.`);
    if (typeof value !== "string" || value.length > 8192 || /[\r\n\0]/.test(value)) throw badRequest(`The value of header "${name}" isn't valid.`);
    if (BLOCKED_REQUEST_HEADERS.has(name.toLowerCase())) continue;
    out[name] = value;
  }
  return out;
}
async function readCapped(res, cap) {
  if (!res.body) return { text: "", truncated: false };
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  let truncated = false;
  for (; ; ) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > cap) {
      chunks.push(value.subarray(0, cap - size));
      size = cap;
      truncated = true;
      await reader.cancel().catch(() => {
      });
      break;
    }
    chunks.push(value);
    size += value.byteLength;
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(all), truncated };
}
function responseHeaders(res) {
  const out = {};
  res.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (!BLOCKED_RESPONSE_HEADERS.has(lower)) out[lower] = value;
  });
  return out;
}
function validateProxyRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw badRequest("The fetch request must be a JSON object.");
  const req = input;
  const method = typeof req.method === "string" ? req.method.toUpperCase() : "GET";
  if (!METHODS.includes(method)) throw badRequest(`Method "${String(req.method).slice(0, 20)}" isn't supported.`);
  if (typeof req.url !== "string") throw badRequest('"url" is required.');
  const timeoutRaw = typeof req.timeoutMs === "number" && Number.isFinite(req.timeoutMs) ? req.timeoutMs : PROXY_MAX_TIMEOUT_MS;
  return {
    url: req.url,
    method,
    headers: sanitizeRequestHeaders(req.headers),
    body: req.body,
    timeoutMs: Math.min(PROXY_MAX_TIMEOUT_MS, Math.max(1, Math.trunc(timeoutRaw)))
  };
}
function proxyRoutes() {
  const route = {
    method: "POST",
    path: CONNECTOR_ROUTES.proxyFetch,
    handler: async (ctx) => {
      const { config } = ctx;
      if (!config.enableFetchProxy) {
        throw new ConnectorError(404, "feature_disabled", "Previewing hubspot.fetch through the connector is turned off on this server.");
      }
      await ctx.hubspot();
      const req = validateProxyRequest(await readJsonBody(ctx.request, 1024 * 1024 + 4096));
      const devLocal = isLocalAppUrl(config.appUrl);
      const first = checkProxyUrl(req.url, { devLocal });
      if (!first.ok) throw new ConnectorError(400, "url_not_allowed", first.reason);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), req.timeoutMs);
      try {
        let url = first.url;
        let method = req.method;
        let body = method === "GET" || req.body === void 0 ? void 0 : JSON.stringify(req.body);
        const headers = { "User-Agent": "UIEX-Builder-Connector (hubspot.fetch preview)", ...req.headers };
        if (body !== void 0 && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) headers["Content-Type"] = "application/json";
        for (let hop = 0; ; hop++) {
          let res;
          try {
            res = await config.fetch(url.toString(), { method, headers, body, redirect: "manual", signal: controller.signal });
          } catch {
            if (controller.signal.aborted) {
              throw new ConnectorError(504, "timeout", `The URL didn't answer within ${Math.round(req.timeoutMs / 1e3)} seconds.`);
            }
            throw new ConnectorError(502, "fetch_failed", "Couldn't connect to that URL. Check the address and that the server is online.");
          }
          const location = res.headers.get("location");
          if (res.status >= 300 && res.status < 400 && location) {
            await res.body?.cancel().catch(() => {
            });
            if (hop >= PROXY_MAX_REDIRECTS) throw new ConnectorError(502, "too_many_redirects", `The URL redirected more than ${PROXY_MAX_REDIRECTS} times.`);
            let next;
            try {
              next = new URL(location, url);
            } catch {
              throw new ConnectorError(502, "fetch_failed", "The URL redirected to an invalid address.");
            }
            const check = checkProxyUrl(next.toString(), { devLocal });
            if (!check.ok) throw new ConnectorError(400, "url_not_allowed", `The URL redirected to an address that isn't allowed: ${check.reason}`);
            if (check.url.origin !== url.origin) {
              for (const h of Object.keys(headers)) {
                if (["authorization", "cookie"].includes(h.toLowerCase())) delete headers[h];
              }
            }
            if (res.status === 303 || (res.status === 301 || res.status === 302) && method === "POST") {
              method = "GET";
              body = void 0;
              for (const h of Object.keys(headers)) if (h.toLowerCase() === "content-type") delete headers[h];
            }
            url = check.url;
            continue;
          }
          const { text, truncated } = await readCapped(res, PROXY_MAX_RESPONSE_BYTES).catch(() => {
            if (controller.signal.aborted) throw new ConnectorError(504, "timeout", `The URL didn't finish answering within ${Math.round(req.timeoutMs / 1e3)} seconds.`);
            throw new ConnectorError(502, "fetch_failed", "The connection closed before the response was complete.");
          });
          const out = { status: res.status, ok: res.ok, headers: responseHeaders(res), body: text, truncated };
          return json(out);
        }
      } finally {
        clearTimeout(timer);
      }
    }
  };
  return [route];
}
var PROXY_MAX_TIMEOUT_MS, PROXY_MAX_RESPONSE_BYTES, PROXY_MAX_REDIRECTS, METHODS, BLOCKED_REQUEST_HEADERS, BLOCKED_RESPONSE_HEADERS, HEADER_NAME;
var init_proxy = __esm({
  "server/core/routes/proxy.ts"() {
    init_types2();
    init_http();
    init_ssrf();
    init_config();
    PROXY_MAX_TIMEOUT_MS = 1e4;
    PROXY_MAX_RESPONSE_BYTES = 1024 * 1024;
    PROXY_MAX_REDIRECTS = 3;
    METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];
    BLOCKED_REQUEST_HEADERS = /* @__PURE__ */ new Set([
      "host",
      "connection",
      "keep-alive",
      "proxy-authorization",
      "proxy-authenticate",
      "proxy-connection",
      "te",
      "trailer",
      "transfer-encoding",
      "upgrade",
      "content-length",
      "expect",
      "forwarded",
      "x-forwarded-for",
      "x-forwarded-host",
      "x-forwarded-proto",
      "x-real-ip"
    ]);
    BLOCKED_RESPONSE_HEADERS = /* @__PURE__ */ new Set([
      "set-cookie",
      "set-cookie2",
      "connection",
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "te",
      "trailer",
      "transfer-encoding",
      "upgrade"
    ]);
    HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,100}$/;
  }
});

// server/core/deploy/paths.ts
function filePathProblem(path2) {
  if (typeof path2 !== "string" || path2.length === 0) return "is empty";
  if (path2.length > DEPLOY_LIMITS.maxPathLength) return `is longer than ${DEPLOY_LIMITS.maxPathLength} characters`;
  if (CONTROL_CHARS.test(path2)) return "contains control characters";
  if (path2.includes("\\")) return "uses backslashes (use / between folders)";
  if (path2.startsWith("/") || /^[A-Za-z]:/.test(path2)) return "must be relative to the project folder";
  if (FORBIDDEN_CHARS.test(path2)) return 'contains a character that is not allowed in file names (< > : " | ? *)';
  const segments = path2.split("/");
  for (const seg of segments) {
    if (seg === "") return "has an empty folder name (// or a trailing /)";
    if (seg === "." || seg === "..") return "must not contain . or .. folders";
    if (seg.length > DEPLOY_LIMITS.maxSegmentLength) return `has a name longer than ${DEPLOY_LIMITS.maxSegmentLength} characters`;
    if (seg.trim() !== seg) return "has a file or folder name that starts or ends with a space";
  }
  return null;
}
function utf8Length(text) {
  return encoder2.encode(text).length;
}
function validateDeployFiles(raw) {
  const problems = [];
  if (!Array.isArray(raw)) return { files: [], problems: ["The project files are missing."] };
  if (raw.length === 0) return { files: [], problems: ["The project has no files."] };
  if (raw.length > DEPLOY_LIMITS.maxFiles) {
    return { files: [], problems: [`The project has ${raw.length} files; the limit is ${DEPLOY_LIMITS.maxFiles}.`] };
  }
  const files = [];
  const seen = /* @__PURE__ */ new Map();
  let total = 0;
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      problems.push("A project file entry is not an object.");
      continue;
    }
    const { path: path2, contents } = item;
    const label = typeof path2 === "string" && path2 ? path2.slice(0, 120) : "(no name)";
    const problem = filePathProblem(path2);
    if (problem) {
      problems.push(`${label}: the file path ${problem}.`);
      continue;
    }
    if (typeof contents !== "string") {
      problems.push(`${label}: the file contents must be text.`);
      continue;
    }
    const p = path2;
    const key = p.toLowerCase();
    const previous = seen.get(key);
    if (previous !== void 0) {
      problems.push(previous === p ? `${label}: the file is listed twice.` : `${label}: clashes with ${previous} (names differ only in upper/lower case).`);
      continue;
    }
    seen.set(key, p);
    const size = utf8Length(contents);
    if (size > DEPLOY_LIMITS.maxFileBytes) {
      problems.push(`${label}: the file is ${formatBytes(size)}; the limit is ${formatBytes(DEPLOY_LIMITS.maxFileBytes)} per file.`);
      continue;
    }
    total += size;
    files.push({ path: p, contents });
  }
  if (total > DEPLOY_LIMITS.maxTotalBytes) {
    problems.push(`The project files add up to ${formatBytes(total)}; the limit is ${formatBytes(DEPLOY_LIMITS.maxTotalBytes)}.`);
  }
  for (const f of files) {
    const parts = f.path.toLowerCase().split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      const clash = seen.get(dir);
      if (clash !== void 0) problems.push(`${f.path}: ${clash} is a file, so it cannot also be a folder.`);
    }
  }
  return { files, problems };
}
function formatBytes(n) {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function isIgnoredOnUpload(relativePath) {
  return relativePath.split("/").some((seg) => {
    const lower = seg.toLowerCase();
    if (IGNORED_NAMES.has(lower)) return true;
    if (seg.startsWith(".")) return true;
    if (lower.endsWith(".log") || lower.endsWith(".swp") || seg.endsWith("~")) return true;
    return false;
  });
}
function readProjectConfig(files) {
  const file = files.find((f) => f.path === "hsproject.json");
  if (!file) return { config: null, problem: null };
  let parsed;
  try {
    parsed = JSON.parse(file.contents);
  } catch {
    return { config: null, problem: "hsproject.json is not valid JSON." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { config: null, problem: "hsproject.json must be a JSON object." };
  const o = parsed;
  const rawSrc = typeof o.srcDir === "string" ? o.srcDir.trim() : "";
  if (!rawSrc) return { config: null, problem: 'hsproject.json is missing "srcDir".' };
  const srcDir = rawSrc.replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (srcDir !== "" && srcDir !== "." && filePathProblem(srcDir)) {
    return { config: null, problem: '"srcDir" in hsproject.json must be a folder inside the project.' };
  }
  return {
    config: {
      srcDir: srcDir === "." ? "" : srcDir,
      name: typeof o.name === "string" ? o.name : void 0,
      platformVersion: typeof o.platformVersion === "string" ? o.platformVersion : void 0
    },
    problem: null
  };
}
function uploadSourceFiles(files, srcDir) {
  const prefix = srcDir ? `${srcDir}/` : "";
  const out = [];
  for (const f of files) {
    if (prefix && !f.path.startsWith(prefix)) continue;
    const rel = f.path.slice(prefix.length);
    if (!rel || isIgnoredOnUpload(rel)) continue;
    out.push({ path: rel, contents: f.contents });
  }
  return out.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
var DEPLOY_LIMITS, FORBIDDEN_CHARS, CONTROL_CHARS, encoder2, IGNORED_NAMES;
var init_paths = __esm({
  "server/core/deploy/paths.ts"() {
    DEPLOY_LIMITS = {
      maxFiles: 400,
      /** Per file, UTF-8 bytes. */
      maxFileBytes: 1024 * 1024,
      /** All files together, UTF-8 bytes. */
      maxTotalBytes: 3.5 * 1024 * 1024,
      maxPathLength: 240,
      maxSegmentLength: 120,
      /** JSON request body limit for POST /api/deploy (contents get escaped, so above maxTotalBytes). */
      maxBodyBytes: 5 * 1024 * 1024
    };
    FORBIDDEN_CHARS = /[<>:"|?*\\]/;
    CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
    encoder2 = new TextEncoder();
    IGNORED_NAMES = /* @__PURE__ */ new Set([
      "fields.output.json",
      "hubspot.config.yml",
      "hubspot.config.yaml",
      "node_modules",
      "icon\r",
      "__macosx",
      "~",
      "thumbs.db",
      "ehthumbs.db",
      "desktop.ini",
      "@eadir"
    ]);
  }
});

// server/core/deploy/api.ts
function errorDetails(body) {
  const out = [];
  for (const e of body?.errors ?? []) {
    if (typeof e?.message === "string" && e.message.trim() && !out.includes(e.message.trim())) out.push(e.message.trim().slice(0, 400));
  }
  return out.slice(0, 12);
}
function requiredScopesOf(body) {
  const out = [];
  const add = (v) => {
    if (Array.isArray(v)) {
      for (const s of v) if (typeof s === "string" && !out.includes(s)) out.push(s);
    }
  };
  for (const e of body?.errors ?? []) {
    add(e?.context?.requiredGranularScopes);
    add(e?.context?.requiredScopes);
  }
  add(body?.context?.requiredGranularScopes);
  add(body?.context?.requiredScopes);
  return out;
}
function retryAfterSeconds(value) {
  const n = Number(value);
  if (value && Number.isFinite(n)) return Math.max(1, Math.ceil(n));
  return 2;
}
function mapDeployError(status, body, retryAfter = null) {
  const correlationId = typeof body?.correlationId === "string" ? body.correlationId : void 0;
  const hsMessage = typeof body?.message === "string" ? body.message.trim().slice(0, 400) : "";
  const details = errorDetails(body);
  const sub = `${body?.subCategory ?? ""} ${(body?.errors ?? []).map((e) => e?.subCategory ?? "").join(" ")}`;
  if (status === 401) {
    return new DeployApiError("HubSpot no longer accepts the access for this deploy (it expired).", 401, "key_expired", details, correlationId);
  }
  if (status === 403) {
    const scopes = requiredScopesOf(body);
    if (body?.category === "MISSING_SCOPES" || scopes.length > 0) {
      return new DeployApiError(DEVELOPER_PROJECTS_PERMISSION_HELP, 403, "missing_scope", details, correlationId, scopes);
    }
    if (body?.category === "GATED" || sub.includes("PORTAL_GATED")) {
      return new DeployApiError(
        "Developer projects aren't available in this HubSpot account yet. Check that the account has access to the developer platform, or try a developer test account.",
        403,
        "not_available",
        details,
        correlationId
      );
    }
    return new DeployApiError(hsMessage ? `HubSpot refused the request: ${hsMessage}` : "HubSpot says this key can't do that.", 403, "forbidden", details, correlationId);
  }
  if (sub.includes("PROJECT_LOCKED") || status === 423) {
    return new DeployApiError(
      "The project is locked in HubSpot \u2014 someone may be running local development (hs project dev) for it. Stop it, or unlock the project in HubSpot, then try again.",
      409,
      "project_locked",
      details,
      correlationId
    );
  }
  if (status === 404) {
    return new DeployApiError(hsMessage ? `HubSpot couldn't find it: ${hsMessage}` : "HubSpot couldn't find it.", 404, "not_found", details, correlationId);
  }
  if (status === 429) {
    const secs = retryAfterSeconds(retryAfter);
    const err = new RateLimitedError(`HubSpot is receiving too many requests right now. Please wait ${secs} seconds and try again.`, secs, correlationId);
    return err;
  }
  if (status >= 400 && status < 500) {
    return new DeployApiError(hsMessage ? `HubSpot rejected the project: ${hsMessage}` : "HubSpot rejected the project.", 400, "hubspot_rejected", details, correlationId);
  }
  return new DeployApiError("HubSpot had a problem answering. Please try again in a moment.", 502, "hubspot_error", details, correlationId, void 0, true);
}
function isTransient(err) {
  if (err instanceof RateLimitedError) return true;
  return err instanceof DeployApiError && err.transient;
}
async function readJson2(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function unreachable() {
  return new DeployApiError("Couldn't reach HubSpot. Check your connection and try again.", 502, "hubspot_unreachable", [], void 0, void 0, true);
}
function personalAccessKeyProblem(key) {
  if (!key) return "Paste your personal access key.";
  if (key.length < 20 || key.length > 4096 || /\s/.test(key)) {
    return "That doesn't look like a personal access key. Copy the whole key from HubSpot (use the Copy button next to it) and paste it here.";
  }
  return null;
}
async function exchangePersonalAccessKey(config, personalAccessKey) {
  let res;
  try {
    res = await fetchWithTimeout(
      config,
      `${config.hubspotApiBase}/localdevauth/v1/auth/refresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ encodedOAuthRefreshToken: personalAccessKey })
      },
      HUBSPOT_DEPLOY_CALL_TIMEOUT_MS
    );
  } catch {
    throw unreachable();
  }
  const body = await readJson2(res);
  if (!res.ok) {
    if (res.status === 429 || res.status >= 500) throw mapDeployError(res.status, body, res.headers.get("retry-after"));
    throw new DeployApiError(
      "HubSpot didn't accept this personal access key. Check that you copied the whole key and that it is still active (you can create a new one on the personal access key page).",
      400,
      "invalid_key",
      errorDetails(body),
      typeof body?.correlationId === "string" ? body.correlationId : void 0
    );
  }
  const accessToken = body?.oauthAccessToken;
  const hubId = body?.hubId;
  if (typeof accessToken !== "string" || !accessToken || typeof hubId !== "number") {
    throw new DeployApiError("HubSpot sent an unexpected answer when checking the key. Please try again.", 502, "hubspot_error", [], void 0, void 0, true);
  }
  const expiresAtMillis = Number(body?.expiresAtMillis);
  return {
    accessToken,
    expiresAt: Number.isFinite(expiresAtMillis) && expiresAtMillis > 0 ? expiresAtMillis : config.now() + 30 * 60 * 1e3,
    portalId: hubId,
    userId: typeof body?.userId === "number" ? body.userId : void 0,
    hubName: typeof body?.hubName === "string" ? body.hubName : void 0,
    accountType: typeof body?.accountType === "string" ? body.accountType : void 0,
    scopeGroups: Array.isArray(body?.scopeGroups) ? body.scopeGroups.filter((s) => typeof s === "string") : []
  };
}
function lacksDeveloperProjects(scopeGroups) {
  return scopeGroups.length > 0 && !scopeGroups.some((s) => s.startsWith("developer.projects"));
}
var HUBSPOT_DEPLOY_CALL_TIMEOUT_MS, HUBSPOT_UPLOAD_TIMEOUT_MS, DeployApiError, DEVELOPER_PROJECTS_PERMISSION_HELP, DeployHubSpotClient, enc, projectsApi;
var init_api = __esm({
  "server/core/deploy/api.ts"() {
    init_types();
    init_http();
    init_oauth();
    HUBSPOT_DEPLOY_CALL_TIMEOUT_MS = 15e3;
    HUBSPOT_UPLOAD_TIMEOUT_MS = 2e4;
    DeployApiError = class extends HubSpotApiError {
      constructor(message, status, code, details = [], correlationId, requiredScopes, transient = false) {
        super(message, status, code, correlationId, requiredScopes);
        this.details = details;
        this.transient = transient;
        this.name = "DeployApiError";
      }
      details;
      transient;
    };
    DEVELOPER_PROJECTS_PERMISSION_HELP = "Your personal access key needs the \u201CDeveloper projects\u201D permission. In HubSpot, open the personal access key page, add Developer projects to the key (or create a new key with it), and paste the new key here.";
    DeployHubSpotClient = class {
      constructor(config, accessToken, portalId) {
        this.config = config;
        this.accessToken = accessToken;
        this.portalId = portalId;
      }
      config;
      accessToken;
      portalId;
      url(path2, query = {}) {
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(query)) if (v !== void 0) params.set(k, String(v));
        params.set("portalId", String(this.portalId));
        return `${this.config.hubspotApiBase}/${path2.replace(/^\/+/, "")}?${params.toString()}`;
      }
      async request(method, path2, opts = {}) {
        const headers = { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json" };
        let body;
        if (opts.form) body = opts.form;
        else if (opts.json !== void 0) {
          headers["Content-Type"] = "application/json";
          body = JSON.stringify(opts.json);
        }
        let res;
        try {
          res = await fetchWithTimeout(this.config, this.url(path2, opts.query), { method, headers, body }, opts.timeoutMs ?? HUBSPOT_DEPLOY_CALL_TIMEOUT_MS);
        } catch {
          throw unreachable();
        }
        const data = await readJson2(res);
        if (!res.ok) throw mapDeployError(res.status, data, res.headers.get("retry-after"));
        return data;
      }
      get(path2, query) {
        return this.request("GET", path2, { query });
      }
    };
    enc = encodeURIComponent;
    projectsApi = {
      fetchProject: (c, name) => c.get(`developer/projects/v1/by-name/${enc(name)}`),
      createProject: (c, name) => c.request("POST", "developer/projects/v1", { json: { name } }),
      fetchSchemas: (c, platformVersion) => c.get(`project-components-external/project-schemas/v3/${enc(platformVersion)}`),
      uploadIR: (c, form) => c.request("POST", "project-components-external/v3/upload/new-api", { form, timeoutMs: HUBSPOT_UPLOAD_TIMEOUT_MS }),
      buildStatus: (c, name, buildId) => c.get(`dfs/v1/projects/${enc(name)}/builds/${buildId}/status`),
      buildWarnLogs: (c, name, buildId) => c.get(`dfs/logging/v1/logs/projects/${enc(name)}/builds/${buildId}/combined/warn`),
      queueDeploy: (c, name, buildId) => c.request("POST", "dfs/deploy/v3/deploys/queue/async", { json: { projectName: name, targetBuildId: buildId, ignoreWarnings: false } }),
      deployStatus: (c, name, deployId) => c.get(`dfs/deploy/v1/deploy-status/projects/${enc(name)}/deploys/${deployId}`),
      deployWarnLogs: (c, name, deployId) => c.get(`dfs/logging/v1/logs/projects/${enc(name)}/deploys/${deployId}/combined/warn`),
      appByUid: (c, appUid) => c.get("apps-dev/external/public/v3/full/portal/sourceId", { sourceId: appUid })
    };
  }
});

// server/core/deploy/ir.ts
function parseVersion(v) {
  if (v === "unstable") return { type: "unstable" };
  const m = DATED.exec(v);
  if (!m) return { type: "unknown" };
  return { type: "dated", year: Number(m[1]), month: Number(m[2]), beta: !!m[3] };
}
function meetsMinimumPlatformVersion(platformVersion, minimum) {
  const min = parseVersion(minimum);
  if (min.type !== "dated") throw new Error("minimum must be a dated version");
  const v = parseVersion(platformVersion);
  if (v.type === "unknown" || v.type === "unstable") return true;
  if (v.year !== min.year) return v.year > min.year;
  if (v.month !== min.month) return v.month > min.month;
  if (v.beta === min.beta) return true;
  return !v.beta;
}
function isLegacyPlatformVersion(platformVersion) {
  return !meetsMinimumPlatformVersion(platformVersion, "2025.2");
}
function mapToInternalType(type) {
  return (USER_FACING_TO_INTERNAL[type] || type || "").toUpperCase().replace(/-/g, "_");
}
function mapToUserFacingType(type) {
  return (INTERNAL_TO_USER_FACING[type] || type || "").toLowerCase().replace(/_/g, "-");
}
function dirname(path2) {
  const i = path2.lastIndexOf("/");
  return i < 0 ? "" : path2.slice(0, i);
}
function uidProblem(uid) {
  if (uid === "" || uid === void 0 || uid === null) return "'uid' must be at least one character long";
  if (typeof uid !== "string") return "'uid' should use only letters, numbers, periods, hyphens, and underscores (for example: app-id_1.2.3)";
  if (uid.length > 64) return "'uid' must be 64 characters or less";
  if (!/^[a-zA-Z0-9_\-.]+$/.test(uid)) return "'uid' should use only letters, numbers, periods, hyphens, and underscores (for example: app-id_1.2.3)";
  return null;
}
function translateProject(srcFiles, platformVersion, schemas = null) {
  const errors = [];
  const skippedHsMetaFiles = [];
  const byPath = new Map(srcFiles.map((f) => [f.path, f]));
  const metas = [];
  for (const f of srcFiles) {
    if (!f.path.endsWith(METAFILE_SUFFIX)) continue;
    if (f.path.split("/").includes("node_modules")) continue;
    const dir = dirname(f.path);
    if (!COMPONENT_DIRS.has(dir) && !SUB_COMPONENT_DIRS.has(dir)) {
      skippedHsMetaFiles.push(f.path);
      continue;
    }
    const meta = { file: f.path, errors: [] };
    try {
      const parsed = JSON.parse(f.contents);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        meta.content = parsed;
        const unexpected = Object.keys(parsed).filter((k) => !ALLOWED_TOP_LEVEL_FIELDS.has(k));
        if (unexpected.length) meta.errors.push(`Unexpected top-level properties found: ${unexpected.join(", ")}`);
      } else {
        meta.errors.push(`File content is missing for ${f.path}`);
      }
    } catch {
      meta.errors.push("Invalid JSON");
    }
    metas.push(meta);
  }
  if (metas.length === 0) {
    errors.push("No *-hsmeta.json files were found in the project, so there is nothing to deploy.");
    return { intermediateRepresentation: { intermediateNodesIndexedByUid: {}, profileData: { vars: { profileVariables: {} } } }, skippedHsMetaFiles, errors };
  }
  const parentUids = {};
  const allAppObjects = [];
  let appUid = "";
  let functionsDir;
  for (const m of metas) {
    const type = typeof m.content?.type === "string" ? m.content.type : void 0;
    const uid = typeof m.content?.uid === "string" ? m.content.uid : "";
    if (type && PARENT_TYPES.includes(type)) {
      if (type === "app") appUid = uid;
      parentUids[type] = uid;
    }
    if (type === "app-object") allAppObjects.push(uid);
    if (type === "app-function") functionsDir = dirname(m.file);
  }
  const nodes = [];
  let serverlessPackageUid;
  if (functionsDir !== void 0) {
    const packageFile = `${functionsDir}/package.json`;
    const lockFile = `${functionsDir}/package-lock.json`;
    if (!byPath.has(packageFile)) {
      errors.push(`${packageFile} does not exist. App Function requires a package.json file to exist in this location`);
    }
    serverlessPackageUid = SERVERLESS_PACKAGE_UID;
    const config = { packageFile };
    if (byPath.has(lockFile)) config.packageLockfile = lockFile;
    nodes.push({
      meta: null,
      node: {
        uid: SERVERLESS_PACKAGE_UID,
        componentType: SERVERLESS_PACKAGE_TYPE,
        config,
        componentDeps: { app: appUid, allAppObjects: [...allAppObjects] },
        metaFilePath: packageFile,
        files: {}
      }
    });
  }
  for (const m of metas) {
    if (!m.content) continue;
    const { uid, type, config, permissions } = m.content;
    const typeStr = typeof type === "string" ? type : "";
    const dependencies = {};
    if (m.content.dependencies && typeof m.content.dependencies === "object" && !Array.isArray(m.content.dependencies)) {
      Object.assign(dependencies, m.content.dependencies);
    }
    if (COMPONENTS[typeStr]?.parent === "app") {
      const parentUid = parentUids.app;
      if (parentUid) {
        dependencies.app = parentUid;
      } else {
        m.errors.push(`This '${typeStr}' component must be a child of the 'app' component. No *-hsmeta.json files were found with type 'app'`);
      }
      if (typeStr !== "app-object") dependencies.allAppObjects = [...allAppObjects];
      if (typeStr === "app-function" && serverlessPackageUid) dependencies.serverlessPackage = serverlessPackageUid;
    }
    const node = {
      uid: typeof uid === "string" ? uid : uid,
      config,
      componentType: mapToInternalType(typeStr),
      componentDeps: dependencies,
      metaFilePath: m.file,
      files: {}
    };
    if (permissions) node.permissions = permissions;
    nodes.push({ node, meta: m });
  }
  const indexed = {};
  const filesByUid = /* @__PURE__ */ new Map();
  for (const { node, meta } of nodes) {
    const key = typeof node.uid === "string" && node.uid ? node.uid : `missing-${meta?.file ?? ""}`;
    const list = filesByUid.get(key) ?? [];
    list.push(meta?.file ?? node.metaFilePath);
    filesByUid.set(key, list);
    if (!(key in indexed)) indexed[key] = node;
  }
  for (const [uid, files] of filesByUid) {
    if (files.length > 1) errors.push(`Duplicate uid '${uid}' found in: ${files.join(", ")}`);
  }
  const singular = /* @__PURE__ */ new Map();
  for (const { node, meta } of nodes) {
    if (!meta) continue;
    if (!node.uid) meta.errors.push("Missing required field: 'uid'");
    else {
      const problem = uidProblem(node.uid);
      if (problem) meta.errors.push(problem);
    }
    if (!node.config) meta.errors.push("Missing required field: 'config'");
    if (node.permissions && !meetsMinimumPlatformVersion(platformVersion, "2027.03")) {
      meta.errors.push(`The "permissions" field is not supported on platform version "${platformVersion}". Upgrade to "2027.03" or later to use component-level permissions.`);
    }
    if (!node.componentType) meta.errors.push("Missing required field: 'type'");
    else if (schemas && !(node.componentType in schemas)) meta.errors.push(`Unsupported type: ${mapToUserFacingType(node.componentType)}`);
    const userType = mapToUserFacingType(node.componentType);
    const info = COMPONENTS[userType];
    if (info) {
      const expected = info.parent ? `${COMPONENTS[info.parent].dir}/${info.dir}` : info.dir;
      const actual = dirname(meta.file);
      if (expected !== actual) {
        meta.errors.push(`The directory '${actual}' is incorrect for type '${userType}'. ${info.name} ${info.plural} should only be placed in the '${expected}' directory`);
      }
      if (info.singular) {
        const key = info.dir;
        singular.set(key, [...singular.get(key) ?? [], meta]);
      }
    }
  }
  for (const [, list] of singular) {
    if (list.length < 2) continue;
    const type = mapToUserFacingType(mapToInternalType(typeof list[0].content?.type === "string" ? list[0].content.type : ""));
    for (const m of list) m.errors.push(`Only one ${type} component is allowed`);
  }
  for (const m of metas) for (const e of m.errors) errors.push(`${m.file}: ${e}`);
  return {
    intermediateRepresentation: { intermediateNodesIndexedByUid: indexed, profileData: { vars: { profileVariables: {} } } },
    skippedHsMetaFiles,
    errors
  };
}
var DATED, SUB, TOP, COMPONENTS, PARENT_TYPES, COMPONENT_DIRS, SUB_COMPONENT_DIRS, ALLOWED_TOP_LEVEL_FIELDS, USER_FACING_TO_INTERNAL, INTERNAL_TO_USER_FACING, METAFILE_SUFFIX, SERVERLESS_PACKAGE_UID, SERVERLESS_PACKAGE_TYPE;
var init_ir = __esm({
  "server/core/deploy/ir.ts"() {
    DATED = /^(\d{4})\.(\d{1,2})(-beta)?$/;
    SUB = "features";
    TOP = "components";
    COMPONENTS = {
      app: { dir: "app", name: "App", plural: TOP, singular: true },
      "api-client": { dir: "api-client", parent: "app", name: "API Client", plural: SUB, singular: true },
      "app-object": { dir: "app-objects", parent: "app", name: "App Object", plural: SUB },
      "app-object-association": { dir: "app-object-associations", parent: "app", name: "App Object Association", plural: SUB },
      page: { dir: "pages", parent: "app", name: "Page", plural: SUB, singular: true },
      pages: { dir: "pages", parent: "app", name: "Page", plural: SUB, singular: true },
      theme: { dir: "theme", name: "Theme", plural: TOP },
      "cms-assets": { dir: "cms-assets", name: "CMS Asset", plural: TOP },
      calling: { dir: "calling", parent: "app", name: "Calling", plural: SUB, singular: true },
      card: { dir: "cards", parent: "app", name: "Card", plural: SUB },
      "app-function": { dir: "functions", parent: "app", name: "App Function", plural: SUB },
      scim: { dir: "scim", parent: "app", name: "SCIM", plural: SUB, singular: true },
      settings: { dir: "settings", parent: "app", name: "Settings Extension", plural: SUB, singular: true },
      "marketing-event": { dir: "marketing-events", parent: "app", name: "Marketing Event", plural: SUB },
      "media-bridge": { dir: "media-bridge", parent: "app", name: "Media Bridge", plural: SUB },
      "app-event": { dir: "app-events", parent: "app", name: "App Event", plural: SUB },
      "video-conferencing": { dir: "video-conferencing", parent: "app", name: "Video Conferencing", plural: SUB },
      webhooks: { dir: "webhooks", parent: "app", name: "Webhooks", plural: SUB, singular: true },
      "webhooks-journal": { dir: "webhooks-journal", parent: "app", name: "Webhooks Journal", plural: SUB, singular: true },
      "workflow-action": { dir: "workflow-actions", parent: "app", name: "Workflow Action", plural: SUB },
      "crm-bulk-action": { dir: "actions", parent: "app", name: "Action", plural: SUB },
      telemetry: { dir: "telemetry", parent: "app", name: "Telemetry", plural: SUB, singular: true },
      "mcp-client": { dir: "mcp-client", parent: "app", name: "MCP Client", plural: SUB, singular: true },
      "mcp-server": { dir: "mcp-server", parent: "app", name: "MCP Server", plural: SUB, singular: true },
      "breeze-tool": { dir: "breeze/tools", parent: "app", name: "Breeze Tool", plural: SUB },
      "breeze-skill": { dir: "breeze/skills", parent: "app", name: "Breeze Skill", plural: SUB }
    };
    PARENT_TYPES = ["app", "theme", "cms-assets"];
    COMPONENT_DIRS = new Set(PARENT_TYPES);
    SUB_COMPONENT_DIRS = new Set(Object.values(COMPONENTS).filter((c) => c.parent === "app").map((c) => `app/${c.dir}`));
    ALLOWED_TOP_LEVEL_FIELDS = /* @__PURE__ */ new Set(["uid", "type", "config", "dependencies", "permissions"]);
    USER_FACING_TO_INTERNAL = {
      app: "APPLICATION",
      calling: "CALLING_EXTENSION",
      scim: "SCIM_INTEGRATION",
      telemetry: "TELEMETRY_CONFIG",
      "cms-assets": "REACT_THEME",
      pages: "PAGE"
    };
    INTERNAL_TO_USER_FACING = Object.fromEntries(Object.entries(USER_FACING_TO_INTERNAL).map(([k, v]) => [v, k]));
    METAFILE_SUFFIX = "-hsmeta.json";
    SERVERLESS_PACKAGE_UID = "hubspot-serverless-package-uid";
    SERVERLESS_PACKAGE_TYPE = "SERVERLESS_PACKAGE";
  }
});

// server/core/deploy/zip.ts
function table() {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}
function crc32(data) {
  const t = table();
  let crc = 4294967295;
  for (let i = 0; i < data.length; i++) crc = t[(crc ^ data[i]) & 255] ^ crc >>> 8;
  return (crc ^ 4294967295) >>> 0;
}
function dosDateTime(date) {
  const year = Math.min(2107, Math.max(1980, date.getUTCFullYear()));
  const time = date.getUTCHours() << 11 | date.getUTCMinutes() << 5 | Math.floor(date.getUTCSeconds() / 2);
  const day = year - 1980 << 9 | date.getUTCMonth() + 1 << 5 | date.getUTCDate();
  return { time: time & 65535, date: day & 65535 };
}
function createZip(entries, options = {}) {
  if (entries.length > 65535) throw new Error("Too many files for a ZIP archive");
  const { time, date } = dosDateTime(options.mtime ?? /* @__PURE__ */ new Date());
  const prepared = entries.map((e) => {
    const name = encoder3.encode(e.path);
    const data = typeof e.data === "string" ? encoder3.encode(e.data) : e.data;
    if (name.length > 65535) throw new Error(`File name too long: ${e.path.slice(0, 80)}`);
    return { name, data, crc: crc32(data) };
  });
  let localSize = 0;
  for (const p of prepared) localSize += 30 + p.name.length + p.data.length;
  let centralSize = 0;
  for (const p of prepared) centralSize += 46 + p.name.length;
  const total = localSize + centralSize + 22;
  if (total > 4294967295) throw new Error("ZIP archive too large");
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;
  const offsets = [];
  for (const p of prepared) {
    offsets.push(offset);
    view.setUint32(offset, LOCAL_HEADER, true);
    view.setUint16(offset + 4, VERSION_NEEDED, true);
    view.setUint16(offset + 6, FLAG_UTF8, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, time, true);
    view.setUint16(offset + 12, date, true);
    view.setUint32(offset + 14, p.crc, true);
    view.setUint32(offset + 18, p.data.length, true);
    view.setUint32(offset + 22, p.data.length, true);
    view.setUint16(offset + 26, p.name.length, true);
    view.setUint16(offset + 28, 0, true);
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
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
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
  view.setUint16(offset + 20, 0, true);
  return out;
}
var encoder3, crcTable, LOCAL_HEADER, CENTRAL_HEADER, END_OF_CENTRAL_DIR, FLAG_UTF8, VERSION_NEEDED, VERSION_MADE_BY, EXTERNAL_ATTRS;
var init_zip = __esm({
  "server/core/deploy/zip.ts"() {
    encoder3 = new TextEncoder();
    crcTable = null;
    LOCAL_HEADER = 67324752;
    CENTRAL_HEADER = 33639248;
    END_OF_CENTRAL_DIR = 101010256;
    FLAG_UTF8 = 2048;
    VERSION_NEEDED = 20;
    VERSION_MADE_BY = 3 << 8 | 20;
    EXTERNAL_ATTRS = 33188 << 16 >>> 0;
  }
});

// server/core/deploy/job.ts
function sealJob(config, state) {
  return seal(state, { secret: config.sessionSecret, purpose: JOB_TOKEN_PURPOSE, aad: JOB_TOKEN_AAD, now: config.now(), ttlSeconds: JOB_TTL_SECONDS });
}
async function unsealJob(config, token) {
  if (!token || token.length > 16e3) return null;
  const s = await unseal(token, { secret: config.sessionSecret, purpose: JOB_TOKEN_PURPOSE, aad: JOB_TOKEN_AAD, now: config.now() });
  if (!s || s.v !== 1 || typeof s.p !== "number" || typeof s.n !== "string" || typeof s.t !== "string" || !Array.isArray(s.l)) return null;
  return s;
}
function appOrigin(config, appHost) {
  return config.hubspotAppBase && config.hubspotAppBase !== DEFAULT_APP_BASE ? config.hubspotAppBase : `https://${appHost}`;
}
function projectUrl(config, s) {
  return `${appOrigin(config, s.h)}/developer-projects/${s.p}/project/${encodeURIComponent(s.n)}`;
}
function stepMessage(s) {
  const busy = s.e > 0 ? " HubSpot is busy right now \u2014 still checking\u2026" : "";
  switch (s.s) {
    case "build":
      return `HubSpot is building your project (build #${s.b}).${busy}`;
    case "autodeploy":
      return `Build #${s.b} is ready. Waiting for HubSpot to start the deploy\u2026${busy}`;
    case "queue":
      return `Build #${s.b} is ready. Starting the deploy\u2026${busy}`;
    case "deploy":
      return `Deploying build #${s.b} to your HubSpot account\u2026${busy}`;
    case "install":
      return "Deployed. Finishing up\u2026";
    case "done":
      return s.m ?? "Your project is live in HubSpot.";
    case "failed":
      return s.m ?? "The deploy failed.";
  }
}
function toStatus(config, deployId, s) {
  const status = {
    deployId,
    phase: PHASE[s.s],
    message: stepMessage(s),
    log: [...s.l],
    portalId: s.p,
    projectName: s.n,
    buildId: s.b,
    projectUrl: projectUrl(config, s)
  };
  if (s.s === "failed") status.error = s.er ?? "deploy_failed";
  if (s.iu) status.installUrl = s.iu;
  return status;
}
function pushLog(s, line) {
  const text = line.replace(/\s+/g, " ").trim();
  if (!text) return;
  s.l.push(text.length > MAX_LOG_LINE ? `${text.slice(0, MAX_LOG_LINE - 1)}\u2026` : text);
  const total = () => s.l.reduce((n, l) => n + l.length, 0);
  const marker = "\u2026 (earlier lines hidden)";
  while (total() > MAX_LOG_CHARS && s.l.length > 2) {
    if (s.l[1] === marker) s.l.splice(2, 1);
    else s.l.splice(1, 1, marker);
  }
}
function goTo(s, step) {
  s.s = step;
  s.c = 0;
}
function finish(s, message) {
  goTo(s, "done");
  s.m = message ?? "Your project is live in HubSpot.";
}
function fail(s, code, message) {
  goTo(s, "failed");
  s.er = code;
  s.m = message;
}
function subtaskName(t) {
  return t.buildName ?? t.deployName ?? t.id ?? "A component";
}
function subtaskErrors(list) {
  const failed = (list ?? []).filter((t) => String(t?.status ?? "").toUpperCase() === "FAILURE");
  const shown = failed.filter((t) => !/DEPENDENT_SUB(BUILD|DEPLOY)_FAILED/.test(t.standardError?.subCategory ?? ""));
  const lines = [];
  for (const t of shown) {
    lines.push(`${subtaskName(t)} failed: ${t.errorMessage?.trim() || t.standardError?.message?.trim() || "no details from HubSpot"}`);
    for (const e of t.standardError?.errors ?? []) if (e?.message?.trim()) lines.push(`\u2022 ${e.message.trim()}`);
  }
  if (lines.length === 0 && failed.length > 0) lines.push(`${failed.map(subtaskName).join(", ")} failed.`);
  return lines;
}
async function addWarnings(s, fetchLogs) {
  try {
    const res = await fetchLogs();
    const seen = /* @__PURE__ */ new Set();
    for (const log of res?.logs ?? []) {
      const msg = typeof log?.message === "string" ? log.message.trim() : "";
      if (msg && !seen.has(msg)) seen.add(msg);
    }
    [...seen].slice(0, 8).forEach((m) => pushLog(s, `Warning: ${m}`));
  } catch {
  }
}
function errorLines(err) {
  if (err instanceof DeployApiError) return err.details;
  return [];
}
function bad(code, message) {
  return new ConnectorError(400, code, message);
}
function parseDeployRequest(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw bad("bad_request", "The deploy request must be a JSON object.");
  const r = raw;
  const projectName = typeof r.projectName === "string" ? r.projectName.trim() : "";
  if (!PROJECT_NAME_RE.test(projectName)) {
    throw bad("invalid_project", "The project name must use letters, digits, dashes, dots or underscores (max 64 characters), e.g. \u201Cmy-hubspot-app\u201D. Change it in App settings.");
  }
  const platformVersion = typeof r.platformVersion === "string" ? r.platformVersion.trim() : "";
  if (!PLATFORM_VERSION_RE.test(platformVersion)) throw bad("invalid_project", `Unsupported platform version: '${platformVersion.slice(0, 40)}'.`);
  let portalId;
  if (r.portalId !== void 0 && r.portalId !== null) {
    if (typeof r.portalId !== "number" || !Number.isSafeInteger(r.portalId) || r.portalId <= 0) throw bad("bad_request", "portalId must be a HubSpot account id.");
    portalId = r.portalId;
  }
  return {
    personalAccessKey: typeof r.personalAccessKey === "string" ? r.personalAccessKey.trim() : "",
    useRememberedKey: r.useRememberedKey === true,
    remember: r.remember === true,
    portalId,
    projectName,
    platformVersion,
    files: r.files
  };
}
function listProblems(intro, problems) {
  const shown = problems.slice(0, 6).join(" \u2022 ");
  const more = problems.length > 6 ? ` (and ${problems.length - 6} more)` : "";
  return `${intro} ${shown}${more}`;
}
function appHostForKey(key, session, portalId) {
  if (session && session.portalId === portalId && session.appHost) return session.appHost;
  const direct = appHostFor({ refreshToken: key });
  if (direct !== "app.hubspot.com") return direct;
  try {
    const head = key.replace(/-/g, "+").replace(/_/g, "/").slice(0, 24);
    const region = /([a-z]{2}\d)-/.exec(atob(head))?.[1];
    if (region && region !== "na1") return `app-${region}.hubspot.com`;
  } catch {
  }
  return "app.hubspot.com";
}
async function ensureProject(client, name) {
  try {
    const project2 = await projectsApi.fetchProject(client, name);
    if (project2) return { project: project2, created: false };
  } catch (err) {
    if (!(err instanceof DeployApiError) || err.code !== "not_found") throw err;
  }
  const project = await projectsApi.createProject(client, name);
  return { project, created: true };
}
function isPrivateStaticApp(node) {
  const config = node?.config;
  return !!config && config.distribution === "private" && config.auth?.type === "static";
}
async function startDeploy(config, session, raw) {
  if (!sessionSecretUsable(config)) {
    throw new ConnectorError(503, "not_configured", "Deploying from the builder needs SESSION_SECRET (at least 32 random characters) on the server. Ask whoever hosts the builder to set it.");
  }
  const req = parseDeployRequest(raw);
  const { files, problems } = validateDeployFiles(req.files);
  if (problems.length) throw bad("invalid_files", listProblems("Some project files can't be uploaded:", problems));
  const pc = readProjectConfig(files);
  if (pc.problem) throw bad("invalid_project", pc.problem);
  if (pc.config?.name !== void 0 && pc.config.name !== req.projectName) {
    throw bad("invalid_project", `hsproject.json names the project \u201C${pc.config.name.slice(0, 64)}\u201D, but the deploy is for \u201C${req.projectName}\u201D.`);
  }
  if (pc.config?.platformVersion !== void 0 && pc.config.platformVersion !== req.platformVersion) {
    throw bad("invalid_project", `hsproject.json uses platform version ${pc.config.platformVersion.slice(0, 40)}, but the deploy is for ${req.platformVersion}.`);
  }
  if (isLegacyPlatformVersion(req.platformVersion)) {
    throw bad("unsupported_platform", `Projects on platform version ${req.platformVersion} can't be deployed from the builder. Choose 2025.2 or later in App settings.`);
  }
  const srcDir = pc.config ? pc.config.srcDir : "src";
  const src = uploadSourceFiles(files, srcDir);
  if (src.length === 0) throw bad("invalid_project", `There are no files in the project's source folder (${srcDir || "project root"}).`);
  const local = translateProject(src, req.platformVersion, null);
  if (local.errors.length) throw bad("invalid_project", listProblems("HubSpot would reject the project:", local.errors));
  const sessionData = await session.get().catch(() => null);
  let key = req.personalAccessKey;
  let usedRemembered = false;
  if (!key && req.useRememberedKey) {
    key = sessionData?.personalAccessKey ?? "";
    usedRemembered = true;
    if (!key) throw bad("no_remembered_key", "No personal access key is saved on this browser any more. Paste your key to deploy.");
  }
  const keyProblem = personalAccessKeyProblem(key);
  if (keyProblem) throw bad(key ? "invalid_key" : "missing_key", keyProblem);
  const token = await exchangePersonalAccessKey(config, key);
  const target = req.portalId ?? sessionData?.portalId;
  if (target !== void 0 && target !== token.portalId) throw new PortalMismatchError(token.portalId, target, token.hubName);
  const state = {
    v: 1,
    s: "build",
    p: token.portalId,
    n: req.projectName,
    pv: req.platformVersion,
    b: 0,
    t: token.accessToken,
    te: token.expiresAt,
    h: appHostForKey(key, sessionData, token.portalId),
    c: 0,
    e: 0,
    l: [],
    st: config.now()
  };
  pushLog(state, `Signed in to HubSpot account ${token.portalId}${token.hubName ? ` (${token.hubName})` : ""} with your personal access key.`);
  if (req.remember && !usedRemembered) {
    if (!sessionData) {
      pushLog(state, "The key wasn't saved: connect HubSpot first to remember it on this browser.");
    } else if (sessionData.portalId !== token.portalId) {
      pushLog(state, "The key wasn't saved because it belongs to a different HubSpot account than the one you're connected to.");
    } else {
      try {
        await session.set({ ...sessionData, personalAccessKey: key });
        pushLog(state, "Saved the key on this browser (encrypted) for next time.");
      } catch {
        pushLog(state, "The key couldn't be saved on this browser.");
      }
    }
  }
  if (lacksDeveloperProjects(token.scopeGroups)) pushLog(state, "Warning: this key may be missing the \u201CDeveloper projects\u201D permission.");
  const client = new DeployHubSpotClient(config, token.accessToken, token.portalId);
  let schemas = null;
  try {
    schemas = await projectsApi.fetchSchemas(client, req.platformVersion);
  } catch (err) {
    if (err instanceof HubSpotApiError && err.status === 403) {
      throw new DeployApiError(DEVELOPER_PROJECTS_PERMISSION_HELP, 403, "missing_scope", errorLines(err), err.correlationId, err.requiredScopes);
    }
    if (!(err instanceof DeployApiError) || err.code !== "not_found") throw err;
  }
  if (!schemas || typeof schemas !== "object" || Object.keys(schemas).length === 0) {
    throw bad("platform_unavailable", `Platform version ${req.platformVersion} isn't available in this HubSpot account. Choose another platform version in App settings.`);
  }
  const translated = translateProject(src, req.platformVersion, schemas);
  if (translated.errors.length) throw bad("invalid_project", listProblems("HubSpot would reject the project:", translated.errors));
  if (translated.skippedHsMetaFiles.length) {
    pushLog(state, `Skipped ${translated.skippedHsMetaFiles.length} *-hsmeta.json file(s) outside component folders: ${translated.skippedHsMetaFiles.slice(0, 3).join(", ")}`);
  }
  const { created } = await ensureProject(client, req.projectName);
  pushLog(state, created ? `Created the project \u201C${req.projectName}\u201D in HubSpot.` : `Found the project \u201C${req.projectName}\u201D in HubSpot.`);
  const zip = createZip(
    src.map((f) => ({ path: f.path, data: f.contents })),
    { mtime: new Date(config.now()) }
  );
  const form = new FormData();
  form.append("projectFilesZip", new Blob([zip], { type: "application/zip" }), `${req.projectName}.zip`);
  form.append("platformVersion", req.platformVersion);
  form.append(
    "uploadRequest",
    JSON.stringify({ ...translated.intermediateRepresentation, projectName: req.projectName, buildMessage: BUILD_MESSAGE, skipAutoDeploy: false })
  );
  const upload = await projectsApi.uploadIR(client, form);
  const buildId = Number(upload?.createdBuildId ?? upload?.buildId);
  if (!Number.isSafeInteger(buildId) || buildId <= 0) {
    throw new DeployApiError("HubSpot accepted the upload but did not say which build it started. Open the project in HubSpot to check on it.", 502, "hubspot_error");
  }
  state.b = buildId;
  pushLog(state, `Uploaded ${src.length} files. HubSpot started build #${buildId}.`);
  const appNode = Object.values(translated.intermediateRepresentation.intermediateNodesIndexedByUid).find((n) => n.componentType === "APPLICATION");
  if (appNode && isPrivateStaticApp(appNode)) state.au = appNode.uid;
  const deployId = await sealJob(config, state);
  return { state, deployId, status: toStatus(config, deployId, state) };
}
async function renewAccess(config, session, s) {
  try {
    const data = await session.get();
    if (!data?.personalAccessKey || data.portalId !== s.p) return false;
    const token = await exchangePersonalAccessKey(config, data.personalAccessKey);
    if (token.portalId !== s.p) return false;
    s.t = token.accessToken;
    s.te = token.expiresAt;
    return true;
  } catch {
    return false;
  }
}
function afterBuild(s, build) {
  const locatorId = build.deployStatusTaskLocator?.id;
  if (build.isAutoDeployEnabled) {
    if ((build.autoDeployId ?? 0) > 0 && locatorId !== void 0 && locatorId !== null) {
      s.d = Number(locatorId);
      pushLog(s, `HubSpot is deploying build #${s.b} automatically.`);
      goTo(s, "deploy");
    } else {
      goTo(s, "autodeploy");
    }
    return;
  }
  if (meetsMinimumPlatformVersion(build.platformVersion ?? s.pv, "2027.03")) {
    finish(s, `Build #${s.b} is ready. This project uses release management: create a release for build #${s.b} in HubSpot to make it live.`);
    return;
  }
  pushLog(s, `Automatic deploys are turned off for this project, so the builder is deploying build #${s.b} now.`);
  goTo(s, "queue");
}
async function runStep(config, s, client) {
  switch (s.s) {
    case "build": {
      const build = await projectsApi.buildStatus(client, s.n, s.b);
      s.e = 0;
      const st = String(build?.status ?? "").toUpperCase();
      if (st === "SUCCESS") {
        pushLog(s, `Build #${s.b} succeeded.`);
        await addWarnings(s, () => projectsApi.buildWarnLogs(client, s.n, s.b));
        afterBuild(s, build);
      } else if (st === "FAILURE") {
        for (const line of subtaskErrors(build.subbuildStatuses)) pushLog(s, line);
        pushLog(s, `Build #${s.b} failed.`);
        fail(s, "build_failed", `HubSpot couldn't build your project (build #${s.b}). The log below says why \u2014 fix it in the builder and deploy again.`);
      } else if (++s.c >= MAX_BUILD_POLLS) {
        fail(s, "timeout", `Build #${s.b} is taking much longer than usual. Open the project in HubSpot to see how it is going.`);
      }
      return;
    }
    case "autodeploy": {
      const build = await projectsApi.buildStatus(client, s.n, s.b);
      s.e = 0;
      const locatorId = build?.deployStatusTaskLocator?.id;
      if ((build?.autoDeployId ?? 0) > 0 && locatorId !== void 0 && locatorId !== null) {
        s.d = Number(locatorId);
        pushLog(s, `HubSpot is deploying build #${s.b} automatically.`);
        goTo(s, "deploy");
      } else if (++s.c >= AUTODEPLOY_WAIT_POLLS) {
        fail(
          s,
          "autodeploy_missing",
          `HubSpot built your project (build #${s.b}) but didn't start the automatic deploy \u2014 it may have been skipped or blocked, for example because components were removed. Open the project in HubSpot to deploy build #${s.b}.`
        );
      }
      return;
    }
    case "queue": {
      const res = await projectsApi.queueDeploy(client, s.n, s.b);
      s.e = 0;
      if (res && res.buildResultType === "DEPLOY_BLOCKED") {
        const issues = res.issues ?? [];
        const warningsOnly = issues.length > 0 && issues.every((i) => (i.blockingMessages ?? []).every((m) => m?.isWarning));
        for (const issue of issues) {
          const who = `${issue.uid ?? "component"}${issue.componentTypeName ? ` (${issue.componentTypeName})` : ""}`;
          const msgs = (issue.blockingMessages ?? []).map((m) => m?.message?.trim()).filter(Boolean);
          if (msgs.length === 0) pushLog(s, `${who} can't be deployed.`);
          for (const m of msgs) pushLog(s, `${who}: ${m}`);
        }
        fail(
          s,
          "deploy_blocked",
          warningsOnly ? `HubSpot paused the deploy of build #${s.b} because of the warnings below. Review them, then deploy build #${s.b} from the project page in HubSpot.` : `HubSpot blocked the deploy of build #${s.b}. The log below says why.`
        );
        return;
      }
      const id = res && "id" in res ? Number(res.id) : NaN;
      if (!Number.isFinite(id) || id <= 0) {
        fail(s, "deploy_failed", `HubSpot didn't start the deploy of build #${s.b}. Open the project in HubSpot to deploy it.`);
        return;
      }
      s.d = id;
      pushLog(s, `Deploying build #${s.b}.`);
      goTo(s, "deploy");
      return;
    }
    case "deploy": {
      const deploy = await projectsApi.deployStatus(client, s.n, s.d ?? 0);
      s.e = 0;
      const st = String(deploy?.status ?? "").toUpperCase();
      if (st === "SUCCESS" || st === "FINISHED") {
        pushLog(s, `Deployed build #${s.b}.`);
        await addWarnings(s, () => projectsApi.deployWarnLogs(client, s.n, s.d ?? 0));
        if (s.au) goTo(s, "install");
        else finish(s);
      } else if (st === "FAILURE") {
        for (const line of subtaskErrors(deploy.subdeployStatuses)) pushLog(s, line);
        pushLog(s, `Deploy of build #${s.b} failed.`);
        fail(s, "deploy_failed", `HubSpot couldn't deploy build #${s.b}. The log below says why.`);
      } else if (++s.c >= MAX_DEPLOY_POLLS) {
        fail(s, "timeout", `The deploy is taking much longer than usual. Open the project in HubSpot to see how it is going.`);
      }
      return;
    }
    case "install": {
      try {
        const app = await projectsApi.appByUid(client, s.au ?? "");
        if (typeof app?.id === "number" && app.id > 0) s.iu = `${appOrigin(config, s.h)}/static-token/${s.p}/authorize?appId=${app.id}`;
      } catch {
      }
      finish(s);
      return;
    }
    case "done":
    case "failed":
      return;
  }
}
function handleStepError(s, err) {
  if (isTransient(err)) {
    s.e += 1;
    if (s.e >= MAX_TRANSIENT_ERRORS) {
      fail(s, "hubspot_unavailable", "HubSpot hasn't answered for a while. Open the project in HubSpot to see how the deploy is going.");
    }
    return;
  }
  for (const line of errorLines(err)) pushLog(s, line);
  const message = err instanceof HubSpotApiError || err instanceof ConnectorError ? err.message : "Something went wrong while checking on the deploy.";
  const code = err instanceof HubSpotApiError || err instanceof ConnectorError ? err.code : "internal_error";
  fail(s, code, message);
}
async function advanceDeploy(config, session, deployId) {
  if (!sessionSecretUsable(config)) {
    throw new ConnectorError(503, "not_configured", "Deploying from the builder needs SESSION_SECRET on the server.");
  }
  const current = await unsealJob(config, deployId);
  if (!current) {
    throw new ConnectorError(
      404,
      "deploy_not_found",
      "This deploy can't be followed any more (status links expire after an hour). Open the project in HubSpot to see how it went, or deploy again."
    );
  }
  if (current.s === "done" || current.s === "failed") return { state: current, deployId, status: toStatus(config, deployId, current) };
  const s = { ...current, l: [...current.l] };
  if (s.te - config.now() < TOKEN_REFRESH_MARGIN_MS) await renewAccess(config, session, s);
  const client = new DeployHubSpotClient(config, s.t, s.p);
  try {
    await runStep(config, s, client);
  } catch (err) {
    if (err instanceof HubSpotApiError && err.status === 401) {
      if (await renewAccess(config, session, s)) {
        pushLog(s, "Renewed HubSpot access with the key saved on this browser.");
        client.accessToken = s.t;
        try {
          await runStep(config, s, client);
        } catch (again) {
          handleStepError(s, again);
        }
      } else {
        fail(
          s,
          "expired",
          `HubSpot access for this deploy expired before it finished. Open the project in HubSpot to check on build #${s.b}, or deploy again.`
        );
      }
    } else {
      handleStepError(s, err);
    }
  }
  const next = await sealJob(config, s);
  return { state: s, deployId: next, status: toStatus(config, next, s) };
}
var JOB_TOKEN_PURPOSE, JOB_TOKEN_AAD, JOB_TTL_SECONDS, MAX_BUILD_POLLS, MAX_DEPLOY_POLLS, AUTODEPLOY_WAIT_POLLS, MAX_TRANSIENT_ERRORS, MAX_LOG_CHARS, MAX_LOG_LINE, TOKEN_REFRESH_MARGIN_MS, BUILD_MESSAGE, PROJECT_NAME_RE, PLATFORM_VERSION_RE, PortalMismatchError, PHASE;
var init_job = __esm({
  "server/core/deploy/job.ts"() {
    init_types();
    init_http();
    init_crypto();
    init_session();
    init_oauth();
    init_config();
    init_api();
    init_ir();
    init_paths();
    init_zip();
    JOB_TOKEN_PURPOSE = "deploy-job";
    JOB_TOKEN_AAD = "uiex-deploy-job";
    JOB_TTL_SECONDS = 60 * 60;
    MAX_BUILD_POLLS = 400;
    MAX_DEPLOY_POLLS = 400;
    AUTODEPLOY_WAIT_POLLS = 10;
    MAX_TRANSIENT_ERRORS = 6;
    MAX_LOG_CHARS = 2400;
    MAX_LOG_LINE = 280;
    TOKEN_REFRESH_MARGIN_MS = 2 * 60 * 1e3;
    BUILD_MESSAGE = "Uploaded from UI Extension Builder";
    PROJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
    PLATFORM_VERSION_RE = /^(\d{4}\.\d{1,2}(-beta)?|unstable)$/;
    PortalMismatchError = class extends ConnectorError {
      constructor(keyPortalId, targetPortalId, hubName) {
        super(
          409,
          "portal_mismatch",
          `This personal access key belongs to HubSpot account ${keyPortalId}${hubName ? ` (${hubName})` : ""}, but the deploy is going to account ${targetPortalId}. Use a key from account ${targetPortalId}, or deploy to account ${keyPortalId} instead.`
        );
        this.keyPortalId = keyPortalId;
        this.targetPortalId = targetPortalId;
      }
      keyPortalId;
      targetPortalId;
    };
    PHASE = {
      build: "building",
      autodeploy: "deploying",
      queue: "deploying",
      deploy: "deploying",
      install: "deploying",
      done: "success",
      failed: "failed"
    };
  }
});

// server/core/routes/deploy.ts
async function keyInfo(ctx) {
  const data = await ctx.session.get().catch(() => null);
  return data?.personalAccessKey ? { remembered: true, portalId: data.portalId } : { remembered: false };
}
function portalMismatch(err) {
  const body = { error: { code: err.code, message: err.message, status: err.status, portalId: err.keyPortalId } };
  return json(body, err.status);
}
var deployRoutes;
var init_deploy = __esm({
  "server/core/routes/deploy.ts"() {
    init_types2();
    init_http();
    init_paths();
    init_job();
    deployRoutes = [
      {
        method: "POST",
        path: CONNECTOR_ROUTES.deployStart,
        handler: async (ctx) => {
          const body = await readJsonBody(ctx.request, DEPLOY_LIMITS.maxBodyBytes);
          try {
            const { status } = await startDeploy(ctx.config, ctx.session, body);
            return json(status);
          } catch (err) {
            if (err instanceof PortalMismatchError) return portalMismatch(err);
            throw err;
          }
        }
      },
      {
        method: "GET",
        path: CONNECTOR_ROUTES.deployKey,
        handler: async (ctx) => json(await keyInfo(ctx))
      },
      {
        method: "DELETE",
        path: CONNECTOR_ROUTES.deployKey,
        handler: async (ctx) => {
          const data = await ctx.session.get().catch(() => null);
          if (data?.personalAccessKey) {
            const rest = { ...data };
            delete rest.personalAccessKey;
            await ctx.session.set(rest);
          }
          return json({ remembered: false });
        }
      },
      {
        method: "GET",
        path: CONNECTOR_ROUTES.deployStatus,
        handler: async (ctx) => {
          const { status } = await advanceDeploy(ctx.config, ctx.session, ctx.params.deployId ?? "");
          return json(status);
        }
      }
    ];
  }
});

// server/core/index.ts
var core_exports = {};
__export(core_exports, {
  AUTH_BROADCAST_CHANNEL: () => AUTH_BROADCAST_CHANNEL,
  AUTH_MESSAGE_TYPE: () => AUTH_MESSAGE_TYPE,
  CONNECTOR_VERSION: () => CONNECTOR_VERSION,
  ConnectorError: () => ConnectorError,
  DEFAULT_OPTIONAL_SCOPES: () => DEFAULT_OPTIONAL_SCOPES,
  DEFAULT_REQUIRED_SCOPES: () => DEFAULT_REQUIRED_SCOPES,
  HubSpotApiError: () => HubSpotApiError,
  OAUTH_COOKIE: () => OAUTH_COOKIE,
  REQUEST_TIMEOUT_MS: () => REQUEST_TIMEOUT_MS,
  RateLimitedError: () => RateLimitedError,
  SESSION_COOKIE: () => SESSION_COOKIE,
  appHostFor: () => appHostFor,
  checkConfig: () => checkConfig,
  configFromEnv: () => configFromEnv,
  createConnector: () => createConnector,
  errorJson: () => errorJson,
  json: () => json,
  readJsonBody: () => readJsonBody
});
function isApiPath(pathname) {
  return pathname === "/api" || pathname.startsWith("/api/");
}
function createConnector(config, options = {}) {
  const status = checkConfig(config);
  const router = new Router([...authRoutes(status), ...crmRoutes(), ...proxyRoutes()]);
  for (const r of deployRoutes) router.add(r);
  const timeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const log = options.log ?? ((m) => console.error(m));
  async function dispatch(request, url, session) {
    if (request.method === "OPTIONS") return preflightResponse(config, request);
    if (!config.enableDeploy && (url.pathname === "/api/deploy" || url.pathname.startsWith("/api/deploy/"))) {
      return errorJson(404, "feature_disabled", "Deploying from the builder is turned off on this server.");
    }
    const match = router.match(request.method === "HEAD" ? "GET" : request.method, url.pathname);
    if (match.kind === "not-found") {
      return errorJson(404, "not_found", `There is no connector endpoint at ${url.pathname.slice(0, 200)}.`);
    }
    if (match.kind === "method-not-allowed") {
      return errorJson(405, "method_not_allowed", `Use ${match.allow.join(" or ")} for this endpoint.`, { headers: { Allow: match.allow.join(", ") } });
    }
    const route = match.route;
    if (route.csrf !== false) assertCsrf(config, request);
    let api = null;
    const ctx = {
      request,
      url,
      params: match.params,
      config,
      session,
      hubspot: async () => {
        if (!status.oauthConfigured) throw new ConnectorError(503, "not_configured", notConfiguredMessage(status));
        if (api) return api;
        const data = await session.get();
        if (!data) throw new ConnectorError(401, "not_connected", "Connect HubSpot to see real data.");
        api = new SessionHubSpotApi(config, session, data, options.hubspot);
        return api;
      }
    };
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new ConnectorError(504, "timeout", "HubSpot took too long to answer. Please try again.")), timeoutMs);
    });
    try {
      return await Promise.race([Promise.resolve(route.handler(ctx)), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    async handle(request) {
      let url;
      try {
        url = new URL(request.url);
      } catch {
        return null;
      }
      if (!isApiPath(url.pathname)) return null;
      const session = new CookieSession(request, config);
      const redact = (s) => redactText(s, [config.hubspotClientSecret, config.sessionSecret, ...session.knownSecrets()]);
      let response;
      try {
        response = await dispatch(request, url, session);
      } catch (err) {
        if (!(err instanceof ConnectorError) && !(err instanceof HubSpotApiError)) {
          const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          log(redact(`[uiex-connector] ${request.method} ${url.pathname} failed: ${detail}`));
        }
        response = errorToResponse(err, redact);
      }
      return finalize(response, request, session);
    }
  };
  function finalize(response, request, session) {
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(API_SECURITY_HEADERS)) if (!headers.has(k)) headers.set(k, v);
    for (const [k, v] of Object.entries(corsHeaders(config, request))) headers.set(k, v);
    for (const cookie of session.setCookieHeaders()) headers.append("Set-Cookie", cookie);
    const body = request.method === "HEAD" ? null : response.body;
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  }
}
var REQUEST_TIMEOUT_MS;
var init_core = __esm({
  "server/core/index.ts"() {
    init_types();
    init_http();
    init_config();
    init_router();
    init_session();
    init_hubspot();
    init_security();
    init_auth();
    init_crm();
    init_proxy();
    init_deploy();
    init_config();
    init_http();
    init_session();
    init_oauth();
    init_authPage();
    init_types();
    REQUEST_TIMEOUT_MS = 25e3;
  }
});

// server/node.ts
import { createServer } from "node:http";
import { createReadStream, existsSync, promises as fsp, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import zlib from "node:zlib";

// server/hosting.ts
var HUBSPOT_SETTING_NAMES = ["APP_URL", "HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET", "SESSION_SECRET"];
var PLACEHOLDER = /^(later|todo|tbd|tbc|none|null|undefined|nil|skip|empty|blank|placeholder|pending|change[-_ ]?me|replace[-_ ]?me|fill[-_ ]?me|x+|-+|\.+|\?+|n\/?a|<[^>]*>|\{\{[^}]*\}\}|your[-_ ][a-z0-9 _-]*)$/i;
function isPlaceholder(value) {
  if (value === void 0 || value === null) return true;
  const v = value.trim();
  return v === "" || PLACEHOLDER.test(v) || /your[-_]?domain/i.test(v);
}
function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
function normalizeHostingEnv(env) {
  const out = { ...env };
  const notes = [];
  for (const name of HUBSPOT_SETTING_NAMES) {
    const raw = out[name];
    if (raw === void 0) continue;
    if (isPlaceholder(raw)) {
      if (raw.trim() !== "") notes.push(`${name} looks like a placeholder, so it is treated as not set yet.`);
      delete out[name];
      continue;
    }
    out[name] = name === "SESSION_SECRET" ? raw : raw.trim();
  }
  const appUrl = out.APP_URL;
  if (appUrl !== void 0) {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(appUrl);
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(appUrl) ? appUrl : `${local ? "http" : "https"}://${appUrl}`;
    if (isHttpUrl(withScheme)) {
      out.APP_URL = withScheme.replace(/\/+$/, "");
    } else {
      notes.push("APP_URL is not a web address (it should look like https://builder.example.com), so it is ignored.");
      delete out.APP_URL;
    }
  }
  return { env: out, notes };
}
var HEALTH_PATH = "/api/health";
var CSRF_HEADER = "X-UIEX-Request";
function allowPlainHealthCheck(request) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return request;
  let pathname;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return request;
  }
  if (pathname !== HEALTH_PATH && pathname !== `${HEALTH_PATH}/`) return request;
  if (request.headers.has(CSRF_HEADER) || request.headers.has("origin")) return request;
  const headers = new Headers(request.headers);
  headers.set(CSRF_HEADER, "health-check");
  return new Request(request.url, { method, headers, signal: request.signal });
}

// server/node.ts
var DEFAULT_BODY_LIMIT = 5 * 1024 * 1024;
var DEFAULT_PORT = 3e3;
var CALLBACK_PATH = "/api/auth/callback";
var HEALTH_PATH2 = "/api/health";
var HOP_BY_HOP = /* @__PURE__ */ new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "http2-settings"
]);
var BodyTooLargeError = class extends Error {
  constructor(limit) {
    super(`The request body is larger than ${limit} bytes.`);
    this.limit = limit;
    this.name = "BodyTooLargeError";
  }
  limit;
};
function requestTarget(rawUrl) {
  const raw = rawUrl ?? "/";
  if (raw.startsWith("/")) return raw;
  try {
    const u = new URL(raw);
    return `${u.pathname}${u.search}`;
  } catch {
    return "/";
  }
}
function requestPathname(rawUrl) {
  const target = requestTarget(rawUrl);
  const q = target.search(/[?#]/);
  return q === -1 ? target : target.slice(0, q);
}
function readNodeBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      reject(new BodyTooLargeError(limit));
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish2 = (err) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(Buffer.concat(chunks, size));
    };
    req.on("data", (chunk2) => {
      if (settled) return;
      size += chunk2.length;
      if (size > limit) {
        chunks.length = 0;
        finish2(new BodyTooLargeError(limit));
        return;
      }
      chunks.push(chunk2);
    });
    req.on("end", () => finish2(null));
    req.on("error", (err) => finish2(err));
    req.on("close", () => finish2(new Error("The client closed the connection before the request body was received.")));
  });
}
async function toWebRequest(req, opts) {
  const method = (req.method ?? "GET").toUpperCase();
  const origin = new URL(opts.origin).origin;
  const url = `${origin}${requestTarget(req.url)}`;
  const headers = new Headers();
  const raw = req.rawHeaders;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i];
    const lower = name.toLowerCase();
    if (lower.startsWith(":") || lower === "cookie" || HOP_BY_HOP.has(lower)) continue;
    try {
      headers.append(name, raw[i + 1]);
    } catch {
    }
  }
  const cookie = req.headers.cookie;
  if (cookie) headers.set("cookie", Array.isArray(cookie) ? cookie.join("; ") : cookie);
  const init = { method, headers };
  if (opts.signal) init.signal = opts.signal;
  if (method !== "GET" && method !== "HEAD") {
    const body = await readNodeBody(req, opts.bodyLimit ?? DEFAULT_BODY_LIMIT);
    if (body.length > 0) init.body = new Uint8Array(body);
  }
  return new Request(url, init);
}
var PRINTABLE_STATUS_TEXT = /^[\t\x20-\x7e]*$/;
async function writeWebResponse(res, response, opts = {}) {
  res.statusCode = response.status;
  if (response.statusText && PRINTABLE_STATUS_TEXT.test(response.statusText)) res.statusMessage = response.statusText;
  response.headers.forEach((value, name) => {
    if (name === "set-cookie" || HOP_BY_HOP.has(name)) return;
    res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader("set-cookie", cookies);
  for (const [name, value] of Object.entries(opts.defaults ?? {})) {
    if (!res.hasHeader(name)) res.setHeader(name, value);
  }
  const noBody = opts.head || response.status === 204 || response.status === 304 || response.status < 200;
  if (!response.body || noBody) {
    if (response.body) await response.body.cancel().catch(() => {
    });
    res.end();
    return;
  }
  const reader = response.body.getReader();
  let closed = false;
  const onClose = () => {
    closed = true;
    reader.cancel().catch(() => {
    });
  };
  res.on("close", onClose);
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done || closed) break;
      if (!res.write(value)) await drainOrClose(res);
    }
    if (!closed) res.end();
  } catch (err) {
    if (!res.destroyed) res.destroy(err instanceof Error ? err : new Error(String(err)));
  } finally {
    res.off("close", onClose);
  }
}
function drainOrClose(res) {
  return new Promise((resolve) => {
    const done = () => {
      res.off("drain", done);
      res.off("close", done);
      resolve();
    };
    res.on("drain", done);
    res.on("close", done);
  });
}
var CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
  ".zip": "application/zip"
};
function contentTypeFor(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}
function isCompressible(contentType) {
  return /^(text\/|application\/(json|javascript|manifest\+json|xml|wasm)|image\/svg\+xml)/.test(contentType);
}
function staticSecurityHeaders(hsts) {
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Resource-Policy": "same-origin"
  };
  if (hsts) headers["Strict-Transport-Security"] = "max-age=15552000";
  return headers;
}
function resolveStaticPath(root, rawUrl) {
  const encoded = requestPathname(rawUrl);
  let pathname;
  try {
    pathname = decodeURIComponent(encoded);
  } catch {
    return { kind: "bad-request" };
  }
  if (pathname.includes("\0")) return { kind: "bad-request" };
  if (pathname.includes("\\")) return { kind: "forbidden" };
  const segments = pathname.split("/");
  for (const seg of segments) {
    if (seg === "..") return { kind: "forbidden" };
    if (seg.startsWith(".") && seg !== ".well-known" && seg !== ".") return { kind: "forbidden" };
  }
  const base = path.resolve(root);
  const file = path.resolve(base, `.${path.posix.normalize(`/${pathname}`)}`);
  if (file !== base && !file.startsWith(base + path.sep)) return { kind: "forbidden" };
  return { kind: "ok", file, pathname };
}
function wantsSpaFallback(pathname) {
  if (pathname === "/api" || pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/assets/")) return false;
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  const ext = path.extname(last).toLowerCase();
  return ext === "" || ext === ".html";
}
function cacheControlFor(pathname, file) {
  if (file.endsWith(".html")) return "no-cache";
  if (pathname.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}
function pickEncoding(acceptEncoding) {
  const header = Array.isArray(acceptEncoding) ? acceptEncoding.join(",") : acceptEncoding ?? "";
  const accepted = /* @__PURE__ */ new Map();
  for (const part of header.split(",")) {
    const [rawName, ...params] = part.trim().split(";");
    const name = rawName.trim().toLowerCase();
    if (!name) continue;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q=([0-9.]+)\s*$/i.exec(p);
      if (m) q = Number(m[1]);
    }
    accepted.set(name, Number.isFinite(q) ? q : 0);
  }
  const ok = (name) => (accepted.get(name) ?? accepted.get("*") ?? 0) > 0;
  if (ok("br")) return "br";
  if (ok("gzip")) return "gzip";
  return null;
}
var brotli = promisify(zlib.brotliCompress);
var gzip = promisify(zlib.gzip);
var MAX_COMPRESS_IN_MEMORY = 16 * 1024 * 1024;
var MIN_COMPRESS_SIZE = 1024;
var CompressionCache = class {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
  }
  maxBytes;
  entries = /* @__PURE__ */ new Map();
  bytes = 0;
  pending = /* @__PURE__ */ new Map();
  async get(file, stat, encoding) {
    const key = `${file}\0${stat.size}\0${stat.mtimeMs}\0${encoding}`;
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const work = (async () => {
      const data = await fsp.readFile(file);
      const out = encoding === "br" ? await brotli(data, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length }
      }) : await gzip(data, { level: 6 });
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
  store(key, value) {
    if (value.length > this.maxBytes) return;
    this.entries.set(key, value);
    this.bytes += value.length;
    for (const [k, v] of this.entries) {
      if (this.bytes <= this.maxBytes) break;
      this.entries.delete(k);
      this.bytes -= v.length;
    }
  }
};
function etagFor(stat, encoding) {
  return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}${encoding ? `-${encoding}` : ""}"`;
}
function etagMatches(header, etag) {
  if (!header) return false;
  const bare = etag.replace(/^W\//, "");
  return header.split(",").some((t) => {
    const v = t.trim();
    return v === "*" || v.replace(/^W\//, "") === bare;
  });
}
async function statOrNull(file) {
  try {
    return await fsp.stat(file);
  } catch {
    return null;
  }
}
function createStaticHandler(opts) {
  const root = path.resolve(opts.root);
  let realRoot = root;
  try {
    realRoot = realpathSync(root);
  } catch {
  }
  const compress = opts.compress !== false;
  const cache = new CompressionCache(opts.cacheBytes ?? 64 * 1024 * 1024);
  const security = staticSecurityHeaders(!!opts.hsts);
  async function insideRoot(file) {
    try {
      const real = await fsp.realpath(file);
      return real === realRoot || real.startsWith(realRoot + path.sep);
    } catch {
      return false;
    }
  }
  const sendPlain = (res, status, text, extra = {}) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
    res.end(text);
  };
  const handler = async (req, res) => {
    for (const [k, v] of Object.entries(security)) res.setHeader(k, v);
    const method = (req.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      sendPlain(res, 405, "Method not allowed.", { Allow: "GET, HEAD" });
      return;
    }
    const resolved = resolveStaticPath(root, req.url);
    if (resolved.kind === "bad-request") return sendPlain(res, 400, "Bad request.");
    if (resolved.kind === "forbidden") return sendPlain(res, 404, "Not found.");
    let file = resolved.file;
    let stat = await statOrNull(file);
    if (stat?.isDirectory()) {
      file = path.join(file, "index.html");
      stat = await statOrNull(file);
    }
    if (stat && stat.isFile() && !await insideRoot(file)) stat = null;
    if (!stat || !stat.isFile()) {
      if (!wantsSpaFallback(resolved.pathname)) return sendPlain(res, 404, "Not found.");
      file = path.join(root, "index.html");
      stat = await statOrNull(file);
      if (!stat || !stat.isFile()) {
        return sendPlain(res, 503, 'The builder has not been built yet. Run "npm run build" and restart the server.');
      }
    }
    const type = contentTypeFor(file);
    const compressible = compress && isCompressible(type) && stat.size >= MIN_COMPRESS_SIZE;
    const encoding = compressible && stat.size <= MAX_COMPRESS_IN_MEMORY ? pickEncoding(req.headers["accept-encoding"]) : null;
    const etag = etagFor(stat, encoding);
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", cacheControlFor(resolved.pathname, file));
    res.setHeader("ETag", etag);
    res.setHeader("Last-Modified", stat.mtime.toUTCString());
    if (compressible) res.setHeader("Vary", "Accept-Encoding");
    if (etagMatches(req.headers["if-none-match"], etag)) {
      res.statusCode = 304;
      res.end();
      return;
    }
    if (encoding) {
      let body;
      try {
        body = await cache.get(file, stat, encoding);
      } catch {
        return sendPlain(res, 500, "Could not read the file.");
      }
      res.statusCode = 200;
      res.setHeader("Content-Encoding", encoding);
      res.setHeader("Content-Length", String(body.length));
      res.end(method === "HEAD" ? void 0 : body);
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Length", String(stat.size));
    if (method === "HEAD") {
      res.end();
      return;
    }
    await new Promise((resolve) => {
      const stream = createReadStream(file);
      stream.on("error", () => {
        if (!res.headersSent) sendPlain(res, 500, "Could not read the file.");
        else res.destroy();
        resolve();
      });
      res.on("close", () => {
        stream.destroy();
        resolve();
      });
      stream.pipe(res);
      stream.on("end", resolve);
    });
  };
  const warm = async () => {
    if (!compress) return;
    const dir = path.join(root, "assets");
    let names = [];
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
      await cache.get(file, stat, "br").catch(() => {
      });
      await cache.get(file, stat, "gzip").catch(() => {
      });
    }
  };
  return Object.assign(handler, { warm });
}
function errorResponse(status, code, message, headers = {}) {
  return new Response(JSON.stringify({ error: { code, message, status } }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}
var API_DEFAULT_HEADERS = { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" };
function firstHeader(value) {
  const v = Array.isArray(value) ? value[0] : value;
  return v?.split(",")[0]?.trim() || void 0;
}
function describeClient(req, trustProxy) {
  const ip = trustProxy && firstHeader(req.headers["x-forwarded-for"]) || req.socket.remoteAddress || "-";
  if (!trustProxy) return ip;
  const proto = firstHeader(req.headers["x-forwarded-proto"]);
  const host = firstHeader(req.headers["x-forwarded-host"]);
  return proto || host ? `${ip} via ${proto ?? "http"}://${host ?? req.headers.host ?? "?"}` : ip;
}
function createRequestListener(opts) {
  const statics = opts.staticHandler ?? (opts.staticRoot ? createStaticHandler({ root: opts.staticRoot, hsts: opts.hsts }) : null);
  const bodyLimit = opts.bodyLimit ?? DEFAULT_BODY_LIMIT;
  const log = opts.log;
  async function handleApi(req, res, pathname, started) {
    const method = (req.method ?? "GET").toUpperCase();
    let response = null;
    if (!opts.connector) {
      response = errorResponse(503, "connector_unavailable", "The HubSpot connector is not running on this server.");
    } else {
      const abort = new AbortController();
      res.on("close", () => {
        if (!res.writableFinished) abort.abort();
      });
      let request = null;
      try {
        request = await toWebRequest(req, { origin: opts.origin, bodyLimit, signal: abort.signal });
      } catch (err) {
        if (err instanceof BodyTooLargeError) {
          response = errorResponse(
            413,
            "payload_too_large",
            `This upload is too big (the limit is ${Math.round(bodyLimit / (1024 * 1024))} MB). Remove large files and try again.`,
            { Connection: "close" }
          );
        } else {
          if (abort.signal.aborted || res.destroyed) return;
          response = errorResponse(400, "bad_request", "The request could not be read.");
        }
      }
      if (request) {
        try {
          response = await opts.connector.handle(request);
        } catch (err) {
          log?.(`[api] ${method} ${pathname} failed: ${err instanceof Error ? err.message : String(err)}`);
          response = errorResponse(500, "internal_error", "Something went wrong on the connector server. Please try again.");
        }
        if (!response) response = errorResponse(404, "not_found", "There is no connector endpoint at this address.");
      }
    }
    if (!response) return;
    await writeWebResponse(res, response, { head: method === "HEAD", defaults: API_DEFAULT_HEADERS });
    if (opts.accessLog !== false) log?.(`[api] ${method} ${pathname} ${response.status} ${Math.round(performance.now() - started)}ms ${describeClient(req, !!opts.trustProxy)}`);
  }
  return (req, res) => {
    const started = performance.now();
    const pathname = requestPathname(req.url);
    const isApi = pathname === "/api" || pathname.startsWith("/api/");
    const work = isApi ? handleApi(req, res, pathname, started) : statics ? statics(req, res) : Promise.resolve().then(() => {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(opts.apiOnlyHint ?? "This server only answers /api requests (HubSpot connector).");
    });
    work.catch((err) => {
      log?.(`[server] ${req.method ?? "GET"} ${pathname} failed: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Internal server error.");
      } else if (!res.writableEnded) {
        res.destroy();
      }
    });
  };
}
function parseArgs(argv) {
  const out = { apiOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, void 0];
    const value = () => inline ?? argv[++i];
    if (flag === "--api-only") out.apiOnly = true;
    else if (flag === "--port") out.port = Number(value());
    else if (flag === "--host") out.host = value();
    else if (flag === "--static" || flag === "--dist") out.staticDir = value();
  }
  return out;
}
function truthy2(v) {
  return !!v && /^(1|true|yes|on)$/i.test(v.trim());
}
function detectAppUrl(env, port) {
  const clean = (u) => u.trim().replace(/\/+$/, "");
  if (env.APP_URL?.trim()) return { url: clean(env.APP_URL), source: "APP_URL" };
  if (env.RENDER_EXTERNAL_URL?.trim()) return { url: clean(env.RENDER_EXTERNAL_URL), source: "detected on Render" };
  if (env.RAILWAY_PUBLIC_DOMAIN?.trim()) return { url: `https://${clean(env.RAILWAY_PUBLIC_DOMAIN)}`, source: "detected on Railway" };
  if (env.FLY_APP_NAME?.trim()) return { url: `https://${env.FLY_APP_NAME.trim()}.fly.dev`, source: "detected on Fly.io" };
  if (env.VERCEL_PROJECT_PRODUCTION_URL?.trim()) {
    return { url: `https://${clean(env.VERCEL_PROJECT_PRODUCTION_URL)}`, source: "detected on Vercel" };
  }
  if ((env.NODE_ENV ?? "").trim() === "production") return { url: null, source: "APP_URL is not set" };
  return { url: `http://localhost:${port}`, source: "local default - APP_URL is not set" };
}
function missingOAuthSettings(config) {
  const missing = [];
  if (!config.appUrl) missing.push("APP_URL");
  if (!config.hubspotClientId) missing.push("HUBSPOT_CLIENT_ID");
  if (!config.hubspotClientSecret) missing.push("HUBSPOT_CLIENT_SECRET");
  if (!config.sessionSecret) missing.push("SESSION_SECRET");
  else if (config.sessionSecret.length < 32) missing.push("SESSION_SECRET (must be at least 32 characters)");
  return missing;
}
function describeStartup(config, info) {
  const missing = missingOAuthSettings(config);
  const configured = info.oauthConfigured ?? missing.length === 0;
  const lines = [
    `UI Extension Builder is running (connector ${config.version || "dev"}).`,
    `  Listening on:     ${info.listenUrl}`,
    config.appUrl ? `  Public address:   ${config.appUrl}   (${info.appUrlSource})` : "  Public address:   NOT SET - set APP_URL to the address people open, e.g. https://builder.example.com",
    info.staticRoot ? `  Builder files:    ${info.staticFound ? info.staticRoot : `${info.staticRoot} (NOT FOUND - run "npm run build")`}` : "  Builder files:    not served (API-only mode)"
  ];
  if (configured) {
    lines.push(`  HubSpot sign-in:  ready (client id ${config.hubspotClientId})`);
  } else {
    lines.push(`  HubSpot sign-in:  NOT CONFIGURED${missing.length ? ` - missing ${missing.join(", ")}` : ""}.`);
    lines.push('                    The builder still works; "Connect HubSpot" stays unavailable until these are set.');
  }
  if (config.appUrl) {
    lines.push(`  Redirect URL:     ${config.appUrl}${CALLBACK_PATH}`);
    lines.push("                    (add exactly this address to your HubSpot app's redirect URLs)");
  }
  lines.push(`  Required scopes:  ${config.requiredScopes.join(" ") || "(none)"}`);
  lines.push(`  Optional scopes:  ${config.optionalScopes.join(" ") || "(none)"}`);
  lines.push(`  HubSpot hosts:    ${config.hubspotApiBase} | ${config.hubspotAppBase}`);
  lines.push(
    `  Features:         live CRM data on | fetch proxy ${config.enableFetchProxy ? "on" : "off"} | deploy to HubSpot (beta) ${config.enableDeploy ? "on" : "off"}`
  );
  if (config.allowedOrigins.length > 0) lines.push(`  Extra origins:    ${config.allowedOrigins.join(", ")}`);
  lines.push(`  Health check:     ${config.appUrl || info.listenUrl}${HEALTH_PATH2}`);
  return lines;
}
function findStaticRoot(explicit) {
  if (explicit) return path.resolve(explicit);
  const fromCwd = path.resolve(process.cwd(), "dist");
  if (existsSync(path.join(fromCwd, "index.html"))) return fromCwd;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const sibling = path.resolve(here, "..", "dist");
    if (existsSync(path.join(sibling, "index.html"))) return sibling;
  } catch {
  }
  return fromCwd;
}
async function probeHealth(connector, origin) {
  try {
    const res = await connector.handle(new Request(`${origin}${HEALTH_PATH2}`, { headers: { accept: "application/json" } }));
    if (!res || !res.ok) return void 0;
    const body = await res.json();
    return typeof body.oauthConfigured === "boolean" ? body.oauthConfigured : void 0;
  } catch {
    return void 0;
  }
}
function tuneServer(server) {
  server.keepAliveTimeout = 65e3;
  server.headersTimeout = 66e3;
  server.requestTimeout = 12e4;
  return server;
}
async function startServer(opts = {}) {
  const { env, notes } = normalizeHostingEnv(opts.env ?? process.env);
  const args = parseArgs(opts.argv ?? process.argv.slice(2));
  const log = opts.log ?? ((line) => console.log(line));
  const port = args.port !== void 0 && Number.isFinite(args.port) ? args.port : Number(env.PORT || DEFAULT_PORT);
  const host = args.host ?? (env.HOST?.trim() || void 0);
  const apiOnly = args.apiOnly || truthy2(env.API_ONLY);
  const { configFromEnv: configFromEnv2, createConnector: createConnector2 } = await Promise.resolve().then(() => (init_core(), core_exports));
  const server = tuneServer(createServer());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const listenHost = !host || host === "0.0.0.0" || host === "::" ? "localhost" : host.includes(":") ? `[${host}]` : host;
  const url = `http://${listenHost}:${actualPort}`;
  const detected = detectAppUrl(env, actualPort);
  const overrides = { ...opts.overrides ?? {} };
  if (!env.APP_URL?.trim() && overrides.appUrl === void 0 && detected.url) overrides.appUrl = detected.url;
  const config = configFromEnv2(env, overrides);
  const core = createConnector2(config);
  const connector = { handle: (request) => core.handle(allowPlainHealthCheck(request)) };
  const staticRoot = apiOnly ? null : findStaticRoot(args.staticDir ?? env.STATIC_DIR);
  const staticFound = !!staticRoot && existsSync(path.join(staticRoot, "index.html"));
  const accessLog = env.LOG_REQUESTS === void 0 || env.LOG_REQUESTS.trim() === "" || truthy2(env.LOG_REQUESTS);
  const hsts = config.appUrl.startsWith("https://");
  const staticHandler = staticRoot ? createStaticHandler({ root: staticRoot, hsts }) : null;
  const origin = config.appUrl || `http://localhost:${actualPort}`;
  server.on(
    "request",
    createRequestListener({
      connector,
      staticRoot,
      staticHandler,
      origin,
      hsts,
      log,
      accessLog,
      trustProxy: env.TRUST_PROXY === void 0 ? true : truthy2(env.TRUST_PROXY),
      apiOnlyHint: `This is the HubSpot connector API for UI Extension Builder. Open the builder at ${config.appUrl || "its public address"}.`
    })
  );
  const oauthConfigured = await probeHealth(connector, origin);
  const appUrlSource = env.APP_URL?.trim() ? "APP_URL" : overrides.appUrl && overrides.appUrl === detected.url ? detected.source : "configured";
  for (const line of describeStartup(config, { listenUrl: url, appUrlSource, staticRoot, staticFound, oauthConfigured })) log(line);
  for (const note of notes) log(`  Note:             ${note}`);
  if (staticHandler && staticFound) void staticHandler.warm();
  const close = () => new Promise((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
  });
  if (opts.handleSignals !== false) installShutdown(server, log);
  return { server, config, url, close };
}
function installShutdown(server, log) {
  let stopping = false;
  const stop = (signal) => {
    if (stopping) {
      log(`${signal} received again - exiting now.`);
      process.exit(1);
    }
    stopping = true;
    log(`${signal} received - finishing open requests, then stopping.`);
    server.close(() => {
      log("Server stopped.");
      process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => {
      server.closeAllConnections();
      process.exit(0);
    }, 1e4).unref();
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}
function runCli() {
  startServer().catch((err) => {
    console.error(`Could not start UI Extension Builder: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
function isDirectRun() {
  if (true) return false;
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}
if (isDirectRun()) runCli();

// node-entry.ts
runCli();
//# sourceMappingURL=node.mjs.map
