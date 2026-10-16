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
 *
 * HubSpot: code runs in the builder's own page, so while HubSpot is connected it can do anything
 * the builder can — read the connected account's CRM data through the connector and send it
 * elsewhere. So for a project that came from a file, trust is asked for again (with that warning)
 * when HubSpot is connected and the earlier trust was given without it: `imported` remembers which
 * projects came from a file, `hubspotConfirmed` which of them were trusted with the warning shown.
 * The connection store reports the connection with setHubSpotAccess().
 */

const UNTRUSTED_KEY = 'uiex-builder:untrusted-projects';
const IMPORTED_KEY = 'uiex-builder:imported-projects';
const HUBSPOT_CONFIRMED_KEY = 'uiex-builder:hubspot-trusted-projects';
/** Provenance sets are capped (oldest ids dropped). */
const MAX_REMEMBERED = 500;

let memory: Set<string> | null = null;
const extraSets = new Map<string, Set<string>>();
let activeProjectId: string | null = null;
let hubspotAccess = false;
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
  changed();
}

function changed(): void {
  version++;
  listeners.forEach((l) => l());
}

function readSet(key: string): Set<string> {
  const cached = extraSets.get(key);
  if (cached) return cached;
  let set: Set<string>;
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    set = new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    set = new Set();
  }
  extraSets.set(key, set);
  return set;
}

function writeSet(key: string, set: Set<string>): void {
  const list = [...set].slice(-MAX_REMEMBERED);
  extraSets.set(key, new Set(list));
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* in memory only */
  }
}

function addTo(key: string, id: string): void {
  const set = readSet(key);
  if (set.has(id)) return;
  writeSet(key, new Set([...set, id]));
}

function removeFrom(key: string, id: string): void {
  const set = readSet(key);
  if (!set.has(id)) return;
  const next = new Set(set);
  next.delete(id);
  writeSet(key, next);
}

/** Marks a project (imported from a file) as untrusted: its code does not run until trusted. */
export function markProjectUntrusted(projectId: string): void {
  addTo(IMPORTED_KEY, projectId);
  removeFrom(HUBSPOT_CONFIRMED_KEY, projectId);
  const set = read();
  if (set.has(projectId)) {
    changed();
    return;
  }
  write(new Set([...set, projectId]));
}

/**
 * The user trusts the project: its code runs from now on (also after reloads). Trusted while
 * HubSpot is connected, the trust covers HubSpot too (the notice said so).
 */
export function trustProject(projectId: string): void {
  if (hubspotAccess && readSet(IMPORTED_KEY).has(projectId)) addTo(HUBSPOT_CONFIRMED_KEY, projectId);
  const set = read();
  if (!set.has(projectId)) {
    changed();
    return;
  }
  const next = new Set(set);
  next.delete(projectId);
  write(next);
}

/** Whether the user trusted the project's code at all (it may still wait for the HubSpot confirmation). */
export function isProjectTrusted(projectId: string): boolean {
  return !read().has(projectId);
}

/** Whether the project came from a file (imported), now or earlier. */
export function isProjectImported(projectId: string): boolean {
  return readSet(IMPORTED_KEY).has(projectId);
}

export type CodeTrustState =
  /** The code runs. */
  | 'trusted'
  /** Imported from a file and not trusted yet. */
  | 'untrusted'
  /** Trusted before HubSpot was connected; now that it is, asked again (with the HubSpot warning). */
  | 'needs-hubspot-confirmation';

export function codeTrustState(projectId: string): CodeTrustState {
  if (!isProjectTrusted(projectId)) return 'untrusted';
  if (hubspotAccess && readSet(IMPORTED_KEY).has(projectId) && !readSet(HUBSPOT_CONFIRMED_KEY).has(projectId)) return 'needs-hubspot-confirmation';
  return 'trusted';
}

/** The connection store reports whether HubSpot is connected (code then also reaches HubSpot data). */
export function setHubSpotAccess(connected: boolean): void {
  if (hubspotAccess === connected) return;
  hubspotAccess = connected;
  changed();
}

export function hubSpotAccess(): boolean {
  return hubspotAccess;
}

/** Everything trust knows about a project id (to restore it, e.g. after a cancelled import). */
export interface CodeTrustSnapshot {
  id: string;
  untrusted: boolean;
  imported: boolean;
  hubspotConfirmed: boolean;
}

export function snapshotCodeTrust(projectId: string): CodeTrustSnapshot {
  return {
    id: projectId,
    untrusted: read().has(projectId),
    imported: readSet(IMPORTED_KEY).has(projectId),
    hubspotConfirmed: readSet(HUBSPOT_CONFIRMED_KEY).has(projectId),
  };
}

export function restoreCodeTrust(snap: CodeTrustSnapshot): void {
  if (snap.imported) addTo(IMPORTED_KEY, snap.id);
  else removeFrom(IMPORTED_KEY, snap.id);
  if (snap.hubspotConfirmed) addTo(HUBSPOT_CONFIRMED_KEY, snap.id);
  else removeFrom(HUBSPOT_CONFIRMED_KEY, snap.id);
  const set = read();
  if (snap.untrusted === set.has(snap.id)) {
    changed();
    return;
  }
  const next = new Set(set);
  if (snap.untrusted) next.add(snap.id);
  else next.delete(snap.id);
  write(next);
}

/** A copy of a project (new id) keeps the original's trust and provenance. */
export function copyCodeTrust(fromId: string, toId: string): void {
  restoreCodeTrust({ ...snapshotCodeTrust(fromId), id: toId });
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
  return activeProjectId === null || codeTrustState(activeProjectId) === 'trusted';
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
  extraSets.clear();
  activeProjectId = null;
  hubspotAccess = false;
  version++;
}
