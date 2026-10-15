/**
 * Cookie encryption with the Web Crypto API (crypto.subtle) only — no Node-specific modules.
 *
 * Key: HKDF-SHA256(SESSION_SECRET, salt = KDF_SALT, info = <purpose label>) → AES-256-GCM key.
 * Sealed value: "v1.<base64url iv>.<base64url ciphertext+tag>", with the cookie name as additional
 * authenticated data so a value sealed for one cookie can never be replayed as another cookie.
 * The plaintext is `{ v: 1, iat, exp, d }` so expired values are rejected server-side as well.
 */

const KDF_SALT = 'uiex-connector/cookie-kdf/v1';
const SEAL_VERSION = 'v1';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error('invalid base64url');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Cryptographically random token (base64url). */
export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return bytesToBase64Url(buf);
}

/** Constant-time string comparison (length is not secret). */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = encoder.encode(a);
  const bb = encoder.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

export async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

const keyCache = new Map<string, Promise<CryptoKey>>();

/** Derive (and cache) the AES-GCM key for a purpose, e.g. 'session' or 'oauth-state'. */
export function deriveKey(secret: string, purpose: string): Promise<CryptoKey> {
  const cacheKey = `${purpose}\u0000${secret}`;
  let key = keyCache.get(cacheKey);
  if (!key) {
    key = (async () => {
      const ikm = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
      return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(KDF_SALT), info: encoder.encode(`uiex-connector/${purpose}`) },
        ikm,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    })();
    if (keyCache.size > 32) keyCache.clear();
    keyCache.set(cacheKey, key);
  }
  return key;
}

interface SealedPayload<T> {
  v: 1;
  /** Issued at (epoch seconds). */
  iat: number;
  /** Expires at (epoch seconds). */
  exp: number;
  d: T;
}

export interface SealOptions {
  secret: string;
  purpose: string;
  /** Bound as AES-GCM additional data (normally the cookie name). */
  aad: string;
  now: number;
  ttlSeconds: number;
}

export async function seal<T>(data: T, opts: SealOptions): Promise<string> {
  const key = await deriveKey(opts.secret, opts.purpose);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const nowSec = Math.floor(opts.now / 1000);
  const payload: SealedPayload<T> = { v: 1, iat: nowSec, exp: nowSec + opts.ttlSeconds, d: data };
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(opts.aad) },
    key,
    encoder.encode(JSON.stringify(payload)),
  );
  return `${SEAL_VERSION}.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

/** Decrypt a sealed value. Returns null for anything tampered, foreign, malformed or expired. */
export async function unseal<T>(value: string, opts: Omit<SealOptions, 'ttlSeconds'>): Promise<T | null> {
  try {
    const parts = value.split('.');
    if (parts.length !== 3 || parts[0] !== SEAL_VERSION) return null;
    const iv = base64UrlToBytes(parts[1]);
    if (iv.length !== 12) return null;
    const ciphertext = base64UrlToBytes(parts[2]);
    if (ciphertext.length < 17) return null;
    const key = await deriveKey(opts.secret, opts.purpose);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(opts.aad) }, key, ciphertext);
    const payload = JSON.parse(decoder.decode(plain)) as SealedPayload<T>;
    if (!payload || payload.v !== 1 || typeof payload.exp !== 'number') return null;
    if (payload.exp * 1000 <= opts.now) return null;
    return payload.d;
  } catch {
    return null;
  }
}
