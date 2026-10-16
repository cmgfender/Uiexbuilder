import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createProject } from '../model/factory';
import { serializeProject } from '../model/persistence';
import { useEditor } from '../model/store';
import { ToastProvider } from '../ui';
import { useDialogs } from './dialogs';
import { useProblems } from './problems';
import { useShell } from './shellStore';
import { TopBar } from './TopBar';
import { resetEditor, rootChildren } from './testUtils';

function renderBar() {
  return render(
    <ToastProvider>
      <TopBar />
    </ToastProvider>,
  );
}

describe('<TopBar>', () => {
  it('opens app settings from the app name', () => {
    resetEditor();
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /My UI Extensions App/ }));
    expect(useDialogs.getState().current).toBe('appSettings');
  });

  it('switches and adds extensions; one settings page and one app home at most', () => {
    resetEditor();
    renderBar();
    const trigger = screen.getByRole('button', { name: /Contact Overview/ });
    fireEvent.click(trigger);
    expect(screen.getByRole('menuitem', { name: /Contact Overview.*Record tab/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add settings page' }));
    const s = useEditor.getState();
    expect(s.project.extensions.map((e) => e.kind)).toEqual(['card', 'settings']);
    expect(s.activeExtensionId).toBe(s.project.extensions[1].id);
    expect(screen.getByText(/Added “Settings”/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /switch or add cards and pages/i }));
    expect(screen.getByRole('menuitem', { name: /Add settings page \(already added\)/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('menuitem', { name: /Contact Overview/ }));
    expect(useEditor.getState().activeExtensionId).toBe(useEditor.getState().project.extensions[0].id);

    fireEvent.click(screen.getByRole('button', { name: /switch or add cards and pages/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Manage cards and pages/ }));
    expect(useDialogs.getState().current).toBe('extensionSettings');
  });

  it('undo / redo buttons reflect history', () => {
    resetEditor();
    renderBar();
    const undo = screen.getByRole('button', { name: /^Undo/ });
    const redo = screen.getByRole('button', { name: /^Redo/ });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
    act(() => {
      useEditor.getState().removeNode(rootChildren()[0]);
    });
    expect(undo).toBeEnabled();
    fireEvent.click(undo);
    expect(rootChildren()).toHaveLength(1);
    expect(redo).toBeEnabled();
  });

  it('toggles Design / Preview and resets the preview', () => {
    resetEditor();
    renderBar();
    expect(screen.queryByRole('button', { name: /Reset preview/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Preview/ }));
    expect(useEditor.getState().mode).toBe('preview');
    const before = useEditor.getState().previewResetKey;
    fireEvent.click(screen.getByRole('button', { name: /Reset preview/ }));
    expect(useEditor.getState().previewResetKey).toBe(before + 1);
    fireEvent.click(screen.getByRole('button', { name: /Design/ }));
    expect(useEditor.getState().mode).toBe('design');
  });

  it('shows problem counts and opens the problems tab', () => {
    resetEditor();
    renderBar();
    expect(screen.getByRole('button', { name: /No problems/ })).toBeInTheDocument();
    act(() =>
      useProblems.getState().setIssues([
        { id: 'a', severity: 'error', message: 'x', rule: 'r' },
        { id: 'b', severity: 'warning', message: 'y', rule: 'r' },
        { id: 'c', severity: 'warning', message: 'z', rule: 'r' },
      ]),
    );
    const badge = screen.getByRole('button', { name: /1 error, 2 warnings/ });
    fireEvent.click(badge);
    expect(useEditor.getState().bottomPanel).toBe('problems');
  });

  it('functions, export, project and help menus open the right dialogs', () => {
    resetEditor();
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: /Functions/ }));
    expect(useDialogs.getState().current).toBe('functions');
    fireEvent.click(screen.getByRole('button', { name: /^Publish/ }));
    expect(useDialogs.getState().current).toBe('export');

    fireEvent.click(screen.getByRole('button', { name: /^Project/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /New project/ }));
    expect(useDialogs.getState().current).toBe('newProject');

    fireEvent.click(screen.getByRole('button', { name: /^Project/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Open/ }));
    expect(useDialogs.getState().current).toBe('projects');

    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Keyboard shortcuts/ }));
    expect(useDialogs.getState().current).toBe('shortcuts');
  });

  it('a menu opens again right after one of its items was chosen (only a press on the trigger closes and swallows)', () => {
    resetEditor();
    renderBar();
    const trigger = screen.getByRole('button', { name: /^Project/ });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: /Save/ }));
    expect(screen.queryByRole('menu')).toBeNull();
    // Immediately again (well within 100 ms): it opens.
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    // A press on the trigger while it is open closes it (and the click that follows doesn't reopen it).
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Help offers Getting started and the tour', async () => {
    resetEditor();
    const { useOnboarding, resetOnboardingForTests } = await import('../onboarding/store');
    resetOnboardingForTests();
    renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Getting started' }));
    expect(useOnboarding.getState()).toMatchObject({ open: true, view: 'welcome' });
    act(() => useOnboarding.setState({ open: false }));
    useEditor.getState().setMode('preview');
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Take the tour' }));
    await waitFor(() => expect(useOnboarding.getState().tour).toEqual({ active: true, step: 0 }));
    expect(useEditor.getState().mode).toBe('design');
    resetOnboardingForTests();
  });

  it('imports a .uiex.json document and reports invalid files', async () => {
    resetEditor();
    renderBar();
    const other = createProject('Imported App');
    const input = screen.getByLabelText('Import .uiex.json file') as HTMLInputElement;
    const file = new File([serializeProject(other)], 'imported.uiex.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(useEditor.getState().project.id).toBe(other.id));
    expect(screen.getByText(/Imported “Imported App”/)).toBeInTheDocument();

    const bad = new File(['{ nope'], 'bad.uiex.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [bad] } });
    await waitFor(() => expect(screen.getByText(/Import failed: Invalid JSON/)).toBeInTheDocument());
    expect(useEditor.getState().project.id).toBe(other.id);
  });

  it('does not announce routine autosaves; announces failures; a conflict becomes a button', () => {
    resetEditor();
    renderBar();
    act(() => useShell.getState().setSaveStatus('pending'));
    const saving = screen.getByText('Saving…');
    expect(saving.closest('[role="status"], [aria-live]')).toBeNull();
    act(() => useShell.getState().setSaveStatus('saved'));
    expect(screen.getByText('Saved locally').closest('[role="status"], [aria-live]')).toBeNull();
    act(() => useShell.getState().setSaveStatus('error'));
    expect(screen.getByRole('alert')).toHaveTextContent(/Not saved/);

    act(() => {
      useShell.getState().setConflict({ projectId: useEditor.getState().project.id, dismissed: true });
      useShell.getState().setSaveStatus('conflict');
    });
    fireEvent.click(screen.getByRole('button', { name: /Changed in another tab/ }));
    expect(useShell.getState().conflict).toMatchObject({ dismissed: false });
  });

  it('compact windows start with the left sidebar as a rail without changing the saved setting', () => {
    resetEditor();
    renderBar();
    act(() => useShell.getState().setCompact(true));
    expect(screen.getByRole('button', { name: 'Show left sidebar' })).toBeInTheDocument();
    expect(useShell.getState().leftCollapsed).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Show left sidebar' }));
    expect(screen.getByRole('button', { name: 'Hide left sidebar' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide left sidebar' }));
    expect(useShell.getState().leftCollapsed).toBe(false); // temporary in compact mode
    expect(useShell.getState().leftAutoCollapsed).toBe(true);
    act(() => useShell.getState().setCompact(false));
    expect(screen.getByRole('button', { name: 'Hide left sidebar' })).toBeInTheDocument();
  });

  it('shows the autosave status and toggles panels', () => {
    resetEditor();
    renderBar();
    expect(screen.getByText('Autosave on')).toBeInTheDocument();
    act(() => useShell.getState().setSaveStatus('pending'));
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    act(() => useShell.getState().setSaveStatus('saved'));
    expect(screen.getByText('Saved locally')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Hide left sidebar' }));
    expect(useShell.getState().leftCollapsed).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Hide inspector' }));
    expect(useShell.getState().rightCollapsed).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Show code, problems/ }));
    expect(useEditor.getState().bottomPanel).toBe('code');
  });
});
