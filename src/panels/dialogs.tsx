/** STUBS — replaced by the panels implementation. Each dialog renders only when open. */
export interface DialogComponentProps {
  open: boolean;
  onClose: () => void;
  /** Optional argument passed via useDialogs().open(name, arg). */
  arg?: string | null;
}

export function AppSettingsDialog(_p: DialogComponentProps) {
  return null;
}
export function ExtensionsDialog(_p: DialogComponentProps) {
  return null;
}
export function FunctionsDialog(_p: DialogComponentProps) {
  return null;
}
export function ExportDialog(_p: DialogComponentProps) {
  return null;
}
export function ProjectsDialog(_p: DialogComponentProps) {
  return null;
}
