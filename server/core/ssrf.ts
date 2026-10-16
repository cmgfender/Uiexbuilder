/**
 * SSRF guard for the fetch proxy (preview of `hubspot.fetch`).
 *
 * Allowed: https URLs to public hosts. In local development (APP_URL on localhost, and the request
 * coming from a browser on the same computer) http and https to localhost / loopback addresses are
 * allowed too, so a locally running backend can be previewed.
 * Blocked: other schemes, credentials in the URL, the ports browsers refuse (fetch spec "bad ports":
 * SMTP, SSH, …), IP literals in private / loopback / link-local / CGNAT / multicast / reserved ranges,
 * every IPv6 address outside global unicast 2000::/3 (so NAT64, IPv4-translated, …) and the special
 * ranges inside it (Teredo, 6to4, documentation, ORCHID), "localhost", "*.localhost", "*.internal",
 * "*.local", "metadata.google.internal" and single-label hostnames.
 *
 * Host NAMES are checked here; the ADDRESSES they resolve to are checked where a DNS lookup exists:
 * the Node server (Render, Docker, any Node host) passes ServerConfig.proxyFetch =
 * server/guardedFetch.ts, which resolves every name, refuses blocked addresses (addressBlocked) and
 * connects to exactly the address it checked (no DNS rebinding). The Edge runtimes (Vercel,
 * Cloudflare Workers) have no DNS API, but they also have no private network to reach.
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
  if (a === 192 && b === 31 && c === 196) return true; // AS112
  if (a === 192 && b === 52 && c === 193) return true; // AMT
  if (a === 192 && b === 175 && c === 48) return true; // AS112 direct delegation
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

/**
 * IPv6: only global unicast (2000::/3) can be reached, minus its special-purpose ranges. Everything
 * else — loopback, unspecified, unique / link / site local, multicast, NAT64 (64:ff9b::/96 and the
 * local-use 64:ff9b:1::/48), IPv4-translated ::ffff:0:a.b.c.d, discard-only 100::/64 … — is refused.
 * IPv4-mapped addresses (::ffff:a.b.c.d) are judged as the IPv4 address they stand for.
 */
export function isBlockedIPv6(h: number[]): boolean {
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    return isBlockedIPv4([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff]);
  }
  if ((h[0] & 0xe000) !== 0x2000) return true; // outside global unicast 2000::/3
  if (h[0] === 0x2001 && h[1] < 0x0200) return true; // 2001::/23 IETF protocol assignments (Teredo 2001::/32, benchmarking, ORCHID …)
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentation
  if (h[0] === 0x2002) return true; // 6to4 (embeds an IPv4 address; deprecated)
  if (h[0] === 0x3fff && h[1] < 0x1000) return true; // documentation 3fff::/20
  return false;
}

/**
 * Ports browsers never fetch from (fetch spec "bad ports": FTP, SSH, SMTP, DNS, IRC, …). The proxy
 * refuses them too, so it can't be used to talk to non-web services.
 */
export const BAD_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135,
  137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720,
  1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

/** Thrown by a guarded fetch when a host name resolves to an address the proxy must not reach. */
export class BlockedAddressError extends Error {
  readonly code = 'EUIEX_BLOCKED_ADDRESS';
  constructor(message = 'That address points to a private or internal network, which the preview proxy does not reach.') {
    super(message);
    this.name = 'BlockedAddressError';
  }
}

/** True when the proxy must not connect to this resolved address (IPv4 or IPv6 text form). */
export function addressBlocked(address: string, opts: { allowLoopback?: boolean } = {}): boolean {
  const bare = address.replace(/^\[|\]$/g, '');
  if (opts.allowLoopback && isLoopbackHost(bare)) return false;
  const v4 = parseIPv4(bare);
  if (v4) return isBlockedIPv4(v4);
  const v6 = parseIPv6(bare);
  if (v6) return isBlockedIPv6(v6);
  return true; // not an IP address: never connect to it blindly
}

/** True for loopback client addresses (127.0.0.0/8, ::1, ::ffff:127.x). */
export function isLoopbackAddress(address: string | undefined | null): boolean {
  if (!address) return false;
  return isLoopbackHost(address.trim().toLowerCase().replace(/^\[|\]$/g, ''));
}

function isLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const v4 = parseIPv4(host);
  if (v4) return v4[0] === 127;
  const v6 = parseIPv6(host.replace(/^\[|\]$/g, ''));
  if (!v6) return false;
  if (v6.slice(0, 7).every((x) => x === 0) && v6[7] === 1) return true; // ::1
  return v6.slice(0, 5).every((x) => x === 0) && v6[5] === 0xffff && v6[6] >> 8 === 127; // ::ffff:127.x.x.x
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
  if (url.port && BAD_PORTS.has(Number(url.port))) return { ok: false, reason: `Port ${url.port} is not allowed (browsers refuse it too).` };
  const blocked = checkHostname(url.hostname, { allowLoopback: opts.devLocal });
  if (blocked) return { ok: false, reason: blocked };
  return { ok: true, url };
}
