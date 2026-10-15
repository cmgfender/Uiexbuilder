import { createRequire as __uiexCreateRequire } from 'node:module'; const require = __uiexCreateRequire(import.meta.url);

// server/fake-hubspot/server.ts
import { createServer as createServer2 } from "node:http";
import { realpathSync as realpathSync2 } from "node:fs";
import { pathToFileURL as pathToFileURL2 } from "node:url";

// server/core/deploy/zip.ts
var encoder = new TextEncoder();
var crcTable = null;
function table() {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
}
function crc32(data) {
  const t = table();
  let crc = 4294967295;
  for (let i = 0; i < data.length; i++) crc = t[(crc ^ data[i]) & 255] ^ crc >>> 8;
  return (crc ^ 4294967295) >>> 0;
}
var LOCAL_HEADER = 67324752;
var CENTRAL_HEADER = 33639248;
var END_OF_CENTRAL_DIR = 101010256;
var VERSION_MADE_BY = 3 << 8 | 20;
var EXTERNAL_ATTRS = 33188 << 16 >>> 0;
function readStoredZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) throw new Error("not a zip archive");
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL_DIR) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive (no end of central directory)");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const out = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_HEADER) throw new Error("bad central directory");
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const size = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const path2 = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    if (method !== 0) throw new Error(`entry ${path2} is compressed`);
    if (view.getUint32(local, true) !== LOCAL_HEADER) throw new Error("bad local header");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (crc32(data) !== crc) throw new Error(`bad CRC for ${path2}`);
    if (!path2.endsWith("/")) out.push({ path: path2, data });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// server/fake-hubspot/projects.ts
var FAKE_PROJECT_PATH_PREFIXES = ["/localdevauth/", "/dfs/", "/project-components-external/", "/developer/", "/apps-dev/"];
var FAKE_KEY_MODES = [
  /** The build fails with a TypeScript error in the first card. */
  "fail-build",
  /** The build succeeds, the deploy fails. */
  "fail-deploy",
  /** isAutoDeployEnabled = false (the connector queues the deploy itself). */
  "no-autodeploy",
  /** Auto-deploy off and the deploy queue answers DEPLOY_BLOCKED (warnings). */
  "blocked-deploy",
  /** Auto-deploy on but skipped (autoDeployId 0, no deploy locator). */
  "skip-autodeploy",
  /** The deploy locator appears only a couple of polls after the build succeeded. */
  "slow-autodeploy",
  /** Upload answers 409 PROJECT_LOCKED. */
  "project-locked",
  /** The key lacks developer projects: project endpoints answer 403 MISSING_SCOPES. */
  "no-projects-scope",
  /** Build and deploy produce warning logs. */
  "warn"
];
var FAKE_PLATFORM_VERSIONS = ["2025.2", "2026.03-beta", "2026.03", "2026.09-beta", "2026.09", "unstable"];
var stores = /* @__PURE__ */ new WeakMap();
function storeFor(state) {
  let s = stores.get(state);
  if (!s) {
    s = {
      now: () => Date.now(),
      tokens: /* @__PURE__ */ new Map(),
      projects: /* @__PURE__ */ new Map(),
      builds: /* @__PURE__ */ new Map(),
      deploys: /* @__PURE__ */ new Map(),
      apps: /* @__PURE__ */ new Map(),
      uploads: [],
      nextId: 1e3,
      buildPolls: 2,
      deployPolls: 2,
      tokenTtlMs: 30 * 60 * 1e3
    };
    stores.set(state, s);
  }
  return s;
}
function projectKey(portalId, name) {
  return `${portalId}:${name.toLowerCase()}`;
}
function modesOf(key) {
  return new Set(FAKE_KEY_MODES.filter((m) => key.includes(m)));
}
function json(status, body) {
  return new Response(body === void 0 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json;charset=utf-8", "x-hubspot-correlation-id": crypto.randomUUID() }
  });
}
function hsError(status, message, category, extra = {}) {
  return json(status, { status: "error", message, correlationId: crypto.randomUUID(), category, ...extra });
}
var SCHEMA_TYPES = [
  "APPLICATION",
  "CARD",
  "SETTINGS",
  "PAGE",
  "APP_FUNCTION",
  "APP_OBJECT",
  "APP_OBJECT_ASSOCIATION",
  "APP_EVENT",
  "WEBHOOKS",
  "WORKFLOW_ACTION",
  "CRM_BULK_ACTION",
  "CALLING_EXTENSION",
  "MARKETING_EVENT",
  "MEDIA_BRIDGE",
  "VIDEO_CONFERENCING",
  "SCIM_INTEGRATION",
  "TELEMETRY_CONFIG",
  "THEME",
  "REACT_THEME"
];
function iso(ms) {
  return new Date(ms).toISOString();
}
async function handleFakeProjects(request, state) {
  const s = storeFor(state);
  const url = new URL(request.url);
  const path2 = url.pathname;
  const method = request.method;
  if (method === "POST" && path2 === "/localdevauth/v1/auth/refresh") {
    let key = "";
    try {
      const body = await request.json();
      key = typeof body.encodedOAuthRefreshToken === "string" ? body.encodedOAuthRefreshToken : "";
    } catch {
      return hsError(400, "Invalid JSON body", "VALIDATION_ERROR");
    }
    const modes = modesOf(key);
    const portalId2 = state.personalAccessKeys.get(key) ?? (modes.size > 0 ? state.portalId : void 0);
    if (!key || portalId2 === void 0) {
      return hsError(401, "The personal access key is invalid or has been deactivated.", "INVALID_AUTHENTICATION", {
        subCategory: "LocalDevAuthErrorType.INVALID_PERSONAL_ACCESS_KEY"
      });
    }
    const requested = url.searchParams.get("portalId");
    if (requested && Number(requested) !== portalId2) {
      return hsError(401, "The personal access key does not belong to this account.", "INVALID_AUTHENTICATION");
    }
    const token = `fake-pak-at-${crypto.randomUUID()}`;
    const expiresAt = s.now() + s.tokenTtlMs;
    s.tokens.set(token, { portalId: portalId2, modes, expiresAt });
    const scopeGroups = modes.has("no-projects-scope") ? ["crm.objects.contacts.read", "content"] : ["developer.projects.write", "developer.projects.read", "developer.app_functions.write", "developer.secrets.write", "content"];
    return json(200, {
      oauthAccessToken: token,
      expiresAtMillis: expiresAt,
      hubId: portalId2,
      userId: 9001,
      scopeGroups,
      enabledFeatures: {},
      encodedOAuthRefreshToken: key,
      hubName: portalId2 === state.portalId ? "Acme Demo (fake)" : `Fake account ${portalId2}`,
      accountType: "STANDARD"
    });
  }
  const auth = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  const tok = bearer ? s.tokens.get(bearer) : void 0;
  if (!tok || tok.expiresAt <= s.now()) {
    return hsError(401, "Authentication credentials not found. This API supports OAuth 2.0 authentication.", "INVALID_AUTHENTICATION");
  }
  const portalParam = url.searchParams.get("portalId");
  if (portalParam !== null && Number(portalParam) !== tok.portalId) {
    return hsError(403, `The access token does not belong to portal ${portalParam}.`, "INVALID_AUTHENTICATION");
  }
  if (tok.modes.has("no-projects-scope")) {
    const message = "This oauth-token does not have proper permissions! (requires any of [developer.projects.write])";
    return hsError(403, message, "MISSING_SCOPES", { errors: [{ message, context: { requiredGranularScopes: ["developer.projects.write"] } }] });
  }
  const portalId = tok.portalId;
  let m;
  if (method === "GET" && (m = /^\/project-components-external\/project-schemas\/v3\/([^/]+)$/.exec(path2))) {
    const version = decodeURIComponent(m[1]);
    if (!FAKE_PLATFORM_VERSIONS.includes(version)) return json(200, {});
    return json(200, Object.fromEntries(SCHEMA_TYPES.map((t) => [t, { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", title: t }])));
  }
  if (method === "GET" && path2 === "/developer/projects/v1/platformVersion") {
    return json(200, { defaultPlatformVersion: "2026.03", activePlatformVersions: FAKE_PLATFORM_VERSIONS.filter((v) => !v.includes("beta")) });
  }
  const projectJson = (p) => ({
    id: p.id,
    name: p.name,
    portalId: p.portalId,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    deletedAt: 0,
    isLocked: false,
    ...p.deployedBuildId ? { deployedBuildId: p.deployedBuildId } : {},
    ...p.latestBuildId ? { latestBuild: buildJson(s.builds.get(p.latestBuildId)) } : {}
  });
  if (method === "GET" && path2 === "/developer/projects/v1") {
    return json(200, { results: [...s.projects.values()].filter((p) => p.portalId === portalId).map(projectJson) });
  }
  if (method === "GET" && (m = /^\/developer\/projects\/v1\/by-name\/([^/]+)$/.exec(path2))) {
    const p = s.projects.get(projectKey(portalId, decodeURIComponent(m[1])));
    if (!p) return hsError(404, `Project ${decodeURIComponent(m[1])} not found`, "OBJECT_NOT_FOUND");
    return json(200, projectJson(p));
  }
  if (method === "POST" && path2 === "/developer/projects/v1") {
    let name = "";
    try {
      name = String((await request.json()).name ?? "");
    } catch {
      return hsError(400, "Invalid JSON body", "VALIDATION_ERROR");
    }
    if (!name.trim()) return hsError(400, "Project name is required", "VALIDATION_ERROR");
    const key = projectKey(portalId, name);
    if (s.projects.has(key)) return hsError(409, `A project named ${name} already exists`, "CONFLICT");
    const p = { id: s.nextId++, name, portalId, createdAt: s.now(), updatedAt: s.now() };
    s.projects.set(key, p);
    return json(200, projectJson(p));
  }
  if (method === "POST" && path2 === "/project-components-external/v3/upload/new-api") {
    return upload(request, s, tok);
  }
  if (method === "GET" && (m = /^\/dfs\/v1\/projects\/([^/]+)\/builds\/(\d+)\/status$/.exec(path2))) {
    const build = findBuild(s, portalId, decodeURIComponent(m[1]), Number(m[2]));
    if (!build) return hsError(404, "Build not found", "OBJECT_NOT_FOUND");
    advanceBuild(s, build);
    return json(200, buildJson(build));
  }
  if (method === "GET" && (m = /^\/dfs\/v1\/builds\/by-project-name\/([^/]+)\/builds\/(\d+)\/structure$/.exec(path2))) {
    const build = findBuild(s, portalId, decodeURIComponent(m[1]), Number(m[2]));
    if (!build) return hsError(404, "Build not found", "OBJECT_NOT_FOUND");
    return json(200, { topLevelComponentsWithChildren: structure(build.buildId, build.components) });
  }
  if (method === "GET" && (m = /^\/dfs\/logging\/v1\/logs\/projects\/([^/]+)\/builds\/(\d+)\/combined\/warn$/.exec(path2))) {
    const build = findBuild(s, portalId, decodeURIComponent(m[1]), Number(m[2]));
    if (!build) return hsError(404, "Build not found", "OBJECT_NOT_FOUND");
    const card = build.components.find((c) => c.type === "CARD");
    const logs = build.modes.has("warn") && build.status === "SUCCESS" ? [warnLog(`Card "${card?.uid ?? "card"}" has no description; HubSpot shows the card name instead.`), warnLog(`Card "${card?.uid ?? "card"}" has no description; HubSpot shows the card name instead.`)] : [];
    return json(200, { logs });
  }
  if (method === "POST" && path2 === "/dfs/deploy/v3/deploys/queue/async") {
    let body;
    try {
      body = await request.json();
    } catch {
      return hsError(400, "Invalid JSON body", "VALIDATION_ERROR");
    }
    const build = findBuild(s, portalId, String(body.projectName ?? ""), Number(body.targetBuildId));
    if (!build) return hsError(404, "Build not found", "OBJECT_NOT_FOUND");
    if (build.status !== "SUCCESS") return hsError(400, `Build #${build.buildId} has not finished successfully`, "VALIDATION_ERROR");
    if (build.modes.has("blocked-deploy") && body.ignoreWarnings !== true) {
      return json(200, {
        buildResultType: "DEPLOY_BLOCKED",
        issues: [
          {
            uid: "old_card",
            componentTypeName: "CARD",
            errorMessages: [],
            blockingMessages: [{ message: 'This deploy removes the card "old_card", which is still shown on record pages.', isWarning: true }]
          }
        ]
      });
    }
    const deploy = createDeploy(s, build);
    return json(200, { id: String(deploy.deployId), buildResultType: "DEPLOY_QUEUED", links: { status: `/dfs/deploy/v1/deploy-status/projects/${encodeURIComponent(build.projectName)}/deploys/${deploy.deployId}` } });
  }
  if (method === "GET" && (m = /^\/dfs\/deploy\/v1\/deploy-status\/projects\/([^/]+)\/deploys\/(\d+)$/.exec(path2))) {
    const deploy = findDeploy(s, portalId, decodeURIComponent(m[1]), Number(m[2]));
    if (!deploy) return hsError(404, "Deploy not found", "OBJECT_NOT_FOUND");
    advanceDeploy(s, deploy);
    return json(200, deployJson(s, deploy));
  }
  if (method === "GET" && (m = /^\/dfs\/deploy\/v1\/deploys\/by-project-name\/([^/]+)\/deploys\/(\d+)\/structure$/.exec(path2))) {
    const deploy = findDeploy(s, portalId, decodeURIComponent(m[1]), Number(m[2]));
    if (!deploy) return hsError(404, "Deploy not found", "OBJECT_NOT_FOUND");
    return json(200, { topLevelComponentsWithChildren: structure(deploy.deployId, s.builds.get(deploy.buildId)?.components ?? []) });
  }
  if (method === "GET" && (m = /^\/dfs\/logging\/v1\/logs\/projects\/([^/]+)\/deploys\/(\d+)\/combined\/warn$/.exec(path2))) {
    const deploy = findDeploy(s, portalId, decodeURIComponent(m[1]), Number(m[2]));
    if (!deploy) return hsError(404, "Deploy not found", "OBJECT_NOT_FOUND");
    const logs = deploy.modes.has("warn") && deploy.status === "SUCCESS" ? [warnLog("The app was updated; users may need to refresh open record pages.")] : [];
    return json(200, { logs });
  }
  if (method === "GET" && path2 === "/apps-dev/external/public/v3/full/portal/sourceId") {
    const uid = url.searchParams.get("sourceId") ?? "";
    const app = s.apps.get(`${portalId}:${uid}`);
    if (!app) return hsError(404, `No app with source id ${uid}`, "OBJECT_NOT_FOUND");
    return json(200, { id: app.id, portalId: app.portalId, projectId: app.projectId, sourceId: uid, name: uid });
  }
  return hsError(404, `Unknown fake endpoint ${method} ${path2}`, "OBJECT_NOT_FOUND");
}
function warnLog(message) {
  return { lineNumber: 1, logLevel: "WARN", message, pipelineStepId: 1, timestamp: Date.now() };
}
function findBuild(s, portalId, projectName, buildId) {
  const b = s.builds.get(buildId);
  return b && b.portalId === portalId && b.projectName.toLowerCase() === projectName.toLowerCase() ? b : void 0;
}
function findDeploy(s, portalId, projectName, deployId) {
  const d = s.deploys.get(deployId);
  return d && d.portalId === portalId && d.projectName.toLowerCase() === projectName.toLowerCase() ? d : void 0;
}
function structure(rootId, components) {
  const app = components.find((c) => c.type === "APPLICATION");
  const children = components.filter((c) => c !== app && c.type !== "SERVERLESS_PACKAGE").map((c) => `${rootId}-${c.uid}`);
  return app ? { [`${rootId}-${app.uid}`]: children } : {};
}
async function upload(request, s, tok) {
  if (tok.modes.has("project-locked")) {
    return hsError(409, "The project is locked", "VALIDATION_ERROR", { subCategory: "BuildPipelineErrorType.PROJECT_LOCKED" });
  }
  let form;
  try {
    form = await request.formData();
  } catch {
    return hsError(400, "Expected multipart/form-data", "VALIDATION_ERROR");
  }
  const zipFile = form.get("projectFilesZip");
  const platformVersion = form.get("platformVersion");
  const rawRequest = form.get("uploadRequest");
  if (!(zipFile instanceof Blob) || typeof platformVersion !== "string" || typeof rawRequest !== "string") {
    return hsError(400, "projectFilesZip, platformVersion and uploadRequest are required", "VALIDATION_ERROR");
  }
  let uploadRequest;
  try {
    uploadRequest = JSON.parse(rawRequest);
  } catch {
    return hsError(400, "uploadRequest is not valid JSON", "VALIDATION_ERROR");
  }
  const projectName = typeof uploadRequest.projectName === "string" ? uploadRequest.projectName : "";
  const project = s.projects.get(projectKey(tok.portalId, projectName));
  if (!project) return hsError(404, `Project ${projectName} not found`, "OBJECT_NOT_FOUND");
  if (!FAKE_PLATFORM_VERSIONS.includes(platformVersion)) {
    return hsError(400, `Platform version ${platformVersion} is not available`, "VALIDATION_ERROR", { subCategory: "PlatformVersionErrorType.PLATFORM_VERSION_SPECIFIED_DOES_NOT_EXIST" });
  }
  const files = /* @__PURE__ */ new Map();
  try {
    const decoder = new TextDecoder();
    for (const entry of readStoredZip(new Uint8Array(await zipFile.arrayBuffer()))) files.set(entry.path, decoder.decode(entry.data));
  } catch (err) {
    return hsError(400, `projectFilesZip is not a valid archive: ${err instanceof Error ? err.message : String(err)}`, "VALIDATION_ERROR");
  }
  const nodes = uploadRequest.intermediateNodesIndexedByUid;
  if (!nodes || typeof nodes !== "object" || Object.keys(nodes).length === 0) {
    return hsError(400, "The upload has no components", "VALIDATION_ERROR");
  }
  const errors = [];
  const components = [];
  for (const [uid, raw] of Object.entries(nodes)) {
    const node = raw;
    if (node.uid !== uid) errors.push({ message: `Component ${uid}: uid does not match its key` });
    if (typeof node.componentType !== "string" || !(SCHEMA_TYPES.includes(node.componentType) || node.componentType === "SERVERLESS_PACKAGE")) {
      errors.push({ message: `Component ${uid}: unknown componentType ${String(node.componentType)}` });
    }
    if (typeof node.metaFilePath !== "string" || !files.has(node.metaFilePath)) {
      errors.push({ message: `Component ${uid}: ${String(node.metaFilePath)} is not in the archive` });
    }
    if (!node.componentDeps || typeof node.componentDeps !== "object" || !node.files || typeof node.files !== "object") {
      errors.push({ message: `Component ${uid}: componentDeps and files are required` });
    }
    components.push({ uid, type: String(node.componentType) });
  }
  if (errors.length) return hsError(400, "Project validation failed", "VALIDATION_ERROR", { errors });
  s.uploads.push({
    portalId: tok.portalId,
    projectName,
    platformVersion,
    buildMessage: typeof uploadRequest.buildMessage === "string" ? uploadRequest.buildMessage : "",
    skipAutoDeploy: uploadRequest.skipAutoDeploy === true,
    uploadRequest,
    files,
    zipFileName: zipFile instanceof File ? zipFile.name : ""
  });
  const autoDeploy = !tok.modes.has("no-autodeploy") && !tok.modes.has("blocked-deploy") && uploadRequest.skipAutoDeploy !== true;
  const build = {
    buildId: s.nextId++,
    projectName: project.name,
    portalId: tok.portalId,
    platformVersion,
    modes: tok.modes,
    polls: 0,
    status: "PENDING",
    createdAt: s.now(),
    components,
    autoDeploy,
    autoDeployId: 0,
    locatorDelay: tok.modes.has("slow-autodeploy") ? 2 : 0
  };
  s.builds.set(build.buildId, build);
  project.latestBuildId = build.buildId;
  project.updatedAt = s.now();
  return json(200, { createdBuildId: build.buildId });
}
function advanceBuild(s, build) {
  if (build.status === "SUCCESS") {
    if (build.autoDeploy && !build.modes.has("skip-autodeploy") && build.autoDeployId === 0) {
      if (build.locatorDelay > 0) build.locatorDelay -= 1;
      else build.autoDeployId = createDeploy(s, build).deployId;
    }
    return;
  }
  if (build.status === "FAILURE") return;
  build.polls += 1;
  if (build.polls <= s.buildPolls) {
    build.status = build.polls === 1 ? "PENDING" : "BUILDING";
    return;
  }
  build.status = build.modes.has("fail-build") ? "FAILURE" : "SUCCESS";
  if (build.status === "SUCCESS" && build.autoDeploy && !build.modes.has("skip-autodeploy") && build.locatorDelay === 0) {
    build.autoDeployId = createDeploy(s, build).deployId;
  }
}
function buildJson(build) {
  const card = build.components.find((c) => c.type === "CARD");
  const subbuildStatuses = build.components.filter((c) => c.type !== "SERVERLESS_PACKAGE").map((c) => {
    const failed = build.status === "FAILURE";
    const isCulprit = failed && c === (card ?? build.components[0]);
    return {
      id: `${build.buildId}-${c.uid}`,
      buildName: c.uid,
      buildType: c.type,
      status: build.status === "SUCCESS" ? "SUCCESS" : failed ? "FAILURE" : build.status,
      errorMessage: isCulprit ? `Card ${c.uid} failed to compile` : failed ? "Dependent build failed" : "",
      standardError: isCulprit ? {
        status: "error",
        category: "VALIDATION_ERROR",
        subCategory: "BuildPipelineErrorType.SUBBUILD_FAILED_WITH_ERRORS",
        message: "Build failed",
        errors: [{ message: "src/app/cards/Card.tsx(12,7): error TS2304: Cannot find name 'contact'.", context: {} }],
        context: {},
        links: {}
      } : failed ? { status: "error", category: "VALIDATION_ERROR", subCategory: "BuildPipelineErrorType.DEPENDENT_SUBBUILD_FAILED", message: "Dependent build failed", context: {}, links: {} } : null,
      startedAt: iso(build.createdAt),
      finishedAt: build.status === "SUCCESS" || failed ? iso(build.createdAt + 1e3) : "",
      rootPath: "",
      visible: true
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
    deployableState: "DEPLOYABLE",
    activitySource: "HUBSPOT_USER",
    uploadMessage: "Uploaded from UI Extension Builder",
    createdAt: iso(build.createdAt),
    enqueuedAt: iso(build.createdAt),
    startedAt: iso(build.createdAt),
    finishedAt: build.status === "SUCCESS" || build.status === "FAILURE" ? iso(build.createdAt + 1e3) : ""
  };
}
function createDeploy(s, build) {
  const deploy = {
    deployId: s.nextId++,
    buildId: build.buildId,
    projectName: build.projectName,
    portalId: build.portalId,
    modes: build.modes,
    polls: 0,
    status: "PENDING"
  };
  s.deploys.set(deploy.deployId, deploy);
  return deploy;
}
function advanceDeploy(s, deploy) {
  if (deploy.status === "SUCCESS" || deploy.status === "FAILURE") return;
  deploy.polls += 1;
  if (deploy.polls <= s.deployPolls) {
    deploy.status = deploy.polls === 1 ? "PENDING" : "DEPLOYING";
    return;
  }
  deploy.status = deploy.modes.has("fail-deploy") ? "FAILURE" : "SUCCESS";
  if (deploy.status === "SUCCESS") {
    const project = s.projects.get(projectKey(deploy.portalId, deploy.projectName));
    if (project) {
      project.deployedBuildId = deploy.buildId;
      const app = s.builds.get(deploy.buildId)?.components.find((c) => c.type === "APPLICATION");
      if (app && !s.apps.has(`${deploy.portalId}:${app.uid}`)) s.apps.set(`${deploy.portalId}:${app.uid}`, { id: s.nextId++, projectId: project.id, portalId: deploy.portalId });
    }
  }
}
function deployJson(s, deploy) {
  const components = s.builds.get(deploy.buildId)?.components ?? [];
  const failed = deploy.status === "FAILURE";
  return {
    deployId: deploy.deployId,
    buildId: deploy.buildId,
    projectName: deploy.projectName,
    portalId: deploy.portalId,
    status: deploy.status,
    userId: 9001,
    source: "HUBSPOT_USER",
    enqueuedAt: iso(s.now()),
    startedAt: iso(s.now()),
    finishedAt: deploy.status === "SUCCESS" || failed ? iso(s.now()) : "",
    subdeployStatuses: components.filter((c) => c.type !== "SERVERLESS_PACKAGE").map((c, i) => ({
      id: `${deploy.deployId}-${c.uid}`,
      deployName: c.uid,
      deployType: c.type,
      action: "INSTALL",
      status: deploy.status === "SUCCESS" ? "SUCCESS" : failed ? "FAILURE" : deploy.status,
      errorMessage: failed && i === 0 ? `Could not deploy ${c.uid}: the app's scopes changed and need to be re-approved` : "",
      standardError: failed && i > 0 ? { status: "error", category: "VALIDATION_ERROR", subCategory: "DeployPipelineErrorType.DEPENDENT_SUBDEPLOY_FAILED", context: {}, links: {} } : null,
      startedAt: iso(s.now()),
      finishedAt: "",
      visible: true
    }))
  };
}

// server/fake-hubspot/seed.ts
var CREATED = "2024-01-15T10:30:00.000Z";
var UPDATED = "2025-06-02T14:05:00.000Z";
function opts(pairs) {
  return pairs.map(([value, label], i) => ({ value, label, displayOrder: i, hidden: false }));
}
function std(name, label, type, fieldType, groupName, extra = {}) {
  return { name, label, type, fieldType, groupName, hubspotDefined: true, ...extra };
}
function custom(name, label, type, fieldType, groupName, extra = {}) {
  return { name, label, type, fieldType, groupName, hubspotDefined: false, ...extra };
}
var SYSTEM = (lastModified, created = "createdate") => [
  std("hs_object_id", "Record ID", "number", "number", "system", { readOnlyValue: true }),
  std(created, "Create date", "datetime", "date", "system", { readOnlyValue: true }),
  std(lastModified, "Last modified date", "datetime", "date", "system", { readOnlyValue: true, calculated: false })
];
var OWNERS = [
  { id: "101", email: "jordan.lee@acmedemo.com", firstName: "Jordan", lastName: "Lee", userId: 9001 },
  { id: "102", email: "sam.rivera@acmedemo.com", firstName: "Sam", lastName: "Rivera", userId: 9002 },
  { id: "103", email: "alex.morgan@acmedemo.com", firstName: "Alex", lastName: "Morgan", userId: 9003 }
];
var OWNER_PROPERTY = std("hubspot_owner_id", "Owner", "enumeration", "select", "sales_properties", {
  options: OWNERS.map((o, i) => ({ value: o.id, label: `${o.firstName} ${o.lastName}`, displayOrder: i, hidden: false }))
});
var LIFECYCLE = opts([
  ["subscriber", "Subscriber"],
  ["lead", "Lead"],
  ["marketingqualifiedlead", "Marketing Qualified Lead"],
  ["salesqualifiedlead", "Sales Qualified Lead"],
  ["opportunity", "Opportunity"],
  ["customer", "Customer"],
  ["evangelist", "Evangelist"],
  ["other", "Other"]
]);
var DEAL_PIPELINES = [
  {
    id: "default",
    label: "Sales Pipeline",
    displayOrder: 0,
    stages: [
      { id: "appointmentscheduled", label: "Appointment Scheduled", displayOrder: 0, metadata: { isClosed: "false", probability: "0.2" } },
      { id: "qualifiedtobuy", label: "Qualified To Buy", displayOrder: 1, metadata: { isClosed: "false", probability: "0.4" } },
      { id: "presentationscheduled", label: "Presentation Scheduled", displayOrder: 2, metadata: { isClosed: "false", probability: "0.6" } },
      { id: "decisionmakerboughtin", label: "Decision Maker Bought-In", displayOrder: 3, metadata: { isClosed: "false", probability: "0.8" } },
      { id: "contractsent", label: "Contract Sent", displayOrder: 4, metadata: { isClosed: "false", probability: "0.9" } },
      { id: "closedwon", label: "Closed Won", displayOrder: 5, metadata: { isClosed: "true", probability: "1.0" } },
      { id: "closedlost", label: "Closed Lost", displayOrder: 6, metadata: { isClosed: "true", probability: "0.0" } }
    ]
  },
  {
    id: "75012345",
    label: "Renewals",
    displayOrder: 1,
    stages: [
      { id: "1001", label: "Renewal upcoming", displayOrder: 0, metadata: { isClosed: "false", probability: "0.5" } },
      { id: "1002", label: "In negotiation", displayOrder: 1, metadata: { isClosed: "false", probability: "0.7" } },
      { id: "1003", label: "Renewed", displayOrder: 2, metadata: { isClosed: "true", probability: "1.0" } },
      { id: "1004", label: "Churned", displayOrder: 3, metadata: { isClosed: "true", probability: "0.0" } }
    ]
  }
];
var TICKET_PIPELINES = [
  {
    id: "0",
    label: "Support Pipeline",
    displayOrder: 0,
    stages: [
      { id: "1", label: "New", displayOrder: 0, metadata: { ticketState: "OPEN" } },
      { id: "2", label: "Waiting on contact", displayOrder: 1, metadata: { ticketState: "OPEN" } },
      { id: "3", label: "Waiting on us", displayOrder: 2, metadata: { ticketState: "OPEN" } },
      { id: "4", label: "Closed", displayOrder: 3, metadata: { ticketState: "CLOSED" } }
    ]
  }
];
function stageOptions(pipelines) {
  let i = 0;
  return pipelines.flatMap((p) => p.stages.map((s) => ({ value: s.id, label: `${s.label} (${p.label})`, displayOrder: i++, hidden: false })));
}
function pipelineOptions(pipelines) {
  return pipelines.map((p, i) => ({ value: p.id, label: p.label, displayOrder: i, hidden: false }));
}
var CUSTOM_OBJECT_TYPE_ID = "2-4561234";
function buildObjectTypes(portalId) {
  return [
    {
      name: "contacts",
      objectTypeId: "0-1",
      singular: "Contact",
      plural: "Contacts",
      aliases: ["contact", "0-1"],
      readScopes: ["crm.objects.contacts.read"],
      schemaScopes: ["crm.schemas.contacts.read"],
      searchable: ["firstname", "lastname", "email", "phone", "company"],
      defaultProperties: ["firstname", "lastname", "email", "createdate", "lastmodifieddate", "hs_object_id"],
      lastModifiedProperty: "lastmodifieddate",
      primaryDisplayProperty: "firstname",
      secondaryDisplayProperties: ["email"],
      properties: [
        std("firstname", "First name", "string", "text", "contactinformation"),
        std("lastname", "Last name", "string", "text", "contactinformation"),
        std("email", "Email", "string", "text", "contactinformation", { description: "A contact's email address" }),
        std("phone", "Phone number", "string", "phonenumber", "contactinformation"),
        std("company", "Company name", "string", "text", "contactinformation"),
        std("jobtitle", "Job title", "string", "text", "contactinformation"),
        std("city", "City", "string", "text", "contactinformation"),
        std("country", "Country/Region", "string", "text", "contactinformation"),
        std("lifecyclestage", "Lifecycle stage", "enumeration", "radio", "contactinformation", { options: LIFECYCLE }),
        std("hs_lead_status", "Lead status", "enumeration", "select", "sales_properties", {
          options: opts([
            ["NEW", "New"],
            ["OPEN", "Open"],
            ["IN_PROGRESS", "In Progress"],
            ["OPEN_DEAL", "Open Deal"],
            ["UNQUALIFIED", "Unqualified"],
            ["ATTEMPTED_TO_CONTACT", "Attempted to Contact"],
            ["CONNECTED", "Connected"],
            ["BAD_TIMING", "Bad Timing"]
          ])
        }),
        OWNER_PROPERTY,
        ...SYSTEM("lastmodifieddate"),
        custom("favorite_product", "Favorite product", "enumeration", "select", "contactinformation", {
          description: "Which plan the contact likes best",
          options: opts([
            ["starter", "Starter"],
            ["pro", "Professional"],
            ["enterprise", "Enterprise"]
          ])
        }),
        custom("loyalty_points", "Loyalty points", "number", "number", "contactinformation"),
        custom("onboarding_date", "Onboarding date", "date", "date", "contactinformation"),
        custom("newsletter_opt_in", "Newsletter opt-in", "bool", "booleancheckbox", "contactinformation", {
          options: opts([
            ["true", "Yes"],
            ["false", "No"]
          ])
        })
      ]
    },
    {
      name: "companies",
      objectTypeId: "0-2",
      singular: "Company",
      plural: "Companies",
      aliases: ["company", "0-2"],
      readScopes: ["crm.objects.companies.read"],
      schemaScopes: ["crm.schemas.companies.read"],
      searchable: ["name", "domain", "phone", "city"],
      defaultProperties: ["name", "domain", "createdate", "hs_lastmodifieddate", "hs_object_id"],
      lastModifiedProperty: "hs_lastmodifieddate",
      primaryDisplayProperty: "name",
      secondaryDisplayProperties: ["domain"],
      properties: [
        std("name", "Company name", "string", "text", "companyinformation"),
        std("domain", "Company domain name", "string", "text", "companyinformation"),
        std("industry", "Industry", "enumeration", "select", "companyinformation", {
          options: opts([
            ["COMPUTER_SOFTWARE", "Computer Software"],
            ["FINANCIAL_SERVICES", "Financial Services"],
            ["LOGISTICS_AND_SUPPLY_CHAIN", "Logistics and Supply Chain"],
            ["RESEARCH", "Research"],
            ["CONSULTING", "Management Consulting"]
          ])
        }),
        std("city", "City", "string", "text", "companyinformation"),
        std("country", "Country/Region", "string", "text", "companyinformation"),
        std("phone", "Phone number", "string", "phonenumber", "companyinformation"),
        std("numberofemployees", "Number of employees", "number", "number", "companyinformation"),
        std("annualrevenue", "Annual revenue", "number", "number", "companyinformation"),
        std("lifecyclestage", "Lifecycle stage", "enumeration", "radio", "companyinformation", { options: LIFECYCLE }),
        OWNER_PROPERTY,
        ...SYSTEM("hs_lastmodifieddate"),
        custom("customer_tier", "Customer tier", "enumeration", "select", "companyinformation", {
          options: opts([
            ["gold", "Gold"],
            ["silver", "Silver"],
            ["bronze", "Bronze"]
          ])
        }),
        custom("contract_renewal_date", "Contract renewal date", "date", "date", "companyinformation"),
        custom("health_score", "Health score", "number", "number", "companyinformation", { description: "0\u2013100, higher is healthier" })
      ]
    },
    {
      name: "deals",
      objectTypeId: "0-3",
      singular: "Deal",
      plural: "Deals",
      aliases: ["deal", "0-3"],
      readScopes: ["crm.objects.deals.read"],
      schemaScopes: ["crm.schemas.deals.read"],
      searchable: ["dealname", "description"],
      defaultProperties: ["dealname", "amount", "closedate", "dealstage", "pipeline", "createdate", "hs_lastmodifieddate", "hs_object_id"],
      lastModifiedProperty: "hs_lastmodifieddate",
      primaryDisplayProperty: "dealname",
      secondaryDisplayProperties: ["amount"],
      properties: [
        std("dealname", "Deal name", "string", "text", "dealinformation"),
        std("amount", "Amount", "number", "number", "dealinformation"),
        std("dealstage", "Deal stage", "enumeration", "radio", "dealinformation", { options: stageOptions(DEAL_PIPELINES) }),
        std("pipeline", "Pipeline", "enumeration", "select", "dealinformation", { options: pipelineOptions(DEAL_PIPELINES) }),
        std("closedate", "Close date", "datetime", "date", "dealinformation"),
        std("dealtype", "Deal type", "enumeration", "radio", "dealinformation", {
          options: opts([
            ["newbusiness", "New Business"],
            ["existingbusiness", "Existing Business"]
          ])
        }),
        std("description", "Deal description", "string", "textarea", "dealinformation"),
        OWNER_PROPERTY,
        ...SYSTEM("hs_lastmodifieddate"),
        custom("deal_source", "Deal source", "enumeration", "select", "dealinformation", {
          options: opts([
            ["inbound", "Inbound"],
            ["outbound", "Outbound"],
            ["partner", "Partner"],
            ["referral", "Referral"]
          ])
        }),
        custom("discount_percent", "Discount (%)", "number", "number", "dealinformation"),
        custom("is_renewal", "Is renewal", "bool", "booleancheckbox", "dealinformation", {
          options: opts([
            ["true", "Yes"],
            ["false", "No"]
          ])
        })
      ]
    },
    {
      name: "tickets",
      objectTypeId: "0-5",
      singular: "Ticket",
      plural: "Tickets",
      aliases: ["ticket", "0-5"],
      readScopes: ["tickets"],
      schemaScopes: ["tickets"],
      searchable: ["subject", "content"],
      defaultProperties: ["subject", "content", "hs_pipeline", "hs_pipeline_stage", "createdate", "hs_lastmodifieddate", "hs_object_id"],
      lastModifiedProperty: "hs_lastmodifieddate",
      primaryDisplayProperty: "subject",
      secondaryDisplayProperties: ["hs_pipeline_stage"],
      properties: [
        std("subject", "Ticket name", "string", "text", "ticketinformation"),
        std("content", "Ticket description", "string", "textarea", "ticketinformation"),
        std("hs_pipeline", "Pipeline", "enumeration", "select", "ticketinformation", { options: pipelineOptions(TICKET_PIPELINES) }),
        std("hs_pipeline_stage", "Ticket status", "enumeration", "select", "ticketinformation", { options: stageOptions(TICKET_PIPELINES) }),
        std("hs_ticket_priority", "Priority", "enumeration", "select", "ticketinformation", {
          options: opts([
            ["LOW", "Low"],
            ["MEDIUM", "Medium"],
            ["HIGH", "High"],
            ["URGENT", "Urgent"]
          ])
        }),
        OWNER_PROPERTY,
        ...SYSTEM("hs_lastmodifieddate"),
        custom("product_area", "Product area", "enumeration", "select", "ticketinformation", {
          options: opts([
            ["billing", "Billing"],
            ["onboarding", "Onboarding"],
            ["integrations", "Integrations"],
            ["reporting", "Reporting"]
          ])
        }),
        custom("affected_users", "Affected users", "number", "number", "ticketinformation"),
        custom("sla_due", "SLA due", "datetime", "date", "ticketinformation")
      ]
    },
    {
      name: "products",
      objectTypeId: "0-7",
      singular: "Product",
      plural: "Products",
      aliases: ["product", "0-7"],
      readScopes: ["crm.objects.products.read", "e-commerce"],
      schemaScopes: ["crm.objects.products.read", "e-commerce"],
      searchable: ["name", "hs_sku", "description"],
      defaultProperties: ["name", "price", "description", "createdate", "hs_lastmodifieddate", "hs_object_id"],
      lastModifiedProperty: "hs_lastmodifieddate",
      primaryDisplayProperty: "name",
      secondaryDisplayProperties: ["price"],
      properties: [
        std("name", "Name", "string", "text", "productinformation"),
        std("price", "Unit price", "number", "number", "productinformation"),
        std("hs_sku", "SKU", "string", "text", "productinformation"),
        std("description", "Description", "string", "textarea", "productinformation"),
        ...SYSTEM("hs_lastmodifieddate"),
        custom("product_family", "Product family", "enumeration", "select", "productinformation", {
          options: opts([
            ["software", "Software"],
            ["services", "Services"]
          ])
        }),
        custom("margin_percent", "Margin (%)", "number", "number", "productinformation"),
        custom("launch_date", "Launch date", "date", "date", "productinformation")
      ]
    },
    {
      name: "line_items",
      objectTypeId: "0-8",
      singular: "Line item",
      plural: "Line items",
      aliases: ["line_item", "0-8"],
      readScopes: ["crm.objects.line_items.read", "e-commerce"],
      schemaScopes: ["crm.objects.line_items.read", "e-commerce"],
      searchable: ["name"],
      defaultProperties: ["name", "quantity", "price", "amount", "createdate", "hs_lastmodifieddate", "hs_object_id"],
      lastModifiedProperty: "hs_lastmodifieddate",
      primaryDisplayProperty: "name",
      secondaryDisplayProperties: ["price"],
      properties: [
        std("name", "Name", "string", "text", "lineiteminformation"),
        std("quantity", "Quantity", "number", "number", "lineiteminformation"),
        std("price", "Unit price", "number", "number", "lineiteminformation"),
        std("amount", "Net price", "number", "number", "lineiteminformation", { calculated: true, readOnlyValue: true }),
        std("hs_product_id", "Product ID", "number", "number", "lineiteminformation"),
        ...SYSTEM("hs_lastmodifieddate")
      ]
    },
    {
      name: "quotes",
      objectTypeId: "0-14",
      singular: "Quote",
      plural: "Quotes",
      aliases: ["quote", "0-14"],
      readScopes: ["crm.objects.quotes.read"],
      schemaScopes: ["crm.objects.quotes.read"],
      searchable: ["hs_title"],
      defaultProperties: ["hs_title", "hs_expiration_date", "createdate", "hs_lastmodifieddate", "hs_object_id"],
      lastModifiedProperty: "hs_lastmodifieddate",
      primaryDisplayProperty: "hs_title",
      secondaryDisplayProperties: ["hs_expiration_date"],
      properties: [
        std("hs_title", "Quote name", "string", "text", "quoteinformation"),
        std("hs_expiration_date", "Expiration date", "date", "date", "quoteinformation"),
        std("hs_status", "Status", "enumeration", "select", "quoteinformation", {
          options: opts([
            ["DRAFT", "Draft"],
            ["APPROVED", "Approved"]
          ])
        }),
        ...SYSTEM("hs_lastmodifieddate")
      ]
    },
    {
      name: "projects",
      objectTypeId: CUSTOM_OBJECT_TYPE_ID,
      singular: "Project",
      plural: "Projects",
      aliases: [CUSTOM_OBJECT_TYPE_ID, "p_projects", `p${portalId}_projects`],
      readScopes: ["crm.objects.custom.read"],
      schemaScopes: ["crm.schemas.custom.read", "crm.objects.custom.read"],
      searchable: ["project_name"],
      defaultProperties: ["project_name", "hs_createdate", "hs_lastmodifieddate", "hs_object_id"],
      lastModifiedProperty: "hs_lastmodifieddate",
      primaryDisplayProperty: "project_name",
      secondaryDisplayProperties: ["project_status"],
      custom: { fullyQualifiedName: `p${portalId}_projects`, schemaId: "4561234" },
      properties: [
        custom("project_name", "Project name", "string", "text", "projects_information"),
        custom("project_status", "Status", "enumeration", "select", "projects_information", {
          options: opts([
            ["planning", "Planning"],
            ["in_progress", "In progress"],
            ["on_hold", "On hold"],
            ["done", "Done"]
          ])
        }),
        custom("budget", "Budget", "number", "number", "projects_information"),
        custom("start_date", "Start date", "date", "date", "projects_information"),
        { ...OWNER_PROPERTY },
        ...SYSTEM("hs_lastmodifieddate", "hs_createdate")
      ]
    }
  ];
}
function rec(id, properties, lastModifiedProperty = "hs_lastmodifieddate", created = "createdate") {
  return {
    id,
    createdAt: CREATED,
    updatedAt: UPDATED,
    properties: { hs_object_id: id, [created]: CREATED, [lastModifiedProperty]: UPDATED, ...properties }
  };
}
var contact = (id, p) => rec(id, p, "lastmodifieddate");
function buildRecords() {
  const contacts = [
    contact("1001", { firstname: "Ada", lastname: "Lovelace", email: "ada@analyticalengines.com", phone: "+44 20 7946 0001", company: "Analytical Engines Ltd", jobtitle: "CTO", city: "London", country: "United Kingdom", lifecyclestage: "customer", hs_lead_status: "CONNECTED", hubspot_owner_id: "101", favorite_product: "enterprise", loyalty_points: "1250", onboarding_date: "2023-03-14", newsletter_opt_in: "true" }),
    contact("1002", { firstname: "Grace", lastname: "Hopper", email: "grace@cobolworks.com", phone: "+1 703 555 0102", company: "COBOL Works", jobtitle: "VP Engineering", city: "Arlington", country: "United States", lifecyclestage: "customer", hs_lead_status: "OPEN_DEAL", hubspot_owner_id: "102", favorite_product: "pro", loyalty_points: "980", onboarding_date: "2023-07-01", newsletter_opt_in: "false" }),
    contact("1003", { firstname: "Alan", lastname: "Turing", email: "alan@bletchleylabs.com", phone: "+44 1908 555 103", company: "Bletchley Labs", jobtitle: "Research Lead", city: "Milton Keynes", country: "United Kingdom", lifecyclestage: "opportunity", hs_lead_status: "IN_PROGRESS", hubspot_owner_id: "101", favorite_product: "pro", loyalty_points: "320", onboarding_date: null, newsletter_opt_in: "true" }),
    contact("1004", { firstname: "Katherine", lastname: "Johnson", email: "katherine@orbitalmath.com", phone: "+1 757 555 0104", company: "Orbital Math", jobtitle: "Mathematician", city: "Hampton", country: "United States", lifecyclestage: "lead", hs_lead_status: "NEW", hubspot_owner_id: "103", favorite_product: null, loyalty_points: "0", onboarding_date: null, newsletter_opt_in: "false" }),
    contact("1005", { firstname: "Maria", lastname: "Garcia", email: "maria.garcia@northwindtraders.com", phone: "+34 91 555 0105", company: "Northwind Traders", jobtitle: "Purchasing Manager", city: "Madrid", country: "Spain", lifecyclestage: "customer", hs_lead_status: "CONNECTED", hubspot_owner_id: "102", favorite_product: "enterprise", loyalty_points: "2100", onboarding_date: "2022-11-20", newsletter_opt_in: "true" }),
    contact("1006", { firstname: "James", lastname: "Chen", email: "james.chen@northwindtraders.com", phone: "+1 206 555 0106", company: "Northwind Traders", jobtitle: "Operations Director", city: "Seattle", country: "United States", lifecyclestage: "customer", hs_lead_status: "OPEN", hubspot_owner_id: "102", favorite_product: "pro", loyalty_points: "640", onboarding_date: "2023-01-09", newsletter_opt_in: "false" }),
    contact("1007", { firstname: "Priya", lastname: "Patel", email: "priya@globex.io", phone: "+1 415 555 0107", company: "Globex", jobtitle: "Head of RevOps", city: "San Francisco", country: "United States", lifecyclestage: "salesqualifiedlead", hs_lead_status: "IN_PROGRESS", hubspot_owner_id: "101", favorite_product: "enterprise", loyalty_points: "150", onboarding_date: null, newsletter_opt_in: "true" }),
    contact("1008", { firstname: "Tom", lastname: "Becker", email: "tom.becker@globex.io", phone: "+49 30 555 0108", company: "Globex", jobtitle: "Finance Manager", city: "Berlin", country: "Germany", lifecyclestage: "opportunity", hs_lead_status: "ATTEMPTED_TO_CONTACT", hubspot_owner_id: "103", favorite_product: "starter", loyalty_points: "75", onboarding_date: null, newsletter_opt_in: null }),
    contact("1009", { firstname: "Sofia", lastname: "Rossi", email: "sofia@initech.com", phone: "+39 02 555 0109", company: "Initech", jobtitle: "Customer Success Manager", city: "Milan", country: "Italy", lifecyclestage: "customer", hs_lead_status: "CONNECTED", hubspot_owner_id: "103", favorite_product: "pro", loyalty_points: "1720", onboarding_date: "2021-09-30", newsletter_opt_in: "true" }),
    contact("1010", { firstname: "Liam", lastname: "O'Connor", email: "liam@initech.com", phone: "+353 1 555 0110", company: "Initech", jobtitle: "IT Administrator", city: "Dublin", country: "Ireland", lifecyclestage: "customer", hs_lead_status: "OPEN", hubspot_owner_id: "101", favorite_product: "starter", loyalty_points: "410", onboarding_date: "2024-02-12", newsletter_opt_in: "false" }),
    contact("1011", { firstname: "Emma", lastname: "Svensson", email: "emma@analyticalengines.com", phone: "+46 8 555 0111", company: "Analytical Engines Ltd", jobtitle: "Product Manager", city: "Stockholm", country: "Sweden", lifecyclestage: "customer", hs_lead_status: "CONNECTED", hubspot_owner_id: "101", favorite_product: "enterprise", loyalty_points: "890", onboarding_date: "2023-03-14", newsletter_opt_in: "true" }),
    contact("1012", { firstname: "Noah", lastname: "Kim", email: "noah.kim@cobolworks.com", phone: "+82 2 555 0112", company: "COBOL Works", jobtitle: "Software Engineer", city: "Seoul", country: "South Korea", lifecyclestage: "marketingqualifiedlead", hs_lead_status: "NEW", hubspot_owner_id: "102", favorite_product: "starter", loyalty_points: "30", onboarding_date: null, newsletter_opt_in: "true" }),
    contact("1013", { firstname: "Olivia", lastname: "Brown", email: "olivia@example.org", phone: null, company: null, jobtitle: null, city: "Toronto", country: "Canada", lifecyclestage: "subscriber", hs_lead_status: null, hubspot_owner_id: null, favorite_product: null, loyalty_points: null, onboarding_date: null, newsletter_opt_in: "true" }),
    contact("1014", { firstname: "Lucas", lastname: "M\xFCller", email: "lucas.mueller@bletchleylabs.com", phone: "+41 44 555 0114", company: "Bletchley Labs", jobtitle: "Data Scientist", city: "Z\xFCrich", country: "Switzerland", lifecyclestage: "opportunity", hs_lead_status: "IN_PROGRESS", hubspot_owner_id: "103", favorite_product: "pro", loyalty_points: "505", onboarding_date: null, newsletter_opt_in: "false" })
  ];
  const companies = [
    rec("2001", { name: "Analytical Engines Ltd", domain: "analyticalengines.com", industry: "COMPUTER_SOFTWARE", city: "London", country: "United Kingdom", phone: "+44 20 7946 0000", numberofemployees: "240", annualrevenue: "18500000", lifecyclestage: "customer", hubspot_owner_id: "101", customer_tier: "gold", contract_renewal_date: "2026-03-31", health_score: "86" }),
    rec("2002", { name: "COBOL Works", domain: "cobolworks.com", industry: "COMPUTER_SOFTWARE", city: "Arlington", country: "United States", phone: "+1 703 555 0100", numberofemployees: "1200", annualrevenue: "96000000", lifecyclestage: "customer", hubspot_owner_id: "102", customer_tier: "silver", contract_renewal_date: "2025-12-15", health_score: "72" }),
    rec("2003", { name: "Bletchley Labs", domain: "bletchleylabs.com", industry: "RESEARCH", city: "Milton Keynes", country: "United Kingdom", phone: "+44 1908 555 100", numberofemployees: "85", annualrevenue: "7200000", lifecyclestage: "opportunity", hubspot_owner_id: "101", customer_tier: "bronze", contract_renewal_date: null, health_score: "58" }),
    rec("2004", { name: "Northwind Traders", domain: "northwindtraders.com", industry: "LOGISTICS_AND_SUPPLY_CHAIN", city: "Seattle", country: "United States", phone: "+1 206 555 0100", numberofemployees: "3400", annualrevenue: "410000000", lifecyclestage: "customer", hubspot_owner_id: "102", customer_tier: "gold", contract_renewal_date: "2026-01-31", health_score: "91" }),
    rec("2005", { name: "Globex", domain: "globex.io", industry: "FINANCIAL_SERVICES", city: "San Francisco", country: "United States", phone: "+1 415 555 0100", numberofemployees: "560", annualrevenue: "54000000", lifecyclestage: "opportunity", hubspot_owner_id: "101", customer_tier: "silver", contract_renewal_date: null, health_score: "64" }),
    rec("2006", { name: "Initech", domain: "initech.com", industry: "CONSULTING", city: "Austin", country: "United States", phone: "+1 512 555 0100", numberofemployees: "310", annualrevenue: "22000000", lifecyclestage: "customer", hubspot_owner_id: "103", customer_tier: "bronze", contract_renewal_date: "2025-11-30", health_score: "45" })
  ];
  const deals = [
    rec("3001", { dealname: "Analytical Engines \u2013 Enterprise plan", amount: "48000", dealstage: "closedwon", pipeline: "default", closedate: "2025-02-28T17:00:00.000Z", dealtype: "newbusiness", description: "Three-year enterprise agreement", hubspot_owner_id: "101", deal_source: "inbound", discount_percent: "10", is_renewal: "false" }),
    rec("3002", { dealname: "COBOL Works \u2013 Expansion", amount: "22500", dealstage: "contractsent", pipeline: "default", closedate: "2025-07-15T17:00:00.000Z", dealtype: "existingbusiness", description: "Add 150 seats for the platform team", hubspot_owner_id: "102", deal_source: "outbound", discount_percent: "5", is_renewal: "false" }),
    rec("3003", { dealname: "Bletchley Labs \u2013 Pilot", amount: "7500", dealstage: "qualifiedtobuy", pipeline: "default", closedate: "2025-08-01T17:00:00.000Z", dealtype: "newbusiness", description: "Eight-week pilot for the research team", hubspot_owner_id: "101", deal_source: "referral", discount_percent: "0", is_renewal: "false" }),
    rec("3004", { dealname: "Northwind \u2013 Annual renewal", amount: "36000", dealstage: "1002", pipeline: "75012345", closedate: "2026-01-31T17:00:00.000Z", dealtype: "existingbusiness", description: "Annual renewal, pricing review requested", hubspot_owner_id: "102", deal_source: "inbound", discount_percent: "8", is_renewal: "true" }),
    rec("3005", { dealname: "Globex \u2013 Onboarding package", amount: "12000", dealstage: "presentationscheduled", pipeline: "default", closedate: "2025-09-10T17:00:00.000Z", dealtype: "newbusiness", description: "Guided onboarding for the RevOps team", hubspot_owner_id: "101", deal_source: "partner", discount_percent: "0", is_renewal: "false" }),
    rec("3006", { dealname: "Initech \u2013 Support add-on", amount: "4800", dealstage: "appointmentscheduled", pipeline: "default", closedate: "2025-10-01T17:00:00.000Z", dealtype: "existingbusiness", description: "Premium support tier", hubspot_owner_id: "103", deal_source: "inbound", discount_percent: "0", is_renewal: "false" }),
    rec("3007", { dealname: "Globex \u2013 Data migration", amount: "18000", dealstage: "decisionmakerboughtin", pipeline: "default", closedate: "2025-08-20T17:00:00.000Z", dealtype: "newbusiness", description: "Migrate 10 years of CRM history", hubspot_owner_id: "103", deal_source: "outbound", discount_percent: "12.5", is_renewal: "false" }),
    rec("3008", { dealname: "Analytical Engines \u2013 Training", amount: "3200", dealstage: "closedlost", pipeline: "default", closedate: "2025-04-30T17:00:00.000Z", dealtype: "existingbusiness", description: "On-site admin training", hubspot_owner_id: "101", deal_source: "inbound", discount_percent: "0", is_renewal: "false" }),
    rec("3009", { dealname: "Northwind \u2013 Warehouse integration", amount: "27500", dealstage: "qualifiedtobuy", pipeline: "default", closedate: "2025-11-15T17:00:00.000Z", dealtype: "existingbusiness", description: "Connect the warehouse system", hubspot_owner_id: "102", deal_source: "partner", discount_percent: "3", is_renewal: "false" }),
    rec("3010", { dealname: "Initech \u2013 Multi-year renewal", amount: "54000", dealstage: "1001", pipeline: "75012345", closedate: "2025-11-30T17:00:00.000Z", dealtype: "existingbusiness", description: "Three-year renewal proposal", hubspot_owner_id: "103", deal_source: "inbound", discount_percent: "15", is_renewal: "true" })
  ];
  const tickets = [
    rec("4001", { subject: "Cannot export report to CSV", content: "The export button spins forever on the revenue report.", hs_pipeline: "0", hs_pipeline_stage: "3", hs_ticket_priority: "HIGH", hubspot_owner_id: "101", product_area: "reporting", affected_users: "12", sla_due: "2025-06-05T12:00:00.000Z" }),
    rec("4002", { subject: "Invoice shows wrong VAT", content: "VAT is 19% but should be 21% for Spain.", hs_pipeline: "0", hs_pipeline_stage: "2", hs_ticket_priority: "MEDIUM", hubspot_owner_id: "102", product_area: "billing", affected_users: "1", sla_due: "2025-06-10T12:00:00.000Z" }),
    rec("4003", { subject: "SSO login loop", content: "Users are redirected back to the login page after signing in with SSO.", hs_pipeline: "0", hs_pipeline_stage: "1", hs_ticket_priority: "URGENT", hubspot_owner_id: "103", product_area: "integrations", affected_users: "140", sla_due: "2025-06-03T09:00:00.000Z" }),
    rec("4004", { subject: "Request: dark mode", content: "Could the dashboard support a dark theme?", hs_pipeline: "0", hs_pipeline_stage: "4", hs_ticket_priority: "LOW", hubspot_owner_id: "101", product_area: "reporting", affected_users: "0", sla_due: null }),
    rec("4005", { subject: "Data sync delayed", content: "Contacts take more than an hour to sync from the warehouse.", hs_pipeline: "0", hs_pipeline_stage: "3", hs_ticket_priority: "HIGH", hubspot_owner_id: "102", product_area: "integrations", affected_users: "35", sla_due: "2025-06-04T15:00:00.000Z" })
  ];
  const products = [
    rec("5001", { name: "Starter plan", price: "49", hs_sku: "PLAN-STARTER", description: "For small teams", product_family: "software", margin_percent: "82", launch_date: "2020-05-01" }),
    rec("5002", { name: "Professional plan", price: "499", hs_sku: "PLAN-PRO", description: "For growing teams", product_family: "software", margin_percent: "78", launch_date: "2020-05-01" }),
    rec("5003", { name: "Onboarding service", price: "1500", hs_sku: "SVC-ONBOARD", description: "Guided setup", product_family: "services", margin_percent: "35", launch_date: "2021-02-15" })
  ];
  const lineItems = [
    rec("6001", { name: "Professional plan", quantity: "80", price: "499", amount: "39920", hs_product_id: "5002" }),
    rec("6002", { name: "Onboarding service", quantity: "1", price: "1500", amount: "1500", hs_product_id: "5003" }),
    rec("6003", { name: "Starter plan", quantity: "25", price: "49", amount: "1225", hs_product_id: "5001" }),
    rec("6004", { name: "Onboarding service", quantity: "2", price: "1500", amount: "3000", hs_product_id: "5003" })
  ];
  const project = (id, p) => rec(id, p, "hs_lastmodifieddate", "hs_createdate");
  const projects = [
    project("7001", { project_name: "Enterprise rollout", project_status: "in_progress", budget: "42000", start_date: "2025-03-01", hubspot_owner_id: "101" }),
    project("7002", { project_name: "Warehouse integration", project_status: "planning", budget: "27500", start_date: "2025-11-20", hubspot_owner_id: "102" }),
    project("7003", { project_name: "RevOps onboarding", project_status: "planning", budget: "12000", start_date: "2025-09-15", hubspot_owner_id: "101" }),
    project("7004", { project_name: "Legacy CRM migration", project_status: "on_hold", budget: "18000", start_date: "2025-08-25", hubspot_owner_id: "103" }),
    project("7005", { project_name: "Admin training", project_status: "done", budget: "3200", start_date: "2025-01-10", hubspot_owner_id: "101" })
  ];
  return /* @__PURE__ */ new Map([
    ["contacts", contacts],
    ["companies", companies],
    ["deals", deals],
    ["tickets", tickets],
    ["products", products],
    ["line_items", lineItems],
    ["quotes", []],
    ["projects", projects]
  ]);
}
var HD = "HUBSPOT_DEFINED";
var UD = "USER_DEFINED";
function link(fromType, fromId, toType, toId, types, reverseTypes) {
  return { fromType, fromId, toType, toId, types, reverseTypes };
}
function buildAssociations() {
  const out = [];
  const contactCompany = [
    ["1001", "2001"],
    ["1011", "2001"],
    ["1002", "2002"],
    ["1012", "2002"],
    ["1003", "2003"],
    ["1014", "2003"],
    ["1005", "2004"],
    ["1006", "2004"],
    ["1007", "2005"],
    ["1008", "2005"],
    ["1009", "2006"],
    ["1010", "2006"]
  ];
  for (const [c, co] of contactCompany) {
    out.push(
      link(
        "contacts",
        c,
        "companies",
        co,
        [
          { category: HD, typeId: 1, label: "Primary" },
          { category: HD, typeId: 279, label: null }
        ],
        [{ category: HD, typeId: 280, label: null }]
      )
    );
  }
  const dealCompany = [
    ["3001", "2001"],
    ["3008", "2001"],
    ["3002", "2002"],
    ["3003", "2003"],
    ["3004", "2004"],
    ["3009", "2004"],
    ["3005", "2005"],
    ["3007", "2005"],
    ["3006", "2006"],
    ["3010", "2006"]
  ];
  for (const [d, co] of dealCompany) {
    out.push(
      link(
        "deals",
        d,
        "companies",
        co,
        [
          { category: HD, typeId: 5, label: "Primary" },
          { category: HD, typeId: 341, label: null }
        ],
        [{ category: HD, typeId: 342, label: null }]
      )
    );
  }
  const dealContact = [
    ["3001", "1001", "Decision maker"],
    ["3001", "1011", null],
    ["3002", "1002", "Decision maker"],
    ["3002", "1012", null],
    ["3003", "1003", null],
    ["3004", "1005", "Decision maker"],
    ["3004", "1006", null],
    ["3005", "1007", null],
    ["3006", "1009", null],
    ["3007", "1007", "Decision maker"],
    ["3007", "1008", "Budget holder"],
    ["3008", "1011", null],
    ["3009", "1006", null],
    ["3010", "1009", "Decision maker"],
    ["3010", "1010", null]
  ];
  for (const [d, c, label] of dealContact) {
    const types = [{ category: HD, typeId: 3, label: null }];
    if (label) types.push({ category: UD, typeId: label === "Decision maker" ? 31 : 33, label });
    const reverse = [{ category: HD, typeId: 4, label: null }];
    if (label) reverse.push({ category: UD, typeId: label === "Decision maker" ? 32 : 34, label });
    out.push(link("deals", d, "contacts", c, types, reverse));
  }
  const ticketContact = [
    ["4001", "1001", "2001"],
    ["4002", "1005", "2004"],
    ["4003", "1009", "2006"],
    ["4004", "1003", "2003"],
    ["4005", "1006", "2004"]
  ];
  for (const [t, c, co] of ticketContact) {
    out.push(link("tickets", t, "contacts", c, [{ category: HD, typeId: 16, label: null }], [{ category: HD, typeId: 15, label: null }]));
    out.push(link("tickets", t, "companies", co, [{ category: HD, typeId: 339, label: null }], [{ category: HD, typeId: 340, label: null }]));
  }
  out.push(link("tickets", "4005", "deals", "3009", [{ category: HD, typeId: 28, label: null }], [{ category: HD, typeId: 27, label: null }]));
  const dealLineItems = [
    ["3001", "6001"],
    ["3001", "6002"],
    ["3006", "6003"],
    ["3005", "6004"]
  ];
  for (const [d, li] of dealLineItems) {
    out.push(link("deals", d, "line_items", li, [{ category: HD, typeId: 19, label: null }], [{ category: HD, typeId: 20, label: null }]));
  }
  const projectLinks = [
    ["7001", "2001", "3001"],
    ["7002", "2004", "3009"],
    ["7003", "2005", "3005"],
    ["7004", "2005", "3007"],
    ["7005", "2001", "3008"]
  ];
  for (const [p, co, d] of projectLinks) {
    out.push(link("projects", p, "companies", co, [{ category: UD, typeId: 101, label: null }], [{ category: UD, typeId: 102, label: null }]));
    out.push(link("projects", p, "deals", d, [{ category: UD, typeId: 103, label: null }], [{ category: UD, typeId: 104, label: null }]));
  }
  return out;
}
var DEFAULT_PORTAL_ID = 12345678;
function createSeed(portalId = DEFAULT_PORTAL_ID) {
  return {
    portalId,
    hubDomain: "acmedemo.com",
    objectTypes: buildObjectTypes(portalId),
    records: buildRecords(),
    associations: buildAssociations(),
    pipelines: /* @__PURE__ */ new Map([
      ["deals", DEAL_PIPELINES],
      ["tickets", TICKET_PIPELINES]
    ]),
    owners: OWNERS.map((o) => ({ ...o }))
  };
}

// server/fake-hubspot/search.ts
var OPERATORS = /* @__PURE__ */ new Set([
  "EQ",
  "NEQ",
  "LT",
  "LTE",
  "GT",
  "GTE",
  "BETWEEN",
  "IN",
  "NOT_IN",
  "HAS_PROPERTY",
  "NOT_HAS_PROPERTY",
  "CONTAINS_TOKEN",
  "NOT_CONTAINS_TOKEN"
]);
function asComparable(v) {
  const t = v.trim();
  if (t === "") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}
function compareValues(recordValue, filterValue) {
  const a = asComparable(recordValue);
  const b = asComparable(filterValue);
  if (a !== null && b !== null) return a === b ? 0 : a < b ? -1 : 1;
  return recordValue.toLowerCase().localeCompare(filterValue.toLowerCase());
}
function equalsValue(recordValue, filterValue) {
  if (recordValue === null) return false;
  if (recordValue.toLowerCase() === filterValue.toLowerCase()) return true;
  const a = asComparable(recordValue);
  const b = asComparable(filterValue);
  return a !== null && b !== null && a === b;
}
function tokens(value) {
  return value.toLowerCase().split(/[^\p{L}\p{N}@._-]+/u).filter(Boolean);
}
function containsToken(recordValue, filterValue) {
  if (recordValue === null || recordValue === "") return false;
  const needle = filterValue.toLowerCase();
  if (needle.includes("*")) {
    const re = new RegExp(`^${needle.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "u");
    return re.test(recordValue.toLowerCase()) || tokens(recordValue).some((t) => re.test(t));
  }
  return recordValue.toLowerCase() === needle || tokens(recordValue).includes(needle);
}
function str(v) {
  return v === null || v === void 0 ? "" : String(v);
}
function matchesFilter(record, f) {
  const name = str(f.propertyName);
  const op = str(f.operator);
  const value = record.properties[name] ?? null;
  const fv = str(f.value);
  const values = Array.isArray(f.values) ? f.values.map(str) : [];
  const multi = value === null ? [] : value.split(";");
  switch (op) {
    case "EQ":
      return equalsValue(value, fv);
    case "NEQ":
      return !equalsValue(value, fv);
    case "LT":
      return value !== null && value !== "" && compareValues(value, fv) < 0;
    case "LTE":
      return value !== null && value !== "" && compareValues(value, fv) <= 0;
    case "GT":
      return value !== null && value !== "" && compareValues(value, fv) > 0;
    case "GTE":
      return value !== null && value !== "" && compareValues(value, fv) >= 0;
    case "BETWEEN":
      return value !== null && value !== "" && compareValues(value, fv) >= 0 && compareValues(value, str(f.highValue)) <= 0;
    case "IN":
      return multi.some((m) => values.some((v) => equalsValue(m, v)));
    case "NOT_IN":
      return !multi.some((m) => values.some((v) => equalsValue(m, v)));
    case "HAS_PROPERTY":
      return value !== null && value !== "";
    case "NOT_HAS_PROPERTY":
      return value === null || value === "";
    case "CONTAINS_TOKEN":
      return containsToken(value, fv);
    case "NOT_CONTAINS_TOKEN":
      return !containsToken(value, fv);
    default:
      return false;
  }
}
function sortSpec(raw) {
  if (typeof raw === "string") {
    return raw.startsWith("-") ? { name: raw.slice(1), desc: true } : { name: raw, desc: false };
  }
  if (raw && typeof raw === "object") {
    const o = raw;
    if (typeof o.propertyName === "string") return { name: o.propertyName, desc: o.direction === "DESCENDING" };
  }
  return null;
}
function runSearch(type, records, req) {
  const known = new Set(type.properties.map((p) => p.name));
  const limit = req.limit === void 0 ? 10 : Number(req.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return { ok: false, message: "limit must be between 1 and 200" };
  const offset = req.after === void 0 || req.after === null || req.after === "" ? 0 : Number(req.after);
  if (!Number.isInteger(offset) || offset < 0) return { ok: false, message: "after must be a non-negative integer" };
  let groups = [];
  if (req.filterGroups !== void 0) {
    if (!Array.isArray(req.filterGroups)) return { ok: false, message: "filterGroups must be an array" };
    if (req.filterGroups.length > 5) return { ok: false, message: "Too many filter groups (max 5)" };
    groups = [];
    for (const g of req.filterGroups) {
      if (!g || !Array.isArray(g.filters)) return { ok: false, message: "Each filter group needs filters" };
      if (g.filters.length > 6) return { ok: false, message: "Too many filters in a group (max 6)" };
      for (const f of g.filters) {
        const op = str(f?.operator);
        if (!OPERATORS.has(op)) {
          return { ok: false, message: `Invalid input JSON: Cannot deserialize value of type \`FilterOperatorEnum\` from String "${op}"` };
        }
        const name = str(f?.propertyName);
        if (!known.has(name)) return { ok: false, message: `There was a problem with the request: property "${name}" does not exist on ${type.name}` };
      }
      groups.push(g.filters);
    }
  }
  const query = typeof req.query === "string" ? req.query.trim().toLowerCase() : "";
  let matched = records.filter((r) => {
    if (query) {
      const hit = r.id === query || type.searchable.some((p) => (r.properties[p] ?? "").toLowerCase().includes(query));
      if (!hit) return false;
    }
    if (groups.length === 0) return true;
    return groups.some((filters) => filters.every((f) => matchesFilter(r, f)));
  });
  const sorts = Array.isArray(req.sorts) ? req.sorts.map(sortSpec).filter((s) => s !== null) : [];
  if (sorts.length > 0) {
    matched = [...matched].sort((a, b) => {
      for (const s of sorts) {
        const av = a.properties[s.name] ?? null;
        const bv = b.properties[s.name] ?? null;
        if (av === bv) continue;
        if (av === null || av === "") return 1;
        if (bv === null || bv === "") return -1;
        const c = compareValues(av, bv);
        if (c !== 0) return s.desc ? -c : c;
      }
      return Number(a.id) - Number(b.id);
    });
  } else {
    matched = [...matched].sort((a, b) => Number(a.id) - Number(b.id));
  }
  const page = matched.slice(offset, offset + limit);
  const nextAfter = offset + limit < matched.length ? String(offset + limit) : void 0;
  const properties = Array.isArray(req.properties) ? req.properties.filter((p) => typeof p === "string") : null;
  return { ok: true, records: page, total: matched.length, nextAfter, properties };
}

// server/fake-hubspot/handler.ts
var FAKE_PERSONAL_ACCESS_KEY = "pat-na1-fake0000-0000-4000-8000-000000000001";
function uuid() {
  return crypto.randomUUID();
}
function hsJson(status, body, headers = {}) {
  return new Response(body === void 0 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json;charset=utf-8", "x-hubspot-correlation-id": uuid(), ...headers }
  });
}
function hsError2(status, message, category, extra = {}) {
  return hsJson(status, { status: "error", message, correlationId: uuid(), category, ...extra });
}
function html(status, body) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>HubSpot (fake)</title></head><body>${body}</body></html>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}
function esc(v) {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function splitScopes(raw) {
  return (raw ?? "").split(/[\s+]+/).filter(Boolean);
}
function createFakeHubSpot(opts2) {
  const portalId = opts2.portalId ?? DEFAULT_PORTAL_ID;
  const seed = createSeed(portalId);
  if (opts2.hubDomain) seed.hubDomain = opts2.hubDomain;
  const now = opts2.now ?? (() => Date.now());
  const ttl = opts2.accessTokenTtlSeconds ?? 1800;
  const region = opts2.region ?? "na1";
  const user = opts2.user ?? { email: "jordan.lee@acmedemo.com", id: 9001 };
  const grants = /* @__PURE__ */ new Map();
  const accessTokens = /* @__PURE__ */ new Map();
  const codes = /* @__PURE__ */ new Map();
  const dropped = /* @__PURE__ */ new Set();
  const failures = [];
  const requests = [];
  const projects = {
    portalId,
    personalAccessKeys: new Map([[FAKE_PERSONAL_ACCESS_KEY, portalId], ...Object.entries(opts2.personalAccessKeys ?? {})])
  };
  const effectiveScopes = (g) => g.scopes.filter((s) => !dropped.has(s));
  function newAccessToken(grant, expiresInSeconds = ttl) {
    const at = { token: `fake-at-${region}-${uuid()}`, grant, expiresAt: now() + expiresInSeconds * 1e3 };
    accessTokens.set(at.token, at);
    return at;
  }
  function newGrant(clientId, scopes) {
    const grant = { refreshToken: `${region}-${uuid()}`, clientId, scopes: [...new Set(scopes)], revoked: false };
    grants.set(grant.refreshToken, grant);
    return grant;
  }
  function findType(raw) {
    const lower = raw.toLowerCase();
    return seed.objectTypes.find((t) => t.name === lower || t.aliases.map((a) => a.toLowerCase()).includes(lower));
  }
  function recordsOf(t) {
    let list = seed.records.get(t.name);
    if (!list) {
      list = [];
      seed.records.set(t.name, list);
    }
    return list;
  }
  function outputProperties(t, r, requested) {
    const known = new Set(t.properties.map((p) => p.name));
    const createdProp = t.properties.some((p) => p.name === "hs_createdate") ? "hs_createdate" : "createdate";
    const names = requested && requested.length > 0 ? [...requested, "hs_object_id", createdProp, t.lastModifiedProperty] : t.defaultProperties;
    const out = {};
    for (const n of names) if (known.has(n)) out[n] = r.properties[n] ?? null;
    return out;
  }
  function objectJson(t, r, requested) {
    return { id: r.id, properties: outputProperties(t, r, requested), createdAt: r.createdAt, updatedAt: r.updatedAt, archived: false };
  }
  function missingScope(scopes) {
    return hsError2(403, "This app hasn't been granted all required scopes to make this call. Read more about required scopes here: https://developers.hubspot.com/scopes.", "MISSING_SCOPES", {
      errors: [{ message: "One or more of the following scopes are required.", context: { requiredGranularScopes: scopes } }],
      links: { scopes: "https://developers.hubspot.com/scopes" }
    });
  }
  function authenticate(request, log) {
    const header = request.headers.get("authorization") ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(header);
    if (!m) return hsError2(401, "Authentication credentials not found. This API supports OAuth 2.0 authentication.", "INVALID_AUTHENTICATION");
    log.token = m[1];
    const at = accessTokens.get(m[1]);
    if (!at || at.grant.revoked) return hsError2(401, "Authentication credentials not found. This API supports OAuth 2.0 authentication.", "INVALID_AUTHENTICATION");
    if (at.expiresAt <= now()) return hsError2(401, "The OAuth token used to make this call expired 1 second(s) ago.", "EXPIRED_AUTHENTICATION");
    return at;
  }
  function requireAny(at, anyOf) {
    const granted = effectiveScopes(at.grant);
    return anyOf.some((s) => granted.includes(s)) ? null : missingScope([anyOf[0]]);
  }
  function authorizePage(url) {
    const clientId = url.searchParams.get("client_id") ?? "";
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const scope = url.searchParams.get("scope") ?? "";
    const optional = url.searchParams.get("optional_scope") ?? "";
    if (clientId !== opts2.clientId) return html(400, "<h1>Invalid client</h1><p>The app that sent you here is not recognised (client_id).</p>");
    let redirect;
    try {
      redirect = new URL(redirectUri);
    } catch {
      return html(400, "<h1>Invalid redirect</h1><p>redirect_uri is missing or invalid.</p>");
    }
    if (!splitScopes(scope).includes("oauth")) return html(400, "<h1>Invalid scope</h1><p>The oauth scope is required.</p>");
    if (url.searchParams.get("auto") === "1" || opts2.autoApprove) return decide(url, "approve");
    const all = [...splitScopes(scope), ...splitScopes(optional)];
    const hidden = ["client_id", "redirect_uri", "scope", "optional_scope", "state"].map((k) => `<input type="hidden" name="${k}" value="${esc(url.searchParams.get(k) ?? "")}">`).join("");
    void redirect;
    return html(
      200,
      `<main><h1>Connect to HubSpot (fake)</h1><p>Portal <strong>${portalId}</strong> (${esc(seed.hubDomain)}) \u2014 signed in as ${esc(user.email)}.</p>
<p>The app is asking for:</p><ul>${all.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
<form method="get" action="/oauth/authorize/decision">${hidden}
<button type="submit" name="decision" value="approve">Approve</button>
<button type="submit" name="decision" value="deny">Deny</button></form>
<p hidden>${esc(state)}</p></main>`
    );
  }
  function decide(url, decision) {
    const clientId = url.searchParams.get("client_id") ?? "";
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    if (clientId !== opts2.clientId) return html(400, "<h1>Invalid client</h1>");
    let target;
    try {
      target = new URL(redirectUri);
    } catch {
      return html(400, "<h1>Invalid redirect</h1>");
    }
    if (decision !== "approve") {
      target.searchParams.set("error", "access_denied");
      target.searchParams.set("error_description", "The user denied access");
      if (state) target.searchParams.set("state", state);
      return new Response(null, { status: 302, headers: { location: target.toString() } });
    }
    const scopes = [...splitScopes(url.searchParams.get("scope")), ...splitScopes(url.searchParams.get("optional_scope"))];
    const code = { code: `fake-code-${uuid()}`, clientId, redirectUri, scopes, expiresAt: now() + 10 * 60 * 1e3, used: false };
    codes.set(code.code, code);
    target.searchParams.set("code", code.code);
    if (state) target.searchParams.set("state", state);
    return new Response(null, { status: 302, headers: { location: target.toString() } });
  }
  async function token(request) {
    const form = new URLSearchParams(await request.text());
    const clientId = form.get("client_id");
    const clientSecret = form.get("client_secret");
    if (clientId !== opts2.clientId || clientSecret !== opts2.clientSecret) {
      return hsJson(400, { status: "BAD_CLIENT_ID", message: "missing or unknown client id", error: "invalid_client", correlationId: uuid() });
    }
    const grantType = form.get("grant_type");
    if (grantType === "authorization_code") {
      const code = codes.get(form.get("code") ?? "");
      if (!code || code.used || code.expiresAt <= now() || code.clientId !== clientId) {
        return hsJson(400, { status: "BAD_AUTH_CODE", message: "missing or unknown auth code", error: "invalid_grant", correlationId: uuid() });
      }
      if (form.get("redirect_uri") !== code.redirectUri) {
        return hsJson(400, { status: "BAD_REDIRECT_URI", message: "redirect_uri does not match", error: "invalid_grant", correlationId: uuid() });
      }
      code.used = true;
      const grant = newGrant(clientId, code.scopes);
      const at = newAccessToken(grant);
      return hsJson(200, { token_type: "bearer", refresh_token: grant.refreshToken, access_token: at.token, expires_in: ttl });
    }
    if (grantType === "refresh_token") {
      const grant = grants.get(form.get("refresh_token") ?? "");
      if (!grant || grant.revoked || grant.clientId !== clientId) {
        return hsJson(400, { status: "BAD_REFRESH_TOKEN", message: "missing or unknown refresh token", error: "invalid_grant", correlationId: uuid() });
      }
      const at = newAccessToken(grant);
      return hsJson(200, { token_type: "bearer", refresh_token: grant.refreshToken, access_token: at.token, expires_in: ttl });
    }
    return hsJson(400, { status: "BAD_GRANT_TYPE", message: "unsupported grant_type", error: "unsupported_grant_type", correlationId: uuid() });
  }
  function tokenInfo(raw) {
    const at = accessTokens.get(raw);
    if (!at || at.grant.revoked) return hsError2(404, "Token not found", "OBJECT_NOT_FOUND");
    if (at.expiresAt <= now()) return hsError2(401, "The OAuth token used to make this call expired.", "EXPIRED_AUTHENTICATION");
    return hsJson(200, {
      token: at.token,
      user: user.email,
      hub_domain: seed.hubDomain,
      scopes: effectiveScopes(at.grant),
      scope_to_scope_group_pks: [],
      trial_scopes: [],
      trial_scope_to_scope_group_pks: [],
      hub_id: portalId,
      app_id: 424242,
      expires_in: Math.max(0, Math.floor((at.expiresAt - now()) / 1e3)),
      user_id: user.id,
      token_type: "access"
    });
  }
  function refreshTokenInfo(raw) {
    const grant = grants.get(raw);
    if (!grant || grant.revoked) return hsError2(404, "Refresh token not found", "OBJECT_NOT_FOUND");
    return hsJson(200, { token: raw, user: user.email, hub_domain: seed.hubDomain, scopes: effectiveScopes(grant), hub_id: portalId, client_id: grant.clientId, user_id: user.id, token_type: "refresh" });
  }
  function revoke(raw) {
    const grant = grants.get(raw);
    if (!grant) return hsError2(404, "Refresh token not found", "OBJECT_NOT_FOUND");
    grant.revoked = true;
    return new Response(null, { status: 204 });
  }
  function propertyJson(t, p, i) {
    return {
      updatedAt: "2024-01-15T10:30:00.000Z",
      createdAt: "2020-01-01T00:00:00.000Z",
      name: p.name,
      label: p.label,
      type: p.type,
      fieldType: p.fieldType,
      description: p.description ?? "",
      groupName: p.groupName,
      options: p.options ?? [],
      displayOrder: i,
      calculated: p.calculated ?? false,
      externalOptions: p.name === "hubspot_owner_id",
      hasUniqueValue: p.name === "hs_object_id",
      hidden: p.hidden ?? false,
      hubspotDefined: p.hubspotDefined ?? false,
      modificationMetadata: { archivable: !p.hubspotDefined, readOnlyDefinition: !!p.hubspotDefined, readOnlyValue: p.readOnlyValue ?? false },
      formField: !p.readOnlyValue,
      archived: false,
      objectType: t.objectTypeId
    };
  }
  function schemaJson(t) {
    return {
      id: t.custom?.schemaId ?? t.objectTypeId,
      name: t.name,
      labels: { singular: t.singular, plural: t.plural },
      objectTypeId: t.objectTypeId,
      fullyQualifiedName: t.custom?.fullyQualifiedName ?? t.name,
      primaryDisplayProperty: t.primaryDisplayProperty,
      secondaryDisplayProperties: t.secondaryDisplayProperties,
      requiredProperties: [t.primaryDisplayProperty],
      searchableProperties: t.searchable,
      properties: t.properties.map((p, i) => propertyJson(t, p, i)),
      associations: [],
      createdAt: "2024-01-15T10:30:00.000Z",
      updatedAt: "2024-01-15T10:30:00.000Z",
      archived: false
    };
  }
  function associationsFor(from, id, to) {
    const out = /* @__PURE__ */ new Map();
    for (const a of seed.associations) {
      if (a.fromType === from.name && a.fromId === id && a.toType === to.name) {
        out.set(a.toId, [...out.get(a.toId) ?? [], ...a.types]);
      } else if (a.toType === from.name && a.toId === id && a.fromType === to.name) {
        out.set(a.fromId, [...out.get(a.fromId) ?? [], ...a.reverseTypes]);
      }
    }
    return [...out.entries()].sort((x, y) => Number(x[0]) - Number(y[0])).map(([toId, types]) => ({ toObjectId: Number(toId), associationTypes: types }));
  }
  async function readJsonBody(request) {
    try {
      return JSON.parse(await request.text());
    } catch {
      return void 0;
    }
  }
  function parseProps(url) {
    const values = url.searchParams.getAll("properties");
    if (values.length === 0) return null;
    return values.flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean);
  }
  async function crm(request, url, at) {
    const path2 = url.pathname;
    const method = request.method;
    let m;
    if (method === "GET" && path2 === "/crm/v3/schemas") {
      const denied = requireAny(at, ["crm.schemas.custom.read"]);
      if (denied) return denied;
      return hsJson(200, { results: seed.objectTypes.filter((t) => t.custom).map(schemaJson) });
    }
    if (method === "GET" && (m = /^\/crm\/v3\/schemas\/([^/]+)$/.exec(path2))) {
      const denied = requireAny(at, ["crm.schemas.custom.read"]);
      if (denied) return denied;
      const t = findType(decodeURIComponent(m[1]));
      if (!t || !t.custom) return hsError2(404, "Unable to find object schema", "OBJECT_NOT_FOUND");
      return hsJson(200, schemaJson(t));
    }
    if (method === "GET" && (m = /^\/crm\/v3\/properties\/([^/]+)$/.exec(path2))) {
      const t = findType(decodeURIComponent(m[1]));
      if (!t) return hsError2(400, `Unable to infer object type from: ${decodeURIComponent(m[1])}`, "VALIDATION_ERROR");
      const denied = requireAny(at, t.schemaScopes);
      if (denied) return denied;
      return hsJson(200, { results: t.properties.map((p, i) => propertyJson(t, p, i)) });
    }
    if (method === "GET" && (m = /^\/crm\/v3\/pipelines\/([^/]+)$/.exec(path2))) {
      const t = findType(decodeURIComponent(m[1]));
      if (!t) return hsError2(400, `Unable to infer object type from: ${decodeURIComponent(m[1])}`, "VALIDATION_ERROR");
      const denied = requireAny(at, t.readScopes);
      if (denied) return denied;
      const pipelines = seed.pipelines.get(t.name);
      if (!pipelines) return hsError2(400, `Pipelines are not supported for object type ${t.name}`, "VALIDATION_ERROR");
      return hsJson(200, {
        results: pipelines.map((p) => ({
          id: p.id,
          label: p.label,
          displayOrder: p.displayOrder,
          stages: p.stages.map((s) => ({ ...s, createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z", archived: false })),
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
          archived: false
        }))
      });
    }
    if (method === "GET" && (path2 === "/crm/v3/owners" || path2 === "/crm/v3/owners/")) {
      const denied = requireAny(at, ["crm.objects.owners.read"]);
      if (denied) return denied;
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100));
      const offset = Number(url.searchParams.get("after") ?? 0) || 0;
      const email = url.searchParams.get("email");
      const all = seed.owners.filter((o) => !email || o.email === email);
      const page = all.slice(offset, offset + limit);
      const body = {
        results: page.map((o) => ({ ...o, createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2024-01-01T00:00:00.000Z", archived: false, teams: [] }))
      };
      if (offset + limit < all.length) body.paging = { next: { after: String(offset + limit) } };
      return hsJson(200, body);
    }
    if (method === "POST" && (m = /^\/crm\/v3\/objects\/([^/]+)\/search$/.exec(path2))) {
      const t = findType(decodeURIComponent(m[1]));
      if (!t) return hsError2(400, `Unable to infer object type from: ${decodeURIComponent(m[1])}`, "VALIDATION_ERROR");
      const denied = requireAny(at, t.readScopes);
      if (denied) return denied;
      const body = await readJsonBody(request);
      if (!body || typeof body !== "object") return hsError2(400, "Invalid input JSON", "VALIDATION_ERROR");
      const outcome = runSearch(t, recordsOf(t), body);
      if (!outcome.ok) return hsError2(400, outcome.message, "VALIDATION_ERROR");
      const res = {
        total: outcome.total,
        results: outcome.records.map((r) => objectJson(t, r, outcome.properties))
      };
      if (outcome.nextAfter) res.paging = { next: { after: outcome.nextAfter, link: "?after=" + outcome.nextAfter } };
      return hsJson(200, res);
    }
    if (method === "POST" && (m = /^\/crm\/v3\/objects\/([^/]+)\/batch\/read$/.exec(path2))) {
      const t = findType(decodeURIComponent(m[1]));
      if (!t) return hsError2(400, `Unable to infer object type from: ${decodeURIComponent(m[1])}`, "VALIDATION_ERROR");
      const denied = requireAny(at, t.readScopes);
      if (denied) return denied;
      const body = await readJsonBody(request);
      if (!body || !Array.isArray(body.inputs)) return hsError2(400, "inputs is required", "VALIDATION_ERROR");
      if (body.inputs.length > 100) return hsError2(400, "Batch size cannot exceed 100", "VALIDATION_ERROR");
      const props = Array.isArray(body.properties) ? body.properties.filter((p) => typeof p === "string") : null;
      const list = recordsOf(t);
      const results = [];
      const missing = [];
      for (const input of body.inputs) {
        const r = list.find((x) => x.id === String(input?.id));
        if (r) results.push(objectJson(t, r, props));
        else missing.push(String(input?.id));
      }
      const res = { status: "COMPLETE", results, startedAt: new Date(now()).toISOString(), completedAt: new Date(now()).toISOString() };
      if (missing.length > 0) {
        res.numErrors = 1;
        res.errors = [{ status: "error", category: "OBJECT_NOT_FOUND", message: "Could not get some objects, they may be deleted or not exist.", context: { ids: missing } }];
        return hsJson(207, res);
      }
      return hsJson(200, res);
    }
    if (method === "GET" && (m = /^\/crm\/v3\/objects\/([^/]+)\/([^/]+)$/.exec(path2))) {
      const t = findType(decodeURIComponent(m[1]));
      if (!t) return hsError2(400, `Unable to infer object type from: ${decodeURIComponent(m[1])}`, "VALIDATION_ERROR");
      const denied = requireAny(at, t.readScopes);
      if (denied) return denied;
      const r = recordsOf(t).find((x) => x.id === m[2]);
      if (!r) return hsError2(404, "Object not found.  objectId are usually numeric.", "OBJECT_NOT_FOUND");
      return hsJson(200, objectJson(t, r, parseProps(url)));
    }
    if (method === "GET" && (m = /^\/crm\/v3\/objects\/([^/]+)$/.exec(path2))) {
      const t = findType(decodeURIComponent(m[1]));
      if (!t) return hsError2(400, `Unable to infer object type from: ${decodeURIComponent(m[1])}`, "VALIDATION_ERROR");
      const denied = requireAny(at, t.readScopes);
      if (denied) return denied;
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 10) || 10));
      const offset = Number(url.searchParams.get("after") ?? 0) || 0;
      const list = recordsOf(t);
      const res = { results: list.slice(offset, offset + limit).map((r) => objectJson(t, r, parseProps(url))) };
      if (offset + limit < list.length) res.paging = { next: { after: String(offset + limit) } };
      return hsJson(200, res);
    }
    if (method === "GET" && (m = /^\/crm\/v4\/objects\/([^/]+)\/([^/]+)\/associations\/([^/]+)$/.exec(path2))) {
      const from = findType(decodeURIComponent(m[1]));
      const to = findType(decodeURIComponent(m[3]));
      if (!from || !to) return hsError2(400, "Unable to infer object type", "VALIDATION_ERROR");
      const denied = requireAny(at, from.readScopes) ?? requireAny(at, to.readScopes);
      if (denied) return denied;
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 500) || 500));
      const offset = Number(url.searchParams.get("after") ?? 0) || 0;
      const all = associationsFor(from, m[2], to);
      const res = { results: all.slice(offset, offset + limit) };
      if (offset + limit < all.length) res.paging = { next: { after: String(offset + limit), link: "?after=" + (offset + limit) } };
      return hsJson(200, res);
    }
    return hsError2(404, `Unknown fake endpoint ${method} ${path2}`, "OBJECT_NOT_FOUND");
  }
  async function handle(request) {
    const url = new URL(request.url);
    const path2 = url.pathname;
    const log = { method: request.method, path: path2, search: url.search };
    requests.push(log);
    if (requests.length > 2e3) requests.splice(0, requests.length - 2e3);
    const key = `${request.method} ${path2}`;
    const ruleIndex = failures.findIndex((r) => r.match === void 0 || (typeof r.match === "string" ? key.includes(r.match) : r.match.test(key)));
    if (ruleIndex >= 0) {
      const rule = failures[ruleIndex];
      rule.remaining -= 1;
      if (rule.remaining <= 0) failures.splice(ruleIndex, 1);
      const body = rule.body ?? { status: "error", message: `Injected failure ${rule.status}`, correlationId: uuid(), category: rule.status === 429 ? "RATE_LIMITS" : "INJECTED" };
      return hsJson(rule.status, body, rule.headers ?? {});
    }
    if (FAKE_PROJECT_PATH_PREFIXES.some((p) => path2.startsWith(p))) return handleFakeProjects(request, projects);
    if (request.method === "GET" && path2 === "/oauth/authorize") return authorizePage(url);
    if (request.method === "GET" && path2 === "/oauth/authorize/decision") return decide(url, url.searchParams.get("decision") ?? "deny");
    if (request.method === "POST" && path2 === "/oauth/v1/token") return token(request);
    let m;
    if (request.method === "GET" && (m = /^\/oauth\/v1\/access-tokens\/([^/]+)$/.exec(path2))) return tokenInfo(decodeURIComponent(m[1]));
    if (request.method === "GET" && (m = /^\/oauth\/v1\/refresh-tokens\/([^/]+)$/.exec(path2))) return refreshTokenInfo(decodeURIComponent(m[1]));
    if (request.method === "DELETE" && (m = /^\/oauth\/v1\/refresh-tokens\/([^/]+)$/.exec(path2))) return revoke(decodeURIComponent(m[1]));
    if (path2.startsWith("/crm/")) {
      const at = authenticate(request, log);
      if (at instanceof Response) return at;
      return crm(request, url, at);
    }
    return hsError2(404, `Unknown fake endpoint ${request.method} ${path2}`, "OBJECT_NOT_FOUND");
  }
  const fakeFetch = async (input, init) => {
    const request = input instanceof Request && init === void 0 ? input : new Request(input, init);
    return handle(request);
  };
  return {
    portalId,
    seed,
    projects,
    requests,
    handle,
    fetch: fakeFetch,
    droppedScopes: dropped,
    issueTokens(o = {}) {
      const all = [...o.scopes ?? ["oauth", "crm.objects.contacts.read", "crm.objects.companies.read", "crm.objects.deals.read", "crm.schemas.contacts.read", "crm.schemas.companies.read", "crm.schemas.deals.read", "tickets", "crm.objects.custom.read", "crm.schemas.custom.read", "crm.objects.owners.read", "crm.objects.line_items.read", "crm.objects.products.read", "crm.objects.quotes.read"]];
      const grant = newGrant(opts2.clientId, all);
      const at = newAccessToken(grant, o.expiresInSeconds ?? ttl);
      return { accessToken: at.token, refreshToken: grant.refreshToken, expiresIn: o.expiresInSeconds ?? ttl };
    },
    expireAccessTokens() {
      const t = now();
      for (const at of accessTokens.values()) at.expiresAt = Math.min(at.expiresAt, t - 1e3);
    },
    revokeRefreshTokens() {
      for (const g of grants.values()) g.revoked = true;
    },
    dropScopes(...scopes) {
      for (const s of scopes) dropped.add(s);
    },
    restoreScopes() {
      dropped.clear();
    },
    failNext(rule) {
      failures.push({ ...rule, remaining: rule.times ?? 1 });
    }
  };
}

// server/node.ts
import { createServer } from "node:http";
import { createReadStream, existsSync, promises as fsp, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import zlib from "node:zlib";

// server/hosting.ts
var HUBSPOT_SETTING_NAMES = ["APP_URL", "HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET", "SESSION_SECRET"];
var PLACEHOLDER = /^(later|todo|tbd|tbc|none|null|undefined|nil|skip|empty|blank|placeholder|pending|change[-_ ]?me|replace[-_ ]?me|fill[-_ ]?me|x+|-+|\.+|\?+|n\/?a|<[^>]*>|\{\{[^}]*\}\}|your[-_ ][a-z0-9 _-]*)$/i;
function isPlaceholder(value) {
  if (value === void 0 || value === null) return true;
  const v = value.trim();
  return v === "" || PLACEHOLDER.test(v) || /your[-_]?domain/i.test(v);
}
function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}
function normalizeHostingEnv(env) {
  const out = { ...env };
  const notes = [];
  for (const name of HUBSPOT_SETTING_NAMES) {
    const raw = out[name];
    if (raw === void 0) continue;
    if (isPlaceholder(raw)) {
      if (raw.trim() !== "") notes.push(`${name} looks like a placeholder, so it is treated as not set yet.`);
      delete out[name];
      continue;
    }
    out[name] = name === "SESSION_SECRET" ? raw : raw.trim();
  }
  const appUrl = out.APP_URL;
  if (appUrl !== void 0) {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(appUrl);
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(appUrl) ? appUrl : `${local ? "http" : "https"}://${appUrl}`;
    if (isHttpUrl(withScheme)) {
      out.APP_URL = withScheme.replace(/\/+$/, "");
    } else {
      notes.push("APP_URL is not a web address (it should look like https://builder.example.com), so it is ignored.");
      delete out.APP_URL;
    }
  }
  return { env: out, notes };
}
var HEALTH_PATH = "/api/health";
var CSRF_HEADER = "X-UIEX-Request";
function allowPlainHealthCheck(request) {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return request;
  let pathname;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return request;
  }
  if (pathname !== HEALTH_PATH && pathname !== `${HEALTH_PATH}/`) return request;
  if (request.headers.has(CSRF_HEADER) || request.headers.has("origin")) return request;
  const headers = new Headers(request.headers);
  headers.set(CSRF_HEADER, "health-check");
  return new Request(request.url, { method, headers, signal: request.signal });
}

// server/node.ts
var DEFAULT_BODY_LIMIT = 5 * 1024 * 1024;
var DEFAULT_PORT = 3e3;
var CALLBACK_PATH = "/api/auth/callback";
var HEALTH_PATH2 = "/api/health";
var HOP_BY_HOP = /* @__PURE__ */ new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "http2-settings"
]);
var BodyTooLargeError = class extends Error {
  constructor(limit) {
    super(`The request body is larger than ${limit} bytes.`);
    this.limit = limit;
    this.name = "BodyTooLargeError";
  }
  limit;
};
function requestTarget(rawUrl) {
  const raw = rawUrl ?? "/";
  if (raw.startsWith("/")) return raw;
  try {
    const u = new URL(raw);
    return `${u.pathname}${u.search}`;
  } catch {
    return "/";
  }
}
function requestPathname(rawUrl) {
  const target = requestTarget(rawUrl);
  const q = target.search(/[?#]/);
  return q === -1 ? target : target.slice(0, q);
}
function readNodeBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      reject(new BodyTooLargeError(limit));
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve(Buffer.concat(chunks, size));
    };
    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        finish(new BodyTooLargeError(limit));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish(null));
    req.on("error", (err) => finish(err));
    req.on("close", () => finish(new Error("The client closed the connection before the request body was received.")));
  });
}
async function toWebRequest(req, opts2) {
  const method = (req.method ?? "GET").toUpperCase();
  const origin = new URL(opts2.origin).origin;
  const url = `${origin}${requestTarget(req.url)}`;
  const headers = new Headers();
  const raw = req.rawHeaders;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i];
    const lower = name.toLowerCase();
    if (lower.startsWith(":") || lower === "cookie" || HOP_BY_HOP.has(lower)) continue;
    try {
      headers.append(name, raw[i + 1]);
    } catch {
    }
  }
  const cookie = req.headers.cookie;
  if (cookie) headers.set("cookie", Array.isArray(cookie) ? cookie.join("; ") : cookie);
  const init = { method, headers };
  if (opts2.signal) init.signal = opts2.signal;
  if (method !== "GET" && method !== "HEAD") {
    const body = await readNodeBody(req, opts2.bodyLimit ?? DEFAULT_BODY_LIMIT);
    if (body.length > 0) init.body = new Uint8Array(body);
  }
  return new Request(url, init);
}
var PRINTABLE_STATUS_TEXT = /^[\t\x20-\x7e]*$/;
async function writeWebResponse(res, response, opts2 = {}) {
  res.statusCode = response.status;
  if (response.statusText && PRINTABLE_STATUS_TEXT.test(response.statusText)) res.statusMessage = response.statusText;
  response.headers.forEach((value, name) => {
    if (name === "set-cookie" || HOP_BY_HOP.has(name)) return;
    res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader("set-cookie", cookies);
  for (const [name, value] of Object.entries(opts2.defaults ?? {})) {
    if (!res.hasHeader(name)) res.setHeader(name, value);
  }
  const noBody = opts2.head || response.status === 204 || response.status === 304 || response.status < 200;
  if (!response.body || noBody) {
    if (response.body) await response.body.cancel().catch(() => {
    });
    res.end();
    return;
  }
  const reader = response.body.getReader();
  let closed = false;
  const onClose = () => {
    closed = true;
    reader.cancel().catch(() => {
    });
  };
  res.on("close", onClose);
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done || closed) break;
      if (!res.write(value)) await drainOrClose(res);
    }
    if (!closed) res.end();
  } catch (err) {
    if (!res.destroyed) res.destroy(err instanceof Error ? err : new Error(String(err)));
  } finally {
    res.off("close", onClose);
  }
}
function drainOrClose(res) {
  return new Promise((resolve) => {
    const done = () => {
      res.off("drain", done);
      res.off("close", done);
      resolve();
    };
    res.on("drain", done);
    res.on("close", done);
  });
}
var CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
  ".zip": "application/zip"
};
function contentTypeFor(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}
function isCompressible(contentType) {
  return /^(text\/|application\/(json|javascript|manifest\+json|xml|wasm)|image\/svg\+xml)/.test(contentType);
}
function staticSecurityHeaders(hsts) {
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Resource-Policy": "same-origin"
  };
  if (hsts) headers["Strict-Transport-Security"] = "max-age=15552000";
  return headers;
}
function resolveStaticPath(root, rawUrl) {
  const encoded = requestPathname(rawUrl);
  let pathname;
  try {
    pathname = decodeURIComponent(encoded);
  } catch {
    return { kind: "bad-request" };
  }
  if (pathname.includes("\0")) return { kind: "bad-request" };
  if (pathname.includes("\\")) return { kind: "forbidden" };
  const segments = pathname.split("/");
  for (const seg of segments) {
    if (seg === "..") return { kind: "forbidden" };
    if (seg.startsWith(".") && seg !== ".well-known" && seg !== ".") return { kind: "forbidden" };
  }
  const base = path.resolve(root);
  const file = path.resolve(base, `.${path.posix.normalize(`/${pathname}`)}`);
  if (file !== base && !file.startsWith(base + path.sep)) return { kind: "forbidden" };
  return { kind: "ok", file, pathname };
}
function wantsSpaFallback(pathname) {
  if (pathname === "/api" || pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/assets/")) return false;
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  const ext = path.extname(last).toLowerCase();
  return ext === "" || ext === ".html";
}
function cacheControlFor(pathname, file) {
  if (file.endsWith(".html")) return "no-cache";
  if (pathname.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}
function pickEncoding(acceptEncoding) {
  const header = Array.isArray(acceptEncoding) ? acceptEncoding.join(",") : acceptEncoding ?? "";
  const accepted = /* @__PURE__ */ new Map();
  for (const part of header.split(",")) {
    const [rawName, ...params] = part.trim().split(";");
    const name = rawName.trim().toLowerCase();
    if (!name) continue;
    let q = 1;
    for (const p of params) {
      const m = /^\s*q=([0-9.]+)\s*$/i.exec(p);
      if (m) q = Number(m[1]);
    }
    accepted.set(name, Number.isFinite(q) ? q : 0);
  }
  const ok = (name) => (accepted.get(name) ?? accepted.get("*") ?? 0) > 0;
  if (ok("br")) return "br";
  if (ok("gzip")) return "gzip";
  return null;
}
var brotli = promisify(zlib.brotliCompress);
var gzip = promisify(zlib.gzip);
var MAX_COMPRESS_IN_MEMORY = 16 * 1024 * 1024;
var MIN_COMPRESS_SIZE = 1024;
var CompressionCache = class {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
  }
  maxBytes;
  entries = /* @__PURE__ */ new Map();
  bytes = 0;
  pending = /* @__PURE__ */ new Map();
  async get(file, stat, encoding) {
    const key = `${file}\0${stat.size}\0${stat.mtimeMs}\0${encoding}`;
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const work = (async () => {
      const data = await fsp.readFile(file);
      const out = encoding === "br" ? await brotli(data, {
        params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length }
      }) : await gzip(data, { level: 6 });
      this.store(key, out);
      return out;
    })();
    this.pending.set(key, work);
    try {
      return await work;
    } finally {
      this.pending.delete(key);
    }
  }
  store(key, value) {
    if (value.length > this.maxBytes) return;
    this.entries.set(key, value);
    this.bytes += value.length;
    for (const [k, v] of this.entries) {
      if (this.bytes <= this.maxBytes) break;
      this.entries.delete(k);
      this.bytes -= v.length;
    }
  }
};
function etagFor(stat, encoding) {
  return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}${encoding ? `-${encoding}` : ""}"`;
}
function etagMatches(header, etag) {
  if (!header) return false;
  const bare = etag.replace(/^W\//, "");
  return header.split(",").some((t) => {
    const v = t.trim();
    return v === "*" || v.replace(/^W\//, "") === bare;
  });
}
async function statOrNull(file) {
  try {
    return await fsp.stat(file);
  } catch {
    return null;
  }
}
function createStaticHandler(opts2) {
  const root = path.resolve(opts2.root);
  let realRoot = root;
  try {
    realRoot = realpathSync(root);
  } catch {
  }
  const compress = opts2.compress !== false;
  const cache = new CompressionCache(opts2.cacheBytes ?? 64 * 1024 * 1024);
  const security = staticSecurityHeaders(!!opts2.hsts);
  async function insideRoot(file) {
    try {
      const real = await fsp.realpath(file);
      return real === realRoot || real.startsWith(realRoot + path.sep);
    } catch {
      return false;
    }
  }
  const sendPlain = (res, status, text, extra = {}) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
    res.end(text);
  };
  const handler = async (req, res) => {
    for (const [k, v] of Object.entries(security)) res.setHeader(k, v);
    const method = (req.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      sendPlain(res, 405, "Method not allowed.", { Allow: "GET, HEAD" });
      return;
    }
    const resolved = resolveStaticPath(root, req.url);
    if (resolved.kind === "bad-request") return sendPlain(res, 400, "Bad request.");
    if (resolved.kind === "forbidden") return sendPlain(res, 404, "Not found.");
    let file = resolved.file;
    let stat = await statOrNull(file);
    if (stat?.isDirectory()) {
      file = path.join(file, "index.html");
      stat = await statOrNull(file);
    }
    if (stat && stat.isFile() && !await insideRoot(file)) stat = null;
    if (!stat || !stat.isFile()) {
      if (!wantsSpaFallback(resolved.pathname)) return sendPlain(res, 404, "Not found.");
      file = path.join(root, "index.html");
      stat = await statOrNull(file);
      if (!stat || !stat.isFile()) {
        return sendPlain(res, 503, 'The builder has not been built yet. Run "npm run build" and restart the server.');
      }
    }
    const type = contentTypeFor(file);
    const compressible = compress && isCompressible(type) && stat.size >= MIN_COMPRESS_SIZE;
    const encoding = compressible && stat.size <= MAX_COMPRESS_IN_MEMORY ? pickEncoding(req.headers["accept-encoding"]) : null;
    const etag = etagFor(stat, encoding);
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", cacheControlFor(resolved.pathname, file));
    res.setHeader("ETag", etag);
    res.setHeader("Last-Modified", stat.mtime.toUTCString());
    if (compressible) res.setHeader("Vary", "Accept-Encoding");
    if (etagMatches(req.headers["if-none-match"], etag)) {
      res.statusCode = 304;
      res.end();
      return;
    }
    if (encoding) {
      let body;
      try {
        body = await cache.get(file, stat, encoding);
      } catch {
        return sendPlain(res, 500, "Could not read the file.");
      }
      res.statusCode = 200;
      res.setHeader("Content-Encoding", encoding);
      res.setHeader("Content-Length", String(body.length));
      res.end(method === "HEAD" ? void 0 : body);
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Length", String(stat.size));
    if (method === "HEAD") {
      res.end();
      return;
    }
    await new Promise((resolve) => {
      const stream = createReadStream(file);
      stream.on("error", () => {
        if (!res.headersSent) sendPlain(res, 500, "Could not read the file.");
        else res.destroy();
        resolve();
      });
      res.on("close", () => {
        stream.destroy();
        resolve();
      });
      stream.pipe(res);
      stream.on("end", resolve);
    });
  };
  const warm = async () => {
    if (!compress) return;
    const dir = path.join(root, "assets");
    let names = [];
    try {
      names = await fsp.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const file = path.join(dir, name);
      const stat = await statOrNull(file);
      if (!stat?.isFile() || stat.size < MIN_COMPRESS_SIZE || stat.size > MAX_COMPRESS_IN_MEMORY) continue;
      if (!isCompressible(contentTypeFor(file))) continue;
      await cache.get(file, stat, "br").catch(() => {
      });
      await cache.get(file, stat, "gzip").catch(() => {
      });
    }
  };
  return Object.assign(handler, { warm });
}
function errorResponse(status, code, message, headers = {}) {
  return new Response(JSON.stringify({ error: { code, message, status } }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}
var API_DEFAULT_HEADERS = { "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" };
function firstHeader(value) {
  const v = Array.isArray(value) ? value[0] : value;
  return v?.split(",")[0]?.trim() || void 0;
}
function describeClient(req, trustProxy) {
  const ip = trustProxy && firstHeader(req.headers["x-forwarded-for"]) || req.socket.remoteAddress || "-";
  if (!trustProxy) return ip;
  const proto = firstHeader(req.headers["x-forwarded-proto"]);
  const host = firstHeader(req.headers["x-forwarded-host"]);
  return proto || host ? `${ip} via ${proto ?? "http"}://${host ?? req.headers.host ?? "?"}` : ip;
}
function createRequestListener(opts2) {
  const statics = opts2.staticHandler ?? (opts2.staticRoot ? createStaticHandler({ root: opts2.staticRoot, hsts: opts2.hsts }) : null);
  const bodyLimit = opts2.bodyLimit ?? DEFAULT_BODY_LIMIT;
  const log = opts2.log;
  async function handleApi(req, res, pathname, started) {
    const method = (req.method ?? "GET").toUpperCase();
    let response = null;
    if (!opts2.connector) {
      response = errorResponse(503, "connector_unavailable", "The HubSpot connector is not running on this server.");
    } else {
      const abort = new AbortController();
      res.on("close", () => {
        if (!res.writableFinished) abort.abort();
      });
      let request = null;
      try {
        request = await toWebRequest(req, { origin: opts2.origin, bodyLimit, signal: abort.signal });
      } catch (err) {
        if (err instanceof BodyTooLargeError) {
          response = errorResponse(
            413,
            "payload_too_large",
            `This upload is too big (the limit is ${Math.round(bodyLimit / (1024 * 1024))} MB). Remove large files and try again.`,
            { Connection: "close" }
          );
        } else {
          if (abort.signal.aborted || res.destroyed) return;
          response = errorResponse(400, "bad_request", "The request could not be read.");
        }
      }
      if (request) {
        try {
          response = await opts2.connector.handle(request);
        } catch (err) {
          log?.(`[api] ${method} ${pathname} failed: ${err instanceof Error ? err.message : String(err)}`);
          response = errorResponse(500, "internal_error", "Something went wrong on the connector server. Please try again.");
        }
        if (!response) response = errorResponse(404, "not_found", "There is no connector endpoint at this address.");
      }
    }
    if (!response) return;
    await writeWebResponse(res, response, { head: method === "HEAD", defaults: API_DEFAULT_HEADERS });
    if (opts2.accessLog !== false) log?.(`[api] ${method} ${pathname} ${response.status} ${Math.round(performance.now() - started)}ms ${describeClient(req, !!opts2.trustProxy)}`);
  }
  return (req, res) => {
    const started = performance.now();
    const pathname = requestPathname(req.url);
    const isApi = pathname === "/api" || pathname.startsWith("/api/");
    const work = isApi ? handleApi(req, res, pathname, started) : statics ? statics(req, res) : Promise.resolve().then(() => {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(opts2.apiOnlyHint ?? "This server only answers /api requests (HubSpot connector).");
    });
    work.catch((err) => {
      log?.(`[server] ${req.method ?? "GET"} ${pathname} failed: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Internal server error.");
      } else if (!res.writableEnded) {
        res.destroy();
      }
    });
  };
}
function parseArgs(argv) {
  const out = { apiOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, void 0];
    const value = () => inline ?? argv[++i];
    if (flag === "--api-only") out.apiOnly = true;
    else if (flag === "--port") out.port = Number(value());
    else if (flag === "--host") out.host = value();
    else if (flag === "--static" || flag === "--dist") out.staticDir = value();
  }
  return out;
}
function truthy(v) {
  return !!v && /^(1|true|yes|on)$/i.test(v.trim());
}
function detectAppUrl(env, port) {
  const clean = (u) => u.trim().replace(/\/+$/, "");
  if (env.APP_URL?.trim()) return { url: clean(env.APP_URL), source: "APP_URL" };
  if (env.RENDER_EXTERNAL_URL?.trim()) return { url: clean(env.RENDER_EXTERNAL_URL), source: "detected on Render" };
  if (env.RAILWAY_PUBLIC_DOMAIN?.trim()) return { url: `https://${clean(env.RAILWAY_PUBLIC_DOMAIN)}`, source: "detected on Railway" };
  if (env.FLY_APP_NAME?.trim()) return { url: `https://${env.FLY_APP_NAME.trim()}.fly.dev`, source: "detected on Fly.io" };
  if (env.VERCEL_PROJECT_PRODUCTION_URL?.trim()) {
    return { url: `https://${clean(env.VERCEL_PROJECT_PRODUCTION_URL)}`, source: "detected on Vercel" };
  }
  if ((env.NODE_ENV ?? "").trim() === "production") return { url: null, source: "APP_URL is not set" };
  return { url: `http://localhost:${port}`, source: "local default - APP_URL is not set" };
}
function missingOAuthSettings(config) {
  const missing = [];
  if (!config.appUrl) missing.push("APP_URL");
  if (!config.hubspotClientId) missing.push("HUBSPOT_CLIENT_ID");
  if (!config.hubspotClientSecret) missing.push("HUBSPOT_CLIENT_SECRET");
  if (!config.sessionSecret) missing.push("SESSION_SECRET");
  else if (config.sessionSecret.length < 32) missing.push("SESSION_SECRET (must be at least 32 characters)");
  return missing;
}
function describeStartup(config, info) {
  const missing = missingOAuthSettings(config);
  const configured = info.oauthConfigured ?? missing.length === 0;
  const lines = [
    `UI Extension Builder is running (connector ${config.version || "dev"}).`,
    `  Listening on:     ${info.listenUrl}`,
    config.appUrl ? `  Public address:   ${config.appUrl}   (${info.appUrlSource})` : "  Public address:   NOT SET - set APP_URL to the address people open, e.g. https://builder.example.com",
    info.staticRoot ? `  Builder files:    ${info.staticFound ? info.staticRoot : `${info.staticRoot} (NOT FOUND - run "npm run build")`}` : "  Builder files:    not served (API-only mode)"
  ];
  if (configured) {
    lines.push(`  HubSpot sign-in:  ready (client id ${config.hubspotClientId})`);
  } else {
    lines.push(`  HubSpot sign-in:  NOT CONFIGURED${missing.length ? ` - missing ${missing.join(", ")}` : ""}.`);
    lines.push('                    The builder still works; "Connect HubSpot" stays unavailable until these are set.');
  }
  if (config.appUrl) {
    lines.push(`  Redirect URL:     ${config.appUrl}${CALLBACK_PATH}`);
    lines.push("                    (add exactly this address to your HubSpot app's redirect URLs)");
  }
  lines.push(`  Required scopes:  ${config.requiredScopes.join(" ") || "(none)"}`);
  lines.push(`  Optional scopes:  ${config.optionalScopes.join(" ") || "(none)"}`);
  lines.push(`  HubSpot hosts:    ${config.hubspotApiBase} | ${config.hubspotAppBase}`);
  lines.push(
    `  Features:         live CRM data on | fetch proxy ${config.enableFetchProxy ? "on" : "off"} | deploy to HubSpot (beta) ${config.enableDeploy ? "on" : "off"}`
  );
  if (config.allowedOrigins.length > 0) lines.push(`  Extra origins:    ${config.allowedOrigins.join(", ")}`);
  lines.push(`  Health check:     ${config.appUrl || info.listenUrl}${HEALTH_PATH2}`);
  return lines;
}
function findStaticRoot(explicit) {
  if (explicit) return path.resolve(explicit);
  const fromCwd = path.resolve(process.cwd(), "dist");
  if (existsSync(path.join(fromCwd, "index.html"))) return fromCwd;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const sibling = path.resolve(here, "..", "dist");
    if (existsSync(path.join(sibling, "index.html"))) return sibling;
  } catch {
  }
  return fromCwd;
}
async function probeHealth(connector, origin) {
  try {
    const res = await connector.handle(new Request(`${origin}${HEALTH_PATH2}`, { headers: { accept: "application/json" } }));
    if (!res || !res.ok) return void 0;
    const body = await res.json();
    return typeof body.oauthConfigured === "boolean" ? body.oauthConfigured : void 0;
  } catch {
    return void 0;
  }
}
function tuneServer(server) {
  server.keepAliveTimeout = 65e3;
  server.headersTimeout = 66e3;
  server.requestTimeout = 12e4;
  return server;
}
async function startServer(opts2 = {}) {
  const { env, notes } = normalizeHostingEnv(opts2.env ?? process.env);
  const args = parseArgs(opts2.argv ?? process.argv.slice(2));
  const log = opts2.log ?? ((line) => console.log(line));
  const port = args.port !== void 0 && Number.isFinite(args.port) ? args.port : Number(env.PORT || DEFAULT_PORT);
  const host = args.host ?? (env.HOST?.trim() || void 0);
  const apiOnly = args.apiOnly || truthy(env.API_ONLY);
  const { configFromEnv, createConnector } = await import("./core/index");
  const server = tuneServer(createServer());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const listenHost = !host || host === "0.0.0.0" || host === "::" ? "localhost" : host.includes(":") ? `[${host}]` : host;
  const url = `http://${listenHost}:${actualPort}`;
  const detected = detectAppUrl(env, actualPort);
  const overrides = { ...opts2.overrides ?? {} };
  if (!env.APP_URL?.trim() && overrides.appUrl === void 0 && detected.url) overrides.appUrl = detected.url;
  const config = configFromEnv(env, overrides);
  const core = createConnector(config);
  const connector = { handle: (request) => core.handle(allowPlainHealthCheck(request)) };
  const staticRoot = apiOnly ? null : findStaticRoot(args.staticDir ?? env.STATIC_DIR);
  const staticFound = !!staticRoot && existsSync(path.join(staticRoot, "index.html"));
  const accessLog = env.LOG_REQUESTS === void 0 || env.LOG_REQUESTS.trim() === "" || truthy(env.LOG_REQUESTS);
  const hsts = config.appUrl.startsWith("https://");
  const staticHandler = staticRoot ? createStaticHandler({ root: staticRoot, hsts }) : null;
  const origin = config.appUrl || `http://localhost:${actualPort}`;
  server.on(
    "request",
    createRequestListener({
      connector,
      staticRoot,
      staticHandler,
      origin,
      hsts,
      log,
      accessLog,
      trustProxy: env.TRUST_PROXY === void 0 ? true : truthy(env.TRUST_PROXY),
      apiOnlyHint: `This is the HubSpot connector API for UI Extension Builder. Open the builder at ${config.appUrl || "its public address"}.`
    })
  );
  const oauthConfigured = await probeHealth(connector, origin);
  const appUrlSource = env.APP_URL?.trim() ? "APP_URL" : overrides.appUrl && overrides.appUrl === detected.url ? detected.source : "configured";
  for (const line of describeStartup(config, { listenUrl: url, appUrlSource, staticRoot, staticFound, oauthConfigured })) log(line);
  for (const note of notes) log(`  Note:             ${note}`);
  if (staticHandler && staticFound) void staticHandler.warm();
  const close = () => new Promise((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
  });
  if (opts2.handleSignals !== false) installShutdown(server, log);
  return { server, config, url, close };
}
function installShutdown(server, log) {
  let stopping = false;
  const stop = (signal) => {
    if (stopping) {
      log(`${signal} received again - exiting now.`);
      process.exit(1);
    }
    stopping = true;
    log(`${signal} received - finishing open requests, then stopping.`);
    server.close(() => {
      log("Server stopped.");
      process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => {
      server.closeAllConnections();
      process.exit(0);
    }, 1e4).unref();
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}
function runCli() {
  startServer().catch((err) => {
    console.error(`Could not start UI Extension Builder: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
function isDirectRun() {
  if (true) return false;
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}
if (isDirectRun()) runCli();

// server/fake-hubspot/server.ts
var FAKE_HUBSPOT_DEFAULT_PORT = 4010;
var DEMO_CLIENT_ID = "uiex-demo-client-id";
var DEMO_CLIENT_SECRET = "uiex-demo-client-secret";
var DEMO_PORTAL_ID = 12345678;
var HOST_RE = /^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/;
async function startFakeHubSpotServer(opts2 = {}) {
  const clientId = opts2.clientId ?? DEMO_CLIENT_ID;
  const clientSecret = opts2.clientSecret ?? DEMO_CLIENT_SECRET;
  const fake = createFakeHubSpot({ clientId, clientSecret, portalId: opts2.portalId ?? DEMO_PORTAL_ID, autoApprove: opts2.autoApprove });
  const host = opts2.host ?? "127.0.0.1";
  const log = opts2.log;
  let selfOrigin = `http://${host}`;
  const server = tuneServer(
    createServer2((req, res) => {
      const hostHeader = req.headers.host;
      const origin = hostHeader && HOST_RE.test(hostHeader) ? `http://${hostHeader}` : selfOrigin;
      (async () => {
        let request;
        try {
          request = await toWebRequest(req, { origin, bodyLimit: 50 * 1024 * 1024 });
        } catch (err) {
          const status = err instanceof BodyTooLargeError ? 413 : 400;
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "error", message: status === 413 ? "Body too large" : "Bad request", category: "VALIDATION_ERROR" }));
          return;
        }
        const response = await fake.handle(request);
        const logged = new URL(request.url).pathname.replace(/(\/(?:access|refresh)-tokens\/)[^/]+/, "$1[redacted]");
        log?.(`[fake-hubspot] ${req.method} ${logged} ${response.status}`);
        await writeWebResponse(res, response, { head: req.method === "HEAD" });
      })().catch((err) => {
        log?.(`[fake-hubspot] ${req.method} ${req.url?.split("?")[0]} crashed: ${err instanceof Error ? err.message : String(err)}`);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ status: "error", message: "Fake HubSpot crashed", category: "INTERNAL_ERROR" }));
        } else {
          res.destroy();
        }
      });
    })
  );
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts2.port ?? FAKE_HUBSPOT_DEFAULT_PORT, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : opts2.port ?? FAKE_HUBSPOT_DEFAULT_PORT;
  const urlHost = host.includes(":") ? `[${host}]` : host;
  selfOrigin = `http://${urlHost}:${port}`;
  return {
    server,
    fake,
    url: selfOrigin,
    port,
    clientId,
    clientSecret,
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    })
  };
}
function runFakeHubSpotCli(env = process.env) {
  const port = Number(env.FAKE_HUBSPOT_PORT || FAKE_HUBSPOT_DEFAULT_PORT);
  startFakeHubSpotServer({
    port,
    host: env.FAKE_HUBSPOT_HOST || "127.0.0.1",
    clientId: env.FAKE_HUBSPOT_CLIENT_ID || DEMO_CLIENT_ID,
    clientSecret: env.FAKE_HUBSPOT_CLIENT_SECRET || DEMO_CLIENT_SECRET,
    portalId: env.FAKE_HUBSPOT_PORTAL_ID ? Number(env.FAKE_HUBSPOT_PORTAL_ID) : DEMO_PORTAL_ID,
    autoApprove: /^(1|true|yes)$/i.test(env.FAKE_HUBSPOT_AUTO_APPROVE ?? ""),
    log: env.FAKE_HUBSPOT_QUIET ? void 0 : (line) => console.log(line)
  }).then((running) => {
    console.log(`Fake HubSpot is running at ${running.url} (demo portal ${env.FAKE_HUBSPOT_PORTAL_ID || DEMO_PORTAL_ID}).`);
    console.log(`  Use HUBSPOT_API_BASE=${running.url} HUBSPOT_APP_BASE=${running.url}`);
    console.log(`  HUBSPOT_CLIENT_ID=${running.clientId} HUBSPOT_CLIENT_SECRET=<demo secret>`);
    console.log(`  Demo personal access key for "Deploy to HubSpot": ${FAKE_PERSONAL_ACCESS_KEY}`);
    const stop = () => {
      void running.close().then(() => process.exit(0));
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  }).catch((err) => {
    console.error(`Could not start the fake HubSpot server: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
function isDirectRun2() {
  if (true) return false;
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL2(realpathSync2(entry)).href;
  } catch {
    return false;
  }
}
if (isDirectRun2()) runFakeHubSpotCli();

// fake-hubspot-entry.ts
runFakeHubSpotCli();
//# sourceMappingURL=fake-hubspot.mjs.map
