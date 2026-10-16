/**
 * Small in-memory token-bucket rate limiter (no dependencies, no database).
 *
 * The connector uses it for the routes that make the server call HubSpot (or other hosts) on a
 * caller's behalf: sign-in start / callback (keyed by client IP), deploy uploads and the fetch proxy
 * (keyed by the signed-in HubSpot user, else the client IP). Limits are per server instance — on
 * serverless hosts each instance counts on its own, which still bounds abuse.
 */

export interface RateRule {
  /** Shown in the 429 message, e.g. "sign-in attempts". */
  what: string;
  /** Requests allowed in a burst. */
  capacity: number;
  /** Milliseconds to earn back one request. */
  refillMs: number;
}

export const RATE_RULES = {
  authStart: { what: 'sign-in attempts', capacity: 20, refillMs: 30_000 },
  authCallback: { what: 'sign-in attempts', capacity: 20, refillMs: 30_000 },
  deploy: { what: 'deploys', capacity: 6, refillMs: 60_000 },
  /** Deploy while sign-in isn't set up yet (first-time setup): stricter, per client IP. */
  deploySetup: { what: 'deploys', capacity: 4, refillMs: 2 * 60_000 },
  proxy: { what: 'preview requests', capacity: 60, refillMs: 1_000 },
} satisfies Record<string, RateRule>;

interface Bucket {
  tokens: number;
  updated: number;
}

export interface RateDecision {
  ok: boolean;
  /** Seconds until the next request is allowed (when !ok). */
  retryAfter: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly now: () => number,
    private readonly maxKeys = 20_000,
  ) {}

  take(rule: RateRule, key: string): RateDecision {
    const id = `${rule.what}|${rule.capacity}|${rule.refillMs}|${key}`;
    const t = this.now();
    let b = this.buckets.get(id);
    if (!b) {
      this.prune(t);
      b = { tokens: rule.capacity, updated: t };
      this.buckets.set(id, b);
    } else {
      const earned = Math.max(0, t - b.updated) / rule.refillMs;
      b.tokens = Math.min(rule.capacity, b.tokens + earned);
      b.updated = t;
    }
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { ok: true, retryAfter: 0 };
    }
    return { ok: false, retryAfter: Math.max(1, Math.ceil(((1 - b.tokens) * rule.refillMs) / 1000)) };
  }

  /** Keeps memory bounded: forgets idle (full) buckets, then the oldest ones. */
  private prune(t: number): void {
    if (this.buckets.size < this.maxKeys) return;
    for (const [id, b] of this.buckets) if (t - b.updated > 60 * 60_000) this.buckets.delete(id);
    if (this.buckets.size < this.maxKeys) return;
    const drop = Math.ceil(this.maxKeys / 10);
    let n = 0;
    for (const id of this.buckets.keys()) {
      this.buckets.delete(id);
      if (++n >= drop) break;
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}
