/**
 * SSRF guard for the fetch proxy (preview of `hubspot.fetch`).
 *
 * Allowed: https URLs to public hosts. In local development (APP_URL on localhost) http and https
 * to localhost / loopback addresses are allowed too, so a locally running backend can be previewed.
 * Blocked: other schemes, credentials in the URL, IP literals in private / loopback / link-local /
 * CGNAT / multicast / reserved ranges (IPv4, IPv6, IPv4-mapped and NAT64), "localhost", "*.localhost",
 * "*.internal", "*.local", "metadata.google.internal" and single-label hostnames.
 *
 * Limitation: the Web Fetch API has no portable DNS lookup, so a public hostname that resolves to a
 * private address (DNS rebinding) cannot be detected here. Deploy the connector where outbound
 * traffic to internal networks is impossible (Vercel / Cloudflare Workers are) or disable the proxy
 * with ENABLE_FETCH_PROXY=false.
 */

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

function parseIPv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p >= 0 && p <= 255) ? parts : null;
}

export function isBlockedIPv4(parts: number[]): boolean {
  const [a, b, c] = parts;
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

/** Expand an IPv6 literal (no brackets) to 8 hextets; null when not IPv6. */
function parseIPv6(host: string): number[] | null {
  if (!host.includes(':')) return null;
  let h = host.toLowerCase();
  const zone = h.indexOf('%');
  if (zone >= 0) h = h.slice(0, zone);
  // Embedded IPv4 tail (::ffff:1.2.3.4)
  const v4tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (v4tail) {
    const v4 = parseIPv4(v4tail[1]);
    if (!v4) return null;
    h = h.slice(0, -v4tail[1].length) + `${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = h.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (all.length !== 8) return null;
  const out: number[] = [];
  for (const part of all) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    out.push(parseInt(part, 16));
  }
  return out;
}

export function isBlockedIPv6(h: number[]): boolean {
  const allZeroPrefix = (n: number) => h.slice(0, n).every((x) => x === 0);
  if (allZeroPrefix(8)) return true; // ::
  if (allZeroPrefix(7) && h[7] === 1) return true; // ::1
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d
  if (allZeroPrefix(5) && (h[5] === 0xffff || h[5] === 0)) {
    return isBlockedIPv4([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff]);
  }
  // NAT64 64:ff9b::/96
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) {
    return isBlockedIPv4([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff]);
  }
  if ((h[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((h[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((h[0] & 0xffc0) === 0xfec0) return true; // site-local (deprecated)
  if ((h[0] & 0xff00) === 0xff00) return true; // multicast
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentation
  if (h[0] === 0x2002) {
    // 6to4 embeds an IPv4 address
    return isBlockedIPv4([h[1] >> 8, h[1] & 0xff, h[2] >> 8, h[2] & 0xff]);
  }
  return false;
}

function isLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const v4 = parseIPv4(host);
  if (v4) return v4[0] === 127;
  const v6 = parseIPv6(host.replace(/^\[|\]$/g, ''));
  return !!v6 && v6.slice(0, 7).every((x) => x === 0) && v6[7] === 1;
}

/** Check a hostname (as produced by the WHATWG URL parser, so numeric IPv4 forms are canonical). */
export function checkHostname(hostname: string, opts: { allowLoopback: boolean }): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return 'The address has no host name.';
  if (opts.allowLoopback && isLoopbackHost(host)) return null;
  if (host === 'localhost' || host.endsWith('.localhost')) return 'Requests to localhost are not allowed.';
  if (host === 'metadata.google.internal' || host.endsWith('.internal')) return 'Requests to internal hosts are not allowed.';
  if (host.endsWith('.local') || host.endsWith('.home.arpa') || host.endsWith('.lan')) return 'Requests to local network hosts are not allowed.';
  const v4 = parseIPv4(host);
  if (v4) return isBlockedIPv4(v4) ? 'Requests to private or reserved IP addresses are not allowed.' : null;
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const v6 = parseIPv6(bare);
  if (v6) return isBlockedIPv6(v6) ? 'Requests to private or reserved IP addresses are not allowed.' : null;
  if (bare.includes(':')) return 'The address is not a valid host.';
  if (!host.includes('.')) return 'Use a full public host name (like api.example.com).';
  return null;
}

export function checkProxyUrl(raw: string, opts: { devLocal: boolean }): UrlCheck {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, reason: 'Enter the URL to fetch.' };
  if (raw.length > 2048) return { ok: false, reason: 'The URL is too long.' };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'That is not a valid URL.' };
  }
  if (url.username || url.password) return { ok: false, reason: "URLs with a user name or password aren't allowed; send credentials in a header instead." };
  const loopback = isLoopbackHost(url.hostname.toLowerCase());
  if (url.protocol === 'http:') {
    if (!(opts.devLocal && loopback)) return { ok: false, reason: 'Only https:// URLs can be fetched (hubspot.fetch requires https).' };
  } else if (url.protocol !== 'https:') {
    return { ok: false, reason: 'Only https:// URLs can be fetched.' };
  }
  const blocked = checkHostname(url.hostname, { allowLoopback: opts.devLocal });
  if (blocked) return { ok: false, reason: blocked };
  return { ok: true, url };
}
