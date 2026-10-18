/**
 * Anonymous visitor ids for the status page: HMAC-SHA256 of the client's IP address with a random
 * salt that only lives in memory and is replaced every day (UTC midnight), shortened to 6 hex
 * characters. The same visitor keeps the same id for the rest of the day, so "this person tried
 * three times" is visible, but the id can't be turned back into an IP address (the salt is never
 * stored or logged), and ids from different days can't be linked.
 *
 * Web Crypto only (Node, Vercel Edge, Cloudflare Workers).
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
const ID_LENGTH = 6;

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class VisitorIds {
  private day = Number.NaN;
  private key: Promise<CryptoKey> | null = null;

  constructor(private readonly now: () => number) {}

  private currentKey(): Promise<CryptoKey> {
    const day = Math.floor(this.now() / DAY_MS);
    if (!this.key || day !== this.day) {
      this.day = day;
      const salt = crypto.getRandomValues(new Uint8Array(32));
      this.key = crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    }
    return this.key;
  }

  /** The visitor id for a client address (callers without an address share one id). */
  async id(clientIp: string | undefined): Promise<string> {
    const key = await this.currentKey();
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`visitor:${(clientIp ?? '').trim().toLowerCase() || 'unknown'}`));
    return toHex(signature).slice(0, ID_LENGTH);
  }
}

/** SHA-256 of a value, shortened (correlates single-use values such as the OAuth state without keeping them). */
export async function shortHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`uiex-diagnostics:${value}`));
  return toHex(digest).slice(0, 24);
}
