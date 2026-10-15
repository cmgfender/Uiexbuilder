import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createProject } from '../model/factory';
import { listSavedProjects, saveProject, serializeProject } from '../model/persistence';
import { useEditor } from '../model/store';
import { ToastProvider } from '../ui';
import { ProjectsDialog } from './dialogs';

function renderDialog() {
  const onClose = vi.fn();
  render(
    <ToastProvider>
      <ProjectsDialog open onClose={onClose} />
    </ToastProvider>,
  );
  return { onClose };
}

function importFile(contents: string, name = 'project.uiex.json') {
  const input = screen.getByLabelText('Import builder file') as HTMLInputElement;
  const file = new File([contents], name, { type: 'application/json' });
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(() => {
  window.localStorage.clear();
  useEditor.getState().loadProject(createProject('Current App'));
});

describe('<ProjectsDialog>', () => {
  it('lists saved projects, marks the current one and opens another', () => {
    const other = createProject('Other App');
    other.updatedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    saveProject(other);
    const { onClose } = renderDialog();
    const list = screen.getByRole('list', { name: 'Saved projects' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    const current = items.find((i) => i.textContent?.includes('Current App'))!;
    expect(within(current).getByText('Current')).toBeInTheDocument();
    expect(within(current).getByRole('button', { name: 'Open Current App' })).toBeDisabled();
    const otherItem = items.find((i) => i.textContent?.includes('Other App'))!;
    expect(otherItem).toHaveTextContent('1 extension');
    expect(otherItem).toHaveTextContent('5 min ago');
    fireEvent.click(within(otherItem).getByRole('button', { name: 'Open Other App' }));
    expect(useEditor.getState().project.id).toBe(other.id);
    expect(onClose).toHaveBeenCalled();
  });

  it('deletes a saved project after confirmation', () => {
    const other = createProject('Other App');
    saveProject(other);
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Other App' }));
    expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(listSavedProjects().map((p) => p.id)).not.toContain(other.id);
    expect(screen.queryByText('Other App')).toBeNull();
  });

  it('shows an error for invalid JSON and for invalid documents', async () => {
    renderDialog();
    const before = useEditor.getState().project.id;
    importFile('{ not json');
    expect(await screen.findByRole('alert')).toHaveTextContent('project.uiex.json is not a valid builder file: Invalid JSON');
    importFile(JSON.stringify({ schemaVersion: 2 }), 'old.uiex.json');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unsupported or missing schemaVersion'));
    expect(useEditor.getState().project.id).toBe(before);
  });

  it('imports a valid builder file', async () => {
    const { onClose } = renderDialog();
    const imported = createProject('Imported App');
    importFile(serializeProject(imported));
    await waitFor(() => expect(useEditor.getState().project.id).toBe(imported.id));
    expect(onClose).toHaveBeenCalled();
    expect(listSavedProjects().map((p) => p.id)).toContain(imported.id);
  });

  it('starts a new blank project and keeps the previous one saved', () => {
    const { onClose } = renderDialog();
    const before = useEditor.getState().project.id;
    fireEvent.click(screen.getByRole('button', { name: 'New blank project' }));
    expect(useEditor.getState().project.id).not.toBe(before);
    expect(listSavedProjects().map((p) => p.id)).toContain(before);
    expect(onClose).toHaveBeenCalled();
  });
});
