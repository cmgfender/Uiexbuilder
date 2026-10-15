/**
 * Code trust for builder documents.
 *
 * A `.uiex.json` can contain JavaScript (helper code, computed values, expressions, custom code
 * actions) that the designer evaluates in the page. A document someone else made must not run
 * that code just because it was opened, so every project imported from a file is *untrusted*
 * until the user chooses "Trust and run code". While the active project is untrusted the runtime
 * only evaluates side-effect-free expressions (see runtime/safeExpression.ts) and shows the rest
 * as source text.
 *
 * Trust is per project id and persisted in localStorage (in memory when storage is unavailable).
 * Projects created in this browser (new / from a template) are trusted.
 */

const UNTRUSTED_KEY = 'uiex-builder:untrusted-projects';

let memory: Set<string> | null = null;
let activeProjectId: string | null = null;
const listeners = new Set<() => void>();
/** Bumped on every change (useSyncExternalStore snapshot). */
let version = 0;

function read(): Set<string> {
  if (memory) return memory;
  try {
    const raw = window.localStorage.getItem(UNTRUSTED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    memory = new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    memory = new Set();
  }
  return memory;
}

function write(set: Set<string>): void {
  memory = set;
  try {
    window.localStorage.setItem(UNTRUSTED_KEY, JSON.stringify([...set]));
  } catch {
    /* storage unavailable or full: the in-memory set still applies for this session */
  }
  version++;
  listeners.forEach((l) => l());
}

/** Marks a project (imported from a file) as untrusted: its code does not run until trusted. */
export function markProjectUntrusted(projectId: string): void {
  const set = read();
  if (set.has(projectId)) return;
  write(new Set([...set, projectId]));
}

/** The user trusts the project: its code runs from now on (also after reloads). */
export function trustProject(projectId: string): void {
  const set = read();
  if (!set.has(projectId)) return;
  const next = new Set(set);
  next.delete(projectId);
  write(next);
}

export function isProjectTrusted(projectId: string): boolean {
  return !read().has(projectId);
}

/** Tells the code policy which project the editor shows (the store calls this on load). */
export function setActiveCodeProject(projectId: string | null): void {
  if (activeProjectId === projectId) return;
  activeProjectId = projectId;
  version++;
  listeners.forEach((l) => l());
}

/** The project whose code the runtime evaluates (null before any project is loaded). */
export function activeCodeProject(): string | null {
  return activeProjectId;
}

/** Whether code of the active project may run (helpers, calls, custom code, ...). */
export function codeExecutionAllowed(): boolean {
  return activeProjectId === null || isProjectTrusted(activeProjectId);
}

/** Subscribes to trust / active project changes (returns the unsubscribe function). */
export function subscribeCodeTrust(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes whenever trust or the active project changes (for useSyncExternalStore). */
export function codeTrustVersion(): number {
  return version;
}

/** Test helper: forgets the cached set (e.g. after clearing localStorage). */
export function resetCodeTrustForTests(): void {
  memory = null;
  activeProjectId = null;
  version++;
}
