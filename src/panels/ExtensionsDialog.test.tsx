import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createExtension, createProject } from '../model/factory';
import { useEditor } from '../model/store';
import { ToastProvider } from '../ui';
import { ExtensionsDialog } from './dialogs';

function renderDialog() {
  const onClose = vi.fn();
  render(
    <ToastProvider>
      <ExtensionsDialog open onClose={onClose} />
    </ToastProvider>,
  );
  return { onClose };
}

const exts = () => useEditor.getState().project.extensions;

beforeEach(() => {
  const a = createExtension({ name: 'Alpha' });
  const b = createExtension({ name: 'Beta', existing: [a] });
  useEditor.getState().loadProject(createProject('Ext App', [a, b]));
});

describe('<ExtensionsDialog>', () => {
  it('highlights and focuses the extension passed as arg', async () => {
    const beta = exts()[1];
    render(
      <ToastProvider>
        <ExtensionsDialog open onClose={() => {}} arg={beta.id} />
      </ToastProvider>,
    );
    const name = screen.getByRole('textbox', { name: 'Name of Beta' });
    await waitFor(() => expect(name).toHaveFocus());
    expect(name.closest('tr')).toHaveClass('ub-pn-table__flash');
    expect(screen.getByRole('textbox', { name: 'Name of Alpha' }).closest('tr')).not.toHaveClass('ub-pn-table__flash');
  });

  it('adds a settings page and an app home page at most once', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Add settings page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add app home page' }));
    expect(exts().map((e) => e.kind)).toEqual(['card', 'card', 'settings', 'home']);
    expect(screen.getByRole('button', { name: 'Add settings page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add app home page' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add card' }));
    expect(exts()).toHaveLength(5);
  });

  it('edits names, locations, object types, file names and uids with uniqueness checks', () => {
    renderDialog();
    const [alpha, beta] = exts();
    const name = screen.getByRole('textbox', { name: 'Name of Alpha' });
    fireEvent.change(name, { target: { value: 'Alpha Prime' } });
    fireEvent.blur(name);
    expect(exts()[0].name).toBe('Alpha Prime');

    fireEvent.change(screen.getByRole('combobox', { name: 'Location of Alpha Prime' }), { target: { value: 'crm.record.sidebar' } });
    expect(exts()[0].location).toBe('crm.record.sidebar');

    const types = screen.getByRole('combobox', { name: 'Object types of Alpha Prime' });
    fireEvent.focus(types);
    fireEvent.change(types, { target: { value: 'deals' } });
    fireEvent.keyDown(types, { key: 'Enter' });
    expect(exts()[0].objectTypes).toEqual(['contacts', 'deals']);

    const uid = screen.getByRole('textbox', { name: 'UID of Alpha Prime' });
    fireEvent.change(uid, { target: { value: beta.uid } });
    fireEvent.keyDown(uid, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('Card “Beta” already uses this UID');
    expect(exts()[0].uid).toBe(alpha.uid);
    fireEvent.change(uid, { target: { value: 'alpha_prime' } });
    fireEvent.keyDown(uid, { key: 'Enter' });
    expect(exts()[0].uid).toBe('alpha_prime');

    const file = screen.getByRole('textbox', { name: 'File name of Alpha Prime' });
    fireEvent.change(file, { target: { value: beta.fileName } });
    fireEvent.keyDown(file, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('“Beta” already uses this file name');
    fireEvent.change(file, { target: { value: 'AlphaPrimeCard' } });
    fireEvent.keyDown(file, { key: 'Enter' });
    expect(exts()[0].fileName).toBe('AlphaPrimeCard');
  });

  it('applies the project-wide uid and file name rules of validation', async () => {
    const { validateProject } = await import('../model/validate');
    useEditor.getState().addExtension({ kind: 'settings' });
    renderDialog();
    const [alpha] = exts();
    const appUid = useEditor.getState().project.app.uid;
    const uid = screen.getByRole('textbox', { name: 'UID of Alpha' });
    fireEvent.change(uid, { target: { value: appUid } });
    fireEvent.keyDown(uid, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('The app already uses this UID');
    expect(exts()[0].uid).toBe(alpha.uid);
    fireEvent.blur(uid);

    const file = screen.getByRole('textbox', { name: 'File name of Alpha' });
    // Validation requires PascalCase extension file names.
    fireEvent.change(file, { target: { value: 'my-card' } });
    fireEvent.keyDown(file, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('PascalCase');
    // Unique across every extension (not only cards), ignoring case.
    const settings = exts()[2];
    fireEvent.change(file, { target: { value: settings.fileName.toUpperCase() } });
    fireEvent.keyDown(file, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('already uses this file name');
    expect(exts()[0].fileName).toBe(alpha.fileName);
    const rules = validateProject(useEditor.getState().project).map((i) => i.rule);
    expect(rules).not.toContain('duplicate-uid');
    expect(rules).not.toContain('invalid-file-name');
  });

  it('opens, duplicates and deletes extensions (never the last one)', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Beta' }));
    expect(exts().map((e) => e.name)).toEqual(['Alpha', 'Beta', 'Beta copy']);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Beta copy' }));
    const table = screen.getByRole('table', { name: 'Cards and pages' });
    expect(within(table).getByText(/are removed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete extension' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Beta' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete extension' }));
    expect(exts().map((e) => e.name)).toEqual(['Alpha']);
    expect(screen.getByRole('button', { name: 'A project needs at least one card or page' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Open Alpha in the editor' }));
    expect(useEditor.getState().activeExtensionId).toBe(exts()[0].id);
    expect(onClose).toHaveBeenCalled();
  });

  it('focuses the name field from the rename action', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Rename Beta' }));
    expect(screen.getByRole('textbox', { name: 'Name of Beta' })).toHaveFocus();
  });
});
