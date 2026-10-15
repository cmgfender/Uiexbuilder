/**
 * Editor shell public API: the app layout and the pieces other modules may reuse
 * (shortcut definitions, panel helpers, dialogs store).
 */
export { AppShell } from './AppShell';
export { TopBar, ExtensionSwitcher, LogoMark, openCommandPalette } from './TopBar';
export { LeftSidebar, RightSidebar } from './Sidebars';
export { Palette } from './Palette';
export { LayersPanel } from './LayersPanel';
export { BottomPanel } from './BottomPanel';
export { CodePanel } from './CodePanel';
export { ProblemsPanel } from './ProblemsPanel';
export { ConsolePanel } from './ConsolePanel';
export { ShortcutsDialog, Keys } from './ShortcutsDialog';
export { WelcomeCard } from './WelcomeCard';
export {
  SHORTCUTS,
  SHORTCUT_GROUPS,
  formatShortcut,
  shortcutKeys,
  shortcutLabel,
  useGlobalShortcuts,
  handleGlobalKeyDown,
  type ShortcutDef,
  type ShortcutGroup,
} from './shortcuts';
export { useDialogs, type DialogName } from './dialogs';
export {
  bootstrapEditor,
  useAutosave,
  saveCurrentProject,
  readBootGuard,
  type BootResult,
  type BootGuard,
  type SaveOutcome,
} from './persistence';
export { EditorErrorBoundary, RecoveryScreen, StartupRecovery } from './Recovery';
export { importProjectFromText, importMessage, ImportConflictDialog, type ImportResult, type ImportOutcome } from './importProject';
export { ProjectConflictDialog, showProjectConflict } from './ProjectConflictDialog';
export { useProblems, navigateToIssue } from './problems';
export {
  useShell,
  toggleBottomPanel,
  openBottomTab,
  showLeftTab,
  showRightTab,
  focusPaletteSearch,
  isLeftCollapsed,
  setLeftSidebarOpen,
} from './shellStore';
