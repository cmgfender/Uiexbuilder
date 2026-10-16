/** Open saved projects, import a builder file (.uiex.json) or start a blank project. */
import { useEffect, useRef, useState } from 'react';
import { FilePlus2, FolderInput, FolderOpen, Trash2, TriangleAlert } from 'lucide-react';
import { deleteSavedProject, listSavedProjects, loadSavedProject, type ProjectSummary } from '../model/persistence';
import { useEditor } from '../model/store';
import { importMessage, importProjectFromText } from '../shell/importProject';
import { saveCurrentProject } from '../shell/persistence';
import { Badge, Button, Dialog, EmptyState, IconButton, useToast } from '../ui';
import { Callout } from './common';
import type { DialogComponentProps } from './dialogTypes';
import { formatRelativeTime } from './utils';

export function ProjectsDialog({ open, onClose }: DialogComponentProps) {
  const currentId = useEditor((s) => s.project.id);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    // Persist the current project first so the list (and switching back) is up to date. Never
    // overwrites a newer version another tab saved (the conflict dialog asks instead).
    saveCurrentProject();
    setProjects(listSavedProjects());
    setConfirmId(null);
    setError(null);
  }, [open]);

  if (!open) return null;

  const refresh = () => setProjects(listSavedProjects());

  const CONFLICT = 'The open project changed in another tab — choose which version to keep first (see the save status in the top bar).';

  const openProject = (id: string) => {
    if (saveCurrentProject() === 'conflict') {
      setError(CONFLICT);
      return;
    }
    const project = loadSavedProject(id);
    if (!project) {
      setError('This project could not be loaded — its saved data is missing or damaged.');
      return;
    }
    useEditor.getState().loadProject(project);
    toast(`Opened “${project.app.name}”`);
    onClose();
  };

  // One import path for every import button (shell/importProject): saves the open project first,
  // asks before replacing a different saved version of the same project (or imports a copy) and
  // keeps code from the file untrusted.
  const importFile = async (file: File) => {
    setError(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setError(`Could not read ${file.name}.`);
      return;
    }
    const res = await importProjectFromText(text, { fileName: file.name });
    if (!res.ok) {
      setError(`Couldn’t import ${file.name}: ${res.error}`);
      return;
    }
    toast(importMessage(res));
    if (res.outcome !== 'cancelled') onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Projects"
      footer={
        <>
          <span className="ub-pn-footnote">Projects are saved in this browser automatically.</span>
          <Button icon={<FolderInput size={14} aria-hidden />} onClick={() => fileRef.current?.click()}>
            Import .uiex.json
          </Button>
          <Button
            variant="primary"
            icon={<FilePlus2 size={14} aria-hidden />}
            onClick={() => {
              if (saveCurrentProject() === 'conflict') {
                setError(CONFLICT);
                return;
              }
              useEditor.getState().newProject();
              toast('Started a new blank project');
              onClose();
            }}
          >
            New blank project
          </Button>
        </>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept=".json,.uiex.json,application/json"
        className="ub-pn-file-input"
        aria-label="Import builder file"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void importFile(file);
        }}
      />
      {error && (
        <Callout tone="danger" icon={<TriangleAlert size={14} aria-hidden />} role="alert">
          {error}
        </Callout>
      )}
      {projects.length === 0 ? (
        <EmptyState icon={<FolderOpen size={24} aria-hidden />} title="No saved projects">
          Projects you work on are saved here automatically.
        </EmptyState>
      ) : (
        <ul className="ub-pn-projects" aria-label="Saved projects">
          {projects.map((p) => {
            const current = p.id === currentId;
            if (confirmId === p.id) {
              return (
                <li key={p.id} className="ub-pn-project ub-pn-project--confirm">
                  <span>
                    Delete <strong>{p.appName || p.name}</strong> from this browser? This cannot be undone.
                  </span>
                  <span className="ub-pn-row">
                    <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        deleteSavedProject(p.id);
                        setConfirmId(null);
                        refresh();
                        toast(`Deleted “${p.appName || p.name}”`);
                      }}
                    >
                      Delete
                    </Button>
                  </span>
                </li>
              );
            }
            return (
              <li key={p.id} className={current ? 'ub-pn-project ub-pn-project--current' : 'ub-pn-project'}>
                <span className="ub-pn-project__main">
                  <span className="ub-pn-project__title">
                    {p.appName || p.name}
                    {current && <Badge tone="select">Current</Badge>}
                  </span>
                  <span className="ub-pn-muted">
                    <code>{p.name}</code> · {p.extensionCount} {p.extensionCount === 1 ? 'card or page' : 'cards and pages'} · updated{' '}
                    <time dateTime={p.updatedAt} title={new Date(p.updatedAt).toLocaleString()}>
                      {formatRelativeTime(p.updatedAt)}
                    </time>
                  </span>
                </span>
                <Button
                  size="sm"
                  disabled={current}
                  title={current ? 'This project is already open' : undefined}
                  aria-label={`Open ${p.appName || p.name}`}
                  onClick={() => openProject(p.id)}
                >
                  Open
                </Button>
                <IconButton
                  label={current ? 'The open project cannot be deleted' : `Delete ${p.appName || p.name}`}
                  size="sm"
                  disabled={current}
                  onClick={() => setConfirmId(p.id)}
                >
                  <Trash2 size={13} aria-hidden />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
