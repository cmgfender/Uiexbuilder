/**
 * Live data selection: whether the preview uses mock data or the connected portal's real data,
 * and which sample record each CRM card previews with.
 *
 * Stored per project in localStorage (`uiex-builder:live-data:<projectId>`) — only the mode and
 * record ids (object type + id + portal), never record contents. Labels are looked up again from
 * HubSpot when needed.
 */
import { create } from 'zustand';
import type { CrmRecordSummary } from './types';
import { isAbortError, isConnectorError } from './client';
import { describeError } from './describe';
import { useConnection } from './store';

export type LiveMode = 'mock' | 'live';

export interface LiveDataError {
  title: string;
  message: string;
  code: string;
  requiredScopes?: string[];
  action?: 'reconnect' | 'retry' | 'none';
  /** Label of the fix button ("Reconnect to grant access" / "Reconnect"). */
  actionLabel?: string;
  /** Amber (not included in the connection) vs red. */
  tone?: 'warning' | 'error';
  /** Offer "Use mock data". */
  offerMock?: boolean;
}

export interface LiveDataState {
  /** Project whose selection is loaded (null before the shell loads one). */
  projectId: string | null;
  mode: LiveMode;
  /** Sample record per extension id (null / absent = none picked). An empty label is not known yet. */
  recordByExtension: Record<string, CrmRecordSummary | null>;
  /** Portal each picked record belongs to (records of another portal are ignored). */
  portalByExtension: Record<string, number>;
  /** Last problem loading real data for the preview (plain language). */
  error: LiveDataError | null;
  loadProject: (projectId: string) => void;
  setMode: (mode: LiveMode) => void;
  setRecord: (extensionId: string, record: CrmRecordSummary | null, portalId?: number) => void;
  reportError: (err: unknown) => void;
  clearError: () => void;
}

export const LIVE_DATA_KEY_PREFIX = 'uiex-builder:live-data:';

interface StoredRecord {
  portalId: number;
  objectType: string;
  objectTypeId: string;
  id: string;
}

interface StoredLiveData {
  v: 1;
  mode: LiveMode;
  records: Record<string, StoredRecord>;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readStored(projectId: string): StoredLiveData | null {
  try {
    const raw = storage()?.getItem(LIVE_DATA_KEY_PREFIX + projectId);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<StoredLiveData>;
    if (!data || typeof data !== 'object') return null;
    const records: Record<string, StoredRecord> = {};
    for (const [extId, r] of Object.entries(data.records && typeof data.records === 'object' ? data.records : {})) {
      if (
        r &&
        typeof r === 'object' &&
        typeof r.portalId === 'number' &&
        typeof r.objectType === 'string' &&
        typeof r.objectTypeId === 'string' &&
        typeof r.id === 'string' &&
        /^\d{1,20}$/.test(r.id)
      ) {
        records[extId] = { portalId: r.portalId, objectType: r.objectType, objectTypeId: r.objectTypeId, id: r.id };
      }
    }
    return { v: 1, mode: data.mode === 'live' ? 'live' : 'mock', records };
  } catch {
    return null;
  }
}

function writeStored(state: Pick<LiveDataState, 'projectId' | 'mode' | 'recordByExtension' | 'portalByExtension'>): void {
  if (!state.projectId) return;
  const records: Record<string, StoredRecord> = {};
  for (const [extId, r] of Object.entries(state.recordByExtension)) {
    const portalId = state.portalByExtension[extId];
    if (r && typeof portalId === 'number') records[extId] = { portalId, objectType: r.objectType, objectTypeId: r.objectTypeId, id: r.id };
  }
  const data: StoredLiveData = { v: 1, mode: state.mode, records };
  try {
    const s = storage();
    if (!s) return;
    if (data.mode === 'mock' && Object.keys(records).length === 0) s.removeItem(LIVE_DATA_KEY_PREFIX + state.projectId);
    else s.setItem(LIVE_DATA_KEY_PREFIX + state.projectId, JSON.stringify(data));
  } catch {
    /* storage full or unavailable: the selection just isn't remembered */
  }
}

export const useLiveData = create<LiveDataState>()((set, get) => ({
  projectId: null,
  mode: 'mock',
  recordByExtension: {},
  portalByExtension: {},
  error: null,

  loadProject: (projectId) => {
    if (get().projectId === projectId) return;
    const stored = readStored(projectId);
    const recordByExtension: Record<string, CrmRecordSummary | null> = {};
    const portalByExtension: Record<string, number> = {};
    for (const [extId, r] of Object.entries(stored?.records ?? {})) {
      recordByExtension[extId] = { id: r.id, objectType: r.objectType, objectTypeId: r.objectTypeId, label: '' };
      portalByExtension[extId] = r.portalId;
    }
    set({ projectId, mode: stored?.mode ?? 'mock', recordByExtension, portalByExtension, error: null });
  },

  setMode: (mode) => {
    if (get().mode === mode) return;
    set({ mode, error: null });
    writeStored(get());
  },

  setRecord: (extensionId, record, portalId) => {
    const s = get();
    const recordByExtension = { ...s.recordByExtension };
    const portalByExtension = { ...s.portalByExtension };
    if (record) {
      recordByExtension[extensionId] = { ...record };
      const portal = portalId ?? (() => {
        const info = useConnection.getState().info;
        return info.connected ? info.portalId : undefined;
      })();
      if (typeof portal === 'number') portalByExtension[extensionId] = portal;
    } else {
      delete recordByExtension[extensionId];
      delete portalByExtension[extensionId];
    }
    const prev = s.recordByExtension[extensionId];
    const sameRecord = !!prev && !!record && prev.id === record.id && prev.objectTypeId === record.objectTypeId;
    set({ recordByExtension, portalByExtension, error: sameRecord ? s.error : null });
    writeStored(get());
  },

  reportError: (err) => {
    if (isAbortError(err)) return;
    const d = describeError(err);
    const code = isConnectorError(err) ? err.code : 'unknown_error';
    const prev = get().error;
    if (prev && prev.code === code && prev.message === d.message) return;
    set({
      error: { title: d.title, message: d.message, code, requiredScopes: d.requiredScopes, action: d.action, actionLabel: d.actionLabel, tone: d.tone, offerMock: d.offerMock },
    });
  },

  clearError: () => {
    if (get().error) set({ error: null });
  },
}));

// A sign-in the user just completed switches the open project to real data.
useConnection.subscribe((s, prev) => {
  if (s.connectedAt !== null && s.connectedAt !== prev.connectedAt) useLiveData.getState().setMode('live');
});

/** Test helper. */
export function resetLiveDataForTests(): void {
  useLiveData.setState({ projectId: null, mode: 'mock', recordByExtension: {}, portalByExtension: {}, error: null });
}
