/**
 * Portal metadata hooks for pickers.
 * All hooks return empty data (and connected: false) when not connected, so callers can always use
 * them and fall back to built-in suggestions (e.g. src/panels/crmProperties.ts).
 *
 * Answers come from the connector client's in-memory cache (TTL, scoped to the portal), so many
 * pickers asking for the same object type share one request. 'contacts', 'contact' and '0-1' are
 * the same object type (one cache entry).
 */
import { useEffect, useMemo, useState } from 'react';
import type { CrmObjectTypeInfo, CrmOwner, CrmPipeline, CrmPropertyDef } from './types';
import { getConnectorClient, isAbortError, type CatalogKind } from './client';
import { describeError } from './describe';
import { canonicalObjectType } from './objectTypes';
import { useConnection } from './store';

export interface PropertyCatalog {
  connected: boolean;
  loading: boolean;
  error: string | null;
  properties: CrmPropertyDef[];
  /** Lookup by internal name. */
  byName: Map<string, CrmPropertyDef>;
}

interface ResourceState<T> {
  key: string | null;
  data: T | null;
  loading: boolean;
  error: string | null;
}

function peek<T>(kind: CatalogKind, objectType: string | null): T | null {
  return getConnectorClient().peek<T>(kind, objectType ?? undefined) ?? null;
}

function load<T>(kind: CatalogKind, objectType: string | null, signal: AbortSignal): Promise<T> {
  const client = getConnectorClient();
  switch (kind) {
    case 'objectTypes':
      return client.objectTypes({ signal }) as Promise<T>;
    case 'owners':
      return client.owners({ signal }) as Promise<T>;
    case 'properties':
      return client.properties(objectType!, { signal }) as Promise<T>;
    case 'pipelines':
      return client.pipelines(objectType!, { signal }) as Promise<T>;
  }
}

function initialState<T>(key: string | null, kind: CatalogKind, objectType: string | null): ResourceState<T> {
  if (!key) return { key, data: null, loading: false, error: null };
  const cached = peek<T>(kind, objectType);
  return { key, data: cached, loading: !cached, error: null };
}

/** Shared loader: connected + portal-scoped key, cache first, abort on unmount / key change. */
function useCatalogResource<T>(kind: CatalogKind, objectType: string | null | undefined): { connected: boolean } & ResourceState<T> {
  const connected = useConnection((s) => s.status === 'connected' && s.info.connected);
  const portalId = useConnection((s) => (s.info.connected ? s.info.portalId : null));
  const type = typeof objectType === 'string' && objectType.trim() ? objectType.trim() : null;
  const needsType = kind === 'properties' || kind === 'pipelines';
  const active = connected && portalId !== null && (!needsType || type !== null);
  const key = active ? `${portalId}|${kind}|${type ? canonicalObjectType(type, peek<CrmObjectTypeInfo[]>('objectTypes', null)) : ''}` : null;

  const [state, setState] = useState<ResourceState<T>>(() => initialState<T>(key, kind, type));
  // Another object type / portal: switch to its cached answer right away (no stale flash).
  let current = state;
  if (state.key !== key) {
    current = initialState<T>(key, kind, type);
    setState(current);
  }

  useEffect(() => {
    if (!key) return;
    const cached = peek<T>(kind, type);
    if (cached) {
      setState((s) => (s.key === key && s.data === cached && !s.loading ? s : { key, data: cached, loading: false, error: null }));
      return;
    }
    const controller = new AbortController();
    setState((s) => (s.key === key ? { ...s, loading: true, error: null } : s));
    load<T>(kind, type, controller.signal).then(
      (data) => setState({ key, data, loading: false, error: null }),
      (err: unknown) => {
        if (isAbortError(err) || controller.signal.aborted) return;
        setState({ key, data: null, loading: false, error: describeError(err).message });
      },
    );
    return () => controller.abort();
    // `key` covers kind, portal and the canonical object type.
  }, [key]);

  return { ...current, connected: connected && portalId !== null };
}

/** Properties of an object type ('contacts', '0-1', 'p_custom' …). Cached per portal + type. */
export function usePropertyCatalog(objectType: string | null | undefined): PropertyCatalog {
  const r = useCatalogResource<CrmPropertyDef[]>('properties', objectType);
  const properties = useMemo(() => (Array.isArray(r.data) ? r.data : []), [r.data]);
  const byName = useMemo(() => new Map(properties.map((p) => [p.name, p])), [properties]);
  return { connected: r.connected, loading: r.loading, error: r.error, properties, byName };
}

/** Standard + custom object types of the connected portal. */
export function useObjectTypes(): { connected: boolean; loading: boolean; objectTypes: CrmObjectTypeInfo[]; error: string | null } {
  const r = useCatalogResource<CrmObjectTypeInfo[]>('objectTypes', null);
  const objectTypes = useMemo(() => (Array.isArray(r.data) ? r.data : []), [r.data]);
  return { connected: r.connected, loading: r.loading, objectTypes, error: r.error };
}

/** Pipelines (with stages) for deals / tickets / custom objects. */
export function usePipelines(objectType: string | null | undefined): { connected: boolean; loading: boolean; pipelines: CrmPipeline[]; error: string | null } {
  const r = useCatalogResource<CrmPipeline[]>('pipelines', objectType);
  const pipelines = useMemo(() => (Array.isArray(r.data) ? r.data : []), [r.data]);
  return { connected: r.connected, loading: r.loading, pipelines, error: r.error };
}

/** Users who can own records in the connected portal (for owner pickers). */
export function useOwners(): { connected: boolean; loading: boolean; owners: CrmOwner[]; error: string | null } {
  const r = useCatalogResource<CrmOwner[]>('owners', null);
  const owners = useMemo(() => (Array.isArray(r.data) ? r.data : []), [r.data]);
  return { connected: r.connected, loading: r.loading, owners, error: r.error };
}
