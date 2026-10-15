/**
 * Expression scope construction for the preview runtime.
 *
 * The base scope mirrors what generated code has in scope inside the extension component:
 *   - each state variable `<name>` and its setter `set<Name>`
 *   - each data source `<name>`, `<name>Loading`, `<name>Error`
 *   - `context` (HubSpot extension context: user, portal, crm, location, extension)
 * Repeat items and event handler params are layered on top by the renderer / action runner.
 */
import { defaultMockData } from '../model/factory';
import { extensionLocation } from '../model/rules';
import type { Extension, JsonValue, Project, StateVar } from '../model/types';
import type { Scope } from './expr';
import { isDeferredSource, mockDataForSource } from './mockData';
import type { DataSourceState } from './types';

/** `count` -> `setCount` (the setter name generated for a state variable). */
export function setterName(stateName: string): string {
  return `set${stateName.charAt(0).toUpperCase()}${stateName.slice(1)}`;
}

/** The HubSpot `context` object simulated for an extension (mock context + location + app info). */
export function buildContext(project: Project, ext: Extension): Record<string, unknown> {
  const mock = ext.mock?.context ?? defaultMockData().context;
  const user = mock.user ?? defaultMockData().context.user;
  return {
    ...mock,
    // HubSpot's UserContext also carries these lists; the mock values take precedence.
    user: { emails: user.email ? [user.email] : [], teams: [], roles: [], permissions: [], ...user },
    portal: { ...mock.portal },
    crm: { ...mock.crm },
    location: extensionLocation(ext),
    extension: { appId: 1, appName: project.app.name, cardTitle: ext.name },
  };
}

function cloneJson(value: JsonValue): unknown {
  return value !== null && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
}

/** Initial values of all state variables (deep-copied so the document is never mutated). */
export function initialStateValues(vars: StateVar[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const v of vars) out[v.name] = cloneJson(v.initial);
  return out;
}

function stateVarKey(v: StateVar): string {
  return JSON.stringify([v.id, v.name, v.type, v.initial]);
}

/** A string that changes whenever a state variable is added, removed, renamed, retyped or re-initialised. */
export function stateSignature(vars: StateVar[]): string {
  return vars.map(stateVarKey).join('\n');
}

/**
 * Carries runtime values over a change of state variable definitions: variables whose definition
 * (id, name, type, initial value) is unchanged keep their current value; every other variable
 * starts from its initial value.
 */
export function reconcileStateValues(
  prevVars: StateVar[],
  nextVars: StateVar[],
  prevValues: Record<string, unknown>,
): Record<string, unknown> {
  const unchanged = new Set(prevVars.map(stateVarKey));
  const out: Record<string, unknown> = {};
  for (const v of nextVars) {
    out[v.name] = unchanged.has(stateVarKey(v)) && v.name in prevValues ? prevValues[v.name] : cloneJson(v.initial);
  }
  return out;
}

/** Per data source runtime status (keyed by data source id). */
export interface DataSourceStatus {
  loading: boolean;
  error: string | null;
  /** Has been run at least once (fetch/function sources that do not run on mount). */
  loaded: boolean;
}

/** Resolves every data source's exposed value + status. Keyed by data source id. */
export function resolveDataSources(
  ext: Extension,
  status: Record<string, DataSourceStatus | undefined>,
): Record<string, DataSourceState> {
  const out: Record<string, DataSourceState> = {};
  for (const ds of ext.dataSources ?? []) {
    const st = status[ds.id];
    let data: unknown = null;
    let error = st?.error ?? null;
    if (!isDeferredSource(ds) || st?.loaded) {
      try {
        data = mockDataForSource(ext, ds);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
    out[ds.id] = { data, loading: st?.loading ?? false, error };
  }
  return out;
}

export interface BaseScopeInput {
  project: Project;
  extension: Extension;
  stateValues: Record<string, unknown>;
  /** Setter per state variable name. */
  setters: Record<string, (value: unknown) => void>;
  /** Data source states keyed by data source id. */
  dataSources: Record<string, DataSourceState>;
}

/** Builds the base expression scope (see module comment). */
export function buildBaseScope({ project, extension, stateValues, setters, dataSources }: BaseScopeInput): Scope {
  const scope: Scope = { context: buildContext(project, extension) };
  for (const ds of extension.dataSources ?? []) {
    const st = dataSources[ds.id];
    scope[ds.name] = st ? st.data : null;
    scope[`${ds.name}Loading`] = st ? st.loading : false;
    scope[`${ds.name}Error`] = st ? st.error : null;
  }
  for (const v of extension.state ?? []) {
    scope[v.name] = stateValues[v.name];
    const setter = setters[v.name];
    if (setter) scope[setterName(v.name)] = setter;
  }
  return scope;
}

const noop = () => {};

/**
 * A static scope with initial state values, no-op setters and initial data source values. Useful
 * outside a RuntimeProvider (e.g. live value previews in the inspector).
 */
export function createInitialScope(project: Project, extension: Extension): Scope {
  const setters: Record<string, (value: unknown) => void> = {};
  for (const v of extension.state ?? []) setters[v.name] = noop;
  return buildBaseScope({
    project,
    extension,
    stateValues: initialStateValues(extension.state ?? []),
    setters,
    dataSources: resolveDataSources(extension, {}),
  });
}
