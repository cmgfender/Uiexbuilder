/**
 * Terminal-free deploy as a STEPPED job (serverless hosts cannot keep background work).
 *
 *   POST /api/deploy        startDeploy: check files → translate (IR) → exchange the personal
 *                           access key → check portal → fetch component schemas → find/create
 *                           the project → upload (zip + IR). Answers phase "building".
 *   GET  /api/deploy/:id    advanceDeploy: ONE step per call — build status → (auto-)deploy →
 *                           deploy status → install link → success / failed.
 *
 * The job state lives in the deployId itself: an AES-GCM sealed token (HKDF from SESSION_SECRET,
 * purpose "deploy-job") holding portal, project, build / deploy ids, step, a bounded log and the
 * short-lived access token from the key exchange. The personal access key itself is never stored —
 * not in the token, not in a cookie: every deploy needs the key pasted again. Every status answer
 * carries a NEW deployId — always poll with the latest one.
 *
 * Who may start and follow a job (routes/deploy.ts):
 *  - once HubSpot sign-in is set up, starting a deploy needs a signed-in session whose grant is
 *    still live, and the key must belong to that same HubSpot account (and to ALLOWED_PORTALS);
 *  - a job is bound to the browser that started it: the `uiex_deploy` HttpOnly cookie holds a
 *    random value whose hash is sealed into the job (`k`). A deployId without that cookie (copied
 *    from a log line, replayed by someone else) is refused;
 *  - the only step that changes anything in HubSpot while polling ('queue') first checks the
 *    project's deployed build, so replaying an old deployId never re-deploys or rolls back a build.
 *
 * Mirrors `hs project upload` (CLI 8.x lib/projects/upload.ts + pollProjectBuildAndDeploy.ts):
 * auto-deploy is followed like the CLI does (waits ~15 s for HubSpot to start it); when a project
 * has automatic deploys turned off, the job queues the deploy itself, like `hs project deploy`,
 * because the admin has no terminal to run it.
 */
import type { DeployKeyAccount, DeployPhase, DeployRequest, DeployStatus } from '../../../src/connect/types';
import { HubSpotApiError, type ServerConfig, type SessionData } from '../types';
import { ConnectorError } from '../http';
import { seal, timingSafeEqual, unseal } from '../crypto';
import { sessionSecretUsable } from '../session';
import { appHostFor } from '../oauth';
import { DEFAULT_APP_BASE, portalAllowed } from '../config';
import {
  DEVELOPER_PROJECTS_PERMISSION_HELP,
  DeployApiError,
  DeployHubSpotClient,
  exchangePersonalAccessKey,
  isTransient,
  lacksDeveloperProjects,
  personalAccessKeyProblem,
  projectsApi,
  type HsBuild,
  type HsProject,
  type HsSubtaskStatus,
  type PersonalAccessKeyToken,
} from './api';
import { isLegacyPlatformVersion, meetsMinimumPlatformVersion, translateProject, type IntermediateRepresentationNode } from './ir';
import { readProjectConfig, uploadSourceFiles, validateDeployFiles, type DeployFile } from './paths';
import { createZip } from './zip';

export const JOB_TOKEN_PURPOSE = 'deploy-job';
export const JOB_TOKEN_AAD = 'uiex-deploy-job';
/** Sliding: every poll issues a fresh token. */
export const JOB_TTL_SECONDS = 60 * 60;
export const MAX_BUILD_POLLS = 400;
export const MAX_DEPLOY_POLLS = 400;
/** The CLI waits ~15 s (7 × 2 s) for HubSpot to start an automatic deploy. */
export const AUTODEPLOY_WAIT_POLLS = 10;
/** Consecutive network / 429 / 5xx answers tolerated while polling. */
export const MAX_TRANSIENT_ERRORS = 6;
/** Keeps the deployId (it travels in the URL) small. */
export const MAX_LOG_CHARS = 2400;
export const MAX_LOG_LINE = 280;
export const BUILD_MESSAGE = 'Uploaded from UI Extension Builder';

const PROJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const PLATFORM_VERSION_RE = /^(\d{4}\.\d{1,2}(-beta)?|unstable)$/;

export type JobStep = 'build' | 'autodeploy' | 'queue' | 'deploy' | 'install' | 'done' | 'failed';

/** Sealed job state (short keys keep the deployId small). */
export interface JobState {
  v: 1;
  /** Step. */
  s: JobStep;
  /** Portal id. */
  p: number;
  /** Project name. */
  n: string;
  /** Platform version. */
  pv: string;
  /** Build id. */
  b: number;
  /** HubSpot deploy id once known. */
  d?: number;
  /** Access token from the key exchange + its expiry (epoch ms). */
  t: string;
  te: number;
  /** HubSpot app host for links (app.hubspot.com, app-eu1.hubspot.com …). */
  h: string;
  /** Polls spent in the current step. */
  c: number;
  /** Consecutive transient errors. */
  e: number;
  /** App uid (for the install link) when the app is a private static-auth app. */
  au?: string;
  /** Log lines. */
  l: string[];
  /** Final message (done / failed). */
  m?: string;
  /** Failure code. */
  er?: string;
  /** Install link. */
  iu?: string;
  /** Started at (epoch ms). */
  st: number;
  /**
   * Hash of the browser binding (the `uiex_deploy` cookie of the browser that started the job).
   * Optional only so tokens sealed by an older version still parse; advanceDeploy refuses them.
   */
  k?: string;
}

/** The key belongs to another HubSpot account than the deploy target (answered as 409 portal_mismatch). */
export class PortalMismatchError extends ConnectorError {
  constructor(
    public keyPortalId: number,
    public targetPortalId: number,
    hubName?: string,
    /** The target is the account the browser is connected to (deploys only go there). */
    connected = false,
    /** The account the key belongs to (for the builder's fix-it screen). */
    public key?: DeployKeyAccount,
  ) {
    super(
      409,
      'portal_mismatch',
      connected
        ? `This personal access key belongs to HubSpot account ${keyPortalId}${hubName ? ` (${hubName})` : ''}, but you're connected to account ${targetPortalId}. Use a key from account ${targetPortalId}, or connect to account ${keyPortalId} instead (account menu › Switch account).`
        : `This personal access key belongs to HubSpot account ${keyPortalId}${hubName ? ` (${hubName})` : ''}, but the deploy is going to account ${targetPortalId}. Use a key from account ${targetPortalId}, or deploy to account ${keyPortalId} instead.`,
    );
  }
}

/**
 * A deploy (or key check) refused because of the personal access key or its account — missing
 * permission, an account HubSpot or ALLOWED_PORTALS refuses. Carries the account the key belongs to,
 * so the builder can name it and link to that account's key page.
 */
export class DeployKeyError extends ConnectorError {
  constructor(
    status: number,
    code: string,
    message: string,
    public key: DeployKeyAccount,
    extra: { correlationId?: string; requiredScopes?: string[] } = {},
  ) {
    super(status, code, message, extra);
    this.name = 'DeployKeyError';
  }
}

/** "Acme (account 123)" / "account 123" — how messages name the account a key belongs to. */
export function accountLabel(account: { portalId: number; name?: string }): string {
  return account.name ? `${account.name} (account ${account.portalId})` : `account ${account.portalId}`;
}

/** The scope group HubSpot names for the "Developer projects" permission (what the fake and the CLI use). */
export const DEVELOPER_PROJECTS_SCOPE = 'developer.projects.write';

export function missingPermissionMessage(account: { portalId: number; name?: string }): string {
  return `Your personal access key for ${accountLabel(account)} doesn’t have the “Developer projects” permission, so HubSpot won’t accept projects from it. On HubSpot’s personal access key page, add Developer projects to the key (or create a new key with it ticked), then check the key again.`;
}

export function portalNotAllowedDeployMessage(portalId: number): string {
  return `This builder only publishes to specific HubSpot accounts, and account ${portalId} isn't one of them. Ask the person who set up this builder to add it to ALLOWED_PORTALS, or use a key from an allowed account.`;
}

/** What the builder may show about the account a key belongs to (never the key or its token). */
export function keyAccountOf(config: ServerConfig, key: string, token: PersonalAccessKeyToken, session: SessionData | null): DeployKeyAccount {
  const host = appHostForKey(key, session, token.portalId);
  const account: DeployKeyAccount = {
    portalId: token.portalId,
    developerProjects: token.scopeGroups.length === 0 ? 'unknown' : lacksDeveloperProjects(token.scopeGroups) ? 'no' : 'yes',
    keyPageUrl: `${appOrigin(config, host)}/personal-access-key/${token.portalId}`,
  };
  const name = token.hubName?.replace(/\s+/g, ' ').trim();
  if (name) account.name = name.slice(0, 120);
  if (token.accountType && /^[A-Z0-9_]{1,40}$/.test(token.accountType)) account.accountType = token.accountType;
  return account;
}

/**
 * A 403 from HubSpot while uploading, explained for the account the key belongs to: the key lacks
 * Developer projects (missing_scope), developer projects aren't available in the account
 * (not_available), or HubSpot refused for another reason (forbidden, with HubSpot's words).
 * Anything else is returned unchanged.
 */
export function keyRefusal(err: unknown, account: DeployKeyAccount): unknown {
  if (!(err instanceof HubSpotApiError) || err.status !== 403) return err;
  const extra = { correlationId: err.correlationId, requiredScopes: err.requiredScopes };
  const label = accountLabel(account);
  if (err.code === 'not_available') {
    return new DeployKeyError(
      403,
      'not_available',
      `HubSpot says developer projects aren't available in ${label}, so it can't take your cards there. Publish to an account that shows Development in HubSpot's main menu (a developer test account works too), or ask HubSpot support to turn on developer projects for this account.`,
      account,
      extra,
    );
  }
  if (err.code === 'missing_scope') {
    return new DeployKeyError(403, 'missing_scope', missingPermissionMessage(account), { ...account, developerProjects: 'no' }, {
      ...extra,
      requiredScopes: err.requiredScopes?.length ? err.requiredScopes : [DEVELOPER_PROJECTS_SCOPE],
    });
  }
  const said = err instanceof DeployApiError && err.hubspotMessage ? ` HubSpot said: “${err.hubspotMessage}”` : '';
  return new DeployKeyError(
    403,
    'forbidden',
    `HubSpot refused to take the project into ${label}.${said} Usually the key's user isn't allowed to use developer tools in that account: a Super Admin can allow it (Settings → Users & Teams → the user's permissions), or publish with their own key.`,
    account,
    extra,
  );
}

/** The browser-binding cookie of deploy jobs (`__Host-uiex_deploy` on https). */
export const DEPLOY_BINDING_COOKIE = 'uiex_deploy';
/** How long the binding cookie lives (refreshed on every start / poll). */
export const DEPLOY_BINDING_TTL_SECONDS = 2 * 60 * 60;

/** Hash of a binding cookie value, as sealed into the job (`k`). */
export async function bindingHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`uiex-deploy-binding:${value}`));
  let bin = '';
  for (const b of new Uint8Array(digest).slice(0, 18)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function notFollowable(): ConnectorError {
  return new ConnectorError(
    404,
    'deploy_not_found',
    "This deploy can't be followed any more (status links expire after an hour and only work in the browser that started the deploy). Open the project in HubSpot to see how it went, or deploy again.",
  );
}

// ------------------------------------------------------------------ token sealing

export function sealJob(config: ServerConfig, state: JobState): Promise<string> {
  return seal(state, { secret: config.sessionSecret, purpose: JOB_TOKEN_PURPOSE, aad: JOB_TOKEN_AAD, now: config.now(), ttlSeconds: JOB_TTL_SECONDS });
}

export async function unsealJob(config: ServerConfig, token: string): Promise<JobState | null> {
  if (!token || token.length > 16_000) return null;
  const s = await unseal<JobState>(token, { secret: config.sessionSecret, purpose: JOB_TOKEN_PURPOSE, aad: JOB_TOKEN_AAD, now: config.now() });
  if (!s || s.v !== 1 || typeof s.p !== 'number' || typeof s.n !== 'string' || typeof s.t !== 'string' || !Array.isArray(s.l)) return null;
  return s;
}

// ------------------------------------------------------------------ status

const PHASE: Record<JobStep, DeployPhase> = {
  build: 'building',
  autodeploy: 'deploying',
  queue: 'deploying',
  deploy: 'deploying',
  install: 'deploying',
  done: 'success',
  failed: 'failed',
};

export function appOrigin(config: ServerConfig, appHost: string): string {
  // A custom HUBSPOT_APP_BASE (EU data centre, local fake) is where links should go too.
  return config.hubspotAppBase && config.hubspotAppBase !== DEFAULT_APP_BASE ? config.hubspotAppBase : `https://${appHost}`;
}

export function projectUrl(config: ServerConfig, s: Pick<JobState, 'h' | 'p' | 'n'>): string {
  return `${appOrigin(config, s.h)}/developer-projects/${s.p}/project/${encodeURIComponent(s.n)}`;
}

function stepMessage(s: JobState): string {
  const busy = s.e > 0 ? ' HubSpot is busy right now — still checking…' : '';
  switch (s.s) {
    case 'build':
      return `HubSpot is building your project (build #${s.b}).${busy}`;
    case 'autodeploy':
      return `Build #${s.b} is ready. Waiting for HubSpot to start the deploy…${busy}`;
    case 'queue':
      return `Build #${s.b} is ready. Starting the deploy…${busy}`;
    case 'deploy':
      return `Deploying build #${s.b} to your HubSpot account…${busy}`;
    case 'install':
      return 'Deployed. Finishing up…';
    case 'done':
      return s.m ?? 'Your project is live in HubSpot.';
    case 'failed':
      return s.m ?? 'The deploy failed.';
  }
}

export function toStatus(config: ServerConfig, deployId: string, s: JobState): DeployStatus {
  const status: DeployStatus = {
    deployId,
    phase: PHASE[s.s],
    message: stepMessage(s),
    log: [...s.l],
    portalId: s.p,
    projectName: s.n,
    buildId: s.b,
    projectUrl: projectUrl(config, s),
  };
  if (s.s === 'failed') status.error = s.er ?? 'deploy_failed';
  if (s.iu) status.installUrl = s.iu;
  return status;
}

// ------------------------------------------------------------------ log helpers

export function pushLog(s: JobState, line: string): void {
  const text = line.replace(/\s+/g, ' ').trim();
  if (!text) return;
  s.l.push(text.length > MAX_LOG_LINE ? `${text.slice(0, MAX_LOG_LINE - 1)}…` : text);
  const total = () => s.l.reduce((n, l) => n + l.length, 0);
  const marker = '… (earlier lines hidden)';
  while (total() > MAX_LOG_CHARS && s.l.length > 2) {
    if (s.l[1] === marker) s.l.splice(2, 1);
    else s.l.splice(1, 1, marker);
  }
}

function goTo(s: JobState, step: JobStep): void {
  s.s = step;
  s.c = 0;
}

function finish(s: JobState, message?: string): void {
  goTo(s, 'done');
  s.m = message ?? 'Your project is live in HubSpot.';
}

function fail(s: JobState, code: string, message: string): void {
  goTo(s, 'failed');
  s.er = code;
  s.m = message;
}

function subtaskName(t: HsSubtaskStatus): string {
  return t.buildName ?? t.deployName ?? t.id ?? 'A component';
}

/** Error lines for failed sub-builds / sub-deploys (dependents that failed only because another did are skipped, like the CLI). */
export function subtaskErrors(list: HsSubtaskStatus[] | undefined): string[] {
  const failed = (list ?? []).filter((t) => String(t?.status ?? '').toUpperCase() === 'FAILURE');
  const shown = failed.filter((t) => !/DEPENDENT_SUB(BUILD|DEPLOY)_FAILED/.test(t.standardError?.subCategory ?? ''));
  const lines: string[] = [];
  for (const t of shown) {
    lines.push(`${subtaskName(t)} failed: ${t.errorMessage?.trim() || t.standardError?.message?.trim() || 'no details from HubSpot'}`);
    for (const e of t.standardError?.errors ?? []) if (e?.message?.trim()) lines.push(`• ${e.message.trim()}`);
  }
  if (lines.length === 0 && failed.length > 0) lines.push(`${failed.map(subtaskName).join(', ')} failed.`);
  return lines;
}

async function addWarnings(s: JobState, fetchLogs: () => Promise<{ logs?: Array<{ message?: string }> } | null>): Promise<void> {
  try {
    const res = await fetchLogs();
    const seen = new Set<string>();
    for (const log of res?.logs ?? []) {
      const msg = typeof log?.message === 'string' ? log.message.trim() : '';
      if (msg && !seen.has(msg)) seen.add(msg);
    }
    [...seen].slice(0, 8).forEach((m) => pushLog(s, `Warning: ${m}`));
  } catch {
    // Warnings are informational; never fail a deploy over them.
  }
}

function errorLines(err: unknown): string[] {
  if (err instanceof DeployApiError) return err.details;
  return [];
}

// ------------------------------------------------------------------ start (POST /api/deploy)

export interface ParsedDeployRequest {
  personalAccessKey: string;
  useRememberedKey: boolean;
  remember: boolean;
  portalId?: number;
  projectName: string;
  platformVersion: string;
  files: unknown;
}

function bad(code: string, message: string): ConnectorError {
  return new ConnectorError(400, code, message);
}

export function parseDeployRequest(raw: unknown): ParsedDeployRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('bad_request', 'The deploy request must be a JSON object.');
  const r = raw as Partial<Record<keyof DeployRequest, unknown>>;
  const projectName = typeof r.projectName === 'string' ? r.projectName.trim() : '';
  if (!PROJECT_NAME_RE.test(projectName)) {
    throw bad('invalid_project', 'The project name must use letters, digits, dashes, dots or underscores (max 64 characters), e.g. “my-hubspot-app”. Change it in App settings.');
  }
  const platformVersion = typeof r.platformVersion === 'string' ? r.platformVersion.trim() : '';
  if (!PLATFORM_VERSION_RE.test(platformVersion)) throw bad('invalid_project', `Unsupported platform version: '${platformVersion.slice(0, 40)}'.`);
  let portalId: number | undefined;
  if (r.portalId !== undefined && r.portalId !== null) {
    if (typeof r.portalId !== 'number' || !Number.isSafeInteger(r.portalId) || r.portalId <= 0) throw bad('bad_request', 'portalId must be a HubSpot account id.');
    portalId = r.portalId;
  }
  return {
    personalAccessKey: typeof r.personalAccessKey === 'string' ? r.personalAccessKey.trim() : '',
    useRememberedKey: r.useRememberedKey === true,
    remember: r.remember === true,
    portalId,
    projectName,
    platformVersion,
    files: r.files,
  };
}

function listProblems(intro: string, problems: string[]): string {
  const shown = problems.slice(0, 6).join(' • ');
  const more = problems.length > 6 ? ` (and ${problems.length - 6} more)` : '';
  return `${intro} ${shown}${more}`;
}

/** App host for links: the connected session's when it is the same portal, else from the key's region. */
export function appHostForKey(key: string, session: SessionData | null, portalId: number): string {
  if (session && session.portalId === portalId && session.appHost) return session.appHost;
  const direct = appHostFor({ refreshToken: key });
  if (direct !== 'app.hubspot.com') return direct;
  try {
    // Real keys are base64 (protobuf) starting with the hublet, e.g. "CiRuYTEt…" → "\n$na1-…".
    const head = key.replace(/-/g, '+').replace(/_/g, '/').slice(0, 24);
    const region = /([a-z]{2}\d)-/.exec(atob(head))?.[1];
    if (region && region !== 'na1') return `app-${region}.hubspot.com`;
  } catch {
    // not base64 — default host
  }
  return 'app.hubspot.com';
}

async function ensureProject(client: DeployHubSpotClient, name: string): Promise<{ project: HsProject | null; created: boolean }> {
  try {
    const project = await projectsApi.fetchProject(client, name);
    if (project) return { project, created: false };
  } catch (err) {
    if (!(err instanceof DeployApiError) || err.code !== 'not_found') throw err;
  }
  const project = await projectsApi.createProject(client, name);
  return { project, created: true };
}

function isPrivateStaticApp(node: IntermediateRepresentationNode | undefined): boolean {
  const config = node?.config as { distribution?: unknown; auth?: { type?: unknown } } | undefined;
  return !!config && config.distribution === 'private' && config.auth?.type === 'static';
}

export interface StartResult {
  state: JobState;
  deployId: string;
  status: DeployStatus;
}

export interface StartDeployOptions {
  /**
   * The signed-in HubSpot session (grant confirmed), or null when HubSpot sign-in isn't set up on
   * this server (first-time setup: the host deploys the connector's own app). When set, the key
   * must belong to this account.
   */
  signedIn: SessionData | null;
  /** Hash of the browser-binding cookie (bindingHash). */
  binding: string;
}

/** HubSpot rejected a key that looks like a private app access token (pat-na1-…), not a personal access key. */
export function looksLikePrivateAppToken(key: string): boolean {
  return /^pat-[a-z]{2}\d-/i.test(key.trim());
}

export const PRIVATE_APP_TOKEN_HELP =
  'This looks like a private app access token (it starts with “pat-”). Deploying needs your personal access key from the Personal access key page instead — a much longer code. Use the Copy button next to it.';

/**
 * Checks the key's shape, then exchanges it with HubSpot (invalid_key / missing_key otherwise; a
 * private app token gets its own explanation). Shared by deploys and key checks.
 */
export async function exchangeDeployKey(config: ServerConfig, key: string): Promise<PersonalAccessKeyToken> {
  const keyProblem = personalAccessKeyProblem(key);
  if (keyProblem) throw bad(key ? 'invalid_key' : 'missing_key', keyProblem);
  try {
    return await exchangePersonalAccessKey(config, key);
  } catch (err) {
    if (err instanceof DeployApiError && err.code === 'invalid_key' && looksLikePrivateAppToken(key)) {
      throw new DeployApiError(PRIVATE_APP_TOKEN_HELP, 400, 'invalid_key', [], err.correlationId);
    }
    throw err;
  }
}

export async function startDeploy(config: ServerConfig, raw: unknown, opts: StartDeployOptions): Promise<StartResult> {
  if (!sessionSecretUsable(config)) {
    throw new ConnectorError(503, 'not_configured', 'Deploying from the builder needs SESSION_SECRET (at least 32 random characters) on the server. Ask whoever hosts the builder to set it.');
  }
  const req = parseDeployRequest(raw);

  // 1. Files → the archive and IR `hs project upload` would send (all local, no HubSpot call yet).
  const { files, problems } = validateDeployFiles(req.files);
  if (problems.length) throw bad('invalid_files', listProblems("Some project files can't be uploaded:", problems));
  const pc = readProjectConfig(files);
  if (pc.problem) throw bad('invalid_project', pc.problem);
  if (pc.config?.name !== undefined && pc.config.name !== req.projectName) {
    throw bad('invalid_project', `hsproject.json names the project “${pc.config.name.slice(0, 64)}”, but the deploy is for “${req.projectName}”.`);
  }
  if (pc.config?.platformVersion !== undefined && pc.config.platformVersion !== req.platformVersion) {
    throw bad('invalid_project', `hsproject.json uses platform version ${pc.config.platformVersion.slice(0, 40)}, but the deploy is for ${req.platformVersion}.`);
  }
  if (isLegacyPlatformVersion(req.platformVersion)) {
    throw bad('unsupported_platform', `Projects on platform version ${req.platformVersion} can't be deployed from the builder. Choose 2025.2 or later in App settings.`);
  }
  const srcDir = pc.config ? pc.config.srcDir : 'src';
  const src = uploadSourceFiles(files, srcDir);
  if (src.length === 0) throw bad('invalid_project', `There are no files in the project's source folder (${srcDir || 'project root'}).`);
  const local = translateProject(src, req.platformVersion, null);
  if (local.errors.length) throw bad('invalid_project', listProblems('HubSpot would reject the project:', local.errors));

  // 2. The personal access key → access token for its portal. Keys are never stored, so there is
  //    no "remembered" key to fall back on: the admin pastes it for every deploy.
  const sessionData = opts.signedIn;
  const key = req.personalAccessKey;
  if (!key && req.useRememberedKey) {
    throw bad('no_remembered_key', "The builder doesn't save personal access keys. Paste your key to deploy.");
  }
  const token = await exchangeDeployKey(config, key);
  const account = keyAccountOf(config, key, token, sessionData);

  if (sessionData) {
    if (token.portalId !== sessionData.portalId) throw new PortalMismatchError(token.portalId, sessionData.portalId, token.hubName, true, account);
  } else if (req.portalId !== undefined && req.portalId !== token.portalId) {
    throw new PortalMismatchError(token.portalId, req.portalId, token.hubName, false, account);
  }
  if (!portalAllowed(config, token.portalId)) {
    throw new DeployKeyError(403, 'portal_not_allowed', portalNotAllowedDeployMessage(token.portalId), account);
  }
  try {
    return await uploadProject(config, req, src, state0(config, req, token, key, sessionData, opts.binding), token);
  } catch (err) {
    // 403s while talking to HubSpot are about the key or its account: name the account and the fix.
    throw keyRefusal(err, account);
  }
}

function state0(config: ServerConfig, req: ParsedDeployRequest, token: PersonalAccessKeyToken, key: string, sessionData: SessionData | null, binding: string): JobState {
  const state: JobState = {
    v: 1,
    s: 'build',
    p: token.portalId,
    n: req.projectName,
    pv: req.platformVersion,
    b: 0,
    t: token.accessToken,
    te: token.expiresAt,
    h: appHostForKey(key, sessionData, token.portalId),
    c: 0,
    e: 0,
    l: [],
    st: config.now(),
    k: binding,
  };
  pushLog(state, `Signed in to HubSpot account ${token.portalId}${token.hubName ? ` (${token.hubName})` : ''} with your personal access key.`);
  if (lacksDeveloperProjects(token.scopeGroups)) pushLog(state, 'Warning: this key may be missing the “Developer projects” permission.');
  return state;
}

/** Steps 3-5 of a deploy: component schemas, the project (created when missing), the upload. */
async function uploadProject(config: ServerConfig, req: ParsedDeployRequest, src: DeployFile[], state: JobState, token: PersonalAccessKeyToken): Promise<StartResult> {
  const client = new DeployHubSpotClient(config, token.accessToken, token.portalId);

  // 3. Component schemas for the platform version (project-parsing-lib fetches them to validate).
  let schemas: Record<string, unknown> | null = null;
  try {
    schemas = await projectsApi.fetchSchemas(client, req.platformVersion);
  } catch (err) {
    if (err instanceof HubSpotApiError && err.status === 403) {
      // A bare 403 here means the key can't use developer projects (keyRefusal names the account) —
      // unless HubSpot listed the key's scope groups with developer projects in them: then it is
      // about something else (the account, the user), and HubSpot's own answer is kept.
      const keyHasProjects = token.scopeGroups.length > 0 && !lacksDeveloperProjects(token.scopeGroups);
      if (err.code === 'not_available' || (keyHasProjects && err.code === 'forbidden')) throw err;
      throw new DeployApiError(DEVELOPER_PROJECTS_PERMISSION_HELP, 403, 'missing_scope', errorLines(err), err.correlationId, err.requiredScopes);
    }
    if (!(err instanceof DeployApiError) || err.code !== 'not_found') throw err;
  }
  if (!schemas || typeof schemas !== 'object' || Object.keys(schemas).length === 0) {
    throw bad('platform_unavailable', `Platform version ${req.platformVersion} isn't available in this HubSpot account. Choose another platform version in App settings.`);
  }
  const translated = translateProject(src, req.platformVersion, schemas);
  if (translated.errors.length) throw bad('invalid_project', listProblems('HubSpot would reject the project:', translated.errors));
  if (translated.skippedHsMetaFiles.length) {
    pushLog(state, `Skipped ${translated.skippedHsMetaFiles.length} *-hsmeta.json file(s) outside component folders: ${translated.skippedHsMetaFiles.slice(0, 3).join(', ')}`);
  }

  // 4. Project (created on first deploy, like `hs project upload --force-create`).
  const { created } = await ensureProject(client, req.projectName);
  pushLog(state, created ? `Created the project “${req.projectName}” in HubSpot.` : `Found the project “${req.projectName}” in HubSpot.`);

  // 5. Upload: the srcDir contents as a zip + the IR (project-components-external/v3/upload/new-api).
  const zip = createZip(
    src.map((f) => ({ path: f.path, data: f.contents })),
    { mtime: new Date(config.now()) },
  );
  const form = new FormData();
  form.append('projectFilesZip', new Blob([zip], { type: 'application/zip' }), `${req.projectName}.zip`);
  form.append('platformVersion', req.platformVersion);
  form.append(
    'uploadRequest',
    JSON.stringify({ ...translated.intermediateRepresentation, projectName: req.projectName, buildMessage: BUILD_MESSAGE, skipAutoDeploy: false }),
  );
  const upload = await projectsApi.uploadIR(client, form);
  const buildId = Number(upload?.createdBuildId ?? upload?.buildId);
  if (!Number.isSafeInteger(buildId) || buildId <= 0) {
    throw new DeployApiError('HubSpot accepted the upload but did not say which build it started. Open the project in HubSpot to check on it.', 502, 'hubspot_error');
  }
  state.b = buildId;
  pushLog(state, `Uploaded ${src.length} files. HubSpot started build #${buildId}.`);

  const appNode = Object.values(translated.intermediateRepresentation.intermediateNodesIndexedByUid).find((n) => n.componentType === 'APPLICATION');
  if (appNode && isPrivateStaticApp(appNode)) state.au = appNode.uid;

  const deployId = await sealJob(config, state);
  return { state, deployId, status: toStatus(config, deployId, state) };
}

// ------------------------------------------------------------------ advance (GET /api/deploy/:id)

function afterBuild(s: JobState, build: HsBuild): void {
  const locatorId = build.deployStatusTaskLocator?.id;
  if (build.isAutoDeployEnabled) {
    if ((build.autoDeployId ?? 0) > 0 && locatorId !== undefined && locatorId !== null) {
      s.d = Number(locatorId);
      pushLog(s, `HubSpot is deploying build #${s.b} automatically.`);
      goTo(s, 'deploy');
    } else {
      goTo(s, 'autodeploy');
    }
    return;
  }
  if (meetsMinimumPlatformVersion(build.platformVersion ?? s.pv, '2027.03')) {
    finish(s, `Build #${s.b} is ready. This project uses release management: create a release for build #${s.b} in HubSpot to make it live.`);
    return;
  }
  pushLog(s, `Automatic deploys are turned off for this project, so the builder is deploying build #${s.b} now.`);
  goTo(s, 'queue');
}

async function runStep(config: ServerConfig, s: JobState, client: DeployHubSpotClient): Promise<void> {
  switch (s.s) {
    case 'build': {
      const build = await projectsApi.buildStatus(client, s.n, s.b);
      s.e = 0;
      const st = String(build?.status ?? '').toUpperCase();
      if (st === 'SUCCESS') {
        pushLog(s, `Build #${s.b} succeeded.`);
        await addWarnings(s, () => projectsApi.buildWarnLogs(client, s.n, s.b));
        afterBuild(s, build);
      } else if (st === 'FAILURE') {
        for (const line of subtaskErrors(build.subbuildStatuses)) pushLog(s, line);
        pushLog(s, `Build #${s.b} failed.`);
        fail(s, 'build_failed', `HubSpot couldn't build your project (build #${s.b}). The log below says why.`);
      } else if (++s.c >= MAX_BUILD_POLLS) {
        fail(s, 'timeout', `Build #${s.b} is taking much longer than usual. Open the project in HubSpot to see how it is going.`);
      }
      return;
    }
    case 'autodeploy': {
      const build = await projectsApi.buildStatus(client, s.n, s.b);
      s.e = 0;
      const locatorId = build?.deployStatusTaskLocator?.id;
      if ((build?.autoDeployId ?? 0) > 0 && locatorId !== undefined && locatorId !== null) {
        s.d = Number(locatorId);
        pushLog(s, `HubSpot is deploying build #${s.b} automatically.`);
        goTo(s, 'deploy');
      } else if (++s.c >= AUTODEPLOY_WAIT_POLLS) {
        fail(
          s,
          'autodeploy_missing',
          `HubSpot built your project (build #${s.b}) but didn't start the automatic deploy — it may have been skipped or blocked, for example because components were removed. Open the project in HubSpot to deploy build #${s.b}.`,
        );
      }
      return;
    }
    case 'queue': {
      // The one step that changes something in HubSpot. A deployId can be replayed (it is only
      // a sealed token), so never queue a build that is already live or older than the live one.
      const project = await projectsApi.fetchProject(client, s.n);
      const live = Number(project?.deployedBuildId ?? 0);
      if (live === s.b) {
        pushLog(s, `Build #${s.b} is already deployed.`);
        if (s.au) goTo(s, 'install');
        else finish(s);
        return;
      }
      if (live > s.b) {
        fail(s, 'superseded', `A newer build (#${live}) of this project is already live in HubSpot, so the builder didn't deploy the older build #${s.b}.`);
        return;
      }
      const res = await projectsApi.queueDeploy(client, s.n, s.b);
      s.e = 0;
      if (res && res.buildResultType === 'DEPLOY_BLOCKED') {
        const issues = res.issues ?? [];
        const warningsOnly = issues.length > 0 && issues.every((i) => (i.blockingMessages ?? []).every((m) => m?.isWarning));
        for (const issue of issues) {
          const who = `${issue.uid ?? 'component'}${issue.componentTypeName ? ` (${issue.componentTypeName})` : ''}`;
          const msgs = (issue.blockingMessages ?? []).map((m) => m?.message?.trim()).filter(Boolean);
          if (msgs.length === 0) pushLog(s, `${who} can't be deployed.`);
          for (const m of msgs) pushLog(s, `${who}: ${m}`);
        }
        fail(
          s,
          'deploy_blocked',
          warningsOnly
            ? `HubSpot paused the deploy of build #${s.b} because of the warnings below. Review them, then deploy build #${s.b} from the project page in HubSpot.`
            : `HubSpot blocked the deploy of build #${s.b}. The log below says why.`,
        );
        return;
      }
      const id = res && 'id' in res ? Number(res.id) : NaN;
      if (!Number.isFinite(id) || id <= 0) {
        fail(s, 'deploy_failed', `HubSpot didn't start the deploy of build #${s.b}. Open the project in HubSpot to deploy it.`);
        return;
      }
      s.d = id;
      pushLog(s, `Deploying build #${s.b}.`);
      goTo(s, 'deploy');
      return;
    }
    case 'deploy': {
      const deploy = await projectsApi.deployStatus(client, s.n, s.d ?? 0);
      s.e = 0;
      const st = String(deploy?.status ?? '').toUpperCase();
      if (st === 'SUCCESS' || st === 'FINISHED') {
        pushLog(s, `Deployed build #${s.b}.`);
        await addWarnings(s, () => projectsApi.deployWarnLogs(client, s.n, s.d ?? 0));
        if (s.au) goTo(s, 'install');
        else finish(s);
      } else if (st === 'FAILURE') {
        for (const line of subtaskErrors(deploy.subdeployStatuses)) pushLog(s, line);
        pushLog(s, `Deploy of build #${s.b} failed.`);
        fail(s, 'deploy_failed', `HubSpot couldn't deploy build #${s.b}. The log below says why.`);
      } else if (++s.c >= MAX_DEPLOY_POLLS) {
        fail(s, 'timeout', `The deploy is taking much longer than usual. Open the project in HubSpot to see how it is going.`);
      }
      return;
    }
    case 'install': {
      try {
        const app = await projectsApi.appByUid(client, s.au ?? '');
        if (typeof app?.id === 'number' && app.id > 0) s.iu = `${appOrigin(config, s.h)}/static-token/${s.p}/authorize?appId=${app.id}`;
      } catch {
        // The install link is a convenience; the project page has an Install button too.
      }
      finish(s);
      return;
    }
    case 'done':
    case 'failed':
      return;
  }
}

function handleStepError(s: JobState, err: unknown): void {
  if (isTransient(err)) {
    s.e += 1;
    if (s.e >= MAX_TRANSIENT_ERRORS) {
      fail(s, 'hubspot_unavailable', "HubSpot hasn't answered for a while. Open the project in HubSpot to see how the deploy is going.");
    }
    return;
  }
  for (const line of errorLines(err)) pushLog(s, line);
  const message = err instanceof HubSpotApiError || err instanceof ConnectorError ? err.message : 'Something went wrong while checking on the deploy.';
  const code = err instanceof HubSpotApiError || err instanceof ConnectorError ? err.code : 'internal_error';
  fail(s, code, message);
}

export interface AdvanceResult {
  state: JobState;
  deployId: string;
  status: DeployStatus;
}

export async function advanceDeploy(config: ServerConfig, deployId: string, binding: string | null): Promise<AdvanceResult> {
  if (!sessionSecretUsable(config)) {
    throw new ConnectorError(503, 'not_configured', 'Deploying from the builder needs SESSION_SECRET on the server.');
  }
  const current = await unsealJob(config, deployId);
  // Only the browser that started the job can follow it (a deployId alone is not enough).
  if (!current || !current.k || !binding || !timingSafeEqual(current.k, binding)) throw notFollowable();
  if (current.s === 'done' || current.s === 'failed') return { state: current, deployId, status: toStatus(config, deployId, current) };

  const s: JobState = { ...current, l: [...current.l] };
  const client = new DeployHubSpotClient(config, s.t, s.p);
  try {
    await runStep(config, s, client);
  } catch (err) {
    if (err instanceof HubSpotApiError && err.status === 401) {
      fail(
        s,
        'expired',
        `HubSpot access for this deploy expired before it finished. Open the project in HubSpot to check on build #${s.b}, or deploy again.`,
      );
    } else {
      handleStepError(s, err);
    }
  }
  const next = await sealJob(config, s);
  return { state: s, deployId: next, status: toStatus(config, next, s) };
}
