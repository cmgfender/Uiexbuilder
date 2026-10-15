/**
 * The editor shell: full-viewport grid with the top bar, left sidebar, canvas + bottom panel and
 * the inspector, all sharing one preview runtime. Also mounts the dialogs, the command palette,
 * global shortcuts, autosave, problem tracking and the compact (narrow window) layout.
 */
import { useEffect, type ReactNode } from 'react';
import { selectActiveExtension, useEditor } from '../model/store';
import { RuntimeProvider } from '../runtime';
import { Canvas } from '../canvas';
import { CommandPalette } from '../power';
import { AppSettingsDialog, ExportDialog, ExtensionsDialog, FunctionsDialog, ProjectsDialog } from '../panels';
import { NewProjectDialog } from '../templates';
import { BottomPanel } from './BottomPanel';
import { useDialogs } from './dialogs';
import { ImportConflictDialog } from './importProject';
import { useAutosave, useBootSettled } from './persistence';
import { ProjectConflictDialog } from './ProjectConflictDialog';
import { useProblemsSync } from './problems';
import { RAIL_WIDTH, isLeftCollapsed, useShell, watchCompactLayout } from './shellStore';
import { useGlobalShortcuts } from './shortcuts';
import { ShortcutsDialog } from './ShortcutsDialog';
import { LeftSidebar, RightSidebar } from './Sidebars';
import { TopBar } from './TopBar';
import { WelcomeCard } from './WelcomeCard';
import './shell.css';

/** Provides the shared preview runtime for the active extension (re-renders only the provider). */
function WorkspaceRuntime({ children }: { children: ReactNode }) {
  const project = useEditor((s) => s.project);
  const extension = useEditor((s) => selectActiveExtension(s));
  const mode = useEditor((s) => s.mode);
  const resetKey = useEditor((s) => s.previewResetKey);
  return (
    <RuntimeProvider project={project} extension={extension} mode={mode} resetKey={resetKey}>
      {children}
    </RuntimeProvider>
  );
}

function ShellGrid({ children }: { children: ReactNode }) {
  const leftCollapsed = useShell(isLeftCollapsed);
  const compact = useShell((s) => s.compact);
  const rightCollapsed = useShell((s) => s.rightCollapsed);
  const leftWidth = useShell((s) => s.leftWidth);
  const rightWidth = useShell((s) => s.rightWidth);
  const mode = useEditor((s) => s.mode);
  return (
    <div
      className="ub-sh"
      data-mode={mode}
      data-compact={compact || undefined}
      style={
        {
          '--ub-sh-left': `${leftCollapsed ? RAIL_WIDTH : leftWidth}px`,
          '--ub-sh-right': `${rightCollapsed ? RAIL_WIDTH : rightWidth}px`,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}

function Dialogs() {
  const current = useDialogs((s) => s.current);
  const arg = useDialogs((s) => s.arg);
  const close = useDialogs((s) => s.close);
  return (
    <>
      <AppSettingsDialog open={current === 'appSettings'} onClose={close} arg={arg} />
      <ExtensionsDialog open={current === 'extensionSettings'} onClose={close} arg={arg} />
      <FunctionsDialog open={current === 'functions'} onClose={close} arg={arg} />
      <ExportDialog open={current === 'export'} onClose={close} arg={arg} />
      <ProjectsDialog open={current === 'projects'} onClose={close} arg={arg} />
      <NewProjectDialog open={current === 'newProject'} onClose={close} arg={arg} />
      <ShortcutsDialog open={current === 'shortcuts'} onClose={close} arg={arg} />
      <ImportConflictDialog />
      <ProjectConflictDialog />
    </>
  );
}

function ShellServices() {
  useGlobalShortcuts();
  useAutosave();
  useBootSettled();
  useProblemsSync();
  useEffect(() => watchCompactLayout(), []);
  return null;
}

export function AppShell() {
  return (
    <div className="ub-sh-viewport">
      <WorkspaceRuntime>
        <ShellServices />
        <ShellGrid>
          <div className="ub-sh-top">
            <TopBar />
          </div>
          <LeftSidebar />
          <main className="ub-sh-center" aria-label="Canvas">
            <div className="ub-sh-canvas">
              <Canvas />
              <WelcomeCard />
            </div>
            <BottomPanel />
          </main>
          <RightSidebar />
        </ShellGrid>
        <Dialogs />
        <CommandPalette />
      </WorkspaceRuntime>
    </div>
  );
}
