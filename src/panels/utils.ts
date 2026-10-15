/** Small pure helpers for the Data panel and dialogs (validation, conversions, formatting). */
import { uidProblem } from '../model/ids';
import type { JsonValue, Project, StateVarType } from '../model/types';

// ---------------------------------------------------------------------------
// State variable values
// ---------------------------------------------------------------------------

export const STATE_TYPES: Array<{ value: StateVarType; label: string }> = [
  { value: 'string', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'True / false' },
  { value: 'array', label: 'List' },
  { value: 'object', label: 'Object' },
  { value: 'any', label: 'Any (JSON)' },
];

export function defaultInitial(type: StateVarType): JsonValue {
  switch (type) {
    case 'string':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'object':
      return {};
    default:
      return null;
  }
}

function isPlainObject(v: unknown): v is Record<string, JsonValue> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Converts an initial value sensibly when a state variable's type changes. */
export function convertInitial(value: JsonValue, to: StateVarType): JsonValue {
  switch (to) {
    case 'string':
      if (typeof value === 'string') return value;
      if (value === null || value === undefined) return '';
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
    case 'number': {
      if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
      if (typeof value === 'boolean') return value ? 1 : 0;
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
      if (Array.isArray(value)) return value.length;
      return 0;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      if (typeof value === 'string') return !['', 'false', '0', 'no', 'off', 'null'].includes(value.trim().toLowerCase());
      if (Array.isArray(value)) return value.length > 0;
      return isPlainObject(value);
    case 'array':
      if (Array.isArray(value)) return value;
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value) as unknown;
          if (Array.isArray(parsed)) return parsed as JsonValue[];
        } catch {
          /* not JSON */
        }
        return value.trim() === '' ? [] : value.split(',').map((s) => s.trim()).filter(Boolean);
      }
      return value === null || value === undefined || typeof value === 'boolean' ? [] : [value];
    case 'object':
      if (isPlainObject(value)) return value;
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value) as unknown;
          if (isPlainObject(parsed)) return parsed;
        } catch {
          /* not JSON */
        }
      }
      return {};
    default:
      return value === undefined ? null : value;
  }
}

/** Short one-line preview of a JSON value for list rows. */
export function previewValue(value: JsonValue | undefined, max = 28): string {
  let s: string;
  if (value === undefined) s = '—';
  else if (typeof value === 'string') s = value === '' ? '""' : JSON.stringify(value);
  else if (Array.isArray(value)) s = value.length === 0 ? '[]' : `[${value.length} item${value.length === 1 ? '' : 's'}]`;
  else if (isPlainObject(value)) {
    const keys = Object.keys(value);
    s = keys.length === 0 ? '{}' : `{ ${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''} }`;
  } else s = JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** hsproject.json name: lowercase letters, digits, dashes and underscores. */
export function validateProjectSlug(name: string): string | null {
  if (!name.trim()) return 'Project name is required';
  if (name.length > 64) return 'Use 64 characters or fewer';
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) return 'Use lowercase letters, numbers, dashes or underscores (no spaces)';
  return null;
}

/** HubSpot uid: letters, digits, `_`, `-` and `.`, up to 64 characters (see uidProblem). */
export function validateUid(uid: string, taken: string[] = []): string | null {
  const problem = uidProblem(uid);
  if (problem) return `UID ${problem}`;
  if (taken.includes(uid)) return 'This UID is already used in the project';
  return null;
}

// Project-wide naming rules. They match validateProject (invalid-uid, duplicate-uid,
// invalid-file-name, duplicate-file-name), so an editor never accepts a value the Problems panel
// then reports — every dialog and inspector field that edits a uid or file name uses them.

/** Who owns a uid: the app, an extension or an app function. */
export type UidOwner = { kind: 'app' } | { kind: 'extension'; id: string } | { kind: 'function'; id: string };

type NamedProject = Pick<Project, 'app' | 'extensions' | 'functions'>;

const EXTENSION_KIND_LABEL: Record<string, string> = { card: 'Card', settings: 'The settings page', home: 'The app home page' };

/**
 * A HubSpot uid of the app, an extension or an app function: uidProblem's characters and length,
 * and unique across the whole project (app, extensions and functions share one namespace).
 */
export function projectUidError(project: NamedProject, uid: string, owner: UidOwner): string | null {
  const problem = uidProblem(uid);
  if (problem) return `UID ${problem}`;
  if (owner.kind !== 'app' && project.app?.uid === uid) return 'The app already uses this UID';
  const ext = (project.extensions ?? []).find((e) => e && e.uid === uid && !(owner.kind === 'extension' && e.id === owner.id));
  if (ext) return `${EXTENSION_KIND_LABEL[ext.kind] ?? 'Extension'} “${ext.name || ext.fileName}” already uses this UID`;
  const fn = (project.functions ?? []).find((f) => f && f.uid === uid && !(owner.kind === 'function' && f.id === owner.id));
  if (fn) return `App function “${fn.fileName || fn.uid}” already uses this UID`;
  return null;
}

/** Extension component file names (src/app/<dir>/<Name>.tsx): PascalCase. */
export const EXTENSION_FILE_NAME_RE = /^[A-Z][A-Za-z0-9_]*$/;
/** App function file names (src/app/functions/<name>.js). */
export const FUNCTION_FILE_NAME_RE = /^[A-Za-z0-9_-]+$/;

/** An extension's file name: PascalCase and unique (ignoring case) across every extension. */
export function extensionFileNameError(project: NamedProject, name: string, extensionId: string): string | null {
  if (!name.trim()) return 'File name is required';
  if (!EXTENSION_FILE_NAME_RE.test(name)) return 'Use PascalCase: a capital letter, then letters, digits or _ (e.g. ContactSummaryCard)';
  const lower = name.toLowerCase();
  const other = (project.extensions ?? []).find((e) => e && e.id !== extensionId && typeof e.fileName === 'string' && e.fileName.toLowerCase() === lower);
  if (other) return `“${other.name || other.fileName}” already uses this file name`;
  return null;
}

/** An app function's file name: letters, digits, _ and -, not `package`, unique (ignoring case) among functions. */
export function functionFileNameError(project: NamedProject, name: string, functionId: string): string | null {
  if (!name.trim()) return 'File name is required';
  if (!FUNCTION_FILE_NAME_RE.test(name)) return 'Use letters, numbers, _ or - (no spaces or extension)';
  if (name.toLowerCase() === 'package') return 'This name is reserved (package.json)';
  const lower = name.toLowerCase();
  const other = (project.functions ?? []).find((f) => f && f.id !== functionId && typeof f.fileName === 'string' && f.fileName.toLowerCase() === lower);
  if (other) return `App function “${other.uid}” already uses this file name`;
  return null;
}

/** An https:// origin or URL usable in permittedUrls (http://localhost allowed for local testing). */
export function validatePermittedUrl(url: string): string | null {
  const v = url.trim();
  if (!v) return 'Enter a URL';
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    return 'Not a valid URL (include https://)';
  }
  const local = parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  if (parsed.protocol !== 'https:' && !local) return 'Must start with https://';
  if (!parsed.hostname) return 'Missing host name';
  return null;
}

/** OAuth redirect URL: https (or http://localhost). */
export function validateRedirectUrl(url: string): string | null {
  return validatePermittedUrl(url);
}

export function originOf(url: string): string | null {
  try {
    const u = new URL(url.trim());
    return u.origin === 'null' ? null : u.origin;
  } catch {
    return null;
  }
}

export function validateEmail(email: string): string | null {
  if (!email.trim()) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : 'Enter a valid email address';
}

export function validateHttpsUrl(url: string): string | null {
  if (!url.trim()) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' ? null : 'Must start with https://';
  } catch {
    return 'Enter a full URL starting with https://';
  }
}

/** HubSpot requires support phone numbers in E.164 format, e.g. +18005555555. */
export function validatePhone(phone: string): string | null {
  if (!phone.trim()) return null;
  return /^\+[1-9]\d{6,14}$/.test(phone.trim()) ? null : 'Use international format without spaces, e.g. +18005555555';
}

export function validateSecretKey(key: string): string | null {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return 'Use letters, numbers and _ (e.g. API_KEY)';
  return null;
}

/**
 * Path of a public app function endpoint, e.g. `/api/status` — the format of HubSpot's official
 * endpoint templates (a leading slash, segments of letters, digits, `-` and `_`). A path without
 * the leading slash is accepted too.
 */
export const ENDPOINT_PATH_RE = /^\/?[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

export function validateEndpointPath(path: string): string | null {
  if (!path.trim()) return 'Path is required';
  if (!ENDPOINT_PATH_RE.test(path)) return 'Use letters, numbers, - and _ in segments separated by /, e.g. /api/status';
  return null;
}

/** Default endpoint path for a function uid: `/api/<uid as a path segment>`, like HubSpot's template. */
export function defaultEndpointPath(uid: string): string {
  const segment = uid.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'function';
  return `/api/${segment}`;
}

/** Compiles CommonJS function source without running it. Returns an error message or null. */
export function checkFunctionSyntax(code: string): string | null {
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', code);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** '2 min ago', '3 h ago', 'yesterday', '5 days ago', or a date. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'unknown';
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d} days ago`;
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Copies text to the clipboard; resolves false when the API is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand?.('copy') ?? false;
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
