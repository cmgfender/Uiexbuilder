/**
 * Crash recovery.
 *
 * `EditorErrorBoundary` wraps the editor shell: when rendering throws (a document from a newer
 * builder version, a hand-edited file…), it stops autosave, records the crash (boot guard, see
 * persistence.ts) and shows the `RecoveryScreen` instead of a white page. The same screen opens at
 * startup when the previous session crashed or never finished loading its project, or with
 * `?safe=1` — so a document that breaks the editor is never reopened automatically, and getting
 * out never requires clearing site data (which would delete every other saved project).
 *
 * The screen only uses the ui kit and the model's storage helpers, never the editor itself.
 */
import { Component, useMemo, useState, type ErrorInfo, type ReactNode } from 'react';
import { Download, FilePlus2, FolderOpen, LifeBuoy, RotateCcw, TriangleAlert } from 'lucide-react';
import { downloadFile, listSavedProjects, loadSavedProject, serializeProject, type ProjectSummary } from '../model/persistence';
import { useEditor } from '../model/store';
import type { Project } from '../model/types';
import { Button, useToast } from '../ui';
import {
  blankProject,
  openProjectFromRecovery,
  readStoredProjectText,
  reportEditorCrash,
  resumeAutosave,
  type BootGuard,
} from './persistence';

export interface RecoveryScreenProps {
  /** 'crash': the editor just crashed; 'boot': the last session crashed / never finished loading; 'safe': ?safe=1. */
  reason: 'crash' | 'boot' | 'safe';
  /** The project that was open (or being opened) when it happened. */
  projectId: string | null;
  error?: string;
  /** The in-memory document when the editor just crashed (may hold unsaved edits). */
  current?: Project | null;
  /** Continue to the editor (the store already holds the chosen project). */
  onContinue: () => void;
  /** At startup: the previous session crashed (rather than never finishing loading). */
  previousCrash?: boolean;
}

function fileNameFor(name: string): string {
  return `${(name || 'project').replace(/[\\/:*?"<>|]+/g, '-')}.uiex.json`;
}

export function RecoveryScreen({ reason, projectId, error, current, onContinue, previousCrash }: RecoveryScreenProps) {
  const toast = useToast();
  const [showList, setShowList] = useState(reason === 'safe');
  const projects = useMemo<ProjectSummary[]>(() => listSavedProjects(), []);
  const affected = projectId ? projects.find((p) => p.id === projectId) : undefined;
  const affectedName = current?.app.name || affected?.appName || affected?.name || current?.name || 'the open project';
  const others = projects.filter((p) => p.id !== projectId);

  const continueWith = (project: Project, message: string) => {
    openProjectFromRecovery(project);
    toast(message);
    onContinue();
  };

  const download = () => {
    // The in-memory document after a crash, else the stored text exactly as saved (even if it
    // can't be parsed any more).
    if (current) {
      downloadFile(fileNameFor(current.name), serializeProject(current));
    } else if (projectId) {
      const text = readStoredProjectText(projectId);
      if (!text) {
        toast('Nothing saved for this project');
        return;
      }
      downloadFile(fileNameFor(affected?.name ?? 'project'), text);
    }
    toast('Downloaded the builder document (.uiex.json)');
  };

  const open = (id: string) => {
    const project = loadSavedProject(id);
    if (!project) {
      toast('This project could not be loaded — its saved data is missing or damaged');
      return;
    }
    continueWith(project, `Opened “${project.app.name || project.name}”`);
  };

  const title =
    reason === 'crash'
      ? 'The editor ran into a problem'
      : reason === 'boot'
        ? previousCrash
          ? 'The editor ran into a problem last time'
          : 'The editor didn’t finish opening your project last time'
        : 'Safe mode';
  const lead =
    reason === 'crash'
      ? `Something in “${affectedName}” could not be displayed. Your other projects are safe.`
      : reason === 'boot'
        ? `To be safe, “${affectedName}” was not reopened automatically. Your projects are still saved in this browser.`
        : 'The editor started without reopening your last project.';

  return (
    <div className="ub-sh-recovery" role="main">
      <div className="ub-sh-recovery-card" role="alertdialog" aria-labelledby="ub-sh-recovery-title" aria-describedby="ub-sh-recovery-lead">
        <div className="ub-sh-recovery-icon" aria-hidden>
          {reason === 'safe' ? <LifeBuoy size={22} /> : <TriangleAlert size={22} />}
        </div>
        <h1 id="ub-sh-recovery-title" className="ub-sh-recovery-title">
          {title}
        </h1>
        <p id="ub-sh-recovery-lead" className="ub-sh-recovery-lead">
          {lead}
        </p>
        {error && (
          <details className="ub-sh-recovery-details">
            <summary>Technical details</summary>
            <code>{error}</code>
          </details>
        )}
        <div className="ub-sh-recovery-actions">
          {(current || (projectId && affected)) && (
            <Button icon={<Download size={14} aria-hidden />} onClick={download}>
              Download “{affectedName}” (.uiex.json)
            </Button>
          )}
          {reason !== 'crash' && projectId && affected && (
            <Button icon={<RotateCcw size={14} aria-hidden />} onClick={() => open(projectId)}>
              Try opening it again
            </Button>
          )}
          <Button icon={<FolderOpen size={14} aria-hidden />} onClick={() => setShowList((v) => !v)} aria-expanded={showList} disabled={others.length === 0}>
            Open another project{others.length ? ` (${others.length})` : ''}
          </Button>
          <Button
            variant="primary"
            icon={<FilePlus2 size={14} aria-hidden />}
            onClick={() => continueWith(blankProject(), 'Started a new blank project')}
          >
            Start a blank project
          </Button>
        </div>
        {showList && others.length > 0 && (
          <ul className="ub-sh-recovery-list" aria-label="Saved projects">
            {others.map((p) => (
              <li key={p.id}>
                <button type="button" className="ub-sh-recovery-project" onClick={() => open(p.id)}>
                  <span className="ub-sh-recovery-project-name">{p.appName || p.name || 'Untitled'}</span>
                  <span className="ub-sh-recovery-project-meta">
                    {p.extensionCount} {p.extensionCount === 1 ? 'extension' : 'extensions'}
                    {p.updatedAt ? ` · ${new Date(p.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="ub-sh-recovery-foot">
          Tip: add <code>?safe=1</code> to the address to start without reopening the last project.
        </p>
      </div>
    </div>
  );
}

interface BoundaryState {
  error: Error | null;
  project: Project | null;
}

/** Top-level error boundary of the editor (see the module comment). */
export class EditorErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null, project: null };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    // Before the shell unmounts (its autosave cleanup must not store the broken document).
    reportEditorCrash(error);
    return { error: error instanceof Error ? error : new Error(String(error)), project: useEditor.getState().project };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('The editor crashed:', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null, project: null });

  render() {
    const { error, project } = this.state;
    if (!error) return this.props.children;
    return <RecoveryScreen reason="crash" projectId={project?.id ?? null} error={error.message} current={project} onContinue={this.reset} />;
  }
}

/** The recovery screen shown at startup instead of restoring the last project (see bootstrapEditor). */
export function StartupRecovery({
  guard,
  onContinue,
}: {
  guard: BootGuard | null;
  /** Opened with ?safe=1 (the screen then says "Safe mode" unless there is a crash to report). */
  safeMode: boolean;
  onContinue: () => void;
}) {
  return (
    <RecoveryScreen
      reason={guard ? 'boot' : 'safe'}
      previousCrash={guard?.reason === 'crash'}
      projectId={guard?.projectId ?? null}
      error={guard?.message}
      onContinue={() => {
        resumeAutosave();
        onContinue();
      }}
    />
  );
}
