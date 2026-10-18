/**
 * HubSpot developer-project API calls made with a personal access key — the same endpoints the
 * HubSpot CLI uses (@hubspot/local-dev-lib 5.x: lib/personalAccessKey, api/localDevAuth,
 * api/projects, api/appsDev), with plain fetch so it runs on Node, Vercel and Workers.
 *
 * Every authenticated call sends `Authorization: Bearer <access token>` and `?portalId=<id>`, like
 * local-dev-lib's withAuth/withPortalId.
 */
import { HubSpotApiError, type ServerConfig } from '../types';
import { RateLimitedError } from '../http';
import { fetchWithTimeout } from '../oauth';

/** local-dev-lib getAxiosConfig default. */
export const HUBSPOT_DEPLOY_CALL_TIMEOUT_MS = 15_000;
/** Upload of the archive (the CLI allows 60 s; the connector answers within its request budget). */
export const HUBSPOT_UPLOAD_TIMEOUT_MS = 20_000;

/** A HubSpot error during deploy, with the details the deploy log shows. */
export class DeployApiError extends HubSpotApiError {
  constructor(
    message: string,
    status: number,
    code: string,
    public details: string[] = [],
    correlationId?: string,
    requiredScopes?: string[],
    /** Worth retrying later (network, 429, 5xx). */
    public transient = false,
    /** HubSpot's own message, when it sent one (shown in quotes next to the plain explanation). */
    public hubspotMessage?: string,
  ) {
    super(message, status, code, correlationId, requiredScopes);
    this.name = 'DeployApiError';
  }
}

export const DEVELOPER_PROJECTS_PERMISSION_HELP =
  'Your personal access key needs the “Developer projects” permission. In HubSpot, open the personal access key page, add Developer projects to the key (or create a new key with it), and paste the new key here.';

interface HubSpotErrorBody {
  status?: string;
  message?: string;
  correlationId?: string;
  category?: string;
  subCategory?: string;
  errors?: Array<{ message?: string; subCategory?: string; context?: Record<string, unknown> }>;
  context?: Record<string, unknown>;
}

function errorDetails(body: HubSpotErrorBody | null): string[] {
  const out: string[] = [];
  for (const e of body?.errors ?? []) {
    if (typeof e?.message === 'string' && e.message.trim() && !out.includes(e.message.trim())) out.push(e.message.trim().slice(0, 400));
  }
  return out.slice(0, 12);
}

function requiredScopesOf(body: HubSpotErrorBody | null): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (Array.isArray(v)) for (const s of v) if (typeof s === 'string' && !out.includes(s)) out.push(s);
  };
  for (const e of body?.errors ?? []) {
    add(e?.context?.requiredGranularScopes);
    add(e?.context?.requiredScopes);
  }
  add(body?.context?.requiredGranularScopes);
  add(body?.context?.requiredScopes);
  return out;
}

function retryAfterSeconds(value: string | null): number {
  const n = Number(value);
  if (value && Number.isFinite(n)) return Math.max(1, Math.ceil(n));
  return 2;
}

/** Map a failed developer-project call to a DeployApiError (plain-language message). */
export function mapDeployError(status: number, body: HubSpotErrorBody | null, retryAfter: string | null = null): HubSpotApiError {
  const correlationId = typeof body?.correlationId === 'string' ? body.correlationId : undefined;
  const hsMessage = typeof body?.message === 'string' ? body.message.trim().slice(0, 400) : '';
  const details = errorDetails(body);
  const sub = `${body?.subCategory ?? ''} ${(body?.errors ?? []).map((e) => e?.subCategory ?? '').join(' ')}`;
  if (status === 401) {
    return new DeployApiError('HubSpot no longer accepts the access for this deploy (it expired).', 401, 'key_expired', details, correlationId);
  }
  if (status === 403) {
    const scopes = requiredScopesOf(body);
    if (body?.category === 'MISSING_SCOPES' || scopes.length > 0) {
      return new DeployApiError(DEVELOPER_PROJECTS_PERMISSION_HELP, 403, 'missing_scope', details, correlationId, scopes);
    }
    if (body?.category === 'GATED' || sub.includes('PORTAL_GATED')) {
      return new DeployApiError(
        "Developer projects aren't available in this HubSpot account yet. Check that the account has access to the developer platform, or try a developer test account.",
        403,
        'not_available',
        details,
        correlationId,
        undefined,
        false,
        hsMessage || undefined,
      );
    }
    return new DeployApiError(
      hsMessage ? `HubSpot refused the request: ${hsMessage}` : "HubSpot says this key can't do that.",
      403,
      'forbidden',
      details,
      correlationId,
      undefined,
      false,
      hsMessage || undefined,
    );
  }
  if (sub.includes('PROJECT_LOCKED') || status === 423) {
    return new DeployApiError(
      'The project is locked in HubSpot — someone may be running local development (hs project dev) for it. Stop it, or unlock the project in HubSpot, then try again.',
      409,
      'project_locked',
      details,
      correlationId,
    );
  }
  if (status === 404) {
    return new DeployApiError(hsMessage ? `HubSpot couldn't find it: ${hsMessage}` : "HubSpot couldn't find it.", 404, 'not_found', details, correlationId);
  }
  if (status === 429) {
    const secs = retryAfterSeconds(retryAfter);
    const err = new RateLimitedError(`HubSpot is receiving too many requests right now. Please wait ${secs} seconds and try again.`, secs, correlationId);
    return err;
  }
  if (status >= 400 && status < 500) {
    return new DeployApiError(hsMessage ? `HubSpot rejected the project: ${hsMessage}` : 'HubSpot rejected the project.', 400, 'hubspot_rejected', details, correlationId);
  }
  return new DeployApiError('HubSpot had a problem answering. Please try again in a moment.', 502, 'hubspot_error', details, correlationId, undefined, true);
}

export function isTransient(err: unknown): boolean {
  if (err instanceof RateLimitedError) return true;
  return err instanceof DeployApiError && err.transient;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function unreachable(): DeployApiError {
  return new DeployApiError("Couldn't reach HubSpot. Check your connection and try again.", 502, 'hubspot_unreachable', [], undefined, undefined, true);
}

// ------------------------------------------------------------------ personal access key exchange

export interface PersonalAccessKeyToken {
  accessToken: string;
  /** Epoch ms. */
  expiresAt: number;
  portalId: number;
  userId?: number;
  hubName?: string;
  accountType?: string;
  scopeGroups: string[];
}

/** Basic shape check before sending a key to HubSpot. */
export function personalAccessKeyProblem(key: string): string | null {
  if (!key) return 'Paste your personal access key.';
  if (key.length < 20 || key.length > 4096 || /\s/.test(key)) {
    return "That doesn't look like a personal access key. Copy the whole key from HubSpot (use the Copy button next to it) and paste it here.";
  }
  return null;
}

/**
 * POST /localdevauth/v1/auth/refresh { encodedOAuthRefreshToken } → access token for the key's
 * portal (local-dev-lib utils/personalAccessKey.fetchAccessToken / lib/personalAccessKey.getAccessToken).
 */
export async function exchangePersonalAccessKey(config: ServerConfig, personalAccessKey: string): Promise<PersonalAccessKeyToken> {
  let res: Response;
  try {
    res = await fetchWithTimeout(
      config,
      `${config.hubspotApiBase}/localdevauth/v1/auth/refresh`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ encodedOAuthRefreshToken: personalAccessKey }),
      },
      HUBSPOT_DEPLOY_CALL_TIMEOUT_MS,
    );
  } catch {
    throw unreachable();
  }
  const body = (await readJson(res)) as Record<string, unknown> | null;
  if (!res.ok) {
    if (res.status === 429 || res.status >= 500) throw mapDeployError(res.status, body as HubSpotErrorBody | null, res.headers.get('retry-after'));
    throw new DeployApiError(
      "HubSpot didn't accept this personal access key. Check that you copied the whole key and that it is still active (you can create a new one on the personal access key page).",
      400,
      'invalid_key',
      errorDetails(body as HubSpotErrorBody | null),
      typeof body?.correlationId === 'string' ? body.correlationId : undefined,
    );
  }
  const accessToken = body?.oauthAccessToken;
  const hubId = body?.hubId;
  if (typeof accessToken !== 'string' || !accessToken || typeof hubId !== 'number') {
    throw new DeployApiError('HubSpot sent an unexpected answer when checking the key. Please try again.', 502, 'hubspot_error', [], undefined, undefined, true);
  }
  const expiresAtMillis = Number(body?.expiresAtMillis);
  return {
    accessToken,
    expiresAt: Number.isFinite(expiresAtMillis) && expiresAtMillis > 0 ? expiresAtMillis : config.now() + 30 * 60 * 1000,
    portalId: hubId,
    userId: typeof body?.userId === 'number' ? body.userId : undefined,
    hubName: typeof body?.hubName === 'string' ? body.hubName : undefined,
    accountType: typeof body?.accountType === 'string' ? body.accountType : undefined,
    scopeGroups: Array.isArray(body?.scopeGroups) ? (body.scopeGroups as unknown[]).filter((s): s is string => typeof s === 'string') : [],
  };
}

/** True when the key's permissions visibly lack developer projects (scope groups listed, none for projects). */
export function lacksDeveloperProjects(scopeGroups: string[]): boolean {
  return scopeGroups.length > 0 && !scopeGroups.some((s) => s.startsWith('developer.projects'));
}

// ------------------------------------------------------------------ authenticated calls

export interface RequestOptions {
  query?: Record<string, string | number | undefined>;
  json?: unknown;
  form?: FormData;
  timeoutMs?: number;
}

export class DeployHubSpotClient {
  constructor(
    private readonly config: ServerConfig,
    public accessToken: string,
    public readonly portalId: number,
  ) {}

  url(path: string, query: Record<string, string | number | undefined> = {}): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, String(v));
    params.set('portalId', String(this.portalId));
    return `${this.config.hubspotApiBase}/${path.replace(/^\/+/, '')}?${params.toString()}`;
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json' };
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }
    let res: Response;
    try {
      res = await fetchWithTimeout(this.config, this.url(path, opts.query), { method, headers, body }, opts.timeoutMs ?? HUBSPOT_DEPLOY_CALL_TIMEOUT_MS);
    } catch {
      throw unreachable();
    }
    const data = await readJson(res);
    if (!res.ok) throw mapDeployError(res.status, data as HubSpotErrorBody | null, res.headers.get('retry-after'));
    return data as T;
  }

  get<T>(path: string, query?: RequestOptions['query']): Promise<T> {
    return this.request<T>('GET', path, { query });
  }
}

// ------------------------------------------------------------------ endpoint helpers (local-dev-lib api/projects)

export const enc = encodeURIComponent;

export interface HsProject {
  id: number;
  name: string;
  portalId?: number;
  deployedBuildId?: number;
}

export interface HsSubtaskStatus {
  id?: string;
  status?: string;
  errorMessage?: string;
  buildName?: string;
  buildType?: string;
  deployName?: string;
  deployType?: string;
  visible?: boolean;
  standardError?: { message?: string; subCategory?: string; errors?: Array<{ message?: string }> } | null;
}

export interface HsBuild {
  buildId: number;
  status: string;
  isAutoDeployEnabled?: boolean;
  autoDeployId?: number;
  deployStatusTaskLocator?: { id: string | number } | null;
  subbuildStatuses?: HsSubtaskStatus[];
  platformVersion?: string;
}

export interface HsDeploy {
  deployId: number;
  buildId?: number;
  status: string;
  subdeployStatuses?: HsSubtaskStatus[];
}

export type HsDeployQueueResponse =
  | { buildResultType: 'DEPLOY_QUEUED'; id: string | number }
  | { buildResultType: 'DEPLOY_BLOCKED'; issues?: Array<{ uid?: string; componentTypeName?: string; blockingMessages?: Array<{ message?: string; isWarning?: boolean }> }> }
  | { buildResultType?: undefined; id?: string | number };

export const projectsApi = {
  fetchProject: (c: DeployHubSpotClient, name: string) => c.get<HsProject>(`developer/projects/v1/by-name/${enc(name)}`),
  createProject: (c: DeployHubSpotClient, name: string) => c.request<HsProject>('POST', 'developer/projects/v1', { json: { name } }),
  fetchSchemas: (c: DeployHubSpotClient, platformVersion: string) => c.get<Record<string, unknown> | null>(`project-components-external/project-schemas/v3/${enc(platformVersion)}`),
  uploadIR: (c: DeployHubSpotClient, form: FormData) =>
    c.request<{ createdBuildId?: number; buildId?: number }>('POST', 'project-components-external/v3/upload/new-api', { form, timeoutMs: HUBSPOT_UPLOAD_TIMEOUT_MS }),
  buildStatus: (c: DeployHubSpotClient, name: string, buildId: number) => c.get<HsBuild>(`dfs/v1/projects/${enc(name)}/builds/${buildId}/status`),
  buildWarnLogs: (c: DeployHubSpotClient, name: string, buildId: number) =>
    c.get<{ logs?: Array<{ message?: string }> }>(`dfs/logging/v1/logs/projects/${enc(name)}/builds/${buildId}/combined/warn`),
  queueDeploy: (c: DeployHubSpotClient, name: string, buildId: number) =>
    c.request<HsDeployQueueResponse>('POST', 'dfs/deploy/v3/deploys/queue/async', { json: { projectName: name, targetBuildId: buildId, ignoreWarnings: false } }),
  deployStatus: (c: DeployHubSpotClient, name: string, deployId: number) => c.get<HsDeploy>(`dfs/deploy/v1/deploy-status/projects/${enc(name)}/deploys/${deployId}`),
  deployWarnLogs: (c: DeployHubSpotClient, name: string, deployId: number) =>
    c.get<{ logs?: Array<{ message?: string }> }>(`dfs/logging/v1/logs/projects/${enc(name)}/deploys/${deployId}/combined/warn`),
  appByUid: (c: DeployHubSpotClient, appUid: string) => c.get<{ id?: number }>('apps-dev/external/public/v3/full/portal/sourceId', { sourceId: appUid }),
};
