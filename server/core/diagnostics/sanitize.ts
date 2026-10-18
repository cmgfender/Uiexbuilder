/**
 * Cleaning what browsers report before it is kept or logged. Whatever a browser sends is untrusted
 * (anyone can send a report): it is cut to size, URLs lose their query strings and fragments (they
 * can carry codes, ids or search terms), links to anywhere but the builder itself become "[link]"
 * (a fake "error" must not send the host somewhere), email addresses, bearer tokens and long
 * token-like strings are masked, and control characters are dropped. The builder's own reporter
 * cleans the same way; this is the server's copy.
 */
import { redactText } from '../http';
import type { ClientErrorDetails, ClientErrorSource } from '../../../src/status/types';

export const CLIENT_LIMITS = {
  message: 300,
  name: 60,
  stack: 1500,
  stackLines: 12,
  path: 120,
  build: 40,
} as const;

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g;

/** "https://x.test/a?code=1#f:10:2" → "https://x.test/a:10:2"; "/api/x?q=ada" → "/api/x". */
export function stripQueryStrings(text: string): string {
  return text
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s?#'"()<>]*)[?#][^\s'"()<>]*?(?=(?::\d+){1,2}(?:[\s)'"]|$)|[\s'"()<>]|$)/gi, '$1')
    .replace(/((?:^|[\s('"])\/[\w\-./%~]*)\?[^\s'"()<>]*/g, '$1');
}

/** What replaces a link to anywhere but the builder. */
export const OUTSIDE_LINK = '[link]';

const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"()<>]+/gi;
/** "www.example.com/x", "//example.com/x", "evil.example/rotate": links without a scheme. */
const BARE_LINK_RE = /(^|[\s('"])(?:\/\/|www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,})(\/[^\s'"()<>]*|(?=[\s'"()<>]|$))/gi;

/**
 * Replaces links to anything but `keepOrigins` (the builder's own addresses) with "[link]": its
 * own script URLs in stack traces stay, anything else a report mentions doesn't.
 */
export function stripOutsideLinks(text: string, keepOrigins: readonly string[]): string {
  const keep = new Set(keepOrigins.map((o) => o.replace(/\/+$/, '').toLowerCase()));
  const keepHosts = new Set<string>();
  for (const o of keep) {
    try {
      keepHosts.add(new URL(o).host);
    } catch {
      /* not an origin */
    }
  }
  const out = text.replace(URL_RE, (m) => {
    try {
      return keep.has(new URL(m).origin.toLowerCase()) ? m : OUTSIDE_LINK;
    } catch {
      return OUTSIDE_LINK;
    }
  });
  return out.replace(BARE_LINK_RE, (m, lead: string, host: string, path: string) => {
    // Only things that look like a site: www., //, or a host followed by a path.
    const looksLikeLink = /^(?:\/\/|www\.)/i.test(m.slice(lead.length)) || path.length > 1;
    if (!looksLikeLink || keepHosts.has(host.toLowerCase())) return m;
    return `${lead}${OUTSIDE_LINK}`;
  });
}

/** Masks email addresses, bearer tokens, HubSpot keys and other long token-like strings. */
export function maskSensitive(text: string): string {
  let out = redactText(text, []);
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]');
  // Personal access keys, private app tokens and other long opaque strings.
  out = out.replace(/\bpat-[a-z]{2}\d-[A-Za-z0-9-]+/gi, '[redacted]');
  // Runs without separators: words such as "react-dom_development" stay; anything long, or mixing
  // upper case, lower case and digits like an encoded token, is masked.
  out = out.replace(/[A-Za-z0-9_+=-]{24,}/g, (m) => {
    if (/^[a-z_-]+$/.test(m)) return m;
    const mixed = /[a-z]/.test(m) && /[A-Z]/.test(m) && /\d/.test(m);
    return m.length >= 32 || mixed ? '[redacted]' : m;
  });
  return out;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** One-line text (message, name): cleaned, masked, collapsed whitespace, clipped. */
export function cleanLine(raw: unknown, max: number, keepOrigins: readonly string[] = []): string {
  if (typeof raw !== 'string') return '';
  const text = maskSensitive(stripOutsideLinks(stripQueryStrings(raw.slice(0, max * 4)), keepOrigins))
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clip(text, max);
}

/** A stack trace: at most `stackLines` lines, each cleaned, then clipped. */
export function cleanStack(raw: unknown, keepOrigins: readonly string[] = []): string | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const lines = raw
    .slice(0, CLIENT_LIMITS.stack * 4)
    .split(/\r?\n/)
    .map((l) => maskSensitive(stripOutsideLinks(stripQueryStrings(l), keepOrigins)).replace(CONTROL, ' ').replace(/\s+$/g, ''))
    .filter((l) => l.trim())
    .slice(0, CLIENT_LIMITS.stackLines);
  const text = clip(lines.join('\n'), CLIENT_LIMITS.stack);
  return text || undefined;
}

/** A page path of the builder: path only (letters, digits and - . _ ~ /), no query string or fragment. */
export function cleanPath(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const path = raw.split(/[?#]/)[0].replace(CONTROL, '');
  if (!/^\/[A-Za-z0-9._~\/-]*$/.test(path) || path.startsWith('//')) return undefined;
  return clip(maskSensitive(path), CLIENT_LIMITS.path);
}

/** A build id: letters, digits, dot, dash and underscore only. */
export function cleanBuild(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const build = raw.trim().slice(0, CLIENT_LIMITS.build);
  return /^[A-Za-z0-9._-]+$/.test(build) ? build : undefined;
}

const SOURCES: readonly ClientErrorSource[] = ['error', 'unhandledrejection', 'react'];

/**
 * The client error details to keep, or null when the report has no usable message. `keepOrigins`:
 * the builder's own addresses (APP_URL, ALLOWED_ORIGINS), whose links stay.
 */
export function cleanClientError(raw: Record<string, unknown>, keepOrigins: readonly string[] = []): ClientErrorDetails | null {
  const message = cleanLine(raw.message, CLIENT_LIMITS.message, keepOrigins);
  if (!message) return null;
  const source = SOURCES.includes(raw.source as ClientErrorSource) ? (raw.source as ClientErrorSource) : 'error';
  const out: ClientErrorDetails = { source, message };
  const name = cleanLine(raw.name, CLIENT_LIMITS.name);
  if (name && /^[A-Za-z][\w$.]*$/.test(name)) out.name = name;
  const stack = cleanStack(raw.stack, keepOrigins);
  if (stack) out.stack = stack;
  const path = cleanPath(raw.path);
  if (path) out.path = path;
  const build = cleanBuild(raw.build);
  if (build) out.build = build;
  return out;
}
