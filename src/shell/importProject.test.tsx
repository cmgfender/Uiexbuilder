import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createProject } from '../model/factory';
import { loadSavedProject, saveProject, serializeProject } from '../model/persistence';
import { useEditor } from '../model/store';
import { isProjectTrusted } from '../model/trust';
import { ToastProvider } from '../ui';
import { ImportConflictDialog, importProjectFromText, type ImportResult } from './importProject';
import { TopBar } from './TopBar';
import { resetEditor, rootChildren } from './testUtils';

function renderDialog() {
  return render(
    <ToastProvider>
      <ImportConflictDialog />
    </ToastProvider>,
  );
}

/** The open project as downloaded now, then edited further (a newer local version). */
function olderDownloadOfOpenProject() {
  const project = useEditor.getState().project;
  saveProject(project);
  const file = serializeProject(project);
  act(() => useEditor.getState().removeNode(rootChildren()[0]));
  return { id: project.id, file };
}

describe('importing a .uiex.json whose project id is already saved here', () => {
  it('opens a new project directly (no prompt) and saves it', async () => {
    resetEditor();
    renderDialog();
    const other = createProject('Other App');
    let result: ImportResult | undefined;
    await act(async () => {
      result = await importProjectFromText(serializeProject(other));
    });
    expect(result).toMatchObject({ ok: true, outcome: 'opened' });
    expect(useEditor.getState().project.id).toBe(other.id);
    expect(loadSavedProject(other.id)).not.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks before replacing a different saved version; "Import as a copy" keeps both', async () => {
    resetEditor();
    renderDialog();
    const { id, file } = olderDownloadOfOpenProject();
    const newer = useEditor.getState().project;
    let pending!: Promise<ImportResult>;
    act(() => {
      pending = importProjectFromText(file, { fileName: 'v1.uiex.json' });
    });
    const dialog = await screen.findByRole('dialog', { name: 'This project is already saved here' });
    expect(dialog).toHaveTextContent('v1.uiex.json');
    // The current project's latest edits were saved before anything else happened.
    expect(loadSavedProject(id)!.extensions[0].nodes[loadSavedProject(id)!.extensions[0].rootId].children).toEqual(
      newer.extensions[0].nodes[newer.extensions[0].rootId].children,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Import as a copy' }));
    const result = await pending;
    expect(result).toMatchObject({ ok: true, outcome: 'copied' });
    const opened = useEditor.getState().project;
    expect(opened.id).not.toBe(id);
    expect(opened.name).toMatch(/\(copy\)$/);
    expect(loadSavedProject(opened.id)).not.toBeNull();
    // The newer local version is untouched and keeps its trust; the copy runs no code until trusted.
    expect(serializeProject(loadSavedProject(id)!)).toBe(serializeProject(newer));
    expect(isProjectTrusted(id)).toBe(true);
    expect(isProjectTrusted(opened.id)).toBe(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('"Replace saved version" opens the file under the same id; Cancel changes nothing', async () => {
    resetEditor();
    renderDialog();
    const { id, file } = olderDownloadOfOpenProject();
    const newer = useEditor.getState().project;

    let pending!: Promise<ImportResult>;
    act(() => {
      pending = importProjectFromText(file);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await pending).toMatchObject({ ok: true, outcome: 'cancelled' });
    expect(useEditor.getState().project).toBe(newer);
    expect(isProjectTrusted(id)).toBe(true);

    act(() => {
      pending = importProjectFromText(file);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Replace saved version' }));
    expect(await pending).toMatchObject({ ok: true, outcome: 'replaced' });
    expect(useEditor.getState().project.id).toBe(id);
    expect(serializeProject(loadSavedProject(id)!)).toBe(file);
    expect(isProjectTrusted(id)).toBe(false);
  });

  it('opens an identical saved version without asking', async () => {
    resetEditor();
    renderDialog();
    const project = useEditor.getState().project;
    saveProject(project);
    let result: ImportResult | undefined;
    await act(async () => {
      result = await importProjectFromText(serializeProject(project));
    });
    expect(result).toMatchObject({ ok: true, outcome: 'opened' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the top bar import uses the same prompt', async () => {
    resetEditor();
    render(
      <ToastProvider>
        <TopBar />
        <ImportConflictDialog />
      </ToastProvider>,
    );
    const { file } = olderDownloadOfOpenProject();
    const input = screen.getByLabelText('Import .uiex.json file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([file], 'v1.uiex.json', { type: 'application/json' })] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Import as a copy' }));
    await waitFor(() => expect(screen.getByText(/as a copy/)).toBeInTheDocument());
  });
});
