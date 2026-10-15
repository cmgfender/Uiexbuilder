/**
 * Dialogs of the panels module (mounted by the shell; each renders only when open):
 * app settings, extensions, app functions, export and saved projects.
 */
import './panels.css';

export type { DialogComponentProps } from './dialogTypes';
export { AppSettingsDialog } from './AppSettingsDialog';
export { ExtensionsDialog } from './ExtensionsDialog';
export { FunctionsDialog } from './FunctionsDialog';
export { ExportDialog } from './ExportDialog';
export { ProjectsDialog } from './ProjectsDialog';
