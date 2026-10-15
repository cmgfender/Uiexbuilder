import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';
import { useEditor } from './model/store';
import { useDialogs } from './shell/dialogs';
import { resetEditor } from './shell/testUtils';

const settle = (ms = 0) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

describe('App (smoke test with all real modules)', () => {
  it('renders the editor shell and survives the main interactions', async () => {
    resetEditor();
    render(<App />);
    expect(screen.getByRole('banner', { name: 'Editor top bar' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Editor mode' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search components')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Export/ })).toBeInTheDocument();

    // Every left tab renders.
    for (const tab of ['Layers', 'Templates', 'Data', 'Components']) {
      fireEvent.click(screen.getByRole('tab', { name: tab }));
      await settle();
    }

    // Add a component from the palette.
    const before = Object.keys(useEditor.getState().project.extensions[0].nodes).length;
    fireEvent.click(document.querySelector('.ub-sh-pal-tile[data-component-type="Button"]')!);
    expect(Object.keys(useEditor.getState().project.extensions[0].nodes).length).toBeGreaterThan(before);

    // Bottom panel tabs.
    for (const tab of [/Code/, /Problems/, /Console/]) {
      fireEvent.click(screen.getByRole('tab', { name: tab }));
      await settle();
    }

    // Preview and back.
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    expect(useEditor.getState().mode).toBe('preview');
    await settle();
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    expect(useEditor.getState().mode).toBe('design');

    // Shortcuts dialog (owned by the shell) and every mounted dialog open/close without crashing.
    fireEvent.keyDown(document.body, { key: '?' });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    act(() => useDialogs.getState().close());
    for (const name of ['appSettings', 'extensionSettings', 'functions', 'export', 'projects', 'newProject'] as const) {
      act(() => useDialogs.getState().open(name));
      await settle();
      act(() => useDialogs.getState().close());
    }

    // Collapse and restore the sidebars.
    fireEvent.click(screen.getByRole('button', { name: 'Hide left sidebar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide inspector' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show left sidebar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show inspector' }));

    // Let debounced work (validation, code generation, autosave) settle.
    await settle(650);
    expect(window.localStorage.getItem(`uiex-builder:project:${useEditor.getState().project.id}`)).toBeTruthy();
  });
});
