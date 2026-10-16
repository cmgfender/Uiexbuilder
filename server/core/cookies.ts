/** Minimal RFC 6265 cookie parsing / serialisation (no dependencies). */

export interface CookieOptions {
  maxAge?: number;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
}

/** Every value sent for each cookie name, in the order the browser sent them. */
export function parseCookieList(header: string | null): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    if (!name) continue;
    const list = out.get(name);
    if (list) list.push(value);
    else out.set(name, [value]);
  }
  return out;
}

/**
 * Cookie name → value. A name sent more than once is AMBIGUOUS and maps to null: a sibling
 * subdomain can plant ("toss") a cookie with the same name in front of ours (Domain=.example.com,
 * a more specific Path), and the connector must never pick the planted one.
 */
export function parseCookies(header: string | null): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const [name, values] of parseCookieList(header)) out.set(name, values.length === 1 ? values[0] : null);
  return out;
}

export function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) throw new Error('invalid cookie name');
  if (!/^[!#-+\--:<-[\]-~]*$/.test(value)) throw new Error('invalid cookie value');
  // Browsers only accept __Host- cookies that are Secure, have Path=/ and no Domain.
  if (name.startsWith('__Host-') && (!opts.secure || (opts.path ?? '/') !== '/')) throw new Error('__Host- cookies must be Secure with Path=/');
  const parts = [`${name}=${value}`];
  parts.push(`Path=${opts.path ?? '/'}`);
  if (opts.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`);
    if (opts.maxAge <= 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  }
  if (opts.httpOnly) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  return parts.join('; ');
}
