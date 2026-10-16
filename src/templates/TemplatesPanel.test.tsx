import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useDragStore } from '../dnd/dragState';
import { createExtension, createProject } from '../model/factory';
import { selectActiveExtension, useEditor } from '../model/store';
import type { Extension, NodeTemplate } from '../model/types';
import { ToastProvider } from '../ui';
import { addTemplateToProject, insertBlock, replaceActiveWithTemplate } from './actions';
import { BLOCK_TEMPLATES, PROJECT_TEMPLATES } from './catalog';
import { TemplatesPanel } from './TemplatesPanel';
import { deleteUserBlock, listUserBlocks, reloadUserBlocks, renameUserBlock, saveUserBlock } from './userBlocks';

function reset(content: NodeTemplate[] = [{ type: 'Flex', name: 'Main', props: { direction: 'column' }, children: [{ type: 'Text', text: 'Hi' }] }]) {
  const ext = createExtension({ name: 'Card', content });
  useEditor.getState().loadProject(createProject('Test App', [ext]));
  return ext;
}

const active = (): Extension => selectActiveExtension(useEditor.getState());
const rootTypes = () => {
  const ext = active();
  return ext.nodes[ext.rootId].children.map((id) => ext.nodes[id].type);
};
const named = (name: string) => Object.values(active().nodes).find((n) => n.name === name)!;
/** Children of the card's main column (where click-to-add puts things when nothing is selected). */
const mainTypes = () => named('Main').children.map((id) => active().nodes[id].type);

function renderPanel() {
  return render(
    <ToastProvider>
      <TemplatesPanel />
    </ToastProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  reloadUserBlocks();
});

// ---------------------------------------------------------------------------
// Flows (logic)
// ---------------------------------------------------------------------------

describe('template flows', () => {
  it('inserts a block after the selection, adding missing state in one undo step', () => {
    reset();
    const search = BLOCK_TEMPLATES.find((b) => b.id === 'search-results')!;
    const r = insertBlock(search.template, search.state, search.name);
    expect(r.ok).toBe(true);
    // Nothing selected: the end of the card's main column.
    expect(rootTypes()).toEqual(['Flex']);
    expect(mainTypes()).toEqual(['Text', 'Flex']);
    expect(active().state.map((s) => s.name)).toEqual(['query']);
    expect(useEditor.getState().selectedNodeId).toBe(r.ok ? r.value : null);
    // Existing state is reused, not duplicated.
    insertBlock(search.template, search.state, search.name);
    expect(active().state.map((s) => s.name)).toEqual(['query']);
    // One undo removes both the block and the state variable it added.
    useEditor.getState().undo();
    useEditor.getState().undo();
    expect(mainTypes()).toEqual(['Text']);
    expect(active().state).toEqual([]);
  });

  it('inserts into the selected container when it accepts the block', () => {
    reset();
    useEditor.getState().select(named('Main').id);
    const alert = BLOCK_TEMPLATES.find((b) => b.id === 'info-alert')!;
    insertBlock(alert.template, alert.state, alert.name);
    const main = named('Main');
    expect(main.children.map((id) => active().nodes[id].type)).toEqual(['Text', 'Alert']);
  });

  it('explains when a block cannot be inserted', () => {
    reset();
    const r = insertBlock({ type: 'TableRow', children: [] }, undefined, 'Row');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/can’t be added to this card/);
  });

  it('adds a starter (with its app function) and makes it active', () => {
    reset();
    const quote = PROJECT_TEMPLATES.find((t) => t.id === 'server-quote')!;
    const r = addTemplateToProject(quote);
    expect(r.ok).toBe(true);
    const { project, activeExtensionId } = useEditor.getState();
    expect(project.extensions).toHaveLength(2);
    expect(activeExtensionId).toBe(r.ok ? r.value : '');
    expect(project.functions).toHaveLength(1);
    expect(JSON.stringify(active())).toContain(project.functions[0].id);
    // A single undo removes both.
    useEditor.getState().undo();
    expect(useEditor.getState().project.extensions).toHaveLength(1);
    expect(useEditor.getState().project.functions).toHaveLength(0);
  });

  it('notes when a starter brings app functions the app type does not allow', () => {
    reset();
    const quote = PROJECT_TEMPLATES.find((t) => t.id === 'server-quote')!;
    const plain = addTemplateToProject(quote);
    expect(plain.message).not.toMatch(/Note:/);
    useEditor.getState().undo();
    useEditor.getState().updateApp({ authType: 'oauth', redirectUrls: ['https://example.com/oauth'] });
    const r = addTemplateToProject(quote);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Note: HubSpot only allows app functions in apps with static token auth.*see Problems\./);
    // Starters without functions add no note.
    const summary = PROJECT_TEMPLATES.find((t) => t.id === 'contact-summary')!;
    expect(replaceActiveWithTemplate(summary).message).not.toMatch(/Note:/);
  });

  it('refuses a second settings page', () => {
    reset();
    const settings = PROJECT_TEMPLATES.find((t) => t.kind === 'settings')!;
    expect(addTemplateToProject(settings).ok).toBe(true);
    const again = addTemplateToProject(settings);
    expect(again.ok).toBe(false);
    expect(again.message).toMatch(/already has a settings page/);
  });

  it('replaces the active extension in place', () => {
    reset();
    const before = useEditor.getState().project.extensions[0].id;
    const summary = PROJECT_TEMPLATES.find((t) => t.id === 'contact-summary')!;
    const r = replaceActiveWithTemplate(summary);
    expect(r.ok).toBe(true);
    const { project } = useEditor.getState();
    expect(project.extensions).toHaveLength(1);
    expect(project.extensions[0].id).not.toBe(before);
    expect(project.extensions[0].name).toBe('Contact Summary');
    useEditor.getState().undo();
    expect(useEditor.getState().project.extensions[0].id).toBe(before);
    expect(useEditor.getState().activeExtensionId).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// User blocks
// ---------------------------------------------------------------------------

describe('user blocks library', () => {
  it('saves, lists, renames and deletes blocks (persisted in localStorage)', () => {
    const block = saveUserBlock('  My header ', { type: 'Heading', text: 'Hello' }, [{ name: 'x', type: 'string', initial: '' }]);
    expect(block.name).toBe('My header');
    expect(listUserBlocks().map((b) => b.name)).toEqual(['My header']);
    renameUserBlock(block.id, 'Header');
    renameUserBlock(block.id, '   ');
    expect(listUserBlocks()[0].name).toBe('Header');
    // Reload from storage keeps the data.
    reloadUserBlocks();
    expect(listUserBlocks()[0]).toMatchObject({ name: 'Header', template: { type: 'Heading' }, state: [{ name: 'x' }] });
    deleteUserBlock(block.id);
    expect(listUserBlocks()).toEqual([]);
  });

  it('ignores malformed stored data', () => {
    window.localStorage.setItem(
      'uiex-builder:user-blocks',
      JSON.stringify([{ id: 'a', name: 'ok', template: { type: 'Text', text: 'x' } }, { id: 'b' }, 'junk', { id: 'c', template: {} }]),
    );
    reloadUserBlocks();
    expect(listUserBlocks().map((b) => b.id)).toEqual(['a']);
    window.localStorage.setItem('uiex-builder:user-blocks', '{not json');
    reloadUserBlocks();
    expect(listUserBlocks()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Panel UI
// ---------------------------------------------------------------------------

describe('<TemplatesPanel>', () => {
  it('shows the block gallery with search and an empty result state', () => {
    reset();
    renderPanel();
    const gallery = screen.getByRole('group', { name: 'Blocks' });
    expect(within(gallery).getAllByRole('button')).toHaveLength(BLOCK_TEMPLATES.length);
    fireEvent.change(screen.getByLabelText('Search blocks'), { target: { value: 'modal' } });
    expect(within(screen.getByRole('group', { name: 'Blocks' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      expect.stringContaining('Confirm button'),
    ]);
    fireEvent.change(screen.getByLabelText('Search blocks'), { target: { value: 'qqqq' } });
    expect(screen.getByText('No blocks match “qqqq”')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all blocks' }));
    expect(screen.getByRole('group', { name: 'Blocks' })).toBeInTheDocument();
  });

  it('inserts a block on click and with the keyboard, with a confirmation toast', () => {
    reset();
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /^Stat row:/ }));
    expect(mainTypes()).toEqual(['Text', 'Statistics']);
    expect(screen.getByText('Added “Stat row”.')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('button', { name: /^Info alert:/ }), { key: 'Enter' });
    expect(mainTypes()).toEqual(['Text', 'Statistics', 'Alert']);
  });

  it('starts a template drag with the block’s state', () => {
    reset();
    renderPanel();
    const card = screen.getByRole('button', { name: /^Search \+ results:/ });
    const data: Record<string, string> = {};
    const dataTransfer = {
      setData: (k: string, v: string) => {
        data[k] = v;
      },
      getData: (k: string) => data[k],
      setDragImage: () => {},
      effectAllowed: 'all',
      types: [] as string[],
    };
    fireEvent.dragStart(card, { dataTransfer });
    const payload = useDragStore.getState().payload;
    expect(payload).toMatchObject({ kind: 'template', label: 'Search + results', state: [{ name: 'query' }] });
    fireEvent.dragEnd(card);
    expect(useDragStore.getState().payload).toBeNull();
  });

  it('adds and replaces starter cards (replace asks for confirmation)', () => {
    reset();
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Starter cards' }));
    expect(screen.getAllByRole('article')).toHaveLength(PROJECT_TEMPLATES.length);
    fireEvent.click(screen.getByRole('button', { name: 'Add Associated deals table to project' }));
    expect(useEditor.getState().project.extensions.map((e) => e.name)).toEqual(['Card', 'Associated Deals']);
    expect(active().name).toBe('Associated Deals');

    fireEvent.click(screen.getByRole('button', { name: 'Replace current with Onboarding checklist' }));
    const dialog = screen.getByRole('dialog', { name: 'Replace “Associated Deals”?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replace' }));
    expect(useEditor.getState().project.extensions.map((e) => e.name)).toEqual(['Card', 'Onboarding Checklist']);

    // Only one settings page per app.
    fireEvent.click(screen.getByRole('button', { name: 'Add App settings page to project' }));
    expect(screen.getByRole('button', { name: 'Add App settings page to project' })).toBeDisabled();
  });

  it('cancels a replace without changes', () => {
    reset();
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Starter cards' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace current with Blank card' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(active().name).toBe('Card');
  });

  it('manages My blocks: empty state, insert, rename and delete', () => {
    reset();
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /^My blocks/ }));
    expect(screen.getByText('No saved blocks yet')).toBeInTheDocument();
    expect(screen.getByText(/Save as block/)).toBeInTheDocument();

    act(() => {
      saveUserBlock('Greeting', { type: 'Text', text: 'Hello {{ who }}' }, [{ name: 'who', type: 'string', initial: 'world' }]);
    });
    expect(screen.getByText('Greeting')).toBeInTheDocument();
    expect(screen.getByText(/Text · 1 component · uses who/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Insert Greeting' }));
    expect(mainTypes()).toEqual(['Text', 'Text']);
    expect(active().state.map((s) => s.name)).toEqual(['who']);

    fireEvent.click(screen.getByRole('button', { name: 'Rename Greeting' }));
    const input = screen.getByLabelText('Block name');
    fireEvent.change(input, { target: { value: 'Hello block' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(listUserBlocks()[0].name).toBe('Hello block');
    expect(screen.getByText('Hello block')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete Hello block' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete block' }));
    expect(listUserBlocks()).toEqual([]);
    expect(screen.getByText('No saved blocks yet')).toBeInTheDocument();
  });

  it('remembers the selected tab', () => {
    reset();
    const first = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Starter cards' }));
    first.unmount();
    renderPanel();
    expect(screen.getByRole('button', { name: 'Starter cards' })).toHaveAttribute('aria-pressed', 'true');
  });
});
