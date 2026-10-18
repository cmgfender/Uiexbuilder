/**
 * Browser client for the connector's terminal-free deploy endpoints (same origin, /api/deploy…).
 * Every call sends the CSRF header and the session cookie. Errors become DeployClientError with
 * the connector's stable code (ConnectorErrorBody) — or 'network' / 'connector_unavailable' when
 * there is no connector to talk to (static hosting). What the server says about a key's account
 * (`error.key`, DeployKeyCheck) is checked before the UI uses it (links must be http(s)).
 */
import {
  CONNECTOR_ROUTES,
  CSRF_HEADER,
  type ConnectorErrorBody,
  type DeployKeyAccount,
  type DeployKeyCheck,
  type DeployKeyCheckRequest,
  type DeployKeyProblem,
  type DeployRequest,
  type DeployStatus,
} from '../../connect/types';

export class DeployClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** For 'portal_mismatch': the account the key belongs to. */
    public portalId?: number,
    public requiredScopes?: string[],
    /** Errors about the key or its account: the account the key belongs to. */
    public key?: DeployKeyAccount,
  ) {
    super(message);
    this.name = 'DeployClientError';
  }
}

export interface DeployClient {
  start(request: DeployRequest): Promise<DeployStatus>;
  /** Advance / poll the job (POST /api/deploy/status, so the job token stays out of URLs and logs). */
  status(deployId: string): Promise<DeployStatus>;
  /**
   * Check a key before uploading anything (POST /api/deploy/check-key). Optional so a client
   * without it (an older connector, test doubles) publishes straight away.
   */
  checkKey?(request: DeployKeyCheckRequest): Promise<DeployKeyCheck>;
}

const URL_RE = /^https?:\/\/[^\s"'<>]+$/i;
const PROBLEMS: readonly DeployKeyProblem[] = ['missing_permission', 'portal_mismatch', 'portal_not_allowed'];

/** A DeployKeyAccount from the server, or undefined when it doesn't look like one. */
export function keyAccountFrom(raw: unknown): DeployKeyAccount | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<Record<keyof DeployKeyAccount, unknown>>;
  if (typeof r.portalId !== 'number' || !Number.isSafeInteger(r.portalId) || r.portalId <= 0) return undefined;
  if (typeof r.keyPageUrl !== 'string' || !URL_RE.test(r.keyPageUrl)) return undefined;
  const account: DeployKeyAccount = {
    portalId: r.portalId,
    developerProjects: r.developerProjects === 'yes' || r.developerProjects === 'no' ? r.developerProjects : 'unknown',
    keyPageUrl: r.keyPageUrl,
  };
  if (typeof r.name === 'string' && r.name.trim()) account.name = r.name.trim().slice(0, 120);
  if (typeof r.accountType === 'string' && /^[A-Z0-9_]{1,40}$/.test(r.accountType)) account.accountType = r.accountType;
  return account;
}

/** A DeployKeyCheck from the server (throws when it isn't one). */
export function keyCheckFrom(raw: unknown): DeployKeyCheck {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof DeployKeyCheck, unknown>>;
  const key = keyAccountFrom(r.key);
  if (!key || typeof r.ok !== 'boolean') throw new DeployClientError(502, 'bad_answer', 'The builder’s server sent an unexpected answer when checking the key. Please try again.');
  const check: DeployKeyCheck = { ok: r.ok, key };
  const t = r.target as { portalId?: unknown; name?: unknown } | undefined;
  if (t && typeof t === 'object' && typeof t.portalId === 'number' && Number.isSafeInteger(t.portalId)) {
    check.target = { portalId: t.portalId, ...(typeof t.name === 'string' && t.name ? { name: t.name.slice(0, 120) } : {}) };
  }
  if (typeof r.problem === 'string' && (PROBLEMS as readonly string[]).includes(r.problem)) check.problem = r.problem as DeployKeyProblem;
  if (typeof r.message === 'string' && r.message) check.message = r.message.slice(0, 1000);
  if (!check.ok && !check.problem) check.problem = 'missing_permission';
  return check;
}

/** Codes worth retrying while polling (the deploy itself keeps running in HubSpot). */
export function isTransientDeployError(err: unknown): boolean {
  if (!(err instanceof DeployClientError)) return false;
  return err.code === 'network' || err.code === 'rate_limited' || err.code === 'timeout' || err.status === 502 || err.status === 503 || err.status === 504;
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { [CSRF_HEADER]: '1', Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, { method, credentials: 'include', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new DeployClientError(0, 'network', "Couldn't reach the builder's server. Check your internet connection and try again.");
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('json')) {
    throw new DeployClientError(res.status, 'connector_unavailable', "The builder's HubSpot connector isn't available here, so it can't publish for you.");
  }
  const data = (await res.json().catch(() => null)) as (T & Partial<ConnectorErrorBody>) | null;
  if (!res.ok || !data) {
    const e = data?.error;
    throw new DeployClientError(
      res.status,
      typeof e?.code === 'string' ? e.code : 'error',
      typeof e?.message === 'string' ? e.message : `The builder's server answered ${res.status}. Please try again.`,
      typeof e?.portalId === 'number' ? e.portalId : undefined,
      Array.isArray(e?.requiredScopes) ? e.requiredScopes : undefined,
      keyAccountFrom(e?.key),
    );
  }
  return data;
}

export const deployClient: DeployClient = {
  start: (request) => call<DeployStatus>('POST', CONNECTOR_ROUTES.deployStart, request),
  status: (deployId) => call<DeployStatus>('POST', CONNECTOR_ROUTES.deployPoll, { deployId }),
  checkKey: async (request) => keyCheckFrom(await call<unknown>('POST', CONNECTOR_ROUTES.deployCheckKey, request)),
};
