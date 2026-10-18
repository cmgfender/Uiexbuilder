import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useEditor } from '../model/store';
import { ToastProvider } from '../ui';
import { useDialogs } from './dialogs';
import { formatShortcut, shortcutKeys, SHORTCUTS, useGlobalShortcuts } from './shortcuts';
import { useShell } from './shellStore';
import { activeNodes, projectWith, resetEditor, rootChildren } from './testUtils';

function Harness() {
  useGlobalShortcuts();
  return (
    <div>
      <input data-testid="field" defaultValue="hello" />
      <textarea data-testid="area" defaultValue="" />
      <button type="button">plain button</button>
    </div>
  );
}

function setup() {
  resetEditor(
    projectWith([
      {
        type: 'Flex',
        name: 'Stack',
        props: { direction: 'column' },
        children: [
          { type: 'Text', name: 'First', text: 'one' },
          { type: 'Text', name: 'Second', text: 'two' },
        ],
      },
      { type: 'Button', name: 'Go', text: 'Go' },
    ]),
  );
  render(
    <ToastProvider>
      <Harness />
    </ToastProvider>,
  );
  const [stack, button] = rootChildren();
  const [first, second] = activeNodes()[stack].children;
  return { stack, button, first, second };
}

const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(document.body, { key: k, ...init });

describe('global shortcuts', () => {
  beforeEach(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
  });

  it('Delete / Backspace remove the selection, but never a locked node', () => {
    const { first, second, button } = setup();
    useEditor.getState().select(first);
    key('Delete');
    expect(activeNodes()[first]).toBeUndefined();

    useEditor.getState().select(second);
    key('Backspace');
    expect(activeNodes()[second]).toBeUndefined();

    useEditor.getState().updateNode(button, { locked: true });
    useEditor.getState().select(button);
    key('Delete');
    expect(activeNodes()[button]).toBeDefined();
    expect(screen.getByText(/is locked/)).toBeInTheDocument();
  });

  it('undo / redo with Cmd+Z, Shift+Cmd+Z and Cmd+Y', () => {
    const { first } = setup();
    useEditor.getState().select(first);
    key('Delete');
    expect(activeNodes()[first]).toBeUndefined();
    key('z', { ctrlKey: true });
    expect(activeNodes()[first]).toBeDefined();
    key('Z', { metaKey: true, shiftKey: true });
    expect(activeNodes()[first]).toBeUndefined();
    key('z', { metaKey: true });
    expect(activeNodes()[first]).toBeDefined();
    key('y', { ctrlKey: true });
    expect(activeNodes()[first]).toBeUndefined();
  });

  it('Cmd+D duplicates, Cmd+C / Cmd+V paste after the selection, Cmd+X cuts', () => {
    const { stack, first } = setup();
    useEditor.getState().select(first);
    key('d', { ctrlKey: true });
    expect(activeNodes()[stack].children).toHaveLength(3);

    useEditor.getState().select(first);
    key('c', { ctrlKey: true });
    expect(useEditor.getState().clipboard?.type).toBe('Text');
    key('v', { ctrlKey: true });
    const kids = activeNodes()[stack].children;
    expect(kids).toHaveLength(4);
    expect(kids[0]).toBe(first);
    expect(activeNodes()[kids[1]].text).toBe('one');

    useEditor.getState().select(first);
    key('x', { ctrlKey: true });
    expect(activeNodes()[first]).toBeUndefined();
    expect(useEditor.getState().clipboard?.name).toBe('First');
  });

  it('Escape selects the parent, then clears the selection at the top level', () => {
    const { stack, first } = setup();
    useEditor.getState().select(first);
    key('Escape');
    expect(useEditor.getState().selectedNodeId).toBe(stack);
    key('Escape');
    expect(useEditor.getState().selectedNodeId).toBeNull();
  });

  it('arrow keys walk siblings, parent and first child', () => {
    const { stack, button, first, second } = setup();
    key('ArrowDown');
    expect(useEditor.getState().selectedNodeId).toBe(stack);
    key('ArrowDown');
    expect(useEditor.getState().selectedNodeId).toBe(button);
    key('ArrowUp');
    expect(useEditor.getState().selectedNodeId).toBe(stack);
    key('ArrowRight');
    expect(useEditor.getState().selectedNodeId).toBe(first);
    key('ArrowDown');
    expect(useEditor.getState().selectedNodeId).toBe(second);
    key('ArrowLeft');
    expect(useEditor.getState().selectedNodeId).toBe(stack);
  });

  it('Alt+ArrowUp / Alt+ArrowDown reorder among siblings', () => {
    const { stack, first, second } = setup();
    useEditor.getState().select(first);
    key('ArrowDown', { altKey: true });
    expect(activeNodes()[stack].children).toEqual([second, first]);
    key('ArrowUp', { altKey: true });
    expect(activeNodes()[stack].children).toEqual([first, second]);
    // Already first: nothing happens.
    key('ArrowUp', { altKey: true });
    expect(activeNodes()[stack].children).toEqual([first, second]);
  });

  it('Cmd+G wraps the selection in a Flex', () => {
    const { button } = setup();
    useEditor.getState().select(button);
    key('g', { ctrlKey: true });
    const wrapper = rootChildren()[1];
    expect(activeNodes()[wrapper].type).toBe('Flex');
    expect(activeNodes()[wrapper].children).toEqual([button]);
    expect(useEditor.getState().selectedNodeId).toBe(wrapper);
  });

  it('Cmd+Enter toggles Design / Preview', () => {
    setup();
    key('Enter', { metaKey: true });
    expect(useEditor.getState().mode).toBe('preview');
    key('Enter', { metaKey: true });
    expect(useEditor.getState().mode).toBe('design');
  });

  it('opens dialogs and panels: ?, Shift+Cmd+E, Cmd+1..4, Cmd+J, Cmd+/', () => {
    setup();
    key('?', { shiftKey: true });
    expect(useDialogs.getState().current).toBe('shortcuts');
    useDialogs.getState().close();

    key('E', { ctrlKey: true, shiftKey: true });
    expect(useDialogs.getState().current).toBe('export');
    useDialogs.getState().close();

    key('2', { ctrlKey: true });
    expect(useEditor.getState().leftPanel).toBe('layers');
    key('4', { ctrlKey: true });
    expect(useEditor.getState().leftPanel).toBe('data');

    key('j', { ctrlKey: true });
    expect(useEditor.getState().bottomPanel).toBe('code');
    key('j', { ctrlKey: true });
    expect(useEditor.getState().bottomPanel).toBeNull();

    useShell.getState().setLeftCollapsed(true);
    key('/', { ctrlKey: true });
    expect(useEditor.getState().leftPanel).toBe('components');
    expect(useShell.getState().leftCollapsed).toBe(false);
    expect(useShell.getState().paletteFocusNonce).toBe(1);
  });

  it('Cmd+S saves the project (even from a text field) and reports it', () => {
    setup();
    const field = screen.getByTestId('field');
    field.focus();
    const ev = fireEvent.keyDown(field, { key: 's', ctrlKey: true });
    expect(ev).toBe(false); // default prevented
    const id = useEditor.getState().project.id;
    expect(window.localStorage.getItem(`uiex-builder:project:${id}`)).toBeTruthy();
    expect(screen.getByText('Saved in this browser')).toBeInTheDocument();
    expect(useShell.getState().saveStatus).toBe('saved');
  });

  it('is ignored while typing in inputs and text areas (undo stays with the field)', () => {
    const { first } = setup();
    useEditor.getState().select(first);
    const field = screen.getByTestId('field');
    field.focus();
    fireEvent.keyDown(field, { key: 'Delete' });
    fireEvent.keyDown(field, { key: 'Backspace' });
    expect(activeNodes()[first]).toBeDefined();

    useEditor.getState().setText(first, 'changed');
    const ev = fireEvent.keyDown(field, { key: 'z', ctrlKey: true });
    expect(ev).toBe(true); // not prevented: the browser's own undo runs
    expect(activeNodes()[first].text).toBe('changed');

    const area = screen.getByTestId('area');
    area.focus();
    fireEvent.keyDown(area, { key: 'ArrowDown' });
    expect(useEditor.getState().selectedNodeId).toBe(first);
  });

  it('single-key shortcuts never act while focus is on a control outside the canvas', () => {
    const { first, second } = setup();
    useEditor.getState().select(first);
    const button = screen.getByRole('button', { name: 'plain button' });
    button.focus();
    for (const k of ['Delete', 'Backspace', 'ArrowDown', 'ArrowLeft', 'Escape']) fireEvent.keyDown(button, { key: k });
    fireEvent.keyDown(button, { key: 'ArrowDown', altKey: true });
    expect(activeNodes()[first]).toBeDefined();
    expect(useEditor.getState().selectedNodeId).toBe(first);
    expect(activeNodes()[rootChildren()[0]].children).toEqual([first, second]); // Alt+ArrowDown did not move it

    // A checkbox / switch is not a text field either, but Backspace on it must not delete.
    const box = document.createElement('input');
    box.type = 'checkbox';
    document.body.appendChild(box);
    box.focus();
    fireEvent.keyDown(box, { key: 'Backspace' });
    expect(activeNodes()[first]).toBeDefined();
    box.remove();
  });

  it('single-key shortcuts act on the canvas stage and inside a data-shortcuts-scope region', () => {
    const { first, second } = setup();
    const stage = document.createElement('div');
    stage.className = 'ub-cv-stage';
    stage.tabIndex = 0;
    document.body.appendChild(stage);
    useEditor.getState().select(first);
    stage.focus();
    fireEvent.keyDown(stage, { key: 'ArrowDown' });
    expect(useEditor.getState().selectedNodeId).toBe(second);
    fireEvent.keyDown(stage, { key: 'Delete' });
    expect(activeNodes()[second]).toBeUndefined();
    stage.remove();

    const scoped = document.createElement('div');
    scoped.setAttribute('data-shortcuts-scope', '');
    const inner = document.createElement('button');
    scoped.appendChild(inner);
    document.body.appendChild(scoped);
    useEditor.getState().select(first);
    inner.focus();
    fireEvent.keyDown(inner, { key: 'Escape' });
    expect(useEditor.getState().selectedNodeId).not.toBe(first);
    scoped.remove();
  });

  it('is ignored while a dialog is open', () => {
    const { first } = setup();
    useEditor.getState().select(first);
    useDialogs.getState().open('appSettings');
    key('Delete');
    expect(activeNodes()[first]).toBeDefined();
    useDialogs.getState().close();
    key('Delete');
    expect(activeNodes()[first]).toBeUndefined();
  });

  it('several selected: Delete removes them all in one undo step, Escape keeps only the primary one', () => {
    const { first, second, button } = setup();
    useEditor.getState().selectMany([first, second]);
    key('Escape');
    expect(useEditor.getState().selectedNodeIds).toEqual([]);
    expect(useEditor.getState().selectedNodeId).toBe(second);

    useEditor.getState().selectMany([first, button]);
    key('Delete');
    expect(activeNodes()[first]).toBeUndefined();
    expect(activeNodes()[button]).toBeUndefined();
    expect(useEditor.getState().selectedNodeId).toBeNull();
    key('z', { metaKey: true });
    expect(activeNodes()[first]).toBeDefined();
    expect(activeNodes()[button]).toBeDefined();
  });

  it('Alt+Cmd+C / Alt+Cmd+V copy and paste settings (by key code: Alt changes the key on macOS)', () => {
    const { first, second } = setup();
    useEditor.getState().setProps(first, { variant: 'microcopy', format: { fontWeight: 'bold' } });
    useEditor.getState().select(first);
    key('ç', { code: 'KeyC', metaKey: true, altKey: true });
    expect(useEditor.getState().settingsClipboard?.type).toBe('Text');
    expect(screen.getByText(/Copied the settings of/)).toBeInTheDocument();
    useEditor.getState().select(second);
    key('√', { code: 'KeyV', metaKey: true, altKey: true });
    expect(activeNodes()[second].props).toMatchObject({ variant: 'microcopy', format: { fontWeight: 'bold' } });
    expect(activeNodes()[second].text).toBe('one');
  });

  it('does not edit the structure in preview mode', () => {
    const { first } = setup();
    useEditor.getState().select(first);
    useEditor.getState().setMode('preview');
    key('Delete');
    expect(activeNodes()[first]).toBeDefined();
  });
});

describe('shortcut display', () => {
  it('renders platform symbols', () => {
    expect(shortcutKeys('Shift+Cmd+Z', true)).toEqual(['⇧', '⌘', 'Z']);
    expect(shortcutKeys('Shift+Cmd+Z', false)).toEqual(['Shift', 'Ctrl', 'Z']);
    expect(formatShortcut('Cmd+Enter', true)).toBe('⌘↵');
    expect(formatShortcut('Alt+ArrowUp', false)).toBe('Alt+↑');
  });

  it('documents every binding once', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['undo', 'redo', 'delete', 'duplicate', 'copy', 'cut', 'paste', 'save', 'export', 'toggleBottom', 'focusSearch']) {
      expect(ids).toContain(id);
    }
  });
});
