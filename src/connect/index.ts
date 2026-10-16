/**
 * HubSpot connection (client side). Implemented by the connect module.
 * - useConnection(): connection status + connect()/disconnect() (popup OAuth via the hosted connector)
 * - catalog hooks: real portal metadata for pickers (properties, object types, pipelines)
 * - live data: sample record selection + LiveDataAdapter for the preview runtime
 *
 * UI components live in './ui' (ConnectButton, RecordPicker …) and the preview adapter hook in
 * './live' (useLiveAdapter); they are not re-exported here so data-only callers stay light.
 */
export { useConnection } from './store';
export type { ConnectionStatus, ConnectionState } from './store';
export { usePropertyCatalog, useObjectTypes, usePipelines } from './catalog';
export type { PropertyCatalog } from './catalog';
export * from './types';
// ---- additive
export { useOwners } from './catalog';
export { ConnectorClient, ConnectorError, getConnectorClient, setConnectorClient, isConnectorError, isAbortError } from './client';
export type { ConnectorClientOptions, RequestOptions, CatalogRequestOptions } from './client';
export { describeError, describeAuthResult, scopeLabel, scopeList, isMissingAccessMessage } from './describe';
export type { FriendlyError } from './describe';
export { canonicalObjectType, findStandardType, findObjectTypeInfo, objectTypeLabel, objectTypeIdOf, sameObjectType } from './objectTypes';
export { useLiveData, LIVE_DATA_KEY_PREFIX } from './records';
export type { LiveMode, LiveDataState, LiveDataError } from './records';
