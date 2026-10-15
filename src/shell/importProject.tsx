/**
 * Opening a builder document (`.uiex.json`) from a file.
 *
 * The current project is saved first (so pending edits are stored under the right project). When
 * this browser already holds a *different* version of a project with the same id — typically an
 * older download of the project being edited — the user chooses: import it as a copy (new id,
 * the default), replace the saved version, or cancel. Nothing is overwritten silently.
 *
 * Code trust (model/trust.ts): the imported document's code is untrusted. Importing as a copy (or
 * cancelling) leaves the trust of the project already saved here as it was.
 *
 * `importProjectFromText` is the one entry point for every import button (top bar, Projects
 * dialog, New project dialog); the prompt is `<ImportConflictDialog />`, mounted by the shell.
 */
import { create } from 'zustand';
import { Copy, Download, Replace } from 'lucide-react';
import { downloadFile, loadSavedProject, parseProjectJson, serializeProject } from '../model/persistence';
import { useEditor } from '../model/store';
import { isProjectTrusted, markProjectUntrusted, trustProject } from '../model/trust';
import type { Project } from '../model/types';
import { Button, Dialog } from '../ui';
import { pausedCode } from '../runtime/CodeTrustNotice';
import { BOOT_SETTLE_MS, copyOfProject, markEditorSettled, saveCurrentProject, writeBootGuard } from './persistence';

export type ImportChoice = 'copy' | 'replace' | 'cancel';
export type ImportOutcome = 'opened' | 'replaced' | 'copied' | 'cancelled';
export type ImportResult = { ok: true; outcome: ImportOutcome; project: Project | null } | { ok: false; error: string };

interface PendingImport {
  incoming: Project;
  existing: Project;
  /** The existing version is the project open in the editor. */
  isOpen: boolean;
  fileName?: string;
  resolve: (choice: ImportChoice) => void;
}

export const useImportPrompt = create<{ pending: PendingImport | null }>()(() => ({ pending: null }));

function sameDocument(a: Project, b: Project): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function peekId(text: string): string | null {
  try {
    const data = JSON.parse(text) as { id?: unknown } | null;
    return data && typeof data.id === 'string' ? data.id : null;
  } catch {
    return null;
  }
}

/** Asks how to import a document whose id is already used here (resolved by ImportConflictDialog). */
function askImportChoice(incoming: Project, existing: Project, isOpen: boolean, fileName?: string): Promise<ImportChoice> {
  return new Promise((resolve) => {
    useImportPrompt.setState({
      pending: {
        incoming,
        existing,
        isOpen,
        fileName,
        resolve: (choice) => {
          useImportPrompt.setState({ pending: null });
          resolve(choice);
        },
      },
    });
  });
}

/**
 * Parses a builder document and opens it (see the module comment). Resolves once the user has
 * decided; `ok: false` when the file is not a valid builder document.
 */
export async function importProjectFromText(text: string, opts: { fileName?: string } = {}): Promise<ImportResult> {
  // Trust of a project saved here under the same id, before parsing marks that id untrusted.
  const id = peekId(text);
  const trustedBefore = id !== null && isProjectTrusted(id);
  const parsed = parseProjectJson(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const incoming = parsed.project;
  const restoreTrust = () => {
    if (trustedBefore && incoming.id === id) trustProject(incoming.id);
  };

  // Store the current project's latest edits under its own id before anything else is opened.
  if (saveCurrentProject() === 'conflict') {
    restoreTrust();
    return { ok: false, error: 'the open project was changed in another tab — choose which version to keep first' };
  }

  const current = useEditor.getState().project;
  const isOpen = current.id === incoming.id;
  const existing = isOpen ? current : loadSavedProject(incoming.id);
  const differs = !!existing && !sameDocument(existing, incoming);
  let choice: ImportChoice = 'replace';
  if (differs) choice = await askImportChoice(incoming, existing, isOpen, opts.fileName);

  if (choice === 'cancel') {
    restoreTrust();
    return { ok: true, outcome: 'cancelled', project: null };
  }
  if (choice === 'copy') {
    restoreTrust();
    const copy = copyOfProject(incoming);
    markProjectUntrusted(copy.id);
    openGuarded(copy);
    return { ok: true, outcome: 'copied', project: copy };
  }
  openGuarded(incoming);
  return { ok: true, outcome: differs ? 'replaced' : 'opened', project: incoming };
}

/**
 * Opens an imported document and saves it (so it is the last project), guarded like a startup
 * restore: until the editor has rendered it and kept running for a moment, the boot guard says
 * "don't reopen this automatically" — a document that hangs or crashes the editor then starts on
 * the recovery screen next time instead of being restored again.
 */
function openGuarded(project: Project): void {
  writeBootGuard(project.id, 'boot');
  useEditor.getState().loadProject(project);
  saveCurrentProject({ force: true });
  setTimeout(markEditorSettled, BOOT_SETTLE_MS);
}

/** Whether an untrusted project has code the designer won't run until the user trusts it. */
function hasPausedCode(project: Project): boolean {
  if (isProjectTrusted(project.id)) return false;
  return project.extensions.some((ext) => {
    const names = ['context'];
    for (const st of ext.state ?? []) names.push(st.name);
    for (const ds of ext.dataSources ?? []) names.push(ds.name, `${ds.name}Loading`, `${ds.name}Error`);
    try {
      const p = pausedCode(ext, names);
      return p.helpers + p.custom + p.expressions > 0;
    } catch {
      return true;
    }
  });
}

/** Toast text for an import result. */
export function importMessage(result: ImportResult): string {
  if (!result.ok) return `Import failed: ${result.error}`;
  const name = result.project ? result.project.app.name || result.project.name : '';
  switch (result.outcome) {
    case 'cancelled':
      return 'Import cancelled';
    case 'copied':
      return `Imported “${name}” as a copy${pausedNote(result.project)}`;
    case 'replaced':
      return `Imported “${name}” (replaced the saved version)${pausedNote(result.project)}`;
    default:
      return `Imported “${name}”${pausedNote(result.project)}`;
  }
}

function pausedNote(project: Project | null): string {
  return project && hasPausedCode(project) ? '. Its code is paused until you trust it (see the notice on the card).' : '';
}

function formatTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'unknown';
  return new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' });
}

/** The replace / copy prompt for importing a document whose project id is already saved here. */
export function ImportConflictDialog() {
  const pending = useImportPrompt((s) => s.pending);
  if (!pending) return null;
  const { incoming, existing, isOpen, fileName } = pending;
  const name = incoming.app.name || incoming.name || 'This project';
  const newer = Date.parse(existing.updatedAt) > Date.parse(incoming.updatedAt);
  return (
    <Dialog
      open
      onClose={() => pending.resolve('cancel')}
      title="This project is already saved here"
      footer={
        <>
          <Button onClick={() => pending.resolve('cancel')}>Cancel</Button>
          <Button variant="danger" icon={<Replace size={14} aria-hidden />} onClick={() => pending.resolve('replace')}>
            Replace saved version
          </Button>
          <Button variant="primary" icon={<Copy size={14} aria-hidden />} onClick={() => pending.resolve('copy')} autoFocus>
            Import as a copy
          </Button>
        </>
      }
    >
      <div className="ub-sh-import">
        <p>
          <strong>{name}</strong>
          {fileName ? <> ({fileName})</> : null} has the same project ID as {isOpen ? 'the project you are editing' : 'a project saved in this browser'}, but
          the two versions differ.
        </p>
        <dl className="ub-sh-import-versions">
          <dt>Saved in this browser{newer ? ' (newer)' : ''}</dt>
          <dd>
            {existing.app.name || existing.name} — last changed {formatTime(existing.updatedAt)}
          </dd>
          <dt>In the file</dt>
          <dd>
            {incoming.app.name || incoming.name} — last changed {formatTime(incoming.updatedAt)}
          </dd>
        </dl>
        <p className="ub-sh-import-hint">
          <strong>Import as a copy</strong> keeps both. <strong>Replace</strong> discards the version saved here
          {isOpen ? ', including your latest changes' : ''} and clears its undo history.
        </p>
        <Button
          size="sm"
          variant="ghost"
          icon={<Download size={13} aria-hidden />}
          onClick={() => downloadFile(`${existing.name || 'project'}.uiex.json`, serializeProject(existing))}
        >
          Download the saved version first
        </Button>
      </div>
    </Dialog>
  );
}
