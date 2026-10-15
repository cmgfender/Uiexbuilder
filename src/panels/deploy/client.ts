/**
 * Browser client for the connector's terminal-free deploy endpoints (same origin, /api/deploy…).
 * Every call sends the CSRF header and the session cookie. Errors become DeployClientError with
 * the connector's stable code (ConnectorErrorBody) — or 'network' / 'connector_unavailable' when
 * there is no connector to talk to (static hosting).
 */
import { CONNECTOR_ROUTES, CSRF_HEADER, type ConnectorErrorBody, type DeployKeyInfo, type DeployRequest, type DeployStatus } from '../../connect/types';

export class DeployClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** For 'portal_mismatch': the account the key belongs to. */
    public portalId?: number,
    public requiredScopes?: string[],
  ) {
    super(message);
    this.name = 'DeployClientError';
  }
}

export interface DeployClient {
  start(request: DeployRequest): Promise<DeployStatus>;
  status(deployId: string): Promise<DeployStatus>;
  keyInfo(): Promise<DeployKeyInfo>;
  forgetKey(): Promise<DeployKeyInfo>;
}

/** Codes worth retrying while polling (the deploy itself keeps running in HubSpot). */
export function isTransientDeployError(err: unknown): boolean {
  if (!(err instanceof DeployClientError)) return false;
  return err.code === 'network' || err.code === 'rate_limited' || err.code === 'timeout' || err.status === 502 || err.status === 503 || err.status === 504;
}

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
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
    throw new DeployClientError(res.status, 'connector_unavailable', "The builder's HubSpot connector isn't available here, so it can't deploy for you.");
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
    );
  }
  return data;
}

export const deployClient: DeployClient = {
  start: (request) => call<DeployStatus>('POST', CONNECTOR_ROUTES.deployStart, request),
  status: (deployId) => call<DeployStatus>('GET', CONNECTOR_ROUTES.deployStatus.replace(':deployId', encodeURIComponent(deployId))),
  keyInfo: () => call<DeployKeyInfo>('GET', CONNECTOR_ROUTES.deployKey),
  forgetKey: () => call<DeployKeyInfo>('DELETE', CONNECTOR_ROUTES.deployKey),
};
