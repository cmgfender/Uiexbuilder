/**
 * <RuntimeProvider> owns the simulated card runtime for one extension: state values, data source
 * states, open overlays, alerts, the iframe modal, tooltips and the console log. It exposes the
 * RuntimeApi (src/runtime/types.ts) through context; see context.ts for how contexts are split.
 *
 * Reset rules:
 *  - `resetKey` change (or reset(), or switching to another extension): everything returns to its
 *    initial values (state, data sources, overlays, alerts, iframe modal). Logs are kept.
 *  - State variable definitions change: variables whose definition is unchanged keep their value,
 *    others start from their initial value.
 *  - Switching to design mode closes overlays, alerts, the iframe modal and tooltips.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getComponent } from '../registry';
import type { ActionStep, AlertType, NodeId, Project, Extension, StateVar } from '../model/types';
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
import { mockDataForSource } from './mockData';
import {
  buildScopeWithDiagnostics,
  initialStateValues,
  reconcileStateValues,
  resolveDataSources,
  stateSignature,
  type DataSourceStatus,
} from './scope';
import type { IframeModalState, RuntimeAlert, RuntimeLogEntry } from './types';
import './runtime.css';

/** Oldest log entries are dropped beyond this many. */
export const MAX_LOG_ENTRIES = 500;
/** At most this many alerts are visible at once (oldest dropped first). */
export const MAX_VISIBLE_ALERTS = 5;

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
  const [dsStatus, setDsStatus] = useState<Record<string, DataSourceStatus>>({});
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
  if (isReset) {
    store = { sig, vars: extension.state ?? [], values: initialStateValues(extension.state ?? []) };
    setStateStore(store);
    setDsStatus({});
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
  const log = useCallback((level: RuntimeLogEntry['level'], message: string, detail?: unknown) => {
    if (!mountedRef.current) return;
    const entry: RuntimeLogEntry = { id: `log_${++seqRef.current}`, at: Date.now(), level, message };
    if (detail !== undefined) entry.detail = detail;
    setLogs((prev) => (prev.length >= MAX_LOG_ENTRIES ? [...prev.slice(prev.length - MAX_LOG_ENTRIES + 1), entry] : [...prev, entry]));
  }, []);
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
      log('info', `${ds.name} loaded (mock data)`, mockDataForSource(extRef.current, ds));
    },
    [log],
  );

  // ---------------------------------------------------------------- base scope
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
  const addAlert = useCallback(
    (alert: { type: AlertType; title?: string; message: string }) => {
      if (!mountedRef.current) return;
      const id = `alert_${++seqRef.current}`;
      const entry: RuntimeAlert = { id, type: alert.type, message: alert.message };
      if (alert.title) entry.title = alert.title;
      setAlerts((prev) => [...prev, entry].slice(-MAX_VISIBLE_ALERTS));
      alertTimers.current.set(
        id,
        setTimeout(() => dismissAlert(id), RUNTIME_TIMING.alertDismissMs),
      );
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
    const timers = alertTimers.current;
    return () => {
      mountedRef.current = false;
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // Helper / computed value errors are logged once per distinct message (not on every render).
  // Declared after the mount effect so the first report happens once `log` is live.
  const reportedRef = useRef<{ helpers: string | null; computed: Record<string, string> }>({ helpers: null, computed: {} });
  useEffect(() => {
    const reported = reportedRef.current;
    if (diagnostics.helpersError && diagnostics.helpersError !== reported.helpers) {
      log('error', `Helper functions failed: ${diagnostics.helpersError}`);
    }
    for (const [id, message] of Object.entries(diagnostics.computedErrors)) {
      if (reported.computed[id] === message) continue;
      const name = extRef.current.computed?.find((c) => c.id === id)?.name ?? id;
      log('error', `Computed value "${name}" failed: ${message}`);
    }
    reportedRef.current = { helpers: diagnostics.helpersError, computed: diagnostics.computedErrors };
  }, [diagnostics, log]);

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
    }),
    [fireEvent, openOverlay, closeOverlay, showTooltip, hideTooltip, registerHost],
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
