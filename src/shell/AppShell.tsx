/**
 * The editor shell: full-viewport grid with the top bar, left sidebar, canvas + bottom panel and
 * the inspector, all sharing one preview runtime. Also mounts the dialogs, the command palette,
 * global shortcuts, autosave and problem tracking.
 */
import type { ReactNode } from 'react';
import { selectActiveExtension, useEditor } from '../model/store';
import { RuntimeProvider } from '../runtime';
import { Canvas } from '../canvas';
import { CommandPalette } from '../power';
import { AppSettingsDialog, ExportDialog, ExtensionsDialog, FunctionsDialog, ProjectsDialog } from '../panels';
import { NewProjectDialog } from '../templates';
import { BottomPanel } from './BottomPanel';
import { useDialogs } from './dialogs';
import { useAutosave } from './persistence';
import { useProblemsSync } from './problems';
import { LEFT_WIDTH, RAIL_WIDTH, RIGHT_WIDTH, useShell } from './shellStore';
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
  const leftCollapsed = useShell((s) => s.leftCollapsed);
  const rightCollapsed = useShell((s) => s.rightCollapsed);
  const mode = useEditor((s) => s.mode);
  return (
    <div
      className="ub-sh"
      data-mode={mode}
      style={
        {
          '--ub-sh-left': `${leftCollapsed ? RAIL_WIDTH : LEFT_WIDTH}px`,
          '--ub-sh-right': `${rightCollapsed ? RAIL_WIDTH : RIGHT_WIDTH}px`,
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
    </>
  );
}

function ShellServices() {
  useGlobalShortcuts();
  useAutosave();
  useProblemsSync();
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
