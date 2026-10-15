/**
 * Store-level operations used by the Data panel and dialogs. Every mutation goes through store
 * actions (`commit` for multi-field changes so they form a single undo step).
 */
import { describeError, getConnectorClient, type CrmRecordSummary } from '../connect';
import { asOneUndoStep } from '../model/history';
import { smartInsertTarget } from '../dnd/dragState';
import { selectActiveExtension, useEditor } from '../model/store';
import { nodeLabel, walk } from '../model/tree';
import type { ActionStep, DataSource, DataSourceKind, Extension, JsonValue, NodeId, Project } from '../model/types';
import { getComponent } from '../registry';
import { mockDataForSource, mockFunctionResult, objectTypeName, sampleValue } from '../runtime/mockData';
import { createDataSource } from './dataSourceMeta';
import { renameReferences } from './findUsages';
import { generateUiForSource, type GenerateLabels } from './generators';
import { PORTAL_LABELS } from './portal';

function activeExt(): Extension {
  return selectActiveExtension(useEditor.getState());
}

/** Renames a state variable and every reference to it. Returns the number of updated references. */
export function renameStateVar(id: string, name: string): number {
  const ext = activeExt();
  const v = ext.state.find((s) => s.id === id);
  if (!v || v.name === name) return 0;
  const old = v.name;
  let changed = 0;
  useEditor.getState().commit((draft) => {
    const e = draft.extensions.find((x) => x.id === ext.id);
    const dv = e?.state.find((s) => s.id === id);
    if (!e || !dv) return;
    dv.name = name;
    changed = renameReferences(e as Extension, old, name);
  });
  return changed;
}

/** Renames a data source and every reference to it (and its Loading/Error names). */
export function renameDataSource(id: string, name: string): number {
  const ext = activeExt();
  const ds = ext.dataSources.find((d) => d.id === id);
  if (!ds || ds.name === name) return 0;
  const old = ds.name;
  let changed = 0;
  useEditor.getState().commit((draft) => {
    const e = draft.extensions.find((x) => x.id === ext.id);
    const dd = e?.dataSources.find((d) => d.id === id);
    if (!e || !dd) return;
    dd.name = name;
    changed = renameReferences(e as Extension, old, name);
  });
  return changed;
}

/** Adds a data source of a kind with sensible defaults (creating an app function if needed). */
export function addDataSourceOfKind(kind: DataSourceKind): DataSource {
  // Creating the function and the data source that runs it is one undo step.
  return asOneUndoStep(() => {
    const store = useEditor.getState();
    let functions = store.project.functions;
    if (kind === 'function' && functions.length === 0) {
      store.addFunction();
      functions = useEditor.getState().project.functions;
    }
    const ds = createDataSource(kind, activeExt(), functions);
    return useEditor.getState().addDataSource(ds);
  });
}

/**
 * Inserts the generated "show this data" block at the smart insert position (into / after the
 * selection, else at the end of the card). Returns the new node id or null when nothing accepts it.
 * Labels (list labels, table headers) come from the connected HubSpot account when its
 * properties are loaded, else from the built-in catalog.
 */
export function insertGeneratedUi(dataSourceId: string, labels: GenerateLabels = PORTAL_LABELS): NodeId | null {
  const store = useEditor.getState();
  const ext = selectActiveExtension(store);
  const ds = ext.dataSources.find((d) => d.id === dataSourceId);
  if (!ds) return null;
  const tpl = generateUiForSource(ds, ext.kind === 'card' ? ext.objectTypes : [], labels);
  const target = smartInsertTarget(ext, store.selectedNodeId, tpl.type);
  if (!target) return null;
  return store.insertNode(tpl, target, { select: true });
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export interface FunctionUsage {
  extensionId: string;
  extensionName: string;
  nodeId?: string;
  /** e.g. `Data source “quote”` or `Button: Save · On click`. */
  location: string;
}

function stepsRunFunction(steps: ActionStep[] | undefined, fnId: string): boolean {
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s) continue;
    if (s.type === 'runFunction' && s.functionId === fnId) return true;
    if (s.type === 'if' && (stepsRunFunction(s.then, fnId) || stepsRunFunction(s.else, fnId))) return true;
    if ((s.type === 'fetch' || s.type === 'runFunction') && (stepsRunFunction(s.onSuccess, fnId) || stepsRunFunction(s.onError, fnId))) {
      return true;
    }
  }
  return false;
}

/** Every function data source and runFunction action that calls the function. */
export function findFunctionUsages(project: Project, fnId: string): FunctionUsage[] {
  const out: FunctionUsage[] = [];
  for (const ext of project.extensions) {
    for (const ds of ext.dataSources) {
      if (ds.kind === 'function' && ds.functionId === fnId) {
        out.push({ extensionId: ext.id, extensionName: ext.name, location: `Data source “${ds.name}”` });
      }
    }
    walk(ext, (node) => {
      for (const [event, steps] of Object.entries(node.events ?? {})) {
        if (!stepsRunFunction(steps, fnId)) continue;
        const def = getComponent(node.type);
        const eventLabel = def?.events?.find((e) => e.name === event)?.label ?? event;
        out.push({
          extensionId: ext.id,
          extensionName: ext.name,
          nodeId: node.id,
          location: `${nodeLabel(node, def?.label)} · ${eventLabel}`,
        });
      }
    });
  }
  return out;
}

/** Selects a node in another (or the same) extension. */
export function revealNode(extensionId: string, nodeId?: string): void {
  const store = useEditor.getState();
  if (store.activeExtensionId !== extensionId) store.setActiveExtension(extensionId);
  if (nodeId) useEditor.getState().select(nodeId);
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

/** Properties referenced by crmProperties sources that have no mock value yet. */
export function missingMockProperties(ext: Extension): string[] {
  const have = ext.mock?.properties ?? {};
  const out: string[] = [];
  for (const ds of ext.dataSources) {
    if (ds.kind !== 'crmProperties') continue;
    for (const p of ds.properties ?? []) if (p && have[p] === undefined && !out.includes(p)) out.push(p);
  }
  return out;
}

/** Adds sample values for every missing record property. Returns how many were added. */
export function addMissingMockProperties(): number {
  const ext = activeExt();
  const missing = missingMockProperties(ext);
  if (missing.length === 0) return 0;
  const objectType = objectTypeName(ext.mock?.context?.crm?.objectTypeId ?? ext.objectTypes?.[0]);
  const objectId = ext.mock?.context?.crm?.objectId ?? 1;
  useEditor.getState().updateMock((m) => {
    for (const p of missing) m.properties[p] = sampleValue(p, { objectType, index: 0, objectId }) ?? '';
  });
  return missing.length;
}

/** A sample mock value for a data source (generated rows, the function mock or a JSON stub). */
export function sampleMockForSource(ext: Extension, ds: DataSource): JsonValue {
  const without: Extension = {
    ...ext,
    mock: { ...ext.mock, dataSources: Object.fromEntries(Object.entries(ext.mock.dataSources).filter(([k]) => k !== ds.id)) },
  };
  const generated = mockDataForSource(without, ds) as JsonValue | undefined;
  if (generated !== null && generated !== undefined) return JSON.parse(JSON.stringify(generated)) as JsonValue;
  if (ds.kind === 'function') return mockFunctionResult(ext, ds.functionId) as JsonValue;
  return { id: 1, name: 'Sample item', status: 'active', updatedAt: '2026-10-01T12:00:00.000Z' };
}

/** Record properties the mock should hold: its current keys plus every crmProperties property. */
export function mockRecordPropertyNames(ext: Extension): string[] {
  const out: string[] = [];
  const add = (p: unknown) => {
    if (typeof p === 'string' && /^[A-Za-z0-9_]+$/.test(p) && !out.includes(p)) out.push(p);
  };
  for (const k of Object.keys(ext.mock?.properties ?? {})) add(k);
  for (const ds of ext.dataSources) if (ds.kind === 'crmProperties') for (const p of ds.properties ?? []) add(p);
  return out;
}

export type CopyRecordResult = { ok: true; count: number } | { ok: false; message: string };

/**
 * Reads a real record through the HubSpot connector and copies its values into the extension's
 * mock record (and the mock context's record id / type) as ONE undo step. With no names the
 * account's default properties are copied.
 */
export async function copyRecordIntoMock(
  extensionId: string,
  record: Pick<CrmRecordSummary, 'id' | 'objectType' | 'objectTypeId'>,
  names: string[],
): Promise<CopyRecordResult> {
  let properties: Record<string, string | null>;
  try {
    const fetched = await getConnectorClient().getRecord(record.objectTypeId || record.objectType, record.id, names.length ? { properties: names } : {});
    properties = fetched && typeof fetched === 'object' && fetched.properties && typeof fetched.properties === 'object' ? fetched.properties : {};
  } catch (err) {
    return { ok: false, message: describeError(err).message };
  }
  const keys = (names.length ? names : Object.keys(properties)).filter((k) => /^[A-Za-z0-9_]+$/.test(k));
  const id = Number(record.id);
  useEditor.getState().commit((draft) => {
    const e = draft.extensions.find((x) => x.id === extensionId);
    if (!e) return;
    for (const k of keys) {
      const v = Object.prototype.hasOwnProperty.call(properties, k) ? properties[k] : null;
      e.mock.properties[k] = v === null || v === undefined ? '' : String(v);
    }
    if (e.kind === 'card') {
      if (Number.isSafeInteger(id) && id > 0) e.mock.context.crm.objectId = id;
      if (record.objectTypeId) e.mock.context.crm.objectTypeId = record.objectTypeId;
    }
  });
  return { ok: true, count: keys.length };
}
