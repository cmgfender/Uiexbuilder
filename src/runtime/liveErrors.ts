/**
 * Small helpers shared by the live data runtime (./live.ts) and the action runner (./actions.ts):
 * plain-language descriptions of failed connector requests and a request clock.
 */

export interface LiveErrorInfo {
  /** Plain-language message (the `<name>Error` value). */
  message: string;
  /** Connector error code (e.g. 'missing_scope', 'rate_limited'), when known. */
  code?: string;
  /** Extra facts for the console (status, required scopes, correlation id …). */
  detail?: Record<string, unknown>;
}

/** True for a cancelled request (never shown as an error). */
export function isAbortLike(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError';
}

/** Describes a failed live request: connector errors keep their stable code. */
export function liveErrorInfo(e: unknown): LiveErrorInfo {
  if (e && typeof e === 'object') {
    const err = e as { message?: unknown; code?: unknown; status?: unknown; requiredScopes?: unknown; correlationId?: unknown; retryAfter?: unknown };
    const message = typeof err.message === 'string' && err.message.trim() ? err.message : 'The request failed.';
    const code = typeof err.code === 'string' && err.code ? err.code : undefined;
    const detail: Record<string, unknown> = {};
    if (code) detail.code = code;
    if (typeof err.status === 'number') detail.status = err.status;
    if (Array.isArray(err.requiredScopes) && err.requiredScopes.length) detail.requiredScopes = err.requiredScopes;
    if (typeof err.correlationId === 'string') detail.correlationId = err.correlationId;
    if (typeof err.retryAfter === 'number') detail.retryAfter = err.retryAfter;
    return { message, ...(code ? { code } : {}), ...(Object.keys(detail).length ? { detail } : {}) };
  }
  return { message: typeof e === 'string' && e ? e : 'The request failed.' };
}

/** Milliseconds since `start` (performance clock when available). */
export function elapsedMs(start: number): number {
  return Math.max(0, Math.round(now() - start));
}

export function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}
