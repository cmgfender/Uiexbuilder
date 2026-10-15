/**
 * Shown when another browser tab or window saved the project open in this tab (see
 * persistence.ts). Autosave waits until the user picks which version to keep; closing the dialog
 * leaves the choice pending (the top bar's save status re-opens it).
 */
import { CopyPlus, RefreshCw, Save } from 'lucide-react';
import { useEditor } from '../model/store';
import { Button, Dialog, useToast } from '../ui';
import { loadStoredVersion, saveCurrentProject, saveErrorMessage, saveOpenProjectAsCopy } from './persistence';
import { useShell } from './shellStore';

/** Re-opens the conflict dialog (e.g. from the save status in the top bar). */
export function showProjectConflict(): void {
  const conflict = useShell.getState().conflict;
  if (conflict) useShell.getState().setConflict({ ...conflict, dismissed: false });
}

export function ProjectConflictDialog() {
  const toast = useToast();
  const conflict = useShell((s) => s.conflict);
  const projectId = useEditor((s) => s.project.id);
  const name = useEditor((s) => s.project.app.name || s.project.name);
  if (!conflict || conflict.dismissed || conflict.projectId !== projectId) return null;
  const close = () => useShell.getState().setConflict({ ...conflict, dismissed: true });
  return (
    <Dialog
      open
      onClose={close}
      title="This project changed in another tab"
      footer={
        <>
          <Button
            icon={<CopyPlus size={14} aria-hidden />}
            onClick={() => {
              const ok = saveOpenProjectAsCopy() === 'saved';
              toast(ok ? 'Saved this tab’s version as a copy' : `Could not save. ${saveErrorMessage()}`);
            }}
          >
            Save mine as a copy
          </Button>
          <Button
            variant="danger"
            icon={<Save size={14} aria-hidden />}
            onClick={() => {
              const ok = saveCurrentProject({ force: true }) === 'saved';
              toast(ok ? 'Saved this tab’s version' : `Could not save. ${saveErrorMessage()}`);
            }}
          >
            Keep this tab’s version
          </Button>
          <Button
            variant="primary"
            autoFocus
            icon={<RefreshCw size={14} aria-hidden />}
            onClick={() => {
              const ok = loadStoredVersion();
              toast(ok ? 'Loaded the latest version' : 'The other version could not be loaded');
            }}
          >
            Load latest version
          </Button>
        </>
      }
    >
      <div className="ub-sh-import">
        <p>
          <strong>{name}</strong> was saved from another browser tab or window while it was open here. Changes made in
          this tab are not saved until you choose which version to keep.
        </p>
        <p className="ub-sh-import-hint">
          <strong>Load latest version</strong> replaces this tab’s copy with the saved one (this tab’s unsaved changes are
          discarded). <strong>Keep this tab’s version</strong> overwrites the other tab’s changes.{' '}
          <strong>Save mine as a copy</strong> keeps both.
        </p>
      </div>
    </Dialog>
  );
}
