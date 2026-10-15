/**
 * Validation of the project files a deploy request carries, and the selection of the files
 * `hs project upload` would put in the upload archive (the contents of hsproject.json's srcDir,
 * minus what HubSpot's ignore rules skip).
 */

export interface DeployFile {
  path: string;
  contents: string;
}

export const DEPLOY_LIMITS = {
  maxFiles: 400,
  /** Per file, UTF-8 bytes. */
  maxFileBytes: 1024 * 1024,
  /** All files together, UTF-8 bytes. */
  maxTotalBytes: 3.5 * 1024 * 1024,
  maxPathLength: 240,
  maxSegmentLength: 120,
  /** JSON request body limit for POST /api/deploy (contents get escaped, so above maxTotalBytes). */
  maxBodyBytes: 5 * 1024 * 1024,
} as const;

/** Characters HubSpot (or a Windows checkout of the project) cannot store in a file name. */
const FORBIDDEN_CHARS = /[<>:"|?*\\]/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Why a project file path is unsafe, or null when it is a clean relative POSIX path. */
export function filePathProblem(path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0) return 'is empty';
  if (path.length > DEPLOY_LIMITS.maxPathLength) return `is longer than ${DEPLOY_LIMITS.maxPathLength} characters`;
  if (CONTROL_CHARS.test(path)) return 'contains control characters';
  if (path.includes('\\')) return 'uses backslashes (use / between folders)';
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return 'must be relative to the project folder';
  if (FORBIDDEN_CHARS.test(path)) return 'contains a character that is not allowed in file names (< > : " | ? *)';
  const segments = path.split('/');
  for (const seg of segments) {
    if (seg === '') return 'has an empty folder name (// or a trailing /)';
    if (seg === '.' || seg === '..') return 'must not contain . or .. folders';
    if (seg.length > DEPLOY_LIMITS.maxSegmentLength) return `has a name longer than ${DEPLOY_LIMITS.maxSegmentLength} characters`;
    if (seg.trim() !== seg) return 'has a file or folder name that starts or ends with a space';
  }
  return null;
}

const encoder = new TextEncoder();

export function utf8Length(text: string): number {
  return encoder.encode(text).length;
}

/**
 * Check the files of a deploy request. Returns the files (copied) or a list of problems written
 * for people ("src/app/x.tsx: must not contain . or .. folders").
 */
export function validateDeployFiles(raw: unknown): { files: DeployFile[]; problems: string[] } {
  const problems: string[] = [];
  if (!Array.isArray(raw)) return { files: [], problems: ['The project files are missing.'] };
  if (raw.length === 0) return { files: [], problems: ['The project has no files.'] };
  if (raw.length > DEPLOY_LIMITS.maxFiles) {
    return { files: [], problems: [`The project has ${raw.length} files; the limit is ${DEPLOY_LIMITS.maxFiles}.`] };
  }
  const files: DeployFile[] = [];
  const seen = new Map<string, string>();
  let total = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      problems.push('A project file entry is not an object.');
      continue;
    }
    const { path, contents } = item as { path?: unknown; contents?: unknown };
    const label = typeof path === 'string' && path ? path.slice(0, 120) : '(no name)';
    const problem = filePathProblem(path);
    if (problem) {
      problems.push(`${label}: the file path ${problem}.`);
      continue;
    }
    if (typeof contents !== 'string') {
      problems.push(`${label}: the file contents must be text.`);
      continue;
    }
    const p = path as string;
    const key = p.toLowerCase();
    const previous = seen.get(key);
    if (previous !== undefined) {
      problems.push(previous === p ? `${label}: the file is listed twice.` : `${label}: clashes with ${previous} (names differ only in upper/lower case).`);
      continue;
    }
    seen.set(key, p);
    const size = utf8Length(contents);
    if (size > DEPLOY_LIMITS.maxFileBytes) {
      problems.push(`${label}: the file is ${formatBytes(size)}; the limit is ${formatBytes(DEPLOY_LIMITS.maxFileBytes)} per file.`);
      continue;
    }
    total += size;
    files.push({ path: p, contents });
  }
  if (total > DEPLOY_LIMITS.maxTotalBytes) {
    problems.push(`The project files add up to ${formatBytes(total)}; the limit is ${formatBytes(DEPLOY_LIMITS.maxTotalBytes)}.`);
  }
  // A file and a folder with the same name ("a" and "a/b") cannot both exist on disk.
  for (const f of files) {
    const parts = f.path.toLowerCase().split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      const clash = seen.get(dir);
      if (clash !== undefined) problems.push(`${f.path}: ${clash} is a file, so it cannot also be a folder.`);
    }
  }
  return { files, problems };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * HubSpot's upload ignore rules (local-dev-lib ignoreRules.ts, used by `hs project upload` with
 * isInProject = true): hidden files and folders, node_modules, logs, editor backups, OS clutter
 * and CLI config files are never uploaded. package-lock.json IS uploaded inside projects.
 */
const IGNORED_NAMES = new Set([
  'fields.output.json',
  'hubspot.config.yml',
  'hubspot.config.yaml',
  'node_modules',
  'icon\r',
  '__macosx',
  '~',
  'thumbs.db',
  'ehthumbs.db',
  'desktop.ini',
  '@eadir',
]);

export function isIgnoredOnUpload(relativePath: string): boolean {
  return relativePath.split('/').some((seg) => {
    const lower = seg.toLowerCase();
    if (IGNORED_NAMES.has(lower)) return true;
    if (seg.startsWith('.')) return true; // '.*' (also covers .env)
    if (lower.endsWith('.log') || lower.endsWith('.swp') || seg.endsWith('~')) return true;
    return false;
  });
}

export interface ProjectConfigFile {
  name?: string;
  srcDir: string;
  platformVersion?: string;
}

/** Read hsproject.json (when present) and normalise its srcDir ("./src/" → "src"; "." → ""). */
export function readProjectConfig(files: DeployFile[]): { config: ProjectConfigFile | null; problem: string | null } {
  const file = files.find((f) => f.path === 'hsproject.json');
  if (!file) return { config: null, problem: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.contents);
  } catch {
    return { config: null, problem: 'hsproject.json is not valid JSON.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { config: null, problem: 'hsproject.json must be a JSON object.' };
  const o = parsed as Record<string, unknown>;
  const rawSrc = typeof o.srcDir === 'string' ? o.srcDir.trim() : '';
  if (!rawSrc) return { config: null, problem: 'hsproject.json is missing "srcDir".' };
  const srcDir = rawSrc.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  if (srcDir !== '' && srcDir !== '.' && filePathProblem(srcDir)) {
    return { config: null, problem: '"srcDir" in hsproject.json must be a folder inside the project.' };
  }
  return {
    config: {
      srcDir: srcDir === '.' ? '' : srcDir,
      name: typeof o.name === 'string' ? o.name : undefined,
      platformVersion: typeof o.platformVersion === 'string' ? o.platformVersion : undefined,
    },
    problem: null,
  };
}

/** The files `hs project upload` archives: everything under srcDir (prefix removed), minus ignored files. */
export function uploadSourceFiles(files: DeployFile[], srcDir: string): DeployFile[] {
  const prefix = srcDir ? `${srcDir}/` : '';
  const out: DeployFile[] = [];
  for (const f of files) {
    if (prefix && !f.path.startsWith(prefix)) continue;
    const rel = f.path.slice(prefix.length);
    if (!rel || isIgnoredOnUpload(rel)) continue;
    out.push({ path: rel, contents: f.contents });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
