/**
 * Real HubSpot data for the CRM component previews (CrmPropertyList, CrmDataHighlight,
 * CrmStageTracker, CrmAssociationTable, …).
 *
 * The runtime provides a LiveCrmSource while the preview uses live data (RuntimeProvider `live`).
 * CRM previews read the sample record through it — with HubSpot's labels and formatted values —
 * instead of their built-in sample values; components that can't be shown from real data say so
 * with a "sample values" badge. Without a source (mock data, tests, the palette) nothing changes.
 *
 * Answers are cached per source key (portal + sample record), so re-renders and several
 * components asking for the same thing share one request.
 */
import { createContext, useContext, useEffect, useState } from 'react';
import type { AssociationResultDTO, CrmPipeline, CrmPropertyDef } from '../connect/types';

export interface LiveCrmSource {
  /** Changes when the portal or the sample record changes (cache scope). */
  key: string;
  /** The sample record (null on settings / app home extensions). */
  record: { objectTypeId: string; objectId: number } | null;
  getRecordProperties(objectTypeId: string, objectId: number, properties: string[], formatted: boolean | string[]): Promise<Record<string, string | null>>;
  getAssociations(
    objectTypeId: string,
    objectId: number,
    request: { toObjectType: string; properties: string[]; pageLength: number; formatted: boolean | string[] },
  ): Promise<AssociationResultDTO[]>;
  /** Property definitions of an object type (labels). Optional. */
  getPropertyDefinitions?(objectType: string): Promise<CrmPropertyDef[]>;
  /** Pipelines of an object type (deals, tickets). Optional. */
  getPipelines?(objectType: string): Promise<CrmPipeline[]>;
}

const LiveCrmContext = createContext<LiveCrmSource | null>(null);

export const LiveCrmProvider = LiveCrmContext.Provider;

/** The live data source of the preview, or null (mock data). */
export function useLiveCrm(): LiveCrmSource | null {
  return useContext(LiveCrmContext);
}

export type LiveLoad<T> = { status: 'loading' } | { status: 'ok'; value: T } | { status: 'error' };

interface CacheEntry {
  promise: Promise<unknown>;
  result?: LiveLoad<unknown>;
}

const cache = new Map<string, CacheEntry>();
const MAX_CACHE_ENTRIES = 400;

/** Test helper. */
export function clearLiveCrmCache(): void {
  cache.clear();
}

function entryFor<T>(fullKey: string, load: () => Promise<T>): CacheEntry {
  let entry = cache.get(fullKey);
  if (entry) return entry;
  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
  const created: CacheEntry = { promise: Promise.resolve() };
  created.promise = load().then(
    (value) => {
      created.result = { status: 'ok', value };
    },
    () => {
      created.result = { status: 'error' };
      // Errors are not kept: the next render after a Reset / new record asks again.
      setTimeout(() => {
        if (cache.get(fullKey) === created) cache.delete(fullKey);
      }, 0);
    },
  );
  cache.set(fullKey, created);
  entry = created;
  return entry;
}

/**
 * Loads `key` from the live source once (cached); null when there is no source or no key.
 * `load` is only called when the key isn't cached yet.
 */
export function useLiveLoad<T>(source: LiveCrmSource | null, key: string | null, load: () => Promise<T>): LiveLoad<T> | null {
  const fullKey = source && key ? `${source.key}\u0000${key}` : null;
  const read = (): LiveLoad<T> | null => {
    if (!fullKey) return null;
    return (cache.get(fullKey)?.result as LiveLoad<T> | undefined) ?? { status: 'loading' };
  };
  const [state, setState] = useState<{ key: string | null; value: LiveLoad<T> | null }>(() => ({ key: fullKey, value: read() }));
  useEffect(() => {
    if (!fullKey) {
      setState({ key: null, value: null });
      return;
    }
    let alive = true;
    const entry = entryFor(fullKey, load);
    if (entry.result) setState({ key: fullKey, value: entry.result as LiveLoad<T> });
    else {
      setState({ key: fullKey, value: { status: 'loading' } });
      void entry.promise.then(() => {
        if (alive) setState({ key: fullKey, value: (entry.result as LiveLoad<T>) ?? { status: 'error' } });
      });
    }
    return () => {
      alive = false;
    };
    // `load` is a fresh closure every render; the key says what it loads.
  }, [fullKey]);
  return state.key === fullKey ? state.value : read();
}

/** Property labels of an object type from the portal (name → label); empty while unknown. */
export function useLivePropertyLabels(source: LiveCrmSource | null, objectType: string | null): Record<string, string> {
  const load = useLiveLoad(source && source.getPropertyDefinitions && objectType ? source : null, objectType ? `defs:${objectType}` : null, () =>
    source!.getPropertyDefinitions!(objectType!),
  );
  if (!load || load.status !== 'ok') return {};
  const out: Record<string, string> = {};
  for (const d of load.value) if (d && typeof d.name === 'string' && typeof d.label === 'string') out[d.name] = d.label;
  return out;
}
