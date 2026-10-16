import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { App } from './App';
import { useEditor } from './model/store';
import { useDialogs } from './shell/dialogs';
import { resetEditor } from './shell/testUtils';
import { recordFirstRun, resetOnboardingForTests, useOnboarding } from './onboarding';

const settle = (ms = 0) =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

describe('App (smoke test with all real modules)', () => {
  it('renders the editor shell and survives the main interactions', async () => {
    resetEditor();
    resetOnboardingForTests();
    // A returning user: the first-run welcome was completed before.
    recordFirstRun('completed');
    render(<App />);
    expect(screen.getByRole('banner', { name: 'Editor top bar' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Editor mode' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search components')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Publish/ })).toBeInTheDocument();

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

  it('opens the first-run welcome over the editor on a first visit, and not again once skipped', async () => {
    resetEditor();
    resetOnboardingForTests();
    const view = render(<App />);
    const welcome = screen.getByRole('dialog', { name: 'Build your own HubSpot cards' });
    expect(welcome).toBeInTheDocument();
    // The editor behind it is inert and hidden from assistive technology.
    const shell = document.querySelector('.ub-sh-viewport')!;
    expect(shell).toHaveAttribute('inert');
    expect(shell).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('banner', { name: 'Editor top bar' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /I know what I’m doing/ }));
    expect(useOnboarding.getState().open).toBe(false);
    expect(shell).not.toHaveAttribute('inert');
    expect(screen.getByRole('banner', { name: 'Editor top bar' })).toBeInTheDocument();
    // No tour for someone who knows what they're doing.
    expect(useOnboarding.getState().tour.active).toBe(false);

    // A return visit: no welcome.
    view.unmount();
    const stored = window.localStorage.getItem('uiex-builder:first-run');
    expect(stored && JSON.parse(stored).status).toBe('skipped');
    resetOnboardingForTests();
    recordFirstRun('skipped');
    render(<App />);
    expect(screen.queryByRole('dialog', { name: 'Build your own HubSpot cards' })).toBeNull();
    expect(screen.getByRole('banner', { name: 'Editor top bar' })).toBeInTheDocument();
    await settle();
  });
});
