import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExtension, createProject } from '../model/factory';
import { selectActiveExtension, useEditor } from '../model/store';
import type { Extension } from '../model/types';
import { useDialogs } from '../shell/dialogs';
import { ToastProvider } from '../ui';
import { buildCommands, type Command } from './commands';
import { CommandPalette, isPaletteShortcut } from './CommandPalette';
import { fuzzyMatch, highlightParts, SCORE } from './fuzzy';
import { MAX_RESULTS, rankCommands } from './paletteModel';
import { useCanvasView } from '../canvas/stores';
import { getRecentComponents, recordRecentComponent, resetRecentComponentsCache } from '../shell/paletteModel';
import { clearRecent, pushRecent, readRecent, RECENT_COMMANDS_KEY } from './recent';
import { usePowerUi } from './uiStore';

const ext = (): Extension => selectActiveExtension(useEditor.getState());
const nodeByName = (name: string) => Object.values(ext().nodes).find((n) => n.name === name)!;

beforeEach(() => {
  clearRecent();
  usePowerUi.setState({ paletteOpen: false, revealComputedId: null });
  useDialogs.getState().close();
  const card = createExtension({
    name: 'Main Card',
    content: [
      {
        type: 'Flex',
        name: 'Layout',
        children: [
          { type: 'Text', name: 'Greeting', text: 'Hello' },
          { type: 'Button', name: 'Save button', text: 'Save' },
        ],
      },
    ],
  });
  const other = createExtension({ name: 'Second Card', existing: [card] });
  useEditor.getState().loadProject(createProject('Palette', [card, other]));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fuzzy scorer
// ---------------------------------------------------------------------------

describe('fuzzyMatch', () => {
  it('ranks prefix > word start > substring > subsequence', () => {
    const prefix = fuzzyMatch('but', 'Button')!;
    const word = fuzzyMatch('but', 'Insert Button')!;
    const sub = fuzzyMatch('but', 'Attribute')!;
    const seq = fuzzyMatch('ibtn', 'Insert Button')!;
    expect(prefix.score).toBeGreaterThan(word.score);
    expect(word.score).toBeGreaterThan(sub.score);
    expect(sub.score).toBeGreaterThan(seq.score);
    expect(seq.score).toBeGreaterThanOrEqual(SCORE.subsequenceMin);
    expect(fuzzyMatch('button', 'button')!.score).toBe(SCORE.exact);
  });

  it('returns matched indices for highlighting', () => {
    expect(fuzzyMatch('but', 'Insert Button')!.indices).toEqual([7, 8, 9]);
    expect(fuzzyMatch('ib', 'Insert Button')!.indices).toEqual([0, 7]);
    expect(highlightParts('Insert Button', [7, 8, 9])).toEqual([
      { text: 'Insert ', hit: false },
      { text: 'But', hit: true },
      { text: 'ton', hit: false },
    ]);
  });

  it('prefers word starts and camelCase humps in subsequences', () => {
    const acronym = fuzzyMatch('sp', 'Show problems')!;
    const scattered = fuzzyMatch('sp', 'Inspector')!;
    expect(acronym.score).toBeGreaterThan(scattered.score);
    expect(fuzzyMatch('crm', 'CrmPropertyList')!.score).toBeGreaterThan(SCORE.subsequenceMax);
    expect(fuzzyMatch('pl', 'CrmPropertyList')!.indices).toEqual([3, 11]);
  });

  it('matches multi-word queries in any order and rejects non-matches', () => {
    expect(fuzzyMatch('button insert', 'Insert Button')!.score).toBe(fuzzyMatch('button insert', 'Insert Button')!.score);
    expect(fuzzyMatch('button insert', 'Insert Button')!.score).toBeGreaterThan(SCORE.substring);
    expect(fuzzyMatch('xyz', 'Insert Button')).toBeNull();
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indices: [] });
  });
});

// ---------------------------------------------------------------------------
// Commands & ranking
// ---------------------------------------------------------------------------

function commands(): Command[] {
  const s = useEditor.getState();
  return buildCommands({ state: s, blocks: [] });
}

describe('buildCommands', () => {
  it('lists insert, go to, switch, data, view and dialog commands for the current state', () => {
    const titles = commands().map((c) => c.title);
    expect(titles).toContain('Insert Button');
    expect(titles).toContain('Go to Greeting');
    expect(titles).toContain('Switch to Second Card');
    expect(titles).not.toContain('Switch to Main Card');
    expect(titles).toEqual(expect.arrayContaining(['Add state variable', 'Add computed value', 'Show code', 'Show layers', 'Open app settings', 'New project']));
    expect(titles.some((t) => t.startsWith('Add data source:'))).toBe(true);
  });

  it('disables selection commands until something is selected', () => {
    const dup = () => commands().find((c) => c.id === 'action:duplicate')!;
    expect(dup().disabledReason).toMatch(/Select a component/);
    act(() => useEditor.getState().select(nodeByName('Greeting').id));
    expect(dup().disabledReason).toBeUndefined();
    expect(dup().subtitle).toBe('Greeting');
    expect(commands().find((c) => c.id === 'action:undo')!.disabledReason).toBe('Nothing to undo');
  });

  it('inserts overlays into the selected trigger and explains when nothing accepts them', () => {
    const insertModal = () => commands().find((c) => c.id === 'insert:Modal')!;
    expect(insertModal().disabledReason).toMatch(/Select a button/);
    act(() => useEditor.getState().select(nodeByName('Save button').id));
    expect(insertModal().disabledReason).toBeUndefined();
    act(() => {
      void insertModal().run({ notify: () => {} });
    });
    const button = ext().nodes[nodeByName('Save button').id];
    expect(button.slots?.overlay).toHaveLength(1);
    expect(ext().nodes[button.slots!.overlay[0]].type).toBe('Modal');
  });

  it('inserts blocks with the state they need', () => {
    const notes: string[] = [];
    const block = {
      id: 'b1',
      name: 'Counter',
      template: { type: 'Text', text: 'Count {{ clicks }}' },
      state: [{ name: 'clicks', type: 'number' as const, initial: 0 }],
    };
    const cmd = buildCommands({ state: useEditor.getState(), blocks: [block] }).find((c) => c.id === 'block:b1')!;
    expect(cmd.title).toBe('Insert block: Counter');
    act(() => {
      void cmd.run({ notify: (m) => notes.push(m) });
    });
    expect(ext().state.map((v) => v.name)).toContain('clicks');
    const selected = ext().nodes[useEditor.getState().selectedNodeId!];
    expect(selected.text).toBe('Count {{ clicks }}');
    expect(notes.join(' ')).toMatch(/Counter/);
  });

  it('go to commands show the node path', () => {
    const go = commands().find((c) => c.title === 'Go to Greeting')!;
    expect(go.subtitle).toBe('Layout');
  });
});

describe('rankCommands', () => {
  it('puts recent commands first when the query is empty and caps the list', () => {
    const all = commands();
    const { items, total } = rankCommands(all, '', ['view:code', 'missing:id', 'action:undo']);
    expect(items[0]).toMatchObject({ group: 'Recent' });
    expect(items[0].command.id).toBe('view:code');
    // Disabled recents (undo with nothing to undo) are not promoted.
    expect(items.filter((i) => i.group === 'Recent')).toHaveLength(1);
    expect(items.length).toBe(Math.min(MAX_RESULTS, total));
    // Commands that cannot run are left out until searched for.
    expect(total).toBe(all.filter((c) => !c.disabledReason).length);
    expect(items.some((i) => i.command.disabledReason)).toBe(false);
  });

  it('sorts matches by score and groups them by their best result', () => {
    const { items } = rankCommands(commands(), 'button');
    expect(items[0].command.title).toBe('Insert Button');
    const groups = items.map((i) => i.group);
    // Groups are contiguous.
    expect(groups.filter((g, i) => i > 0 && g !== groups[i - 1] && groups.slice(0, i).includes(g))).toEqual([]);
    expect(items.some((i) => i.command.title === 'Go to Save button')).toBe(true);
  });

  it('finds commands through keywords and ranks disabled ones lower', () => {
    expect(rankCommands(commands(), 'zip').items[0].command.id).toBe('dialog:export');
    const { items } = rankCommands(commands(), 'redo');
    expect(items[0].command.id).toBe('action:redo');
  });
});

describe('rankCommands: common searches', () => {
  const top = (query: string) => rankCommands(commands(), query).items.map((i) => i.command.id);

  it('ranks title matches above keyword matches and drops scattered subsequence noise', () => {
    expect(top('computed')[0]).toBe('data:addComputed');
    expect(top('helper')[0]).toBe('data:helpers');
    expect(top('undo')).toEqual(['action:undo']);
    expect(top('delete')[0]).toBe('action:delete');
    // Abbreviations still work.
    expect(top('ibtn')[0]).toBe('insert:Button');
  });

  it('understands synonyms and mixed title / keyword words', () => {
    expect(top('copy code')[0]).toBe('action:copyJsx');
    expect(top('new variable')[0]).toBe('data:addState');
    expect(top('select greeting')[0]).toBe(`goto:${nodeByName('Greeting').id}`);
    expect(top('duplicate card')[0]).toBe('ext:duplicate');
  });

  it('only the API data source matches "fetch"; with a button selected the Fetch URL action comes first', () => {
    const fetchSources = top('fetch').filter((id) => id.startsWith('data:addSource:'));
    expect(fetchSources).toEqual(['data:addSource:fetch']);
    act(() => useEditor.getState().select(nodeByName('Save button').id));
    expect(top('fetch')[0]).toBe('event:add:fetch');
  });

  it('offers zoom commands that drive the canvas zoom', () => {
    useCanvasView.getState().setZoom(1);
    expect(top('zoom').slice(0, 4).sort()).toEqual(['view:zoomFit', 'view:zoomIn', 'view:zoomOut', 'view:zoomReset'].sort());
    const byId = (id: string) => commands().find((c) => c.id === id)!;
    expect(byId('view:zoomReset').disabledReason).toMatch(/already at 100%/);
    act(() => void byId('view:zoomIn').run({ notify: () => {} }));
    expect(useCanvasView.getState().zoom).toBeGreaterThan(1);
    act(() => void byId('view:zoomReset').run({ notify: () => {} }));
    expect(useCanvasView.getState().zoom).toBe(1);
    act(() => void byId('view:zoomOut').run({ notify: () => {} }));
    expect(useCanvasView.getState().zoom).toBeLessThan(1);
    useCanvasView.getState().setZoom(1);
  });
});

describe('event and extension commands', () => {
  it('adds an action to the selected component’s first event and opens the Events tab', () => {
    const add = () => commands().find((c) => c.id === 'event:add:addAlert')!;
    expect(add().disabledReason).toMatch(/Select a button/);
    act(() => useEditor.getState().select(nodeByName('Greeting').id));
    expect(add().disabledReason).toMatch(/has no events/);
    const button = nodeByName('Save button').id;
    act(() => useEditor.getState().select(button));
    expect(add().disabledReason).toBeUndefined();
    expect(add().subtitle).toBe('When clicked — Save button');
    const notes: string[] = [];
    act(() => void add().run({ notify: (m) => notes.push(m) }));
    expect(ext().nodes[button].events?.onClick?.map((s) => s.type)).toEqual(['addAlert']);
    expect(useEditor.getState().rightPanel).toBe('events');
    expect(notes[0]).toMatch(/Show alert/);
  });

  it('duplicates the active card', () => {
    const before = useEditor.getState().project.extensions.length;
    const notes: string[] = [];
    act(() => void commands().find((c) => c.id === 'ext:duplicate')!.run({ notify: (m) => notes.push(m) }));
    expect(useEditor.getState().project.extensions.length).toBe(before + 1);
    expect(ext().name).toBe('Main Card copy');
    expect(notes[0]).toMatch(/Duplicated “Main Card”/);
  });
});

describe('recent commands storage', () => {
  it('keeps the most recent first without duplicates', () => {
    pushRecent('a');
    pushRecent('b');
    pushRecent('a');
    expect(readRecent()).toEqual(['a', 'b']);
  });

  it('does not share its storage key with the component palette', () => {
    resetRecentComponentsCache();
    pushRecent('action:undo');
    recordRecentComponent('Button');
    pushRecent('view:code');
    expect(readRecent()).toEqual(['view:code', 'action:undo']);
    resetRecentComponentsCache();
    expect(getRecentComponents()).toEqual(['Button']);
    expect(window.localStorage.getItem(RECENT_COMMANDS_KEY)).toBe(JSON.stringify(['view:code', 'action:undo']));
  });

  it('migrates command ids from the old shared key once', () => {
    window.localStorage.removeItem(RECENT_COMMANDS_KEY);
    window.localStorage.setItem('uiex-builder:palette-recent', JSON.stringify(['Button', 'dialog:export', 'Text', 'view:code']));
    expect(readRecent()).toEqual(['dialog:export', 'view:code']);
    pushRecent('action:redo');
    expect(readRecent()).toEqual(['action:redo', 'dialog:export', 'view:code']);
    window.localStorage.removeItem('uiex-builder:palette-recent');
  });
});

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

function renderPalette() {
  return render(
    <ToastProvider>
      <input aria-label="Some field" />
      <CommandPalette />
    </ToastProvider>,
  );
}

const pressCmdK = (target: Element | Window = window) => fireEvent.keyDown(target, { key: 'k', code: 'KeyK', ctrlKey: true });

describe('CommandPalette', () => {
  it('recognises ⌘K / Ctrl+K only', () => {
    expect(isPaletteShortcut({ key: 'k', code: 'KeyK', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false })).toBe(true);
    expect(isPaletteShortcut({ key: 'K', code: 'KeyK', metaKey: false, ctrlKey: true, altKey: false, shiftKey: false })).toBe(true);
    expect(isPaletteShortcut({ key: 'л', code: 'KeyK', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false })).toBe(true);
    expect(isPaletteShortcut({ key: 'k', code: 'KeyK', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false })).toBe(false);
    expect(isPaletteShortcut({ key: 'k', code: 'KeyK', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true })).toBe(false);
  });

  it('opens with Ctrl+K even from a text field, focuses the search and closes with Escape', () => {
    renderPalette();
    const field = screen.getByLabelText('Some field');
    field.focus();
    pressCmdK(field);
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    const input = within(dialog).getByRole('combobox', { name: 'Search commands' });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(field).toHaveFocus();
    // Ctrl+K toggles.
    pressCmdK();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    pressCmdK();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('searches, navigates with the keyboard and runs the active command with Enter', async () => {
    const user = userEvent.setup();
    renderPalette();
    act(() => useEditor.getState().select(nodeByName('Layout').id));
    pressCmdK();
    const input = screen.getByRole('combobox', { name: 'Search commands' });
    await user.type(input, 'insert text');
    const first = screen.getAllByRole('option')[0];
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(first).toHaveTextContent('Insert Text');
    expect(input).toHaveAttribute('aria-activedescendant', first.id);
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'false');
    await user.keyboard('{ArrowUp}');
    const before = ext().nodes[nodeByName('Layout').id].children.length;
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    // Inserted into the selected Flex and selected.
    const layout = ext().nodes[nodeByName('Layout').id];
    expect(layout.children.length).toBe(before + 1);
    const inserted = ext().nodes[layout.children[layout.children.length - 1]];
    expect(inserted.type).toBe('Text');
    expect(useEditor.getState().selectedNodeId).toBe(inserted.id);
    expect(readRecent()[0]).toBe('insert:Text');
  });

  it('shows recent commands first, an empty state, and runs commands on click', async () => {
    const user = userEvent.setup();
    pushRecent('dialog:appSettings');
    renderPalette();
    pressCmdK();
    const groups = screen.getAllByRole('group');
    expect(groups[0]).toHaveAccessibleName('Recent');
    expect(within(groups[0]).getByRole('option')).toHaveTextContent('Open app settings');

    const input = screen.getByRole('combobox', { name: 'Search commands' });
    await user.type(input, 'qqqzzz');
    expect(screen.getByText(/No commands match “qqqzzz”/)).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, 'go to greet');
    await user.click(screen.getByRole('option', { name: /Go to Greeting/ }));
    expect(useEditor.getState().selectedNodeId).toBe(nodeByName('Greeting').id);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('runs dialog, panel, extension and data commands', async () => {
    const user = userEvent.setup();
    renderPalette();
    const run = async (query: string, title: string) => {
      pressCmdK();
      await user.type(screen.getByRole('combobox', { name: 'Search commands' }), query);
      await user.click(screen.getByRole('option', { name: new RegExp(title) }));
    };
    await run('app settings', 'Open app settings');
    expect(useDialogs.getState().current).toBe('appSettings');
    act(() => useDialogs.getState().close());

    await run('show problems', 'Show problems');
    expect(useEditor.getState().bottomPanel).toBe('problems');

    await run('switch second', 'Switch to Second Card');
    expect(ext().name).toBe('Second Card');

    await run('add computed', 'Add computed value');
    expect(ext().computed).toHaveLength(1);
    expect(useEditor.getState().leftPanel).toBe('data');
    expect(usePowerUi.getState().revealComputedId).toBe(ext().computed![0].id);
  });

  it('copies the JSX of the selection to the clipboard', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPalette();
    act(() => useEditor.getState().select(nodeByName('Greeting').id));
    pressCmdK();
    await user.type(screen.getByRole('combobox', { name: 'Search commands' }), 'copy jsx');
    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('<Text>Hello</Text>\n'));
    expect(await screen.findByText('Copied the JSX of Greeting')).toBeInTheDocument();
  });

  it('explains disabled commands instead of running them', async () => {
    const user = userEvent.setup();
    renderPalette();
    pressCmdK();
    await user.type(screen.getByRole('combobox', { name: 'Search commands' }), 'duplicate selection');
    const option = screen.getByRole('option', { name: /Duplicate selection/ });
    expect(option).toHaveAttribute('aria-disabled', 'true');
    await user.click(option);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByText('Select a component on the canvas first').length).toBeGreaterThan(0);
  });
});
