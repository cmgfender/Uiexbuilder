/**
 * Local persistence: projects are autosaved to localStorage (per-browser), and can be exported /
 * imported as `.uiex.json` builder documents. All storage access is wrapped in try/catch so the
 * editor works when storage is unavailable (private windows, blocked site data).
 */
import type { Project } from './types';
import { ROOT_TYPE } from './types';

const INDEX_KEY = 'uiex-builder:projects';
const PROJECT_KEY = (id: string) => `uiex-builder:project:${id}`;
const LAST_KEY = 'uiex-builder:last-project';

export interface ProjectSummary {
  id: string;
  name: string;
  appName: string;
  updatedAt: string;
  extensionCount: number;
}

function storage(): Storage | null {
  try {
    const s = window.localStorage;
    const probe = '__uiex_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function listSavedProjects(): ProjectSummary[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(INDEX_KEY);
    const list = raw ? (JSON.parse(raw) as ProjectSummary[]) : [];
    return Array.isArray(list) ? list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [];
  } catch {
    return [];
  }
}

export function saveProject(project: Project): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(PROJECT_KEY(project.id), JSON.stringify(project));
    const summary: ProjectSummary = {
      id: project.id,
      name: project.name,
      appName: project.app.name,
      updatedAt: project.updatedAt,
      extensionCount: project.extensions.length,
    };
    const list = listSavedProjects().filter((p) => p.id !== project.id);
    list.unshift(summary);
    s.setItem(INDEX_KEY, JSON.stringify(list));
    s.setItem(LAST_KEY, project.id);
    return true;
  } catch {
    return false;
  }
}

export function loadSavedProject(id: string): Project | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(PROJECT_KEY(id));
    if (!raw) return null;
    const parsed = parseProjectJson(raw);
    return parsed.ok ? parsed.project : null;
  } catch {
    return null;
  }
}

export function loadLastProject(): Project | null {
  const s = storage();
  if (!s) return null;
  try {
    const id = s.getItem(LAST_KEY);
    return id ? loadSavedProject(id) : null;
  } catch {
    return null;
  }
}

export function deleteSavedProject(id: string): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(PROJECT_KEY(id));
    s.setItem(INDEX_KEY, JSON.stringify(listSavedProjects().filter((p) => p.id !== id)));
    if (s.getItem(LAST_KEY) === id) s.removeItem(LAST_KEY);
  } catch {
    /* ignore */
  }
}

export type ParseResult = { ok: true; project: Project } | { ok: false; error: string };

/** Parses and structurally validates a builder document (`.uiex.json`). */
export function parseProjectJson(json: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  return validateProjectShape(data);
}

export function validateProjectShape(data: unknown): ParseResult {
  const fail = (error: string): ParseResult => ({ ok: false, error });
  if (!data || typeof data !== 'object') return fail('Document is not an object');
  const p = data as Partial<Project>;
  if (p.schemaVersion !== 1) return fail('Unsupported or missing schemaVersion (expected 1)');
  if (typeof p.id !== 'string' || typeof p.name !== 'string') return fail('Missing project id or name');
  if (!p.app || typeof p.app !== 'object') return fail('Missing app configuration');
  if (!Array.isArray(p.extensions) || p.extensions.length === 0) return fail('Project has no extensions');
  if (!Array.isArray(p.functions)) return fail('Missing functions array');
  for (const ext of p.extensions) {
    if (!ext || typeof ext !== 'object') return fail('Invalid extension');
    if (!ext.nodes || typeof ext.nodes !== 'object') return fail(`Extension ${ext.name} has no nodes`);
    const root = ext.nodes[ext.rootId];
    if (!root || root.type !== ROOT_TYPE) return fail(`Extension ${ext.name} has an invalid root`);
    for (const node of Object.values(ext.nodes)) {
      if (!Array.isArray(node.children)) return fail(`Node ${node.id} has invalid children`);
      for (const cid of node.children) if (!ext.nodes[cid]) return fail(`Node ${node.id} references missing child ${cid}`);
      for (const ids of Object.values(node.slots ?? {})) {
        for (const cid of ids) if (!ext.nodes[cid]) return fail(`Node ${node.id} references missing slot child ${cid}`);
      }
    }
    if (!Array.isArray(ext.state) || !Array.isArray(ext.dataSources) || !ext.mock) {
      return fail(`Extension ${ext.name} is missing state, dataSources or mock data`);
    }
  }
  return { ok: true, project: data as Project };
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
