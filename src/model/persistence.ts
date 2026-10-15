/**
 * Local persistence: projects are autosaved to localStorage (per-browser), and can be exported /
 * imported as `.uiex.json` builder documents. All storage access is wrapped in try/catch so the
 * editor works when storage is unavailable (private windows, blocked site data).
 *
 * Reading never depends on being able to write: a full storage quota must not hide saved
 * projects (see `saveProjectResult` for why a save failed).
 */
import { normalizeProject } from './normalize';
import { markProjectUntrusted } from './trust';
import type { Project } from './types';

const INDEX_KEY = 'uiex-builder:projects';
const PROJECT_PREFIX = 'uiex-builder:project:';
const PROJECT_KEY = (id: string) => `${PROJECT_PREFIX}${id}`;
const LAST_KEY = 'uiex-builder:last-project';

export interface ProjectSummary {
  id: string;
  name: string;
  appName: string;
  updatedAt: string;
  extensionCount: number;
}

/** Why a save failed: no storage at all, or the browser's storage quota is used up. */
export type SaveFailureReason = 'unavailable' | 'quota' | 'error';
export type SaveResult = { ok: true } | { ok: false; reason: SaveFailureReason; message: string };

/** localStorage for reading (no write probe: a full quota still allows reads). */
function readStorage(): Storage | null {
  try {
    const s = window.localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/** True when an exception means "the storage quota is exceeded". */
export function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const { name, code } = e as { name?: unknown; code?: unknown };
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22 || code === 1014;
}

function summaryOf(p: Partial<Project>): ProjectSummary | null {
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !p.id) return null;
  return {
    id: p.id,
    name: typeof p.name === 'string' ? p.name : '',
    appName: typeof p.app?.name === 'string' ? p.app.name : '',
    updatedAt: typeof p.updatedAt === 'string' ? p.updatedAt : '',
    extensionCount: Array.isArray(p.extensions) ? p.extensions.length : 0,
  };
}

/** Normalises one index entry (hand-edited or older indexes may lack fields). */
function indexEntry(raw: unknown): ProjectSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.id !== 'string' || !e.id) return null;
  return {
    id: e.id,
    name: typeof e.name === 'string' ? e.name : '',
    appName: typeof e.appName === 'string' ? e.appName : '',
    updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : '',
    extensionCount: typeof e.extensionCount === 'number' ? e.extensionCount : 0,
  };
}

/** Ids of every stored project document (whether or not the index lists it). */
function storedProjectIds(s: Storage): string[] {
  const ids: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (key && key.startsWith(PROJECT_PREFIX)) ids.push(key.slice(PROJECT_PREFIX.length));
  }
  return ids;
}

/**
 * The saved-projects list: index entries (tolerating malformed ones) plus any stored project the
 * index lost (an interrupted save, a corrupt index), newest first.
 */
function readIndex(s: Storage): ProjectSummary[] {
  let entries: ProjectSummary[] = [];
  try {
    const raw = s.getItem(INDEX_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) entries = parsed.map(indexEntry).filter((e): e is ProjectSummary => e !== null);
  } catch {
    entries = [];
  }
  const byId = new Map<string, ProjectSummary>();
  for (const e of entries) {
    if (!byId.has(e.id) && s.getItem(PROJECT_KEY(e.id)) !== null) byId.set(e.id, e);
  }
  for (const id of storedProjectIds(s)) {
    if (byId.has(id)) continue;
    try {
      const summary = summaryOf(JSON.parse(s.getItem(PROJECT_KEY(id)) ?? 'null') as Partial<Project>);
      if (summary && summary.id === id) byId.set(id, summary);
    } catch {
      /* unreadable document: skip */
    }
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function listSavedProjects(): ProjectSummary[] {
  const s = readStorage();
  if (!s) return [];
  try {
    return readIndex(s);
  } catch {
    return [];
  }
}

/** Saves a project and reports why it failed (storage unavailable, quota exceeded, ...). */
export function saveProjectResult(project: Project): SaveResult {
  const s = readStorage();
  if (!s) return { ok: false, reason: 'unavailable', message: 'Browser storage is unavailable' };
  try {
    // Read the list before writing so a failure below can never shrink it.
    const list = readIndex(s).filter((p) => p.id !== project.id);
    s.setItem(PROJECT_KEY(project.id), JSON.stringify(project));
    const summary = summaryOf(project);
    if (summary) list.unshift(summary);
    s.setItem(INDEX_KEY, JSON.stringify(list));
    s.setItem(LAST_KEY, project.id);
    return { ok: true };
  } catch (e) {
    if (isQuotaError(e)) {
      return { ok: false, reason: 'quota', message: 'Browser storage is full — delete old projects or download a .uiex.json' };
    }
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

/** Saves a project; false when it could not be stored (see saveProjectResult for the reason). */
export function saveProject(project: Project): boolean {
  return saveProjectResult(project).ok;
}

export function loadSavedProject(id: string): Project | null {
  const s = readStorage();
  if (!s) return null;
  try {
    const raw = s.getItem(PROJECT_KEY(id));
    if (!raw) return null;
    const parsed = parseStoredDocument(raw);
    return parsed.ok ? parsed.project : null;
  } catch {
    return null;
  }
}

export function loadLastProject(): Project | null {
  const s = readStorage();
  if (!s) return null;
  try {
    const id = s.getItem(LAST_KEY);
    return id ? loadSavedProject(id) : null;
  } catch {
    return null;
  }
}

export function deleteSavedProject(id: string): void {
  const s = readStorage();
  if (!s) return;
  try {
    const list = readIndex(s).filter((p) => p.id !== id);
    s.removeItem(PROJECT_KEY(id));
    s.setItem(INDEX_KEY, JSON.stringify(list));
    if (s.getItem(LAST_KEY) === id) s.removeItem(LAST_KEY);
  } catch {
    /* ignore */
  }
}

export type ParseResult =
  | {
      ok: true;
      project: Project;
      /** What was repaired while reading the document (empty for well-formed documents). */
      warnings?: string[];
    }
  | { ok: false; error: string };

function parseText(json: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  return validateProjectShape(data);
}

/** Parses a document this browser saved itself (autosave). */
function parseStoredDocument(json: string): ParseResult {
  return parseText(json);
}

/**
 * Parses and structurally validates a builder document (`.uiex.json`) from a file. The project's
 * code is marked untrusted (model/trust.ts): it does not run in the designer until the user
 * trusts it, because a file from someone else must not execute code in this page on open.
 */
export function parseProjectJson(json: string): ParseResult {
  const res = parseText(json);
  if (res.ok) markProjectUntrusted(res.project.id);
  return res;
}

/**
 * Checks a parsed document and repairs or rejects malformed parts (see model/normalize.ts):
 * wrong field types, unknown enum values, node graphs that are not trees, and so on. Repairs are
 * listed in `warnings`.
 */
export function validateProjectShape(data: unknown): ParseResult {
  const res = normalizeProject(data);
  if (!res.ok) return res;
  return { ok: true, project: res.project, warnings: res.repairs };
}

/** Serialises a project as a downloadable builder document. */
export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

/** Triggers a browser download of text or a Blob. */
export function downloadFile(fileName: string, contents: string | Blob, mime = 'application/json'): void {
  const blob = typeof contents === 'string' ? new Blob([contents], { type: mime }) : contents;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
