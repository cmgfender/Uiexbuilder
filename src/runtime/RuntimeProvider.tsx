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
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { codeTrustVersion, subscribeCodeTrust } from '../model/trust';
import { getComponent } from '../registry';
import type { ActionStep, AlertType, DataSource, NodeId, Project, Extension, StateVar } from '../model/types';
import { executeActions, RUNTIME_TIMING, type ActionHost } from './actions';
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
import { mockDataForSource } from './mockData';
import {
  buildScopeWithDiagnostics,
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
import type { IframeModalState, RuntimeAlert, RuntimeLogEntry } from './types';
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
  children?: ReactNode;
}

interface StateStore {
  sig: string;
  vars: StateVar[];
  values: Record<string, unknown>;
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

export function RuntimeProvider({ project, extension, mode, resetKey = 0, children }: RuntimeProviderProps) {
  // Latest props for callbacks that outlive a render (async handlers, timers, overlay unmounts).
  const projectRef = useRef(project);
  projectRef.current = project;
  const extRef = useRef(extension);
  extRef.current = extension;
  const modeRef = useRef(mode);
  modeRef.current = mode;
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
  const [applied, setApplied] = useState({ resetToken, mode });

  // Derived resets are applied while rendering (React re-renders immediately), so a stale frame
  // with old values is never committed.
  const isReset = applied.resetToken !== resetToken;
  let store = stateStore;
  if (isReset || (applied.mode !== mode && mode === 'preview')) {
    // A preview session opens like the card on HubSpot: data that loads on open starts loading.
    setDsStatus(mode === 'preview' ? initialLoadStatus(extension) : {});
  } else if (applied.mode !== mode) {
    setDsStatus({});
  }
  if (isReset) {
    store = { sig, vars: extension.state ?? [], values: initialStateValues(extension.state ?? []) };
    setStateStore(store);
  } else if (stateStore.sig !== sig) {
    store = { sig, vars: extension.state ?? [], values: reconcileStateValues(stateStore.vars, extension.state ?? [], stateStore.values) };
    setStateStore(store);
  }
  if (isReset || applied.mode !== mode) {
    if (isReset || mode === 'design') {
      setOverlays([]);
      setAlerts([]);
      setIframeModal(null);
      setTooltip(null);
    }
    setApplied({ resetToken, mode });
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
  const dataSources = useMemo(
    () => resolveDataSources(extension, dsStatus),
    // resolveDataSources reads only these parts of the extension.
    [extension.dataSources, extension.mock, extension.objectTypes, dsStatus],
  );

  const runDataSource = useCallback(
    async (idOrName: string) => {
      const ext = extRef.current;
      const ds = ext.dataSources.find((d) => d.id === idOrName) ?? ext.dataSources.find((d) => d.name === idOrName);
      if (!ds) {
        log('warn', `Data source "${idOrName}" does not exist`);
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
    [log],
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
    // Runs once per preview session (reset / mode change); later edits do not restart loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken, mode]);

  // ---------------------------------------------------------------- base scope
  // Trusting an imported project (model/trust.ts) lets its code run: rebuild the scope.
  const trustVersion = useSyncExternalStore(subscribeCodeTrust, codeTrustVersion, codeTrustVersion);
  const { scope, diagnostics } = useMemo(
    () => buildScopeWithDiagnostics({ project, extension, stateValues, setters, dataSources }),
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
    ],
  );
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

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

  return (
    <RuntimeContext.Provider value={api}>
      <ControlsContext.Provider value={controls}>
        <RenderContext.Provider value={renderState}>{children}</RenderContext.Provider>
      </ControlsContext.Provider>
    </RuntimeContext.Provider>
  );
}
