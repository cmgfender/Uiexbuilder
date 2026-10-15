import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../model/factory';
import { listSavedProjects, loadSavedProject, saveProject, serializeProject } from '../model/persistence';
import { ImportConflictDialog } from '../shell/importProject';
import { useEditor } from '../model/store';
import { ToastProvider } from '../ui';
import { PROJECT_TEMPLATES } from './catalog';
import { NewProjectDialog } from './NewProjectDialog';

function renderDialog(arg: string | null = null) {
  const onClose = vi.fn();
  const utils = render(
    <ToastProvider>
      <NewProjectDialog open onClose={onClose} arg={arg} />
    </ToastProvider>,
  );
  return { ...utils, onClose };
}

beforeEach(() => {
  window.localStorage.clear();
  useEditor.getState().loadProject(createProject('Existing App'));
});

describe('<NewProjectDialog>', () => {
  it('lists Blank first and every starter as radio options', () => {
    renderDialog();
    const radios = within(screen.getByRole('radiogroup')).getAllByRole('radio');
    expect(radios).toHaveLength(PROJECT_TEMPLATES.length);
    expect(radios[0]).toHaveAccessibleName(/Blank card/);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('requires an app name', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    expect(screen.getByText(/Give your app a name/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(useEditor.getState().project.app.name).toBe('Existing App');
  });

  it('creates a project from the selected starter (with its functions)', () => {
    const before = useEditor.getState().project;
    const { onClose } = renderDialog();
    fireEvent.change(screen.getByLabelText('App name'), { target: { value: 'Acme Quotes' } });
    expect(screen.getByText('acme-quotes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Server-side quote/ }));
    expect(screen.getByRole('radio', { name: /Server-side quote/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    const { project } = useEditor.getState();
    expect(project.id).not.toBe(before.id);
    expect(project.app.name).toBe('Acme Quotes');
    expect(project.name).toBe('acme-quotes');
    expect(project.extensions.map((e) => e.name)).toEqual(['Quote Builder']);
    expect(project.functions.map((f) => f.uid)).toEqual(['generate_quote']);
    expect(onClose).toHaveBeenCalled();
    // The previous project stays saved in the browser.
    expect(listSavedProjects().map((p) => p.id)).toContain(before.id);
  });

  it('creates a blank project by pressing Enter in the name field', () => {
    renderDialog();
    const input = screen.getByLabelText('App name');
    fireEvent.change(input, { target: { value: 'Blank App' } });
    fireEvent.submit(input.closest('form')!);
    const { project } = useEditor.getState();
    expect(project.app.name).toBe('Blank App');
    expect(project.extensions).toHaveLength(1);
    expect(project.extensions[0].nodes[project.extensions[0].rootId].children).toEqual([]);
  });

  it('preselects a template passed as the dialog argument and supports arrow keys', () => {
    renderDialog('ticket-triage');
    const group = screen.getByRole('radiogroup');
    expect(screen.getByRole('radio', { name: /Ticket triage/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(group, { key: 'Home' });
    expect(within(group).getAllByRole('radio')[0]).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(within(group).getAllByRole('radio')[1]).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(within(group).getAllByRole('radio')[PROJECT_TEMPLATES.length - 1]).toHaveAttribute('aria-checked', 'true');
  });

  it('imports a .uiex.json document', async () => {
    const imported = createProject('Imported App');
    const { onClose } = renderDialog();
    const file = new File([serializeProject(imported)], 'imported.uiex.json', { type: 'application/json' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Import builder file'), { target: { files: [file] } });
    });
    await waitFor(() => expect(useEditor.getState().project.id).toBe(imported.id));
    expect(onClose).toHaveBeenCalled();
  });

  it('asks before replacing a saved project with an older download of it', async () => {
    const original = useEditor.getState().project;
    const older = { ...JSON.parse(serializeProject(original)), app: { ...original.app, name: 'Old name' } };
    saveProject(original);
    const onClose = vi.fn();
    render(
      <ToastProvider>
        <NewProjectDialog open onClose={onClose} arg={null} />
        <ImportConflictDialog />
      </ToastProvider>,
    );
    const file = new File([JSON.stringify(older)], 'old.uiex.json', { type: 'application/json' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Import builder file'), { target: { files: [file] } });
    });
    fireEvent.click(await screen.findByRole('button', { name: /Import as a copy/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // The saved project keeps its newer content; the file opened as a separate copy.
    expect(loadSavedProject(original.id)?.app.name).toBe('Existing App');
    expect(useEditor.getState().project.id).not.toBe(original.id);
    expect(useEditor.getState().project.app.name).toBe('Old name');
  });

  it('reports an invalid import without changing the project', async () => {
    const before = useEditor.getState().project.id;
    renderDialog();
    const file = new File(['{"nope": true}'], 'broken.uiex.json', { type: 'application/json' });
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Import builder file'), { target: { files: [file] } });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('broken.uiex.json is not a valid builder file');
    expect(useEditor.getState().project.id).toBe(before);
  });
});
