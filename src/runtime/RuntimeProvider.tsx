/**
 * <RuntimeProvider> owns the simulated card runtime for one extension: state values, data source
 * states, open overlays, alerts, the iframe modal, tooltips and the console log. It exposes the
 * RuntimeApi (src/runtime/types.ts) through context; see context.ts for how contexts are split.
 *
 * Reset rules:
 *  - `resetKey` change (or reset(), or switching to another extension): everything returns to its
 *    initial values (state, data sources, overlays, alerts, iframe modal). Logs are kept.
 *  - Preview sessions start like the card opens on HubSpot: CRM hooks and "load on open" sources
 *    begin loading with HubSpot's first-render values (`{}`, `[]`, `null`) and get their mock data
 *    after RUNTIME_TIMING.dataSourceLatencyMs; a request that reads other sources waits for them.
 *  - State variable definitions change: variables whose definition is unchanged keep their value,
 *    others start from their initial value.
 *  - Switching to design mode closes overlays, alerts, the iframe modal and tooltips.
 *
 * Live HubSpot data (`live`, see LiveDataAdapter in ./types and ./live.ts): CRM sources (and fetch
 * sources when the connector proxies hubspot.fetch) load from the portal in both modes, with
 * HubSpot's async semantics — loading with the first-render values (`{}` / `[]`), then the real
 * data or an error (`<name>Error` + a console entry). A source's first load waits for the sources
 * its request reads; afterwards a CRM source re-runs when its request changes (debounced by
 * RUNTIME_TIMING.liveDebounceMs), like a hook whose inputs changed. A reset, entering preview or a
 * new `live.key` (another record / portal) loads everything again; responses of an older load, a
 * superseded request or an unmounted runtime are ignored. App functions keep their mock results.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { codeTrustVersion, subscribeCodeTrust } from '../model/trust';
import { getComponent } from '../registry';
import type { ActionStep, AlertType, DataSource, NodeId, Project, Extension, StateVar } from '../model/types';
import { executeActions, RUNTIME_TIMING, type ActionHost } from './actions';
import { isLiveSource, liveDataKey, liveGates, planLiveRequest, type LiveRequestFailure, type LiveRequestPlan } from './live';
import { elapsedMs, isAbortLike, liveErrorInfo, now } from './liveErrors';
import {
  ControlsContext,
  RenderContext,
  RuntimeContext,
  type InternalRuntimeApi,
  type OpenOverlayEntry,
  type RenderState,
  type RuntimeControls,
  type TooltipState,
} from './context';
import { resolvePropValue, type Scope } from './expr';
import { interpolate } from './expr';
import { isDeferredSource, mockDataForSource } from './mockData';
import {
  buildScopeWithDiagnostics,
  initialDataValue,
  initialLoadStatus,
  initialStateValues,
  loadsOnOpen,
  reconcileStateValues,
  requestDependencies,
  resolveDataSources,
  SIMULATED_ERROR,
  stateSignature,
  type DataSourceStatus,
} from './scope';
import type { IframeModalState, LiveDataAdapter, RuntimeAlert, RuntimeLogEntry } from './types';
import { LiveCrmProvider, type LiveCrmSource } from '../preview/liveCrm';
import './runtime.css';

/** Oldest log entries are dropped beyond this many. */
export const MAX_LOG_ENTRIES = 500;
/** At most this many alerts are visible at once (oldest dropped first). */
export const MAX_VISIBLE_ALERTS = 5;
/** Helper / computed value errors are reported once editing pauses for this long. */
export const DIAGNOSTICS_DEBOUNCE_MS = 800;

export interface RuntimeProviderProps {
  project: Project;
  extension: Extension;
  mode: 'design' | 'preview';
  /** Changing this value resets the runtime (state, data, overlays, alerts) to initial values. */
  resetKey?: string | number;
  /** Real HubSpot data (see LiveDataAdapter in ./types). Null/undefined = mock data. */
  live?: LiveDataAdapter | null;
  children?: ReactNode;
}

interface StateStore {
  sig: string;
  vars: StateVar[];
  values: Record<string, unknown>;
}

/** Runtime value of a data source that loads live (see LiveDataAdapter). */
interface LiveEntry {
  kind: DataSource['kind'];
  data: unknown;
  loading: boolean;
  error: string | null;
  /** Has finished loading at least once in this live session. */
  loaded: boolean;
}

/** Live data of one session (`epoch` changes on reset, entering preview and a new live key). */
interface LiveStore {
  epoch: number;
  entries: Record<string, LiveEntry>;
}

/** Bookkeeping of the live requests of the current session (not rendered). */
interface LiveRequests {
  /** Kind + request signature of each source's latest request. */
  ran: Map<string, { kind: DataSource['kind']; sig: string }>;
  /** Signature a debounced re-run is waiting to load. */
  pending: Map<string, string>;
  timers: Map<string, ReturnType<typeof setTimeout>>;
  /** Generation of each source's latest request: older responses are ignored. */
  gens: Map<string, number>;
  seq: number;
}

/** A live source before its first load: loading with HubSpot's first-render value (or idle until run). */
function initialLiveEntry(ds: DataSource): LiveEntry {
  return isDeferredSource(ds)
    ? { kind: ds.kind, data: null, loading: false, error: null, loaded: false }
    : { kind: ds.kind, data: initialDataValue(ds), loading: true, error: null, loaded: false };
}

function initialLiveEntries(ext: Extension, live: LiveDataAdapter | null): Record<string, LiveEntry> {
  const out: Record<string, LiveEntry> = {};
  if (!live) return out;
  for (const ds of ext.dataSources ?? []) if (isLiveSource(ds, live)) out[ds.id] = initialLiveEntry(ds);
  return out;
}

const DATA_SOURCE_LABEL: Record<string, string> = {
  crmProperties: 'useCrmProperties',
  associations: 'useAssociations',
  crmSearch: 'useCrmSearch',
  fetch: 'hubspot.fetch',
  function: 'hubspot.serverless',
};

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Dependency depth of an on-open source (0 = loads right away, 1 = waits for one level, ...). */
function loadDepths(ext: Extension): Map<string, number> {
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (ds: DataSource): number => {
    const known = depths.get(ds.id);
    if (known !== undefined) return known;
    if (visiting.has(ds.id)) return 0; // a cycle: load without waiting
    visiting.add(ds.id);
    const deps = requestDependencies(ext, ds);
    const d = deps.length ? Math.max(...deps.map(depthOf)) + 1 : 0;
    visiting.delete(ds.id);
    depths.set(ds.id, d);
    return d;
  };
  (ext.dataSources ?? []).filter(loadsOnOpen).forEach(depthOf);
  return depths;
}

export function RuntimeProvider({ project, extension, mode, resetKey = 0, live = null, children }: RuntimeProviderProps) {
  // Latest props for callbacks that outlive a render (async handlers, timers, overlay unmounts).
  const projectRef = useRef(project);
  projectRef.current = project;
  const extRef = useRef(extension);
  extRef.current = extension;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const liveRef = useRef<LiveDataAdapter | null>(live);
  liveRef.current = live;
  const liveKey = liveDataKey(live);
  const mountedRef = useRef(false);
  /** Bumped on every reset: async work started in an older session is discarded. */
  const sessionRef = useRef(0);
  /** Sequence for log / alert ids. */
  const seqRef = useRef(0);

  const [resetCounter, setResetCounter] = useState(0);
  const resetToken = `${extension.id}|${String(resetKey)}|${resetCounter}`;

  // ---------------------------------------------------------------- state values
  const sig = useMemo(() => stateSignature(extension.state ?? []), [extension.state]);
  const [stateStore, setStateStore] = useState<StateStore>(() => ({
    sig,
    vars: extension.state ?? [],
    values: initialStateValues(extension.state ?? []),
  }));
  const [dsStatus, setDsStatus] = useState<Record<string, DataSourceStatus>>(() =>
    mode === 'preview' ? initialLoadStatus(extension) : {},
  );
  const [overlays, setOverlays] = useState<OpenOverlayEntry[]>([]);
  const [alerts, setAlerts] = useState<RuntimeAlert[]>([]);
  const [iframeModal, setIframeModal] = useState<IframeModalState | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [logs, setLogs] = useState<RuntimeLogEntry[]>([]);
  const [hostCount, setHostCount] = useState(0);
  const [applied, setApplied] = useState({ resetToken, mode, liveKey, liveEpoch: 0 });
  const [liveState, setLiveStore] = useState<LiveStore>(() => ({ epoch: 0, entries: initialLiveEntries(extension, live) }));

  // Derived resets are applied while rendering (React re-renders immediately), so a stale frame
  // with old values is never committed.
  const isReset = applied.resetToken !== resetToken;
  const liveChanged = applied.liveKey !== liveKey;
  // Data loads again on a reset, when a preview session starts and when live data changes
  // (connected / disconnected, another sample record or portal).
  const dataReset = isReset || (applied.mode !== mode && mode === 'preview') || liveChanged;
  let store = stateStore;
  if (dataReset) {
    // A preview session opens like the card on HubSpot: data that loads on open starts loading.
    setDsStatus(mode === 'preview' ? initialLoadStatus(extension) : {});
  } else if (applied.mode !== mode) {
    setDsStatus({});
  }
  const liveEpoch = dataReset ? applied.liveEpoch + 1 : applied.liveEpoch;
  let liveStore = liveState;
  if (liveStore.epoch !== liveEpoch) {
    liveStore = { epoch: liveEpoch, entries: initialLiveEntries(extension, live) };
    setLiveStore(liveStore);
  }
  const liveEpochRef = useRef(liveEpoch);
  liveEpochRef.current = liveEpoch;
  if (isReset) {
    store = { sig, vars: extension.state ?? [], values: initialStateValues(extension.state ?? []) };
    setStateStore(store);
  } else if (stateStore.sig !== sig) {
    store = { sig, vars: extension.state ?? [], values: reconcileStateValues(stateStore.vars, extension.state ?? [], stateStore.values) };
    setStateStore(store);
  }
  if (isReset || applied.mode !== mode || liveChanged) {
    if (isReset || (applied.mode !== mode && mode === 'design')) {
      setOverlays([]);
      setAlerts([]);
      setIframeModal(null);
      setTooltip(null);
    }
    setApplied({ resetToken, mode, liveKey, liveEpoch });
  }
  const stateValues = store.values;

  useEffect(() => {
    sessionRef.current += 1;
  }, [resetToken]);

  const setStateValue = useCallback((name: string, value: unknown) => {
    if (!extRef.current.state?.some((v) => v.name === name)) return;
    setStateStore((prev) => {
      const current = prev.values[name];
      // Like React's setState, a function is an updater of the previous value.
      const next = typeof value === 'function' ? (value as (prev: unknown) => unknown)(current) : value;
      if (Object.is(next, current) && name in prev.values) return prev;
      return { ...prev, values: { ...prev.values, [name]: next } };
    });
  }, []);

  const stateNamesKey = (extension.state ?? []).map((v) => v.name).join('\n');
  const setters = useMemo(() => {
    const out: Record<string, (value: unknown) => void> = {};
    for (const name of stateNamesKey ? stateNamesKey.split('\n') : []) out[name] = (value) => setStateValue(name, value);
    return out;
  }, [stateNamesKey, setStateValue]);

  // ---------------------------------------------------------------- logging
  /** Entries logged during the first render / commit (before the mount effect) are kept here. */
  const pendingLogsRef = useRef<RuntimeLogEntry[] | null>([]);
  const appendLogs = useCallback((entries: RuntimeLogEntry[]) => {
    setLogs((prev) => {
      const next = [...prev, ...entries];
      return next.length > MAX_LOG_ENTRIES ? next.slice(next.length - MAX_LOG_ENTRIES) : next;
    });
  }, []);
  const log = useCallback(
    (level: RuntimeLogEntry['level'], message: string, detail?: unknown) => {
      const entry: RuntimeLogEntry = { id: `log_${++seqRef.current}`, at: Date.now(), level, message };
      if (detail !== undefined) entry.detail = detail;
      if (!mountedRef.current) {
        // Before mount (e.g. a node failing on the first render): flushed by the mount effect.
        // After unmount the queue is gone and the entry is dropped.
        pendingLogsRef.current?.push(entry);
        return;
      }
      appendLogs([entry]);
    },
    [appendLogs],
  );
  const clearLogs = useCallback(() => setLogs([]), []);

  // ---------------------------------------------------------------- data sources
  const liveEntries = liveStore.entries;
  const dataSources = useMemo(() => {
    const out = resolveDataSources(extension, dsStatus);
    if (!live) return out;
    // Live sources expose what the portal returned (mock simulations do not apply to them).
    for (const ds of extension.dataSources ?? []) {
      if (!isLiveSource(ds, live)) continue;
      const entry = liveEntries[ds.id]?.kind === ds.kind ? liveEntries[ds.id] : initialLiveEntry(ds);
      out[ds.id] = { data: entry.data, loading: entry.loading, error: entry.error };
    }
    return out;
    // resolveDataSources reads only these parts of the extension.
  }, [extension.dataSources, extension.mock, extension.objectTypes, dsStatus, live, liveEntries]);
  const dataSourcesRef = useRef(dataSources);
  dataSourcesRef.current = dataSources;

  // ---------------------------------------------------------------- live data
  const liveRequests = useRef<LiveRequests>({ ran: new Map(), pending: new Map(), timers: new Map(), gens: new Map(), seq: 0 });

  const updateLiveEntry = useCallback((epoch: number, id: string, update: (prev: LiveEntry | undefined) => LiveEntry) => {
    setLiveStore((prev) => (prev.epoch !== epoch ? prev : { ...prev, entries: { ...prev.entries, [id]: update(prev.entries[id]) } }));
  }, []);

  /**
   * Runs a live source's request now (the plan is built from the current scope unless given).
   * Resolves once the response is applied — or ignored because a newer request, another live
   * session or an unmount superseded it.
   */
  const startLive = useCallback(
    (dsId: string, given?: LiveRequestPlan | LiveRequestFailure): Promise<void> => {
      const adapter = liveRef.current;
      const ds = extRef.current.dataSources?.find((d) => d.id === dsId);
      if (!adapter || !ds || !isLiveSource(ds, adapter)) return Promise.resolve();
      const requests = liveRequests.current;
      const timer = requests.timers.get(dsId);
      if (timer) clearTimeout(timer);
      requests.timers.delete(dsId);
      requests.pending.delete(dsId);
      const plan = given ?? planLiveRequest(ds, scopeRef.current, adapter, extRef.current.kind);
      requests.ran.set(dsId, { kind: ds.kind, sig: plan.sig });
      const gen = ++requests.seq;
      requests.gens.set(dsId, gen);
      const epoch = liveEpochRef.current;
      const isCurrent = () => mountedRef.current && liveEpochRef.current === epoch && requests.gens.get(dsId) === gen;

      if (!plan.ok) {
        updateLiveEntry(epoch, dsId, () => ({ kind: ds.kind, data: initialDataValue(ds), loading: false, error: plan.message, loaded: true }));
        log(
          plan.code === 'no_sample_record' || plan.code === 'no_record_context' ? 'warn' : 'error',
          `Live: ${plan.label} failed for ${ds.name} — ${plan.message} (${plan.code})`,
          { code: plan.code },
        );
        return Promise.resolve();
      }
      // Loading again keeps the data of an earlier load (like a hook refetching).
      updateLiveEntry(epoch, dsId, (prev) => {
        const same = prev?.kind === ds.kind && prev.loaded && prev.error === null;
        return { kind: ds.kind, data: same ? prev.data : initialDataValue(ds), loading: true, error: null, loaded: prev?.kind === ds.kind && prev.loaded };
      });
      const started = now();
      return Promise.resolve()
        .then(() => plan.perform(adapter))
        .then(
          (result) => {
            if (!isCurrent()) return;
            const latest = extRef.current.dataSources?.find((d) => d.id === dsId);
            if (!latest) return;
            updateLiveEntry(epoch, dsId, () => ({ kind: ds.kind, data: result.data, loading: false, error: null, loaded: true }));
            if (!plan.local) log('info', `Live: ${plan.label}${result.summary} for ${latest.name} — ${elapsedMs(started)} ms`, result.data);
          },
          (e: unknown) => {
            if (!isCurrent()) return;
            if (isAbortLike(e)) {
              updateLiveEntry(epoch, dsId, (prev) => ({ ...(prev ?? initialLiveEntry(ds)), loading: false }));
              return;
            }
            const info = liveErrorInfo(e);
            updateLiveEntry(epoch, dsId, () => ({ kind: ds.kind, data: initialDataValue(ds), loading: false, error: info.message, loaded: true }));
            log('error', `Live: ${plan.label} failed for ${ds.name} — ${info.message}${info.code ? ` (${info.code})` : ''}`, info.detail);
          },
        );
    },
    [log, updateLiveEntry],
  );

  const runDataSource = useCallback(
    async (idOrName: string) => {
      const ext = extRef.current;
      const ds = ext.dataSources.find((d) => d.id === idOrName) ?? ext.dataSources.find((d) => d.name === idOrName);
      if (!ds) {
        log('warn', `Data source "${idOrName}" does not exist`);
        return;
      }
      if (liveRef.current && isLiveSource(ds, liveRef.current)) {
        // Live: the request runs again right away (like query.refetch() / the loader).
        log('action', `Refetching ${ds.name} (${DATA_SOURCE_LABEL[ds.kind] ?? ds.kind})`);
        await startLive(ds.id);
        return;
      }
      const session = sessionRef.current;
      setDsStatus((prev) => ({ ...prev, [ds.id]: { loading: true, error: null, loaded: prev[ds.id]?.loaded ?? false } }));
      log('action', `Refetching ${ds.name} (${DATA_SOURCE_LABEL[ds.kind] ?? ds.kind})`);
      await delay(RUNTIME_TIMING.dataSourceLatencyMs);
      if (!mountedRef.current || sessionRef.current !== session) return;
      setDsStatus((prev) => ({ ...prev, [ds.id]: { loading: false, error: null, loaded: true } }));
      logLoaded(extRef.current, ds);
    },
    [log, startLive],
  );

  /** Console entry for a finished (mock) load, explaining simulated states and missing mocks. */
  const logLoaded = useCallback(
    (ext: Extension, ds: DataSource) => {
      const simulate = ext.mock?.simulate?.[ds.id];
      if (simulate === 'error') {
        log('error', `${ds.name} failed: ${SIMULATED_ERROR}`);
        return;
      }
      if (simulate === 'empty') {
        log('info', `${ds.name} loaded with no data (simulated empty result)`);
        return;
      }
      const data = mockDataForSource(ext, ds);
      if ((ds.kind === 'fetch' || ds.kind === 'function') && data === null) {
        log(
          'warn',
          `${ds.name} has no mock data, so it stays null in the preview. Add a sample response in Data › Mock data ` +
            `to see your card with data (on HubSpot the real ${ds.kind === 'fetch' ? 'API' : 'function'} answers).`,
        );
        return;
      }
      log('info', `${ds.name} loaded (mock data)`, data);
    },
    [log],
  );

  // Preview start: complete the loads that started on open (see initialLoadStatus), each after
  // the simulated latency — sources whose request reads other sources one latency later.
  useEffect(() => {
    if (mode !== 'preview') return undefined;
    const ext = extRef.current;
    const depths = loadDepths(ext);
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    for (const ds of ext.dataSources ?? []) {
      const depth = depths.get(ds.id);
      if (depth === undefined || ext.mock?.simulate?.[ds.id] === 'loading') continue;
      // Live sources load from HubSpot (see the live data effects below).
      if (isLiveSource(ds, liveRef.current)) continue;
      timers.push(
        setTimeout(() => {
          if (!mountedRef.current) return;
          setDsStatus((prev) => (prev[ds.id]?.loaded ? prev : { ...prev, [ds.id]: { loading: false, error: null, loaded: true } }));
          const latest = extRef.current;
          const current = latest.dataSources.find((d) => d.id === ds.id);
          if (!current) return;
          if (current.kind === 'fetch') {
            log('action', `hubspot.fetch ${(current.method ?? 'GET').toUpperCase()} ${interpolate(current.url ?? '', scopeRef.current)} (on open)`);
          } else if (current.kind === 'function') {
            const fn = projectRef.current.functions.find((f) => f.id === current.functionId);
            log('action', `hubspot.serverless('${fn?.uid ?? current.functionId}') (on open)`);
          }
          logLoaded(latest, current);
        }, (depth + 1) * RUNTIME_TIMING.dataSourceLatencyMs),
      );
    }
    return () => timers.forEach(clearTimeout);
    // Runs once per preview session (reset / mode change / live data change); later edits do not
    // restart loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken, mode, liveKey]);

  // ---------------------------------------------------------------- base scope
  // Trusting an imported project (model/trust.ts) lets its code run: rebuild the scope.
  const trustVersion = useSyncExternalStore(subscribeCodeTrust, codeTrustVersion, codeTrustVersion);
  const liveContext = live?.context;
  const { scope, diagnostics } = useMemo(
    () => buildScopeWithDiagnostics({ project, extension, stateValues, setters, dataSources, liveContext: liveContext ?? null }),
    // buildScopeWithDiagnostics reads only these parts of the project / extension.
    [
      project.app.name,
      extension.name,
      extension.kind,
      extension.location,
      extension.mock,
      extension.state,
      extension.dataSources,
      extension.computed,
      extension.helpers,
      stateValues,
      setters,
      dataSources,
      trustVersion,
      liveContext,
    ],
  );
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  // Live requests of an older session are forgotten (their responses are ignored); pending
  // re-runs are cancelled on a new session and on unmount.
  useEffect(() => {
    const requests = liveRequests.current;
    return () => {
      for (const t of requests.timers.values()) clearTimeout(t);
      requests.timers.clear();
      requests.pending.clear();
      requests.ran.clear();
      requests.gens.clear();
    };
  }, [liveEpoch]);

  // Live loads: each source's first load once the sources its request reads have loaded; then a
  // CRM source re-runs (debounced) whenever its request changes — like a hook whose inputs
  // changed. Fetch sources load once on open (or when run), like the generated loader.
  const gates = useMemo(() => liveGates(extension), [extension.dataSources, extension.computed]);
  useEffect(() => {
    const adapter = liveRef.current;
    if (!adapter) return;
    const requests = liveRequests.current;
    const states = dataSourcesRef.current;
    const present = new Set<string>();
    for (const ds of extRef.current.dataSources ?? []) {
      if (!isLiveSource(ds, adapter)) continue;
      present.add(ds.id);
      const ran = requests.ran.get(ds.id);
      if (!ran || ran.kind !== ds.kind) {
        if (isDeferredSource(ds)) continue; // runs when asked (refetch action)
        if ((gates.get(ds.id) ?? []).some((dep) => states[dep.id]?.loading)) continue;
        void startLive(ds.id);
        continue;
      }
      if (ds.kind === 'fetch') continue;
      const plan = planLiveRequest(ds, scopeRef.current, adapter, extRef.current.kind);
      if (plan.sig === ran.sig) {
        const timer = requests.timers.get(ds.id);
        if (timer) clearTimeout(timer);
        requests.timers.delete(ds.id);
        requests.pending.delete(ds.id);
        continue;
      }
      if (requests.pending.get(ds.id) === plan.sig) continue;
      const old = requests.timers.get(ds.id);
      if (old) clearTimeout(old);
      requests.pending.set(ds.id, plan.sig);
      const id = ds.id;
      requests.timers.set(
        id,
        setTimeout(() => {
          requests.timers.delete(id);
          requests.pending.delete(id);
          const latestAdapter = liveRef.current;
          const latest = extRef.current.dataSources?.find((d) => d.id === id);
          if (!mountedRef.current || !latestAdapter || !latest || !isLiveSource(latest, latestAdapter)) return;
          const next = planLiveRequest(latest, scopeRef.current, latestAdapter, extRef.current.kind);
          if (next.sig !== requests.ran.get(id)?.sig) void startLive(id, next);
        }, RUNTIME_TIMING.liveDebounceMs),
      );
    }
    for (const [id, timer] of requests.timers) {
      if (present.has(id)) continue;
      clearTimeout(timer);
      requests.timers.delete(id);
      requests.pending.delete(id);
    }
  }, [liveEpoch, live, scope, dataSources, gates, startLive]);

  // ---------------------------------------------------------------- alerts
  const alertTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const dismissAlert = useCallback((id: string) => {
    const timer = alertTimers.current.get(id);
    if (timer) clearTimeout(timer);
    alertTimers.current.delete(id);
    setAlerts((prev) => (prev.some((a) => a.id === id) ? prev.filter((a) => a.id !== id) : prev));
  }, []);
  const alertsRef = useRef<RuntimeAlert[]>([]);
  alertsRef.current = alerts;
  const addAlert = useCallback(
    (alert: { type: AlertType; title?: string; message: string }) => {
      if (!mountedRef.current) return;
      const last = alertsRef.current[alertsRef.current.length - 1];
      const restartTimer = (id: string) => {
        const old = alertTimers.current.get(id);
        if (old) clearTimeout(old);
        alertTimers.current.set(
          id,
          setTimeout(() => dismissAlert(id), RUNTIME_TIMING.alertDismissMs),
        );
      };
      // The same alert again (e.g. submitting twice) is counted instead of stacked.
      if (last && last.type === alert.type && (last.title ?? '') === (alert.title ?? '') && last.message === alert.message) {
        const count = (last.count ?? 1) + 1;
        const updated = { ...last, count };
        alertsRef.current = [...alertsRef.current.slice(0, -1), updated];
        setAlerts((prev) => prev.map((a) => (a.id === last.id ? { ...a, count } : a)));
        restartTimer(last.id);
        return;
      }
      const id = `alert_${++seqRef.current}`;
      const entry: RuntimeAlert = { id, type: alert.type, message: alert.message };
      if (alert.title) entry.title = alert.title;
      alertsRef.current = [...alertsRef.current, entry].slice(-MAX_VISIBLE_ALERTS);
      setAlerts((prev) => [...prev, entry].slice(-MAX_VISIBLE_ALERTS));
      restartTimer(id);
    },
    [dismissAlert],
  );

  // ---------------------------------------------------------------- overlays
  /** The `id` prop value of an overlay node (Modal/Panel), resolved against the base scope. */
  const overlayIdOf = useCallback((nodeId: NodeId): string | undefined => {
    const node = extRef.current.nodes[nodeId];
    if (!node) return undefined;
    const idProp = getComponent(node.type)?.overlay?.idProp ?? 'id';
    const raw = node.props[idProp];
    if (raw === undefined) return undefined;
    const value = resolvePropValue(raw, scopeRef.current);
    return value === null || value === undefined ? undefined : String(value);
  }, []);

  const openOverlay = useCallback((overlayNodeId: NodeId, overlayScope?: Scope) => {
    setOverlays((prev) => [...prev.filter((o) => o.id !== overlayNodeId), { id: overlayNodeId, scope: overlayScope }]);
  }, []);

  const closeOverlay = useCallback(
    (idOrOverlayId: string) => {
      setOverlays((prev) => {
        const next = prev.filter((o) => o.id !== idOrOverlayId && overlayIdOf(o.id) !== idOrOverlayId);
        return next.length === prev.length ? prev : next;
      });
    },
    [overlayIdOf],
  );

  // ---------------------------------------------------------------- iframe modal
  const iframeOnClose = useRef<(() => void) | undefined>(undefined);
  const openIframeModal = useCallback((modal: IframeModalState, onClose?: () => void) => {
    iframeOnClose.current = onClose;
    setIframeModal(modal);
  }, []);
  const closeIframeModal = useCallback(() => {
    const onClose = iframeOnClose.current;
    iframeOnClose.current = undefined;
    setIframeModal(null);
    if (onClose) {
      try {
        onClose();
      } catch (e) {
        log('error', `openIframeModal onClose callback failed — ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }, [log]);

  // ---------------------------------------------------------------- actions & events
  const makeHost = useCallback((): ActionHost => {
    const session = sessionRef.current;
    return {
      getProject: () => projectRef.current,
      getExtension: () => extRef.current,
      hasState: (name) => !!extRef.current.state?.some((v) => v.name === name),
      setState: setStateValue,
      addAlert,
      log,
      openIframeModal,
      closeOverlay,
      runDataSource,
      isActive: () => mountedRef.current && sessionRef.current === session,
      getLive: () => liveRef.current,
    };
  }, [setStateValue, addAlert, log, openIframeModal, closeOverlay, runDataSource]);

  const runActions = useCallback(
    async (steps: ActionStep[], local?: Scope) => {
      if (!steps?.length) return;
      // Snapshot semantics: every step of this handler sees the scope as it is right now.
      const snapshot: Scope = { ...scopeRef.current, ...(local ?? {}) };
      await executeActions(steps, snapshot, makeHost());
    },
    [makeHost],
  );

  const fireEvent = useCallback(
    (nodeId: NodeId, eventName: string, args: unknown[], local?: Scope) => {
      if (!mountedRef.current) return;
      const ext = extRef.current;
      const node = ext.nodes[nodeId];
      if (!node) return;
      const def = getComponent(node.type);

      // Handler scope: local (repeat items) + the event's declared params bound positionally.
      const handlerScope: Scope = { ...(local ?? {}) };
      const params = def?.events?.find((e) => e.name === eventName)?.params ?? [];
      params.forEach((p, i) => {
        handlerScope[p.name] = args[i];
      });

      // Two-way binding: the bound state variable takes the new value first.
      if (node.binding && def?.valueBinding && def.valueBinding.event === eventName) {
        setStateValue(node.binding.state, args[0]);
      }

      // Clicking an overlay trigger opens its Modal / Panel.
      if (eventName === 'onClick') {
        const overlayId = (node.slots?.overlay ?? []).find((id) => {
          const child = ext.nodes[id];
          return !!child && !!getComponent(child.type)?.overlay;
        });
        if (overlayId) {
          openOverlay(overlayId, local);
          log('action', `Opened ${ext.nodes[overlayId].type} "${overlayIdOf(overlayId) ?? overlayId}"`);
        }
      }

      const steps = node.events?.[eventName];
      if (steps?.length) void runActions(steps, handlerScope);
    },
    [setStateValue, openOverlay, log, overlayIdOf, runActions],
  );

  // ---------------------------------------------------------------- tooltips & host
  const showTooltip = useCallback((t: TooltipState) => setTooltip(t), []);
  const hideTooltip = useCallback(
    (nodeId: NodeId) => setTooltip((prev) => (prev && prev.nodeId === nodeId ? null : prev)),
    [],
  );
  const registerHost = useCallback(() => {
    setHostCount((c) => c + 1);
    return () => setHostCount((c) => c - 1);
  }, []);

  const reset = useCallback(() => setResetCounter((c) => c + 1), []);

  // ---------------------------------------------------------------- lifecycle
  useEffect(() => {
    mountedRef.current = true;
    const pending = pendingLogsRef.current;
    pendingLogsRef.current = null;
    if (pending?.length) appendLogs(pending);
    const timers = alertTimers.current;
    return () => {
      mountedRef.current = false;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, [appendLogs]);

  // Helper / computed value errors: one live console entry per helper code / computed value,
  // updated in place when the error changes and removed once it evaluates again. While editing,
  // reports wait until typing pauses (DIAGNOSTICS_DEBOUNCE_MS) so half-typed code is not logged.
  // Declared after the mount effect so the first report happens once `log` is live.
  const diagnosticEntries = useRef(new Map<string, string>());
  const firstDiagnostics = useRef(true);
  const reportDiagnostic = useCallback((key: string, message: string | null) => {
    const entries = diagnosticEntries.current;
    const existing = entries.get(key);
    if (message === null) {
      if (!existing) return;
      entries.delete(key);
      setLogs((prev) => prev.filter((l) => l.id !== existing));
      return;
    }
    if (existing) {
      setLogs((prev) => {
        const found = prev.find((l) => l.id === existing);
        if (found?.message === message) return prev;
        if (!found) {
          return [...prev, { id: existing, at: Date.now(), level: 'error' as const, message }].slice(-MAX_LOG_ENTRIES);
        }
        return prev.map((l) => (l.id === existing ? { ...l, at: Date.now(), message } : l));
      });
      return;
    }
    const id = `log_${++seqRef.current}`;
    entries.set(key, id);
    setLogs((prev) => [...prev, { id, at: Date.now(), level: 'error' as const, message }].slice(-MAX_LOG_ENTRIES));
  }, []);
  useEffect(() => {
    const flush = () => {
      if (!mountedRef.current) return;
      reportDiagnostic('helpers', diagnostics.helpersError ? `Helper functions failed: ${diagnostics.helpersError}` : null);
      const ids = new Set(Object.keys(diagnostics.computedErrors));
      for (const [id, message] of Object.entries(diagnostics.computedErrors)) {
        const name = extRef.current.computed?.find((c) => c.id === id)?.name ?? id;
        reportDiagnostic(`computed:${id}`, `Computed value "${name}" failed: ${message}`);
      }
      for (const key of [...diagnosticEntries.current.keys()]) {
        if (key.startsWith('computed:') && !ids.has(key.slice('computed:'.length))) reportDiagnostic(key, null);
      }
    };
    if (firstDiagnostics.current) {
      firstDiagnostics.current = false;
      flush();
      return undefined;
    }
    const timer = setTimeout(flush, DIAGNOSTICS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [diagnostics, reportDiagnostic]);

  // Nodes that fail to render: one console entry per node and message per session.
  const nodeErrorsRef = useRef(new Set<string>());
  useEffect(() => {
    nodeErrorsRef.current = new Set();
  }, [resetToken]);
  const reportNodeError = useCallback(
    (nodeId: NodeId, message: string) => {
      const key = `${nodeId}\u0000${message}`;
      if (nodeErrorsRef.current.has(key) || modeRef.current !== 'preview') return;
      nodeErrorsRef.current.add(key);
      const node = extRef.current.nodes[nodeId];
      const label = node ? getComponent(node.type)?.label ?? node.type : 'Component';
      log('error', `${node?.name ? `${label} “${node.name}”` : label} could not be rendered: ${message}`);
    },
    [log],
  );

  // ---------------------------------------------------------------- context values
  const controls = useMemo<RuntimeControls>(
    () => ({
      isPreview: () => modeRef.current === 'preview',
      fireEvent,
      openOverlay,
      closeOverlay,
      showTooltip,
      hideTooltip,
      registerHost,
      reportNodeError,
    }),
    [fireEvent, openOverlay, closeOverlay, showTooltip, hideTooltip, registerHost, reportNodeError],
  );

  const renderState = useMemo<RenderState>(
    () => ({ extension, mode, scope, stateValues, hostMounted: hostCount > 0 }),
    [extension, mode, scope, stateValues, hostCount],
  );

  const openOverlayIds = useMemo(() => overlays.map((o) => o.id), [overlays]);

  const api = useMemo<InternalRuntimeApi>(
    () => ({
      mode,
      project,
      extension,
      scope,
      diagnostics,
      stateValues,
      setStateValue,
      dataSources,
      runDataSource,
      runActions,
      fireEvent,
      openOverlays: openOverlayIds,
      openOverlay,
      closeOverlay,
      alerts,
      dismissAlert,
      iframeModal,
      closeIframeModal,
      logs,
      clearLogs,
      reset,
      overlayEntries: overlays,
      tooltip,
      controls,
    }),
    [
      mode,
      project,
      extension,
      scope,
      diagnostics,
      stateValues,
      setStateValue,
      dataSources,
      runDataSource,
      runActions,
      fireEvent,
      openOverlayIds,
      openOverlay,
      closeOverlay,
      alerts,
      dismissAlert,
      iframeModal,
      closeIframeModal,
      logs,
      clearLogs,
      reset,
      overlays,
      tooltip,
      controls,
    ],
  );

  // CRM components read the sample record through the same live adapter (src/preview/liveCrm).
  const liveCrm = useMemo<LiveCrmSource | null>(() => {
    if (!live) return null;
    const crm = live.context.crm;
    return {
      key: live.key,
      record: crm ? { objectTypeId: crm.objectTypeId, objectId: crm.objectId } : null,
      getRecordProperties: live.getRecordProperties,
      getAssociations: live.getAssociations,
      getPropertyDefinitions: live.getPropertyDefinitions,
      getPipelines: live.getPipelines,
    };
    // A new key means another portal / record; the adapter's functions don't change otherwise.
  }, [liveKey]);

  return (
    <RuntimeContext.Provider value={api}>
      <ControlsContext.Provider value={controls}>
        <LiveCrmProvider value={liveCrm}>
          <RenderContext.Provider value={renderState}>{children}</RenderContext.Provider>
        </LiveCrmProvider>
      </ControlsContext.Provider>
    </RuntimeContext.Provider>
  );
}
