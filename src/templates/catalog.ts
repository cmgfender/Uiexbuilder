/**
 * Template catalog contract.
 * - ExtensionTemplate: a complete starter extension (card / settings / home) with state, data
 *   sources and mock data; `build(existing, functionIds?)` returns a fresh Extension (new ids each
 *   call). Templates that need server-side code declare `functions()`; use
 *   `instantiateExtensionTemplate` to create those functions (unique uid / file name) and an
 *   extension wired to their ids.
 * - BlockTemplate: a reusable snippet dropped onto the canvas (DragPayload kind 'template').
 */
import type { LucideIcon } from 'lucide-react';
import { newId, uniqueName } from '../model/ids';
import type { AppFunction, CardLocation, DataSource, Extension, ExtensionKind, NodeTemplate, Project, StateVar } from '../model/types';

export interface ExtensionTemplate {
  id: string;
  name: string;
  description: string;
  kind: ExtensionKind;
  location?: CardLocation;
  objectTypes?: string[];
  /** Short tags shown in the gallery, e.g. ['Form', 'Fetch']. */
  tags: string[];
  /**
   * Builds a fresh extension. `functionIds` are the ids of the app functions created from
   * `functions()` (same order); without them the extension references placeholder ids.
   */
  build: (existing: Extension[], functionIds?: string[]) => Extension;
  /** App functions the template relies on (added to the project when the template is used). */
  functions?: () => AppFunction[];
}

export interface BlockTemplate {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  template: NodeTemplate;
  /** State variables the block needs (added on drop if missing). */
  state?: Array<Omit<StateVar, 'id'>>;
  /** Extra search words for the blocks gallery. */
  keywords?: string[];
  /**
   * Blocks that bring their own data (e.g. "Associated records"): builds the block and the data
   * sources it reads for the card it goes into (names that don't clash, the card's record type).
   * `template` is still what the gallery's thumbnail shows. Additive.
   */
  create?: (ext: Extension, project: Pick<Project, 'functions'>) => BuiltBlock;
}

/** A block built for a specific card: its nodes and the data sources they read. */
export interface BuiltBlock {
  template: NodeTemplate;
  dataSources: DataSource[];
}

export { PROJECT_TEMPLATES } from './projectTemplates';
export { BLOCK_TEMPLATES } from './blockTemplates';

// ---------------------------------------------------------------------------
// Instantiation
// ---------------------------------------------------------------------------

export interface InstantiatedTemplate {
  extension: Extension;
  /** New app functions to add to the project (fresh ids, unique uids and file names). */
  functions: AppFunction[];
}

/**
 * Creates a template's extension and the app functions it needs, with names that do not clash
 * with `project` (pass the extensions that will remain next to it, e.g. without the extension a
 * "replace" removes).
 */
export function instantiateExtensionTemplate(
  tpl: ExtensionTemplate,
  project: Pick<Project, 'extensions' | 'functions'> & { app?: { uid: string } },
): InstantiatedTemplate {
  const takenUids = new Set<string>([
    ...(project.app?.uid ? [project.app.uid] : []),
    ...project.extensions.map((e) => e.uid),
    ...project.functions.map((f) => f.uid),
  ]);
  const takenFiles = new Set<string>(project.functions.map((f) => f.fileName.toLowerCase()));
  const functions: AppFunction[] = [];
  for (const fn of tpl.functions?.() ?? []) {
    let fileName = fn.fileName;
    for (let i = 2; takenFiles.has(fileName.toLowerCase()); i++) fileName = `${fn.fileName}${i}`;
    const uid = uniqueName(fn.uid, takenUids);
    takenUids.add(uid);
    takenFiles.add(fileName.toLowerCase());
    // A uid may appear in the function's comments / docs; keep them in sync.
    const code = uid === fn.uid ? fn.code : fn.code.split(`'${fn.uid}'`).join(`'${uid}'`);
    functions.push({ ...fn, id: newId('f'), uid, fileName, code, secretKeys: [...fn.secretKeys] });
  }
  const extension = tpl.build(project.extensions, functions.map((f) => f.id));
  if (takenUids.has(extension.uid)) extension.uid = uniqueName(extension.uid, takenUids);
  return { extension, functions };
}

/**
 * Why a template cannot be added next to `extensions` (an app has at most one settings page and
 * one app home page), or null when it can. `replacingId` is the extension a "replace" removes.
 */
export function templateConflict(
  tpl: Pick<ExtensionTemplate, 'kind'>,
  extensions: Array<Pick<Extension, 'id' | 'kind'>>,
  replacingId?: string,
): string | null {
  const others = extensions.filter((e) => e.id !== replacingId);
  if (tpl.kind === 'settings' && others.some((e) => e.kind === 'settings')) return 'This app already has a settings page.';
  if (tpl.kind === 'home' && others.some((e) => e.kind === 'home')) return 'This app already has an app home page.';
  return null;
}

/** Plain-language location label of a template (gallery badges). */
export function templateLocationLabel(tpl: Pick<ExtensionTemplate, 'kind' | 'location'>): string {
  if (tpl.kind === 'settings') return 'Settings page';
  if (tpl.kind === 'home') return 'App home';
  switch (tpl.location) {
    case 'crm.record.sidebar':
      return 'Record sidebar';
    case 'crm.preview':
      return 'Preview panel';
    case 'helpdesk.sidebar':
      return 'Help desk';
    default:
      return 'Record tab';
  }
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function overlayIds(tpl: NodeTemplate, out: string[] = []): string[] {
  if ((tpl.type === 'Modal' || tpl.type === 'Panel') && typeof tpl.props?.id === 'string') out.push(tpl.props.id);
  tpl.children?.forEach((c) => overlayIds(c, out));
  Object.values(tpl.slots ?? {}).forEach((list) => list.forEach((c) => overlayIds(c, out)));
  return out;
}

/**
 * A deep copy of a block template whose Modal / Panel `id` props do not clash with overlays the
 * extension already has (closeOverlay `@id` references are renamed with them), so a block can be
 * inserted any number of times.
 */
export function freshBlockTemplate(template: NodeTemplate, ext: Extension | null): NodeTemplate {
  const copy = JSON.parse(JSON.stringify(template)) as NodeTemplate;
  if (!ext) return copy;
  const ids = overlayIds(copy);
  if (ids.length === 0) return copy;
  const taken = new Set<string>();
  for (const node of Object.values(ext.nodes)) {
    const v = node.props?.id;
    if (typeof v === 'string') taken.add(v);
  }
  const renames = new Map<string, string>();
  for (const id of ids) {
    if (!taken.has(id)) {
      taken.add(id);
      continue;
    }
    let i = 2;
    while (taken.has(`${id}-${i}`)) i++;
    renames.set(id, `${id}-${i}`);
    taken.add(`${id}-${i}`);
  }
  if (renames.size === 0) return copy;
  let json = JSON.stringify(copy);
  for (const [from, to] of renames) {
    json = json.split(`"id":${JSON.stringify(from)}`).join(`"id":${JSON.stringify(to)}`);
    json = json.split(`"overlayNodeId":${JSON.stringify(`@${from}`)}`).join(`"overlayNodeId":${JSON.stringify(`@${to}`)}`);
  }
  return JSON.parse(json) as NodeTemplate;
}

/** Case-insensitive search over block names, descriptions and keywords. */
export function matchesBlock(block: Pick<BlockTemplate, 'name' | 'description' | 'keywords'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${block.name} ${block.description} ${(block.keywords ?? []).join(' ')}`.toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}
