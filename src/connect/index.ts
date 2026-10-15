/**
 * HubSpot connection (client side). Implemented by the connect module.
 * - useConnection(): connection status + connect()/disconnect() (popup OAuth via the hosted connector)
 * - catalog hooks: real portal metadata for pickers (properties, object types, pipelines)
 * - live data: sample record selection + LiveDataAdapter for the preview runtime
 */
export { useConnection } from './store';
export type { ConnectionStatus, ConnectionState } from './store';
export { usePropertyCatalog, useObjectTypes, usePipelines } from './catalog';
export type { PropertyCatalog } from './catalog';
export * from './types';
