/**
 * Designer preview runtime — public API. See ./types.ts for the contract and ARCHITECTURE.md §5.
 */
export { RuntimeProvider, DIAGNOSTICS_DEBOUNCE_MS, MAX_LOG_ENTRIES, MAX_VISIBLE_ALERTS, type RuntimeProviderProps } from './RuntimeProvider';
export { useRuntime, useOptionalRuntime } from './context';
export { NodeRenderer, ExtensionRenderer, MAX_DESIGN_REPEAT, MAX_PREVIEW_REPEAT } from './NodeRenderer';
export { PreviewHost } from './PreviewHost';
export { PreviewAlerts } from './PreviewAlerts';
export { DropPlaceholder } from './DropPlaceholder';

export {
  applyComputedValues,
  buildBaseScope,
  buildScopeWithDiagnostics,
  buildContext,
  createInitialScope,
  initialDataValue,
  initialLoadStatus,
  initialStateValues,
  loadsOnOpen,
  reconcileStateValues,
  requestDependencies,
  resolveDataSources,
  setterName,
  SIMULATED_ERROR,
  type BaseScopeInput,
  type ScopeDiagnostics,
  type ScopeWithDiagnostics,
} from './scope';
export {
  generateAssociationRows,
  generateSearchRows,
  formatPropertyValue,
  hasConfiguredMock,
  isDeferredSource,
  mockDataForSource,
  mockFunctionResult,
  mockRecordProperties,
  objectTypeName,
  sampleValue,
  MOCK_ROW_COUNT,
  type MockAssociationResult,
  type MockCrmSearchResult,
} from './mockData';
export {
  createCustomCodeGlobals,
  describeStep,
  executeActions,
  normalizeAlertType,
  previewFetch,
  PreviewFetchError,
  RUNTIME_TIMING,
  type ActionHost,
  type PreviewFetchOptions,
} from './actions';
export {
  checkExpressionSyntax,
  checkStatementsSyntax,
  evaluate,
  interpolate,
  resolveLiteral,
  resolvePropValue,
  resolveTemplateString,
  resolveText,
  runStatements,
  type EvalResult,
  type Scope,
} from './expr';
export {
  buildSearchRequest,
  isLiveSource,
  liveDataKey,
  planLiveRequest,
  LiveRequestError,
  NO_RECORD_CONTEXT_MESSAGE,
  NO_SAMPLE_RECORD_MESSAGE,
  type LiveRequestFailure,
  type LiveRequestPlan,
  type LiveResult,
} from './live';
export { liveErrorInfo, type LiveErrorInfo } from './liveErrors';
export { previewRequestToProxy, proxyResponseLike, readProxyJson } from './actions';
export type {
  DataSourceState,
  LiveDataAdapter,
  DropPlaceholderProps,
  IframeModalState,
  NodeRendererProps,
  RuntimeAlert,
  RuntimeApi,
  RuntimeLogEntry,
} from './types';
