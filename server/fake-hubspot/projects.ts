/**
 * Fake HubSpot developer-project endpoints (personal-access-key exchange, project fetch/create,
 * component schemas, IR upload, build and deploy status, warning logs, app lookup) for
 * terminal-free deploy tests and the local demo (`npm run dev:full`). The main fake handler
 * (./handler.ts) delegates requests whose path starts with one of FAKE_PROJECT_PATH_PREFIXES to
 * handleFakeProjects.
 *
 * Shapes follow @hubspot/local-dev-lib 5.x (api/projects, api/localDevAuth, api/appsDev, types/*).
 * Builds and deploys progress per poll: PENDING → BUILDING … → SUCCESS / FAILURE (see setPolls).
 *
 * Failure modes for tests and demos: a personal access key that CONTAINS one of the FAKE_KEY_MODES
 * markers is accepted for the default portal and switches the mode on, e.g. "fail-build",
 * "pat-na1-fake-no-autodeploy-1". Test controls: fakeProjects(state) (uploads, expire tokens, polls,
 * clock).
 */
import { readStoredZip } from '../core/deploy/zip';

export const FAKE_PROJECT_PATH_PREFIXES = ['/localdevauth/', '/dfs/', '/project-components-external/', '/developer/', '/apps-dev/'];

export interface FakeProjectsState {
  portalId: number;
  /** Personal access keys accepted by the fake (key -> portal id). */
  personalAccessKeys: Map<string, number>;
}

/** Markers that switch on a failure mode when they appear in a personal access key. */
export const FAKE_KEY_MODES = [
  /** The build fails with a TypeScript error in the first card. */
  'fail-build',
  /** The build succeeds, the deploy fails. */
  'fail-deploy',
  /** isAutoDeployEnabled = false (the connector queues the deploy itself). */
  'no-autodeploy',
  /** Auto-deploy off and the deploy queue answers DEPLOY_BLOCKED (warnings). */
  'blocked-deploy',
  /** Auto-deploy on but skipped (autoDeployId 0, no deploy locator). */
  'skip-autodeploy',
  /** The deploy locator appears only a couple of polls after the build succeeded. */
  'slow-autodeploy',
  /** Upload answers 409 PROJECT_LOCKED. */
  'project-locked',
  /** The key lacks developer projects: project endpoints answer 403 MISSING_SCOPES. */
  'no-projects-scope',
  /** Build and deploy produce warning logs. */
  'warn',
] as const;
export type FakeKeyMode = (typeof FAKE_KEY_MODES)[number];

export const FAKE_PLATFORM_VERSIONS = ['2025.2', '2026.03-beta', '2026.03', '2026.09-beta', '2026.09', 'unstable'];

export interface FakeUpload {
  portalId: number;
  projectName: string;
  platformVersion: string;
  buildMessage: string;
  skipAutoDeploy: boolean;
  /** Parsed uploadRequest (IR + projectName + buildMessage + skipAutoDeploy). */
  uploadRequest: Record<string, unknown>;
  /** Archive entries (path → text). */
  files: Map<string, string>;
  zipFileName: string;
}

interface FakeToken {
  portalId: number;
  modes: Set<FakeKeyMode>;
  expiresAt: number;
}

interface FakeProject {
  id: number;
  name: string;
  portalId: number;
  createdAt: number;
  updatedAt: number;
  latestBuildId?: number;
  deployedBuildId?: number;
}

interface FakeBuild {
  buildId: number;
  projectName: string;
  portalId: number;
  platformVersion: string;
  modes: Set<FakeKeyMode>;
  polls: number;
  status: 'PENDING' | 'BUILDING' | 'SUCCESS' | 'FAILURE';
  createdAt: number;
  components: Array<{ uid: string; type: string }>;
  autoDeploy: boolean;
  autoDeployId: number;
  locatorDelay: number;
}

interface FakeDeploy {
  deployId: number;
  buildId: number;
  projectName: string;
  portalId: number;
  modes: Set<FakeKeyMode>;
  polls: number;
  status: 'PENDING' | 'DEPLOYING' | 'SUCCESS' | 'FAILURE';
}

interface Store {
  now: () => number;
  tokens: Map<string, FakeToken>;
  projects: Map<string, FakeProject>;
  builds: Map<number, FakeBuild>;
  deploys: Map<number, FakeDeploy>;
  apps: Map<string, { id: number; projectId: number; portalId: number }>;
  uploads: FakeUpload[];
  nextId: number;
  buildPolls: number;
  deployPolls: number;
  tokenTtlMs: number;
}

export interface FakeProjectsControls {
  /** Every accepted upload, oldest first. */
  readonly uploads: ReadonlyArray<FakeUpload>;
  /** Number of BUILDING/DEPLOYING answers before the result (defaults 2 / 2). */
  setPolls(polls: { build?: number; deploy?: number }): void;
  /** Every access token from the key exchange stops working (401 until the key is exchanged again). */
  expireAccessTokens(): void;
  /** Share the test clock. */
  setNow(now: () => number): void;
  /** Projects by name in the default portal. */
  project(name: string, portalId?: number): { id: number; name: string; deployedBuildId?: number; latestBuildId?: number } | undefined;
  /** Builds / deploys started so far. */
  readonly buildCount: number;
  readonly deployCount: number;
}

const stores = new WeakMap<FakeProjectsState, Store>();

function storeFor(state: FakeProjectsState): Store {
  let s = stores.get(state);
  if (!s) {
    s = {
      now: () => Date.now(),
      tokens: new Map(),
      projects: new Map(),
      builds: new Map(),
      deploys: new Map(),
      apps: new Map(),
      uploads: [],
      nextId: 1000,
      buildPolls: 2,
      deployPolls: 2,
      tokenTtlMs: 30 * 60 * 1000,
    };
    stores.set(state, s);
  }
  return s;
}

export function fakeProjects(state: FakeProjectsState): FakeProjectsControls {
  const s = storeFor(state);
  return {
    get uploads() {
      return s.uploads;
    },
    setPolls(p) {
      if (p.build !== undefined) s.buildPolls = Math.max(0, p.build);
      if (p.deploy !== undefined) s.deployPolls = Math.max(0, p.deploy);
    },
    expireAccessTokens() {
      const t = s.now();
      for (const tok of s.tokens.values()) tok.expiresAt = Math.min(tok.expiresAt, t - 1000);
    },
    setNow(now) {
      s.now = now;
    },
    project(name, portalId = state.portalId) {
      const p = s.projects.get(projectKey(portalId, name));
      return p ? { id: p.id, name: p.name, deployedBuildId: p.deployedBuildId, latestBuildId: p.latestBuildId } : undefined;
    },
    get buildCount() {
      return s.builds.size;
    },
    get deployCount() {
      return s.deploys.size;
    },
  };
}

function projectKey(portalId: number, name: string): string {
  return `${portalId}:${name.toLowerCase()}`;
}

function modesOf(key: string): Set<FakeKeyMode> {
  return new Set(FAKE_KEY_MODES.filter((m) => key.includes(m)));
}

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json;charset=utf-8', 'x-hubspot-correlation-id': crypto.randomUUID() },
  });
}

function hsError(status: number, message: string, category: string, extra: Record<string, unknown> = {}): Response {
  return json(status, { status: 'error', message, correlationId: crypto.randomUUID(), category, ...extra });
}

const SCHEMA_TYPES = [
  'APPLICATION',
  'CARD',
  'SETTINGS',
  'PAGE',
  'APP_FUNCTION',
  'APP_OBJECT',
  'APP_OBJECT_ASSOCIATION',
  'APP_EVENT',
  'WEBHOOKS',
  'WORKFLOW_ACTION',
  'CRM_BULK_ACTION',
  'CALLING_EXTENSION',
  'MARKETING_EVENT',
  'MEDIA_BRIDGE',
  'VIDEO_CONFERENCING',
  'SCIM_INTEGRATION',
  'TELEMETRY_CONFIG',
  'THEME',
  'REACT_THEME',
];

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export async function handleFakeProjects(request: Request, state: FakeProjectsState): Promise<Response> {
  const s = storeFor(state);
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // ---------------------------------------------------------------- key exchange (no bearer)
  if (method === 'POST' && path === '/localdevauth/v1/auth/refresh') {
    let key = '';
    try {
      const body = (await request.json()) as { encodedOAuthRefreshToken?: unknown };
      key = typeof body.encodedOAuthRefreshToken === 'string' ? body.encodedOAuthRefreshToken : '';
    } catch {
      return hsError(400, 'Invalid JSON body', 'VALIDATION_ERROR');
    }
    const modes = modesOf(key);
    const portalId = state.personalAccessKeys.get(key) ?? (modes.size > 0 ? state.portalId : undefined);
    if (!key || portalId === undefined) {
      return hsError(401, 'The personal access key is invalid or has been deactivated.', 'INVALID_AUTHENTICATION', {
        subCategory: 'LocalDevAuthErrorType.INVALID_PERSONAL_ACCESS_KEY',
      });
    }
    const requested = url.searchParams.get('portalId');
    if (requested && Number(requested) !== portalId) {
      return hsError(401, 'The personal access key does not belong to this account.', 'INVALID_AUTHENTICATION');
    }
    const token = `fake-pak-at-${crypto.randomUUID()}`;
    const expiresAt = s.now() + s.tokenTtlMs;
    s.tokens.set(token, { portalId, modes, expiresAt });
    const scopeGroups = modes.has('no-projects-scope')
      ? ['crm.objects.contacts.read', 'content']
      : ['developer.projects.write', 'developer.projects.read', 'developer.app_functions.write', 'developer.secrets.write', 'content'];
    return json(200, {
      oauthAccessToken: token,
      expiresAtMillis: expiresAt,
      hubId: portalId,
      userId: 9001,
      scopeGroups,
      enabledFeatures: {},
      encodedOAuthRefreshToken: key,
      hubName: portalId === state.portalId ? 'Acme Demo (fake)' : `Fake account ${portalId}`,
      accountType: 'STANDARD',
    });
  }

  // ---------------------------------------------------------------- bearer auth
  const auth = request.headers.get('authorization') ?? '';
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  const tok = bearer ? s.tokens.get(bearer) : undefined;
  if (!tok || tok.expiresAt <= s.now()) {
    return hsError(401, 'Authentication credentials not found. This API supports OAuth 2.0 authentication.', 'INVALID_AUTHENTICATION');
  }
  const portalParam = url.searchParams.get('portalId');
  if (portalParam !== null && Number(portalParam) !== tok.portalId) {
    return hsError(403, `The access token does not belong to portal ${portalParam}.`, 'INVALID_AUTHENTICATION');
  }
  if (tok.modes.has('no-projects-scope')) {
    const message = 'This oauth-token does not have proper permissions! (requires any of [developer.projects.write])';
    return hsError(403, message, 'MISSING_SCOPES', { errors: [{ message, context: { requiredGranularScopes: ['developer.projects.write'] } }] });
  }
  const portalId = tok.portalId;
  let m: RegExpExecArray | null;

  // ---------------------------------------------------------------- schemas / platform versions
  if (method === 'GET' && (m = /^\/project-components-external\/project-schemas\/v3\/([^/]+)$/.exec(path))) {
    const version = decodeURIComponent(m[1]);
    if (!FAKE_PLATFORM_VERSIONS.includes(version)) return json(200, {});
    return json(200, Object.fromEntries(SCHEMA_TYPES.map((t) => [t, { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', title: t }])));
  }
  if (method === 'GET' && path === '/developer/projects/v1/platformVersion') {
    return json(200, { defaultPlatformVersion: '2026.03', activePlatformVersions: FAKE_PLATFORM_VERSIONS.filter((v) => !v.includes('beta')) });
  }

  // ---------------------------------------------------------------- projects
  const projectJson = (p: FakeProject) => ({
    id: p.id,
    name: p.name,
    portalId: p.portalId,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    deletedAt: 0,
    isLocked: false,
    ...(p.deployedBuildId ? { deployedBuildId: p.deployedBuildId } : {}),
    ...(p.latestBuildId ? { latestBuild: buildJson(s.builds.get(p.latestBuildId)!) } : {}),
  });
  if (method === 'GET' && path === '/developer/projects/v1') {
    return json(200, { results: [...s.projects.values()].filter((p) => p.portalId === portalId).map(projectJson) });
  }
  if (method === 'GET' && (m = /^\/developer\/projects\/v1\/by-name\/([^/]+)$/.exec(path))) {
    const p = s.projects.get(projectKey(portalId, decodeURIComponent(m[1])));
    if (!p) return hsError(404, `Project ${decodeURIComponent(m[1])} not found`, 'OBJECT_NOT_FOUND');
    return json(200, projectJson(p));
  }
  if (method === 'POST' && path === '/developer/projects/v1') {
    let name = '';
    try {
      name = String(((await request.json()) as { name?: unknown }).name ?? '');
    } catch {
      return hsError(400, 'Invalid JSON body', 'VALIDATION_ERROR');
    }
    if (!name.trim()) return hsError(400, 'Project name is required', 'VALIDATION_ERROR');
    const key = projectKey(portalId, name);
    if (s.projects.has(key)) return hsError(409, `A project named ${name} already exists`, 'CONFLICT');
    const p: FakeProject = { id: s.nextId++, name, portalId, createdAt: s.now(), updatedAt: s.now() };
    s.projects.set(key, p);
    return json(200, projectJson(p));
  }

  // ---------------------------------------------------------------- upload (IR + zip)
  if (method === 'POST' && path === '/project-components-external/v3/upload/new-api') {
    return upload(request, s, tok);
  }

  // ---------------------------------------------------------------- builds
  if (method === 'GET' && (m = /^\/dfs\/v1\/projects\/([^/]+)\/builds\/(\d+)\/status$/.exec(path))) {
    const build = findBuild(s, portalId, decodeURIComponent(m[1]), Number(m[2]));
    if (!build) return hsError(404, 'Build not found', 'OBJECT_NOT_FOUND');
    advanceBuild(s, build);
    return json(200, buildJson(build));
  }
  if (method === 'GET' && (m = /^\/dfs\/v1\/builds\/by-project-name\/([^/]+)\/builds\/(\d+)\/structure$/.exec(path))) {
    const build = findBuild(s, portalId, decodeURIComponent(m[1]), Number(m[2]));
    if (!build) return hsError(404, 'Build not found', 'OBJECT_NOT_FOUND');
    return json(200, { topLevelComponentsWithChildren: structure(build.buildId, build.components) });
  }
  if (method === 'GET' && (m = /^\/dfs\/logging\/v1\/logs\/projects\/([^/]+)\/builds\/(\d+)\/combined\/warn$/.exec(path))) {
    const build = findBuild(s, portalId, decodeURIComponent(m[1]), Number(m[2]));
    if (!build) return hsError(404, 'Build not found', 'OBJECT_NOT_FOUND');
    const card = build.components.find((c) => c.type === 'CARD');
    const logs = build.modes.has('warn') && build.status === 'SUCCESS'
      ? [warnLog(`Card "${card?.uid ?? 'card'}" has no description; HubSpot shows the card name instead.`), warnLog(`Card "${card?.uid ?? 'card'}" has no description; HubSpot shows the card name instead.`)]
      : [];
    return json(200, { logs });
  }

  // ---------------------------------------------------------------- deploys
  if (method === 'POST' && path === '/dfs/deploy/v3/deploys/queue/async') {
    let body: { projectName?: unknown; targetBuildId?: unknown; ignoreWarnings?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return hsError(400, 'Invalid JSON body', 'VALIDATION_ERROR');
    }
    const build = findBuild(s, portalId, String(body.projectName ?? ''), Number(body.targetBuildId));
    if (!build) return hsError(404, 'Build not found', 'OBJECT_NOT_FOUND');
    if (build.status !== 'SUCCESS') return hsError(400, `Build #${build.buildId} has not finished successfully`, 'VALIDATION_ERROR');
    if (build.modes.has('blocked-deploy') && body.ignoreWarnings !== true) {
      return json(200, {
        buildResultType: 'DEPLOY_BLOCKED',
        issues: [
          {
            uid: 'old_card',
            componentTypeName: 'CARD',
            errorMessages: [],
            blockingMessages: [{ message: 'This deploy removes the card "old_card", which is still shown on record pages.', isWarning: true }],
          },
        ],
      });
    }
    const deploy = createDeploy(s, build);
    return json(200, { id: String(deploy.deployId), buildResultType: 'DEPLOY_QUEUED', links: { status: `/dfs/deploy/v1/deploy-status/projects/${encodeURIComponent(build.projectName)}/deploys/${deploy.deployId}` } });
  }
  if (method === 'GET' && (m = /^\/dfs\/deploy\/v1\/deploy-status\/projects\/([^/]+)\/deploys\/(\d+)$/.exec(path))) {
    const deploy = findDeploy(s, portalId, decodeURIComponent(m[1]), Number(m[2]));
    if (!deploy) return hsError(404, 'Deploy not found', 'OBJECT_NOT_FOUND');
    advanceDeploy(s, deploy);
    return json(200, deployJson(s, deploy));
  }
  if (method === 'GET' && (m = /^\/dfs\/deploy\/v1\/deploys\/by-project-name\/([^/]+)\/deploys\/(\d+)\/structure$/.exec(path))) {
    const deploy = findDeploy(s, portalId, decodeURIComponent(m[1]), Number(m[2]));
    if (!deploy) return hsError(404, 'Deploy not found', 'OBJECT_NOT_FOUND');
    return json(200, { topLevelComponentsWithChildren: structure(deploy.deployId, s.builds.get(deploy.buildId)?.components ?? []) });
  }
  if (method === 'GET' && (m = /^\/dfs\/logging\/v1\/logs\/projects\/([^/]+)\/deploys\/(\d+)\/combined\/warn$/.exec(path))) {
    const deploy = findDeploy(s, portalId, decodeURIComponent(m[1]), Number(m[2]));
    if (!deploy) return hsError(404, 'Deploy not found', 'OBJECT_NOT_FOUND');
    const logs = deploy.modes.has('warn') && deploy.status === 'SUCCESS' ? [warnLog('The app was updated; users may need to refresh open record pages.')] : [];
    return json(200, { logs });
  }

  // ---------------------------------------------------------------- apps
  if (method === 'GET' && path === '/apps-dev/external/public/v3/full/portal/sourceId') {
    const uid = url.searchParams.get('sourceId') ?? '';
    const app = s.apps.get(`${portalId}:${uid}`);
    if (!app) return hsError(404, `No app with source id ${uid}`, 'OBJECT_NOT_FOUND');
    return json(200, { id: app.id, portalId: app.portalId, projectId: app.projectId, sourceId: uid, name: uid });
  }

  return hsError(404, `Unknown fake endpoint ${method} ${path}`, 'OBJECT_NOT_FOUND');
}

function warnLog(message: string) {
  return { lineNumber: 1, logLevel: 'WARN', message, pipelineStepId: 1, timestamp: Date.now() };
}

function findBuild(s: Store, portalId: number, projectName: string, buildId: number): FakeBuild | undefined {
  const b = s.builds.get(buildId);
  return b && b.portalId === portalId && b.projectName.toLowerCase() === projectName.toLowerCase() ? b : undefined;
}

function findDeploy(s: Store, portalId: number, projectName: string, deployId: number): FakeDeploy | undefined {
  const d = s.deploys.get(deployId);
  return d && d.portalId === portalId && d.projectName.toLowerCase() === projectName.toLowerCase() ? d : undefined;
}

function structure(rootId: number, components: Array<{ uid: string; type: string }>): Record<string, string[]> {
  const app = components.find((c) => c.type === 'APPLICATION');
  const children = components.filter((c) => c !== app && c.type !== 'SERVERLESS_PACKAGE').map((c) => `${rootId}-${c.uid}`);
  return app ? { [`${rootId}-${app.uid}`]: children } : {};
}

async function upload(request: Request, s: Store, tok: FakeToken): Promise<Response> {
  if (tok.modes.has('project-locked')) {
    return hsError(409, 'The project is locked', 'VALIDATION_ERROR', { subCategory: 'BuildPipelineErrorType.PROJECT_LOCKED' });
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return hsError(400, 'Expected multipart/form-data', 'VALIDATION_ERROR');
  }
  const zipFile = form.get('projectFilesZip');
  const platformVersion = form.get('platformVersion');
  const rawRequest = form.get('uploadRequest');
  if (!(zipFile instanceof Blob) || typeof platformVersion !== 'string' || typeof rawRequest !== 'string') {
    return hsError(400, 'projectFilesZip, platformVersion and uploadRequest are required', 'VALIDATION_ERROR');
  }
  let uploadRequest: Record<string, unknown>;
  try {
    uploadRequest = JSON.parse(rawRequest) as Record<string, unknown>;
  } catch {
    return hsError(400, 'uploadRequest is not valid JSON', 'VALIDATION_ERROR');
  }
  const projectName = typeof uploadRequest.projectName === 'string' ? uploadRequest.projectName : '';
  const project = s.projects.get(projectKey(tok.portalId, projectName));
  if (!project) return hsError(404, `Project ${projectName} not found`, 'OBJECT_NOT_FOUND');
  if (!FAKE_PLATFORM_VERSIONS.includes(platformVersion)) {
    return hsError(400, `Platform version ${platformVersion} is not available`, 'VALIDATION_ERROR', { subCategory: 'PlatformVersionErrorType.PLATFORM_VERSION_SPECIFIED_DOES_NOT_EXIST' });
  }
  const files = new Map<string, string>();
  try {
    const decoder = new TextDecoder();
    for (const entry of readStoredZip(new Uint8Array(await zipFile.arrayBuffer()))) files.set(entry.path, decoder.decode(entry.data));
  } catch (err) {
    return hsError(400, `projectFilesZip is not a valid archive: ${err instanceof Error ? err.message : String(err)}`, 'VALIDATION_ERROR');
  }
  const nodes = uploadRequest.intermediateNodesIndexedByUid;
  if (!nodes || typeof nodes !== 'object' || Object.keys(nodes).length === 0) {
    return hsError(400, 'The upload has no components', 'VALIDATION_ERROR');
  }
  const errors: Array<{ message: string }> = [];
  const components: Array<{ uid: string; type: string }> = [];
  for (const [uid, raw] of Object.entries(nodes as Record<string, unknown>)) {
    const node = raw as { uid?: unknown; componentType?: unknown; metaFilePath?: unknown; componentDeps?: unknown; config?: unknown; files?: unknown };
    if (node.uid !== uid) errors.push({ message: `Component ${uid}: uid does not match its key` });
    if (typeof node.componentType !== 'string' || !(SCHEMA_TYPES.includes(node.componentType) || node.componentType === 'SERVERLESS_PACKAGE')) {
      errors.push({ message: `Component ${uid}: unknown componentType ${String(node.componentType)}` });
    }
    if (typeof node.metaFilePath !== 'string' || !files.has(node.metaFilePath)) {
      errors.push({ message: `Component ${uid}: ${String(node.metaFilePath)} is not in the archive` });
    }
    if (!node.componentDeps || typeof node.componentDeps !== 'object' || !node.files || typeof node.files !== 'object') {
      errors.push({ message: `Component ${uid}: componentDeps and files are required` });
    }
    components.push({ uid, type: String(node.componentType) });
  }
  if (errors.length) return hsError(400, 'Project validation failed', 'VALIDATION_ERROR', { errors });

  s.uploads.push({
    portalId: tok.portalId,
    projectName,
    platformVersion,
    buildMessage: typeof uploadRequest.buildMessage === 'string' ? uploadRequest.buildMessage : '',
    skipAutoDeploy: uploadRequest.skipAutoDeploy === true,
    uploadRequest,
    files,
    zipFileName: zipFile instanceof File ? zipFile.name : '',
  });
  const autoDeploy = !tok.modes.has('no-autodeploy') && !tok.modes.has('blocked-deploy') && uploadRequest.skipAutoDeploy !== true;
  const build: FakeBuild = {
    buildId: s.nextId++,
    projectName: project.name,
    portalId: tok.portalId,
    platformVersion,
    modes: tok.modes,
    polls: 0,
    status: 'PENDING',
    createdAt: s.now(),
    components,
    autoDeploy,
    autoDeployId: 0,
    locatorDelay: tok.modes.has('slow-autodeploy') ? 2 : 0,
  };
  s.builds.set(build.buildId, build);
  project.latestBuildId = build.buildId;
  project.updatedAt = s.now();
  return json(200, { createdBuildId: build.buildId });
}

function advanceBuild(s: Store, build: FakeBuild): void {
  if (build.status === 'SUCCESS') {
    if (build.autoDeploy && !build.modes.has('skip-autodeploy') && build.autoDeployId === 0) {
      if (build.locatorDelay > 0) build.locatorDelay -= 1;
      else build.autoDeployId = createDeploy(s, build).deployId;
    }
    return;
  }
  if (build.status === 'FAILURE') return;
  build.polls += 1;
  if (build.polls <= s.buildPolls) {
    build.status = build.polls === 1 ? 'PENDING' : 'BUILDING';
    return;
  }
  build.status = build.modes.has('fail-build') ? 'FAILURE' : 'SUCCESS';
  if (build.status === 'SUCCESS' && build.autoDeploy && !build.modes.has('skip-autodeploy') && build.locatorDelay === 0) {
    build.autoDeployId = createDeploy(s, build).deployId;
  }
}

function buildJson(build: FakeBuild) {
  const card = build.components.find((c) => c.type === 'CARD');
  const subbuildStatuses = build.components
    .filter((c) => c.type !== 'SERVERLESS_PACKAGE')
    .map((c) => {
      const failed = build.status === 'FAILURE';
      const isCulprit = failed && c === (card ?? build.components[0]);
      return {
        id: `${build.buildId}-${c.uid}`,
        buildName: c.uid,
        buildType: c.type,
        status: build.status === 'SUCCESS' ? 'SUCCESS' : failed ? 'FAILURE' : build.status,
        errorMessage: isCulprit ? `Card ${c.uid} failed to compile` : failed ? 'Dependent build failed' : '',
        standardError: isCulprit
          ? {
              status: 'error',
              category: 'VALIDATION_ERROR',
              subCategory: 'BuildPipelineErrorType.SUBBUILD_FAILED_WITH_ERRORS',
              message: 'Build failed',
              errors: [{ message: "src/app/cards/Card.tsx(12,7): error TS2304: Cannot find name 'contact'.", context: {} }],
              context: {},
              links: {},
            }
          : failed
            ? { status: 'error', category: 'VALIDATION_ERROR', subCategory: 'BuildPipelineErrorType.DEPENDENT_SUBBUILD_FAILED', message: 'Dependent build failed', context: {}, links: {} }
            : null,
        startedAt: iso(build.createdAt),
        finishedAt: build.status === 'SUCCESS' || failed ? iso(build.createdAt + 1000) : '',
        rootPath: '',
        visible: true,
      };
    });
  const deploying = build.autoDeployId > 0;
  return {
    buildId: build.buildId,
    projectName: build.projectName,
    portalId: build.portalId,
    platformVersion: build.platformVersion,
    status: build.status,
    subbuildStatuses,
    isAutoDeployEnabled: build.autoDeploy,
    autoDeployId: build.autoDeployId,
    deployStatusTaskLocator: deploying ? { id: String(build.autoDeployId), links: [{ status: `/dfs/deploy/v1/deploy-status/projects/${build.projectName}/deploys/${build.autoDeployId}` }] } : null,
    deployableState: 'DEPLOYABLE',
    activitySource: 'HUBSPOT_USER',
    uploadMessage: 'Uploaded from UI Extension Builder',
    createdAt: iso(build.createdAt),
    enqueuedAt: iso(build.createdAt),
    startedAt: iso(build.createdAt),
    finishedAt: build.status === 'SUCCESS' || build.status === 'FAILURE' ? iso(build.createdAt + 1000) : '',
  };
}

function createDeploy(s: Store, build: FakeBuild): FakeDeploy {
  const deploy: FakeDeploy = {
    deployId: s.nextId++,
    buildId: build.buildId,
    projectName: build.projectName,
    portalId: build.portalId,
    modes: build.modes,
    polls: 0,
    status: 'PENDING',
  };
  s.deploys.set(deploy.deployId, deploy);
  return deploy;
}

function advanceDeploy(s: Store, deploy: FakeDeploy): void {
  if (deploy.status === 'SUCCESS' || deploy.status === 'FAILURE') return;
  deploy.polls += 1;
  if (deploy.polls <= s.deployPolls) {
    deploy.status = deploy.polls === 1 ? 'PENDING' : 'DEPLOYING';
    return;
  }
  deploy.status = deploy.modes.has('fail-deploy') ? 'FAILURE' : 'SUCCESS';
  if (deploy.status === 'SUCCESS') {
    const project = s.projects.get(projectKey(deploy.portalId, deploy.projectName));
    if (project) {
      project.deployedBuildId = deploy.buildId;
      const app = s.builds.get(deploy.buildId)?.components.find((c) => c.type === 'APPLICATION');
      if (app && !s.apps.has(`${deploy.portalId}:${app.uid}`)) s.apps.set(`${deploy.portalId}:${app.uid}`, { id: s.nextId++, projectId: project.id, portalId: deploy.portalId });
    }
  }
}

function deployJson(s: Store, deploy: FakeDeploy) {
  const components = s.builds.get(deploy.buildId)?.components ?? [];
  const failed = deploy.status === 'FAILURE';
  return {
    deployId: deploy.deployId,
    buildId: deploy.buildId,
    projectName: deploy.projectName,
    portalId: deploy.portalId,
    status: deploy.status,
    userId: 9001,
    source: 'HUBSPOT_USER',
    enqueuedAt: iso(s.now()),
    startedAt: iso(s.now()),
    finishedAt: deploy.status === 'SUCCESS' || failed ? iso(s.now()) : '',
    subdeployStatuses: components
      .filter((c) => c.type !== 'SERVERLESS_PACKAGE')
      .map((c, i) => ({
        id: `${deploy.deployId}-${c.uid}`,
        deployName: c.uid,
        deployType: c.type,
        action: 'INSTALL',
        status: deploy.status === 'SUCCESS' ? 'SUCCESS' : failed ? 'FAILURE' : deploy.status,
        errorMessage: failed && i === 0 ? `Could not deploy ${c.uid}: the app's scopes changed and need to be re-approved` : '',
        standardError: failed && i > 0 ? { status: 'error', category: 'VALIDATION_ERROR', subCategory: 'DeployPipelineErrorType.DEPENDENT_SUBDEPLOY_FAILED', context: {}, links: {} } : null,
        startedAt: iso(s.now()),
        finishedAt: '',
        visible: true,
      })),
  };
}
