/**
 * Designer preview runtime — public API. See ./types.ts for the contract and ARCHITECTURE.md §5.
 */
export { RuntimeProvider, MAX_LOG_ENTRIES, MAX_VISIBLE_ALERTS, type RuntimeProviderProps } from './RuntimeProvider';
export { useRuntime, useOptionalRuntime } from './context';
export { NodeRenderer, ExtensionRenderer, MAX_DESIGN_REPEAT, MAX_PREVIEW_REPEAT } from './NodeRenderer';
export { PreviewHost } from './PreviewHost';
export { DropPlaceholder } from './DropPlaceholder';

export {
  buildBaseScope,
  buildContext,
  createInitialScope,
  initialStateValues,
  reconcileStateValues,
  resolveDataSources,
  setterName,
  type BaseScopeInput,
} from './scope';
export {
  generateAssociationRows,
  generateSearchRows,
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
export type {
  DataSourceState,
  DropPlaceholderProps,
  IframeModalState,
  NodeRendererProps,
  RuntimeAlert,
  RuntimeApi,
  RuntimeLogEntry,
} from './types';
