/**
 * Expression scope construction for the preview runtime.
 *
 * The base scope mirrors what generated code has in scope inside the extension component:
 *   - helper functions / constants declared in Extension.helpers (module level: shadowed by
 *     every other name)
 *   - each state variable `<name>` and its setter `set<Name>`
 *   - each data source `<name>`, `<name>Loading`, `<name>Error`
 *   - `context` (HubSpot extension context: user, portal, crm, location, extension)
 *   - computed values, evaluated in order after everything above (each sees the earlier ones)
 * Repeat items and event handler params are layered on top by the renderer / action runner.
 */
import { defaultMockData } from '../model/factory';
import { extensionLocation } from '../model/rules';
import type { Extension, JsonValue, Project, StateVar } from '../model/types';
import { usableComputed } from '../power/computed';
import { compileHelpers } from '../power/helpers';
import { evaluate, type Scope } from './expr';
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

/** Problems found while building the scope (reported in the console, shown in the Data panel). */
export interface ScopeDiagnostics {
  /** Error compiling or running the extension's helper code, or null. */
  helpersError: string | null;
  /** Errors of computed values keyed by computed value id (their value is `undefined`). */
  computedErrors: Record<string, string>;
}

export interface ScopeWithDiagnostics {
  scope: Scope;
  diagnostics: ScopeDiagnostics;
}

/**
 * Evaluates the extension's computed values in declaration order on top of `scope` (mutated:
 * each value is added as soon as it is computed, so later values see earlier ones). Computed
 * values run like render code: calling a state setter while computing is an error (it would loop),
 * but functions a computed value returns may call setters later (e.g. from an event handler).
 * Errors never throw: the value becomes `undefined` and the message is returned per id.
 */
export function applyComputedValues(
  extension: Pick<Extension, 'state' | 'dataSources' | 'computed'>,
  scope: Scope,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const list = usableComputed(extension);
  if (list.length === 0) return errors;
  let computing: string | null = null;
  const evalScope: Scope = { ...scope };
  for (const v of extension.state ?? []) {
    const name = setterName(v.name);
    const real = scope[name];
    if (typeof real !== 'function') continue;
    evalScope[name] = (...args: unknown[]) => {
      if (computing !== null) {
        throw new Error(`computed values cannot change state (${name} was called while computing “${computing}”)`);
      }
      return (real as (...a: unknown[]) => unknown)(...args);
    };
  }
  for (const c of list) {
    computing = c.name;
    let value: unknown;
    if (typeof c.expr === 'string' && c.expr.trim() !== '') {
      const r = evaluate(c.expr, evalScope);
      if (r.ok) value = r.value;
      else errors[c.id] = r.error;
    }
    computing = null;
    evalScope[c.name] = value;
    scope[c.name] = value;
  }
  return errors;
}

/**
 * Builds the base expression scope (see module comment) plus helper functions (module level, so
 * every other name shadows them) and computed values (after everything else, in order).
 */
export function buildScopeWithDiagnostics({ project, extension, stateValues, setters, dataSources }: BaseScopeInput): ScopeWithDiagnostics {
  const scope: Scope = {};
  const helpers = compileHelpers(extension.helpers);
  for (const name of helpers.names) {
    if (name in helpers.values) scope[name] = helpers.values[name];
  }
  scope.context = buildContext(project, extension);
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
  const computedErrors = applyComputedValues(extension, scope);
  return { scope, diagnostics: { helpersError: helpers.error, computedErrors } };
}

/** Builds the base expression scope (see buildScopeWithDiagnostics). */
export function buildBaseScope(input: BaseScopeInput): Scope {
  return buildScopeWithDiagnostics(input).scope;
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
