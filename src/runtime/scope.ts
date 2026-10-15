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
import { isPropertyName, tokenize } from '../model/jsTokens';
import type { DataSource, Extension, JsonValue, Project, StateVar } from '../model/types';
import { usableComputed } from '../power/computed';
import { compileHelpers, helperNames } from '../power/helpers';
import { codeExecutionAllowed } from '../model/trust';
import { evaluate, type Scope } from './expr';
import { guardLoops } from './loopGuard';
import { isDeferredSource, mockDataForSource } from './mockData';
import type { DataSourceState, LiveDataAdapter } from './types';

/** `count` -> `setCount` (the setter name generated for a state variable). */
export function setterName(stateName: string): string {
  return `set${stateName.charAt(0).toUpperCase()}${stateName.slice(1)}`;
}

/**
 * The HubSpot `context` object simulated for an extension (mock context + location + app info).
 * Only app cards get `crm` (the record): HubSpot's SettingsContext / AppHomeContext have none, so
 * `context.crm.objectId` fails in the preview of a settings or home page exactly as it would there.
 *
 * With live HubSpot data (`live`, see LiveDataAdapter.context) the portal, the signed-in user and
 * the sample record come from HubSpot: `{{ context.user.email }}` shows the real user. User names
 * and ids are used when the connection provides them; the locale and other fields stay mock.
 */
export function buildContext(project: Project, ext: Extension, live?: LiveDataAdapter['context'] | null): Record<string, unknown> {
  const mock = ext.mock?.context ?? defaultMockData().context;
  const mockUser = mock.user ?? defaultMockData().context.user;
  const { crm: mockCrm, ...rest } = mock;
  let user: Record<string, unknown> = { ...mockUser };
  let portal: Record<string, unknown> = { ...mock.portal };
  let crm: Record<string, unknown> = { ...mockCrm };
  if (live) {
    const liveUser = live.user;
    if (liveUser && typeof liveUser.email === 'string') {
      user = { ...user, email: liveUser.email };
      if (typeof liveUser.id === 'number') user.id = liveUser.id;
      if (typeof liveUser.firstName === 'string') user.firstName = liveUser.firstName;
      if (typeof liveUser.lastName === 'string') user.lastName = liveUser.lastName;
    }
    if (live.portal && typeof live.portal.id === 'number') {
      portal = { ...portal, id: live.portal.id };
      if (typeof live.portal.timezone === 'string' && live.portal.timezone) portal.timezone = live.portal.timezone;
    }
    if (live.crm) crm = { objectId: live.crm.objectId, objectTypeId: live.crm.objectTypeId };
  }
  const email = typeof user.email === 'string' ? user.email : '';
  return {
    ...rest,
    // HubSpot's UserContext also carries these lists; the mock values take precedence.
    user: { emails: email ? [email] : [], teams: [], roles: [], permissions: [], ...user },
    portal,
    ...(ext.kind === 'card' ? { crm } : {}),
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
  /**
   * Has finished loading at least once. While a source is loading for the first time it exposes
   * the value HubSpot gives on the first render (see initialDataValue), not its mock data.
   */
  loaded: boolean;
}

/** Message of a data source simulated to fail (Mock data › Simulate › Error). */
export const SIMULATED_ERROR = 'Simulated error (Mock data › Simulate)';

/**
 * The value a data source exposes before its first load completes, exactly as on HubSpot:
 * useCrmProperties returns `{}`, useAssociations / useCrmSearch `[]`, and fetch / function
 * sources start as `null`. Expressions such as `deals[0].properties.x` fail on this value.
 */
export function initialDataValue(ds: DataSource): unknown {
  switch (ds.kind) {
    case 'crmProperties':
      return {};
    case 'associations':
    case 'crmSearch':
      return [];
    default:
      return null;
  }
}

/** The loaded value of a source simulated as "empty": no records, null properties / response. */
function emptyDataValue(ds: DataSource): unknown {
  if (ds.kind === 'crmProperties') return Object.fromEntries((ds.properties ?? []).filter(Boolean).map((p) => [p, null]));
  return initialDataValue(ds);
}

/** Sources that load when the extension opens: CRM hooks and fetch / function sources set to run on open. */
export function loadsOnOpen(ds: DataSource): boolean {
  return !isDeferredSource(ds);
}

/**
 * Status of every source that loads when the extension opens, at the moment it opens (the
 * preview starts in this state, then RuntimeProvider completes each load after the simulated
 * latency).
 */
export function initialLoadStatus(ext: Extension): Record<string, DataSourceStatus> {
  const out: Record<string, DataSourceStatus> = {};
  for (const ds of ext.dataSources ?? []) {
    if (loadsOnOpen(ds)) out[ds.id] = { loading: true, error: null, loaded: false };
  }
  return out;
}

/**
 * Other data sources whose values a fetch / function source's request reads (URL and header
 * templates, body, parameters) — a "load on open" request waits for them, like generated code.
 */
export function requestDependencies(ext: Extension, ds: DataSource): DataSource[] {
  if (ds.kind !== 'fetch' && ds.kind !== 'function') return [];
  const codes: string[] = [];
  const template = (v: unknown) => {
    if (typeof v === 'string') for (const m of v.matchAll(/\{\{([\s\S]*?)\}\}/g)) codes.push(m[1]);
  };
  if (ds.kind === 'fetch') {
    template(ds.url);
    (ds.headers ?? []).forEach((h) => template(h?.value));
    if ((ds.method ?? 'GET').toUpperCase() !== 'GET' && typeof ds.body === 'string') codes.push(ds.body);
  } else if (typeof ds.parameters === 'string') {
    codes.push(ds.parameters);
  }
  const ids = new Set<string>();
  for (const code of codes) {
    const tokens = tokenize(code);
    tokens.forEach((t, i) => {
      if (t.kind === 'ident' && !isPropertyName(tokens, i)) ids.add(t.text);
    });
  }
  return (ext.dataSources ?? []).filter(
    (other) => other.id !== ds.id && loadsOnOpen(other) && [other.name, `${other.name}Loading`, `${other.name}Error`].some((n) => ids.has(n)),
  );
}

/**
 * Resolves every data source's exposed value + status. Keyed by data source id.
 *  - first load in progress: the initial value (`{}` / `[]` / `null`), loading
 *  - fetch / function sources that do not load on open: `null` until run
 *  - otherwise the mock data — or what `mock.simulate` asks for (loading / empty / error)
 */
export function resolveDataSources(
  ext: Extension,
  status: Record<string, DataSourceStatus | undefined>,
): Record<string, DataSourceState> {
  const out: Record<string, DataSourceState> = {};
  for (const ds of ext.dataSources ?? []) {
    const st = status[ds.id];
    const simulate = ext.mock?.simulate?.[ds.id] ?? 'ok';
    const loading = st?.loading ?? false;
    let data: unknown = null;
    let error = st?.error ?? null;
    if (simulate === 'loading') {
      out[ds.id] = { data: initialDataValue(ds), loading: true, error: null };
      continue;
    }
    if (loading && !st?.loaded) {
      out[ds.id] = { data: initialDataValue(ds), loading: true, error: null };
      continue;
    }
    if (!isDeferredSource(ds) || st?.loaded) {
      if (simulate === 'empty') data = emptyDataValue(ds);
      else if (simulate === 'error') {
        data = initialDataValue(ds);
        error = loading ? null : SIMULATED_ERROR;
      } else {
        try {
          data = mockDataForSource(ext, ds);
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
      }
    }
    out[ds.id] = { data, loading, error };
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
  /** Live HubSpot context (portal, user, sample record) overriding the mock context. */
  liveContext?: LiveDataAdapter['context'] | null;
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
      // Paused (untrusted) code is not an error of the computed value.
      else if (!r.blocked) errors[c.id] = r.error;
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
export function buildScopeWithDiagnostics({ project, extension, stateValues, setters, dataSources, liveContext }: BaseScopeInput): ScopeWithDiagnostics {
  const scope: Scope = {};
  // Helper code runs once per source text — only when the project's code is trusted, and with
  // its loops guarded so a runaway loop throws instead of freezing the tab.
  const helpers = codeExecutionAllowed()
    ? compileHelpers(typeof extension.helpers === 'string' ? guardLoops(extension.helpers) : extension.helpers)
    : { names: helperNames(extension.helpers), values: {} as Record<string, unknown>, error: null };
  for (const name of helpers.names) {
    if (name in helpers.values) scope[name] = helpers.values[name];
  }
  scope.context = buildContext(project, extension, liveContext);
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
