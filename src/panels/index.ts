/** Panels module public API (implemented by the panels module). */
export { DataPanel } from './DataPanel';
export { AppSettingsDialog, ExtensionsDialog, FunctionsDialog, ExportDialog, ProjectsDialog } from './dialogs';
export type { DialogComponentProps } from './dialogs';

// Reusable logic (pure helpers other modules may build on).
export { findUsages, renameReferences, replaceIdentifiers, referencedIdentifiers, type Usage } from './findUsages';
export { validateDeclaredName, uniqueDeclaredName, declaredNames } from './names';
export { generateUiForSource, generatedRootType } from './generators';
export { insertGeneratedUi, renameStateVar, renameDataSource, findFunctionUsages, type FunctionUsage } from './actions';
export {
  COMMON_PROPERTIES,
  propertySuggestions,
  propertiesFor,
  propertyLabel,
  humanizeProperty,
  objectTypeKey,
  objectTypeLabel,
  type CrmPropertyInfo,
} from './crmProperties';
export { COMMON_SCOPES } from './scopes';
