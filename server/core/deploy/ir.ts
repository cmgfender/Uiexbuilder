/**
 * Project → intermediate representation (IR), re-implemented from @hubspot/project-parsing-lib
 * 0.23.x (src/lib/translate.js, files.js, transform.js, validation.js, constants.js,
 * platformVersion.js). For platform versions ≥ 2025.2, `hs project upload` sends this IR next to
 * the source zip (POST project-components-external/v3/upload/new-api); HubSpot builds from it.
 *
 * Faithful parts: locating *-hsmeta.json files (only in component / sub-component folders, the
 * rest are "skipped"), the top-level field check, componentType mapping, componentDeps (app,
 * allAppObjects, serverlessPackage), the auto-generated serverless package component, metaFilePath,
 * empty `files`, permissions pass-through, duplicate uid detection and profileData without a
 * profile. Validation re-implements the library's structural checks (uid, config, type known to
 * the fetched schemas, folder per type, single-instance components, permissions version gate);
 * the per-type JSON-schema (ajv) check of `config` is left to HubSpot's build, which reports the
 * same errors in the build log.
 */
import type { DeployFile } from './paths';

// ---------------------------------------------------------------- platform versions

const DATED = /^(\d{4})\.(\d{1,2})(-beta)?$/;

/** Known versions of project-parsing-lib (supported + deprecated). */
export const KNOWN_PLATFORM_VERSIONS = [
  '2023.2',
  '2025.1',
  '2025.2',
  '2026.03-beta',
  '2026.03',
  '2026.09-beta',
  '2026.09',
  '2027.03-beta',
  '2027.03',
  'unstable',
] as const;

type ParsedVersion = { type: 'unstable' } | { type: 'dated'; year: number; month: number; beta: boolean } | { type: 'unknown' };

function parseVersion(v: string): ParsedVersion {
  if (v === 'unstable') return { type: 'unstable' };
  const m = DATED.exec(v);
  if (!m) return { type: 'unknown' };
  return { type: 'dated', year: Number(m[1]), month: Number(m[2]), beta: !!m[3] };
}

/** True if platformVersion ≥ minimum (unknown formats count as newer, like the library). */
export function meetsMinimumPlatformVersion(platformVersion: string, minimum: string): boolean {
  const min = parseVersion(minimum);
  if (min.type !== 'dated') throw new Error('minimum must be a dated version');
  const v = parseVersion(platformVersion);
  if (v.type === 'unknown' || v.type === 'unstable') return true;
  if (v.year !== min.year) return v.year > min.year;
  if (v.month !== min.month) return v.month > min.month;
  if (v.beta === min.beta) return true;
  return !v.beta;
}

/** 2023.2 / 2025.1 projects predate components (*-hsmeta.json) and upload without an IR. */
export function isLegacyPlatformVersion(platformVersion: string): boolean {
  return !meetsMinimumPlatformVersion(platformVersion, '2025.2');
}

export function isKnownPlatformVersion(platformVersion: string): boolean {
  return (KNOWN_PLATFORM_VERSIONS as readonly string[]).includes(platformVersion);
}

// ---------------------------------------------------------------- component catalogue

interface ComponentInfo {
  dir: string;
  parent?: 'app';
  name: string;
  plural: string;
  singular?: boolean;
}

const SUB = 'features';
const TOP = 'components';

/** project-parsing-lib `Components` (user-facing type → folder and labels). */
export const COMPONENTS: Record<string, ComponentInfo> = {
  app: { dir: 'app', name: 'App', plural: TOP, singular: true },
  'api-client': { dir: 'api-client', parent: 'app', name: 'API Client', plural: SUB, singular: true },
  'app-object': { dir: 'app-objects', parent: 'app', name: 'App Object', plural: SUB },
  'app-object-association': { dir: 'app-object-associations', parent: 'app', name: 'App Object Association', plural: SUB },
  page: { dir: 'pages', parent: 'app', name: 'Page', plural: SUB, singular: true },
  pages: { dir: 'pages', parent: 'app', name: 'Page', plural: SUB, singular: true },
  theme: { dir: 'theme', name: 'Theme', plural: TOP },
  'cms-assets': { dir: 'cms-assets', name: 'CMS Asset', plural: TOP },
  calling: { dir: 'calling', parent: 'app', name: 'Calling', plural: SUB, singular: true },
  card: { dir: 'cards', parent: 'app', name: 'Card', plural: SUB },
  'app-function': { dir: 'functions', parent: 'app', name: 'App Function', plural: SUB },
  scim: { dir: 'scim', parent: 'app', name: 'SCIM', plural: SUB, singular: true },
  settings: { dir: 'settings', parent: 'app', name: 'Settings Extension', plural: SUB, singular: true },
  'marketing-event': { dir: 'marketing-events', parent: 'app', name: 'Marketing Event', plural: SUB },
  'media-bridge': { dir: 'media-bridge', parent: 'app', name: 'Media Bridge', plural: SUB },
  'app-event': { dir: 'app-events', parent: 'app', name: 'App Event', plural: SUB },
  'video-conferencing': { dir: 'video-conferencing', parent: 'app', name: 'Video Conferencing', plural: SUB },
  webhooks: { dir: 'webhooks', parent: 'app', name: 'Webhooks', plural: SUB, singular: true },
  'webhooks-journal': { dir: 'webhooks-journal', parent: 'app', name: 'Webhooks Journal', plural: SUB, singular: true },
  'workflow-action': { dir: 'workflow-actions', parent: 'app', name: 'Workflow Action', plural: SUB },
  'crm-bulk-action': { dir: 'actions', parent: 'app', name: 'Action', plural: SUB },
  telemetry: { dir: 'telemetry', parent: 'app', name: 'Telemetry', plural: SUB, singular: true },
  'mcp-client': { dir: 'mcp-client', parent: 'app', name: 'MCP Client', plural: SUB, singular: true },
  'mcp-server': { dir: 'mcp-server', parent: 'app', name: 'MCP Server', plural: SUB, singular: true },
  'breeze-tool': { dir: 'breeze/tools', parent: 'app', name: 'Breeze Tool', plural: SUB },
  'breeze-skill': { dir: 'breeze/skills', parent: 'app', name: 'Breeze Skill', plural: SUB },
};

const PARENT_TYPES = ['app', 'theme', 'cms-assets'];
const COMPONENT_DIRS = new Set(PARENT_TYPES);
const SUB_COMPONENT_DIRS = new Set(Object.values(COMPONENTS).filter((c) => c.parent === 'app').map((c) => `app/${c.dir}`));
const ALLOWED_TOP_LEVEL_FIELDS = new Set(['uid', 'type', 'config', 'dependencies', 'permissions']);

const USER_FACING_TO_INTERNAL: Record<string, string> = {
  app: 'APPLICATION',
  calling: 'CALLING_EXTENSION',
  scim: 'SCIM_INTEGRATION',
  telemetry: 'TELEMETRY_CONFIG',
  'cms-assets': 'REACT_THEME',
  pages: 'PAGE',
};
const INTERNAL_TO_USER_FACING: Record<string, string> = Object.fromEntries(Object.entries(USER_FACING_TO_INTERNAL).map(([k, v]) => [v, k]));

export const METAFILE_SUFFIX = '-hsmeta.json';
export const SERVERLESS_PACKAGE_UID = 'hubspot-serverless-package-uid';
export const SERVERLESS_PACKAGE_TYPE = 'SERVERLESS_PACKAGE';

export function mapToInternalType(type: string): string {
  return (USER_FACING_TO_INTERNAL[type] || type || '').toUpperCase().replace(/-/g, '_');
}

export function mapToUserFacingType(type: string): string {
  return (INTERNAL_TO_USER_FACING[type] || type || '').toLowerCase().replace(/_/g, '-');
}

// ---------------------------------------------------------------- IR types

export type Dependencies = Record<string, string | string[]>;

export interface IntermediateRepresentationNode {
  uid: string;
  config: unknown;
  componentType: string;
  componentDeps: Dependencies;
  metaFilePath: string;
  files: Record<string, never>;
  permissions?: unknown;
}

export interface IntermediateRepresentation {
  intermediateNodesIndexedByUid: Record<string, IntermediateRepresentationNode>;
  profileData: { vars: { profileVariables: Record<string, never> } };
}

export interface TranslateResult {
  intermediateRepresentation: IntermediateRepresentation;
  /** *-hsmeta.json files outside component folders (ignored, like the CLI warns). */
  skippedHsMetaFiles: string[];
  /** Problems per file, written like the CLI's ("app/cards/x-hsmeta.json: Missing required field: 'uid'"). */
  errors: string[];
}

interface ParsedMeta {
  file: string;
  content?: { uid?: unknown; type?: unknown; config?: unknown; dependencies?: unknown; permissions?: unknown };
  errors: string[];
}

function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Problem with a component uid (project-parsing-lib uid.ts), or null. */
export function uidProblem(uid: unknown): string | null {
  if (uid === '' || uid === undefined || uid === null) return "'uid' must be at least one character long";
  if (typeof uid !== 'string') return "'uid' should use only letters, numbers, periods, hyphens, and underscores (for example: app-id_1.2.3)";
  if (uid.length > 64) return "'uid' must be 64 characters or less";
  if (!/^[a-zA-Z0-9_\-.]+$/.test(uid)) return "'uid' should use only letters, numbers, periods, hyphens, and underscores (for example: app-id_1.2.3)";
  return null;
}

/**
 * Translate the upload source files (paths relative to srcDir) into the IR. `schemas` — the
 * component schemas HubSpot serves for the platform version — enables the "unsupported type" check;
 * pass null to skip it.
 */
export function translateProject(srcFiles: DeployFile[], platformVersion: string, schemas: Record<string, unknown> | null = null): TranslateResult {
  const errors: string[] = [];
  const skippedHsMetaFiles: string[] = [];
  const byPath = new Map(srcFiles.map((f) => [f.path, f]));

  // locateHsMetaFiles + parseHsMetaFiles
  const metas: ParsedMeta[] = [];
  for (const f of srcFiles) {
    if (!f.path.endsWith(METAFILE_SUFFIX)) continue;
    if (f.path.split('/').includes('node_modules')) continue;
    const dir = dirname(f.path);
    if (!COMPONENT_DIRS.has(dir) && !SUB_COMPONENT_DIRS.has(dir)) {
      skippedHsMetaFiles.push(f.path);
      continue;
    }
    const meta: ParsedMeta = { file: f.path, errors: [] };
    try {
      const parsed: unknown = JSON.parse(f.contents);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        meta.content = parsed as ParsedMeta['content'];
        const unexpected = Object.keys(parsed).filter((k) => !ALLOWED_TOP_LEVEL_FIELDS.has(k));
        if (unexpected.length) meta.errors.push(`Unexpected top-level properties found: ${unexpected.join(', ')}`);
      } else {
        meta.errors.push(`File content is missing for ${f.path}`);
      }
    } catch {
      meta.errors.push('Invalid JSON');
    }
    metas.push(meta);
  }
  if (metas.length === 0) {
    errors.push('No *-hsmeta.json files were found in the project, so there is nothing to deploy.');
    return { intermediateRepresentation: { intermediateNodesIndexedByUid: {}, profileData: { vars: { profileVariables: {} } } }, skippedHsMetaFiles, errors };
  }

  // transform(): parent components, app objects, functions folder
  const parentUids: Record<string, string> = {};
  const allAppObjects: string[] = [];
  let appUid = '';
  let functionsDir: string | undefined;
  for (const m of metas) {
    const type = typeof m.content?.type === 'string' ? m.content.type : undefined;
    const uid = typeof m.content?.uid === 'string' ? m.content.uid : '';
    if (type && PARENT_TYPES.includes(type)) {
      if (type === 'app') appUid = uid;
      parentUids[type] = uid;
    }
    if (type === 'app-object') allAppObjects.push(uid);
    if (type === 'app-function') functionsDir = dirname(m.file);
  }

  const nodes: Array<{ node: IntermediateRepresentationNode; meta: ParsedMeta | null }> = [];
  let serverlessPackageUid: string | undefined;
  if (functionsDir !== undefined) {
    const packageFile = `${functionsDir}/package.json`;
    const lockFile = `${functionsDir}/package-lock.json`;
    if (!byPath.has(packageFile)) {
      errors.push(`${packageFile} does not exist. App Function requires a package.json file to exist in this location`);
    }
    serverlessPackageUid = SERVERLESS_PACKAGE_UID;
    const config: Record<string, string> = { packageFile };
    if (byPath.has(lockFile)) config.packageLockfile = lockFile;
    nodes.push({
      meta: null,
      node: {
        uid: SERVERLESS_PACKAGE_UID,
        componentType: SERVERLESS_PACKAGE_TYPE,
        config,
        componentDeps: { app: appUid, allAppObjects: [...allAppObjects] },
        metaFilePath: packageFile,
        files: {},
      },
    });
  }

  for (const m of metas) {
    if (!m.content) continue;
    const { uid, type, config, permissions } = m.content;
    const typeStr = typeof type === 'string' ? type : '';
    const dependencies: Dependencies = {};
    if (m.content.dependencies && typeof m.content.dependencies === 'object' && !Array.isArray(m.content.dependencies)) {
      Object.assign(dependencies, m.content.dependencies as Dependencies);
    }
    if (COMPONENTS[typeStr]?.parent === 'app') {
      const parentUid = parentUids.app;
      if (parentUid) {
        dependencies.app = parentUid;
      } else {
        m.errors.push(`This '${typeStr}' component must be a child of the 'app' component. No *-hsmeta.json files were found with type 'app'`);
      }
      if (typeStr !== 'app-object') dependencies.allAppObjects = [...allAppObjects];
      if (typeStr === 'app-function' && serverlessPackageUid) dependencies.serverlessPackage = serverlessPackageUid;
    }
    const node: IntermediateRepresentationNode = {
      uid: typeof uid === 'string' ? uid : (uid as string),
      config,
      componentType: mapToInternalType(typeStr),
      componentDeps: dependencies,
      metaFilePath: m.file,
      files: {},
    };
    if (permissions) node.permissions = permissions;
    nodes.push({ node, meta: m });
  }

  // getIntermediateRepresentation(): index by uid, duplicates are fatal
  const indexed: Record<string, IntermediateRepresentationNode> = {};
  const filesByUid = new Map<string, string[]>();
  for (const { node, meta } of nodes) {
    const key = typeof node.uid === 'string' && node.uid ? node.uid : `missing-${meta?.file ?? ''}`;
    const list = filesByUid.get(key) ?? [];
    list.push(meta?.file ?? node.metaFilePath);
    filesByUid.set(key, list);
    if (!(key in indexed)) indexed[key] = node;
  }
  for (const [uid, files] of filesByUid) {
    if (files.length > 1) errors.push(`Duplicate uid '${uid}' found in: ${files.join(', ')}`);
  }

  // validateIntermediateRepresentation(): structural checks
  const singular = new Map<string, ParsedMeta[]>();
  for (const { node, meta } of nodes) {
    if (!meta) continue; // auto-generated components are not validated
    if (!node.uid) meta.errors.push("Missing required field: 'uid'");
    else {
      const problem = uidProblem(node.uid);
      if (problem) meta.errors.push(problem);
    }
    if (!node.config) meta.errors.push("Missing required field: 'config'");
    if (node.permissions && !meetsMinimumPlatformVersion(platformVersion, '2027.03')) {
      meta.errors.push(`The "permissions" field is not supported on platform version "${platformVersion}". Upgrade to "2027.03" or later to use component-level permissions.`);
    }
    if (!node.componentType) meta.errors.push("Missing required field: 'type'");
    else if (schemas && !(node.componentType in schemas)) meta.errors.push(`Unsupported type: ${mapToUserFacingType(node.componentType)}`);
    const userType = mapToUserFacingType(node.componentType);
    const info = COMPONENTS[userType];
    if (info) {
      const expected = info.parent ? `${COMPONENTS[info.parent].dir}/${info.dir}` : info.dir;
      const actual = dirname(meta.file);
      if (expected !== actual) {
        meta.errors.push(`The directory '${actual}' is incorrect for type '${userType}'. ${info.name} ${info.plural} should only be placed in the '${expected}' directory`);
      }
      if (info.singular) {
        const key = info.dir;
        singular.set(key, [...(singular.get(key) ?? []), meta]);
      }
    }
  }
  for (const [, list] of singular) {
    if (list.length < 2) continue;
    const type = mapToUserFacingType(mapToInternalType(typeof list[0].content?.type === 'string' ? list[0].content.type : ''));
    for (const m of list) m.errors.push(`Only one ${type} component is allowed`);
  }
  for (const m of metas) for (const e of m.errors) errors.push(`${m.file}: ${e}`);

  return {
    intermediateRepresentation: { intermediateNodesIndexedByUid: indexed, profileData: { vars: { profileVariables: {} } } },
    skippedHsMetaFiles,
    errors,
  };
}
