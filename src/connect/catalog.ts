/**
 * Portal metadata hooks for pickers. STUB with final signatures — implemented by the connect module.
 * All hooks return empty data (and connected: false) when not connected, so callers can always use
 * them and fall back to built-in suggestions (e.g. src/panels/crmProperties.ts).
 */
import type { CrmObjectTypeInfo, CrmPipeline, CrmPropertyDef } from './types';

export interface PropertyCatalog {
  connected: boolean;
  loading: boolean;
  error: string | null;
  properties: CrmPropertyDef[];
  /** Lookup by internal name. */
  byName: Map<string, CrmPropertyDef>;
}

/** Properties of an object type ('contacts', '0-1', 'p_custom' …). Cached per portal + type. */
export function usePropertyCatalog(_objectType: string | null | undefined): PropertyCatalog {
  return { connected: false, loading: false, error: null, properties: [], byName: new Map() };
}

/** Standard + custom object types of the connected portal. */
export function useObjectTypes(): { connected: boolean; loading: boolean; objectTypes: CrmObjectTypeInfo[] } {
  return { connected: false, loading: false, objectTypes: [] };
}

/** Pipelines (with stages) for deals / tickets / custom objects. */
export function usePipelines(_objectType: string | null | undefined): { connected: boolean; loading: boolean; pipelines: CrmPipeline[] } {
  return { connected: false, loading: false, pipelines: [] };
}
