import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExtension, createProject } from '../model/factory';
import { selectActiveExtension, useActiveExtension, useEditor } from '../model/store';
import type { CardLocation, Extension, ExtensionKind, NodeTemplate, UINode } from '../model/types';
import { RuntimeProvider } from '../runtime';
import { UIEX_REVEAL_EVENT } from '../registry/components/layout';
import { useDragStore, type DragPayload } from '../dnd/dragState';
import { listUserBlocks } from '../templates';
import { Canvas } from './Canvas';
import { useCanvasUi, useCanvasView } from './stores';
import { renderStats } from './renderStats';

function Harness() {
  const project = useEditor((s) => s.project);
  const ext = useActiveExtension();
  const mode = useEditor((s) => s.mode);
  const resetKey = useEditor((s) => s.previewResetKey);
  return (
    <RuntimeProvider project={project} extension={ext} mode={mode} resetKey={resetKey}>
      <Canvas />
    </RuntimeProvider>
  );
}

interface SetupOptions {
  kind?: ExtensionKind;
  location?: CardLocation;
  state?: Extension['state'];
}

function setup(content: NodeTemplate[], opts: SetupOptions = {}) {
  const ext = createExtension({ content, name: 'Deal Desk', kind: opts.kind, location: opts.location });
  if (opts.state) ext.state = opts.state;
  const project = createProject('Acme Tools', [ext]);
  useEditor.getState().loadProject(project);
  useEditor.setState({ clipboard: null, leftPanel: 'layers', bottomPanel: null });
  useCanvasView.setState({ zoom: 1, chrome: true, collapsed: false });
  useCanvasUi.setState({ menu: null, editing: null, saveBlockFor: null });
  useDragStore.setState({ payload: null, indicator: null });
  const utils = render(<Harness />);
  return utils;
}

const ext = () => selectActiveExtension(useEditor.getState());
const root = () => ext().nodes[ext().rootId];

function byName(name: string): UINode {
  const node = Object.values(ext().nodes).find((n) => n.name === name);
  if (!node) throw new Error(`No node named ${name}`);
  return node;
}

function el(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`.ub-cv-surface [data-node-id="${id}"]`);
  if (!found) throw new Error(`Node ${id} is not rendered`);
  return found;
}

function stage(): HTMLElement {
  return document.querySelector<HTMLElement>('.ub-cv-stage')!;
}

function cardRoot(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-cv-card-root]')!;
}

function fakeRect(target: Element, left: number, top: number, width: number, height: number) {
  const rect = {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect);
}

function openMenuOn(target: Element) {
  fireEvent.contextMenu(target, { clientX: 40, clientY: 40 });
  return screen.getByRole('menu');
}

function chooseMenuItem(name: string | RegExp) {
  const menu = screen.getByRole('menu');
  fireEvent.click(within(menu).getByRole('menuitem', { name }));
}

function drag(payload: DragPayload) {
  act(() => useDragStore.getState().setPayload(payload));
}

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  act(() => {
    useDragStore.setState({ payload: null, indicator: null });
    useCanvasUi.setState({ menu: null, editing: null, saveBlockFor: null });
  });
});

// ---------------------------------------------------------------------------
// Frame & toolbar
// ---------------------------------------------------------------------------

describe('Canvas frame', () => {
  it('renders the card inside a HubSpot record page with title and app caption', () => {
    setup([{ type: 'Text', name: 't', text: 'Hello card' }]);
    expect(screen.getByText('Hello card')).toBeInTheDocument();
    expect(screen.getByText('App: Acme Tools')).toBeInTheDocument();
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Activities')).toBeInTheDocument();
    expect(screen.getAllByText('Deal Desk').length).toBeGreaterThanOrEqual(2);
    // Card body: hsp-root in design mode, position: relative container for overlays.
    expect(cardRoot()).toHaveClass('hsp-root', 'hsp-design');
    expect(cardRoot().querySelector('.hsp-overlay-host')).not.toBeNull();
  });

  it('toggles the HubSpot chrome', () => {
    setup([{ type: 'Text', text: 'Hello' }]);
    fireEvent.click(screen.getByLabelText('HubSpot chrome'));
    expect(screen.queryByText('Overview')).toBeNull();
    expect(screen.queryByText('App: Acme Tools')).toBeNull();
    expect(screen.getByText('Hello')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('HubSpot chrome'));
    expect(screen.getByText('Overview')).toBeInTheDocument();
  });

  it.each([
    ['crm.record.sidebar', 'Companies (1)'],
    ['crm.preview', 'About this contact'],
    ['helpdesk.sidebar', 'Ticket'],
  ] as const)('frames %s cards', (location, marker) => {
    setup([{ type: 'Text', text: 'Body' }], { location });
    expect(screen.getByText(marker)).toBeInTheDocument();
    expect(screen.getByText('App: Acme Tools')).toBeInTheDocument();
  });

  it('collapses the sidebar section and expands it again when something gets selected', async () => {
    setup([{ type: 'Text', name: 't', text: 'Body' }], { location: 'crm.record.sidebar' });
    const header = screen.getByRole('button', { name: /Deal Desk.*App: Acme Tools/ });
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    act(() => useEditor.getState().select(byName('t').id));
    await waitFor(() => expect(header).toHaveAttribute('aria-expanded', 'true'));
  });

  it('frames settings and app home pages', () => {
    setup([{ type: 'Text', text: 'Prefs' }], { kind: 'settings' });
    expect(screen.getByText('Settings', { selector: '.ub-cv-page-head__eyebrow' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Acme Tools' })).toBeInTheDocument();
  });

  it('zoom control steps through zoom levels', () => {
    setup([{ type: 'Text', text: 'Zoom me' }]);
    expect(screen.getByLabelText('Zoom level 100%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByLabelText('Zoom level 110%')).toBeInTheDocument();
    expect(document.querySelector<HTMLElement>('.ub-cv-surface')!.style.transform).toBe('scale(1.1)');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(screen.getByLabelText('Zoom level 90%')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Zoom level 90%'));
    chooseMenuItem('150%');
    expect(screen.getByLabelText('Zoom level 150%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Selection, hover, breadcrumbs
// ---------------------------------------------------------------------------

describe('selection and hover', () => {
  const content: NodeTemplate[] = [
    {
      type: 'Flex',
      name: 'col',
      props: { direction: 'column' },
      children: [
        { type: 'Heading', name: 'title', text: 'Deal summary' },
        { type: 'Text', name: 'body', text: 'Body copy' },
      ],
    },
  ];

  it('click selects the node under the pointer; clicking empty card area deselects', () => {
    setup(content);
    const body = byName('body');
    fireEvent.click(el(body.id));
    expect(useEditor.getState().selectedNodeId).toBe(body.id);
    fireEvent.click(cardRoot());
    expect(useEditor.getState().selectedNodeId).toBeNull();
    fireEvent.click(el(byName('col').id));
    expect(useEditor.getState().selectedNodeId).toBe(byName('col').id);
    fireEvent.click(stage());
    expect(useEditor.getState().selectedNodeId).toBeNull();
  });

  it('pointer move hovers the node under the pointer; leaving clears it', () => {
    setup(content);
    const title = byName('title');
    fireEvent.pointerMove(el(title.id));
    expect(useEditor.getState().hoveredNodeId).toBe(title.id);
    fireEvent.pointerMove(cardRoot());
    expect(useEditor.getState().hoveredNodeId).toBeNull();
    fireEvent.pointerMove(el(title.id));
    fireEvent.pointerLeave(stage());
    expect(useEditor.getState().hoveredNodeId).toBeNull();
  });

  it('repeat clones map to their node id', () => {
    setup([{ type: 'Text', name: 'rep', text: 'Item {{ item }}', repeat: { items: '["a","b","c"]', itemName: 'item', indexName: 'i' } }]);
    const rep = byName('rep');
    const copies = document.querySelectorAll(`[data-node-id="${rep.id}"]`);
    expect(copies).toHaveLength(3);
    const clone = copies[2] as HTMLElement;
    expect(clone).toHaveAttribute('data-uiex-clone', '2');
    fireEvent.pointerMove(clone);
    expect(useEditor.getState().hoveredNodeId).toBe(rep.id);
    fireEvent.click(clone);
    expect(useEditor.getState().selectedNodeId).toBe(rep.id);
  });

  it('does nothing in preview mode', () => {
    setup(content);
    act(() => useEditor.getState().setMode('preview'));
    fireEvent.click(el(byName('body').id));
    fireEvent.pointerMove(el(byName('body').id));
    expect(useEditor.getState().selectedNodeId).toBeNull();
    expect(useEditor.getState().hoveredNodeId).toBeNull();
  });

  it('breadcrumbs show the ancestor chain and select on click', () => {
    setup(content);
    const body = byName('body');
    act(() => useEditor.getState().select(body.id));
    const crumbs = screen.getByRole('navigation', { name: 'Selection path' });
    const buttons = within(crumbs).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Deal Desk', 'col', 'body']);
    fireEvent.click(within(crumbs).getByRole('button', { name: 'col' }));
    expect(useEditor.getState().selectedNodeId).toBe(byName('col').id);
    fireEvent.click(within(crumbs).getByRole('button', { name: 'Deal Desk' }));
    expect(useEditor.getState().selectedNodeId).toBeNull();
  });

  it('dispatches the reveal event on the selected element', async () => {
    setup(content);
    const body = byName('body');
    const seen: EventTarget[] = [];
    const listener = (e: Event) => seen.push(e.target!);
    document.addEventListener(UIEX_REVEAL_EVENT, listener);
    act(() => useEditor.getState().select(body.id));
    await waitFor(() => expect(seen).toContain(el(body.id)));
    document.removeEventListener(UIEX_REVEAL_EVENT, listener);
  });

  it('selection outline, label chip with badges and quick toolbar', async () => {
    setup([
      {
        type: 'Flex',
        name: 'col',
        props: { direction: 'column' },
        children: [
          { type: 'Text', name: 'a', text: 'A', condition: 'true', events: { onClick: [] } },
          { type: 'Button', name: 'b', text: 'B', binding: { state: 'x' } },
        ],
      },
    ]);
    const a = byName('a');
    fakeRect(el(a.id), 100, 120, 300, 24);
    act(() => useEditor.getState().select(a.id));
    const chip = await screen.findByTestId('canvas-selection-chip');
    expect(chip).toHaveTextContent('a');
    expect(within(chip).getByLabelText('Condition')).toBeInTheDocument();
    const toolbar = screen.getByRole('toolbar', { name: 'Text actions' });
    expect(within(toolbar).getByRole('button', { name: 'Move up' })).toBeDisabled();
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Move down' }));
    expect(byName('col').children[1]).toBe(a.id);
    fireEvent.click(screen.getByRole('button', { name: 'Select parent' }));
    expect(useEditor.getState().selectedNodeId).toBe(byName('col').id);
  });

  it('flags nodes hidden by a condition', async () => {
    setup([{ type: 'Text', name: 'h', text: 'Only VIPs', condition: 'false' }]);
    const h = byName('h');
    expect(el(h.id)).toHaveAttribute('data-uiex-cond', 'false');
    fakeRect(el(h.id), 10, 10, 200, 20);
    act(() => useEditor.getState().hover(null));
    // Any DOM mutation triggers a re-measure.
    act(() => useEditor.getState().setText(h.id, 'Only VIP customers'));
    expect(await screen.findByText('Hidden by condition')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

describe('context menu', () => {
  const content: NodeTemplate[] = [
    { type: 'Text', name: 'first', text: 'First' },
    { type: 'Button', name: 'btn', text: 'Edit' },
    { type: 'Text', name: 'last', text: 'Last' },
  ];

  it('opens on right-click, selects the node and duplicates it', () => {
    setup(content);
    const first = byName('first');
    openMenuOn(el(first.id));
    expect(useEditor.getState().selectedNodeId).toBe(first.id);
    chooseMenuItem(/Duplicate/);
    expect(root().children).toHaveLength(4);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('deletes, but not locked nodes', () => {
    setup(content);
    const last = byName('last');
    openMenuOn(el(last.id));
    chooseMenuItem(/^Delete/);
    expect(ext().nodes[last.id]).toBeUndefined();

    const first = byName('first');
    act(() => useEditor.getState().updateNode(first.id, { locked: true }));
    openMenuOn(el(first.id));
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Delete \(locked\)/ })).toBeDisabled();
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Cut/ })).toBeDisabled();
  });

  it('copies and pastes after the node', () => {
    setup(content);
    const first = byName('first');
    openMenuOn(el(first.id));
    chooseMenuItem(/Copy/);
    expect(useEditor.getState().clipboard?.type).toBe('Text');
    openMenuOn(el(byName('last').id));
    chooseMenuItem(/Paste/);
    expect(root().children).toHaveLength(4);
    expect(ext().nodes[root().children[3]].text).toBe('First');
  });

  it('cuts a node to the clipboard', () => {
    setup(content);
    const btn = byName('btn');
    openMenuOn(el(btn.id));
    chooseMenuItem(/Cut/);
    expect(ext().nodes[btn.id]).toBeUndefined();
    expect(useEditor.getState().clipboard?.type).toBe('Button');
  });

  it('wraps in a Flex', () => {
    setup(content);
    const btn = byName('btn');
    openMenuOn(el(btn.id));
    chooseMenuItem('Wrap in Flex');
    const wrapperId = root().children[1];
    expect(ext().nodes[wrapperId].type).toBe('Flex');
    expect(ext().nodes[wrapperId].children).toEqual([btn.id]);
  });

  it('moves up / down and selects the parent', () => {
    setup([{ type: 'Box', name: 'box', children: [{ type: 'Text', name: 'x', text: 'x' }, { type: 'Text', name: 'y', text: 'y' }] }]);
    const x = byName('x');
    openMenuOn(el(x.id));
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Move up' })).toBeDisabled();
    chooseMenuItem('Move down');
    expect(byName('box').children).toEqual([byName('y').id, x.id]);
    openMenuOn(el(x.id));
    chooseMenuItem('Select parent');
    expect(useEditor.getState().selectedNodeId).toBe(byName('box').id);
  });

  it('adds a Modal to an empty overlay slot and shows it in the storyboard', () => {
    setup(content);
    const btn = byName('btn');
    openMenuOn(el(btn.id));
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Add Panel' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Add Tooltip' })).toBeInTheDocument();
    chooseMenuItem('Add Modal');
    const overlayId = byName('btn').slots?.overlay?.[0];
    expect(overlayId).toBeTruthy();
    expect(ext().nodes[overlayId!].type).toBe('Modal');
    const storyboard = screen.getByRole('region', { name: 'Overlay storyboard' });
    expect(within(storyboard).getByText('Modal “Edit details” · opened by Button “Edit”')).toBeInTheDocument();
    // The slot is full now: no more "Add ..." items.
    openMenuOn(el(btn.id));
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: /^Add / })).toBeNull();
  });

  it('cannot duplicate an overlay into its single overlay slot', () => {
    setup([
      {
        type: 'Button',
        name: 'btn',
        text: 'Edit',
        slots: { overlay: [{ type: 'Modal', name: 'modal', props: { id: 'm1', title: 'M' }, children: [{ type: 'ModalBody', children: [{ type: 'Text', text: 'x' }] }] }] },
      },
    ]);
    openMenuOn(el(byName('modal').id));
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Duplicate/ })).toBeDisabled();
    // Its trigger can still be duplicated (overlay included).
    openMenuOn(el(byName('btn').id));
    chooseMenuItem(/Duplicate/);
    expect(root().children).toHaveLength(2);
  });

  it('only offers overlays for triggers', () => {
    setup(content);
    openMenuOn(el(byName('first').id));
    expect(within(screen.getByRole('menu')).queryByRole('menuitem', { name: /^Add / })).toBeNull();
  });

  it('opens the code panel', () => {
    setup(content);
    openMenuOn(el(byName('btn').id));
    chooseMenuItem('View code');
    expect(useEditor.getState().bottomPanel).toBe('code');
  });

  it('saves the subtree as a block with the state it uses', () => {
    setup([{ type: 'Text', name: 'counter', text: 'Count: {{ count }}' }], {
      state: [{ id: 's1', name: 'count', type: 'number', initial: 0 }, { id: 's2', name: 'unused', type: 'string', initial: '' }],
    });
    openMenuOn(el(byName('counter').id));
    chooseMenuItem('Save as block…');
    const dialog = screen.getByRole('dialog', { name: 'Save as block' });
    const input = within(dialog).getByLabelText('Block name');
    expect(input).toHaveValue('counter');
    fireEvent.change(input, { target: { value: 'Counter text' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save block' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const block = listUserBlocks()[0];
    expect(block.name).toBe('Counter text');
    expect(block.template).toMatchObject({ type: 'Text', text: 'Count: {{ count }}' });
    expect(block.state).toEqual([{ name: 'count', type: 'number', initial: 0 }]);
  });

  it('background menu pastes at the end of the card and opens panels', () => {
    setup(content);
    act(() => useEditor.getState().copyNode(byName('first').id));
    openMenuOn(cardRoot());
    expect(useEditor.getState().selectedNodeId).toBeNull();
    chooseMenuItem(/Paste/);
    expect(root().children).toHaveLength(4);
    openMenuOn(stage());
    chooseMenuItem('Add data');
    expect(useEditor.getState().leftPanel).toBe('data');
  });
});

// ---------------------------------------------------------------------------
// Inline text editing
// ---------------------------------------------------------------------------

describe('inline text editing', () => {
  const content: NodeTemplate[] = [{ type: 'Text', name: 't', text: 'Hello {{ context.user.firstName }}' }];

  it('double-click edits the raw text and Enter commits', () => {
    setup(content);
    const t = byName('t');
    fireEvent.doubleClick(el(t.id));
    const editor = screen.getByRole('textbox', { name: /Edit text of/ });
    expect(editor).toHaveValue('Hello {{ context.user.firstName }}');
    fireEvent.change(editor, { target: { value: 'Hi {{ context.user.firstName }}!' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(byName('t').text).toBe('Hi {{ context.user.firstName }}!');
    expect(screen.queryByRole('textbox', { name: /Edit text of/ })).toBeNull();
  });

  it('Shift+Enter keeps editing; Escape cancels', () => {
    setup(content);
    const t = byName('t');
    fireEvent.doubleClick(el(t.id));
    const editor = screen.getByRole('textbox', { name: /Edit text of/ });
    fireEvent.change(editor, { target: { value: 'Line 1\nLine 2' } });
    fireEvent.keyDown(editor, { key: 'Enter', shiftKey: true });
    expect(screen.getByRole('textbox', { name: /Edit text of/ })).toBeInTheDocument();
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: /Edit text of/ })).toBeNull();
    expect(byName('t').text).toBe('Hello {{ context.user.firstName }}');
  });

  it('blur commits', () => {
    setup(content);
    const t = byName('t');
    fireEvent.doubleClick(el(t.id));
    const editor = screen.getByRole('textbox', { name: /Edit text of/ });
    fireEvent.change(editor, { target: { value: 'Blurred' } });
    fireEvent.blur(editor);
    expect(byName('t').text).toBe('Blurred');
  });

  it('starts from the context menu and from the keyboard', () => {
    setup([{ type: 'Button', name: 'b', text: 'Save' }]);
    const b = byName('b');
    openMenuOn(el(b.id));
    chooseMenuItem(/Edit text/);
    const editor = screen.getByRole('textbox', { name: /Edit text of/ });
    fireEvent.keyDown(editor, { key: 'Escape' });
    act(() => useEditor.getState().select(b.id));
    fireEvent.keyDown(stage(), { key: 'Enter' });
    expect(screen.getByRole('textbox', { name: /Edit text of/ })).toHaveValue('Save');
  });

  it('double-click on a container selects the deepest child under the pointer', () => {
    setup([{ type: 'Box', name: 'box', children: [{ type: 'Flex', name: 'inner', children: [{ type: 'Image', name: 'img' }] }] }]);
    const box = byName('box');
    const img = byName('img');
    fakeRect(el(box.id), 0, 0, 400, 200);
    fakeRect(el(byName('inner').id), 10, 10, 380, 100);
    fakeRect(el(img.id), 20, 20, 100, 60);
    fireEvent.doubleClick(el(box.id), { clientX: 50, clientY: 50 });
    expect(useEditor.getState().selectedNodeId).toBe(img.id);
  });
});

// ---------------------------------------------------------------------------
// Drag & drop
// ---------------------------------------------------------------------------

describe('drag and drop', () => {
  it('drops a new component into an empty container placeholder', () => {
    setup([{ type: 'Flex', name: 'empty', props: { direction: 'column' } }]);
    const flex = byName('empty');
    const ph = document.querySelector<HTMLElement>(`[data-drop-placeholder-for="${flex.id}"]`)!;
    drag({ kind: 'new', componentType: 'Button' });
    fireEvent.dragOver(ph);
    const ind = useDragStore.getState().indicator!;
    expect(ind).toMatchObject({ mode: 'inside', target: { parentId: flex.id, index: 0 }, source: 'canvas', label: 'Into Flex' });
    expect(screen.getByTestId('canvas-drop-inside')).toHaveTextContent('Into Flex');
    fireEvent.drop(ph);
    expect(byName('empty').children).toHaveLength(1);
    expect(ext().nodes[byName('empty').children[0]].type).toBe('Button');
    expect(useDragStore.getState().payload).toBeNull();
    expect(useDragStore.getState().indicator).toBeNull();
  });

  it('shows the rejection reason and refuses the drop', () => {
    setup([{ type: 'Text', name: 't', text: 'Top' }]);
    drag({ kind: 'new', componentType: 'Tab' });
    fireEvent.dragOver(el(byName('t').id));
    expect(useDragStore.getState().indicator?.rejectReason).toBe('Tab must be placed inside Tabs');
    fireEvent.drop(el(byName('t').id));
    expect(root().children).toHaveLength(1);
  });

  it('attaches an overlay to a trigger', () => {
    setup([{ type: 'Button', name: 'b', text: 'Open' }]);
    const b = byName('b');
    drag({ kind: 'new', componentType: 'Panel' });
    fireEvent.dragOver(el(b.id));
    expect(useDragStore.getState().indicator).toMatchObject({ target: { parentId: b.id, slot: 'overlay', index: 0 }, label: 'Attach as overlay' });
    fireEvent.drop(el(b.id));
    const overlayId = byName('b').slots?.overlay?.[0];
    expect(ext().nodes[overlayId!].type).toBe('Panel');
    expect(screen.getByRole('region', { name: 'Overlay storyboard' })).toBeInTheDocument();
  });

  it('drops a template and adds the state it needs', () => {
    setup([]);
    const ph = document.querySelector<HTMLElement>(`[data-drop-placeholder-for="${ext().rootId}"]`)!;
    drag({
      kind: 'template',
      label: 'Counter',
      template: { type: 'Text', text: 'Count: {{ count }}' },
      state: [{ name: 'count', type: 'number', initial: 0 }],
    });
    fireEvent.dragOver(ph);
    fireEvent.drop(ph);
    expect(ext().state.map((s) => s.name)).toEqual(['count']);
    expect(ext().nodes[root().children[0]].text).toBe('Count: {{ count }}');
    expect(useEditor.getState().selectedNodeId).toBe(root().children[0]);
    // The block and its state are one undo step.
    act(() => useEditor.getState().undo());
    expect(ext().state).toEqual([]);
    expect(root().children).toEqual([]);
  });

  it('moves an existing node into another container', () => {
    setup([
      { type: 'Text', name: 'mover', text: 'Move me' },
      { type: 'Box', name: 'target', children: [] },
    ]);
    const mover = byName('mover');
    const target = byName('target');
    const ph = document.querySelector<HTMLElement>(`[data-drop-placeholder-for="${target.id}"]`)!;
    drag({ kind: 'move', nodeId: mover.id });
    fireEvent.dragOver(ph);
    fireEvent.drop(ph);
    expect(byName('target').children).toEqual([mover.id]);
    expect(root().children).toEqual([target.id]);
    expect(useEditor.getState().selectedNodeId).toBe(mover.id);
  });

  it('refuses to move locked nodes', () => {
    setup([
      { type: 'Text', name: 'locked', text: 'Locked' },
      { type: 'Box', name: 'target', children: [] },
    ]);
    const locked = byName('locked');
    act(() => useEditor.getState().updateNode(locked.id, { locked: true }));
    const ph = document.querySelector<HTMLElement>(`[data-drop-placeholder-for="${byName('target').id}"]`)!;
    drag({ kind: 'move', nodeId: locked.id });
    fireEvent.dragOver(ph);
    expect(useDragStore.getState().indicator?.rejectReason).toMatch(/Locked components can’t be moved/);
    fireEvent.drop(ph);
    expect(byName('target').children).toEqual([]);
  });

  it('the quick toolbar drag handle starts a move drag', async () => {
    setup([{ type: 'Text', name: 't', text: 'Drag me' }]);
    const t = byName('t');
    fakeRect(el(t.id), 50, 80, 300, 24);
    act(() => useEditor.getState().select(t.id));
    const handle = await screen.findByRole('button', { name: 'Drag to move' });
    const dataTransfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(handle, { dataTransfer });
    expect(useDragStore.getState().payload).toEqual({ kind: 'move', nodeId: t.id });
    fireEvent.dragEnd(handle);
    expect(useDragStore.getState().payload).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Storyboard, empty state, preview mode
// ---------------------------------------------------------------------------

describe('storyboard', () => {
  it('shows attached overlays inline; the title selects the trigger and content is selectable', () => {
    setup([
      {
        type: 'Button',
        name: 'trigger',
        text: 'Edit',
        slots: {
          overlay: [
            {
              type: 'Modal',
              props: { id: 'edit-contact', title: 'Edit contact' },
              children: [{ type: 'ModalBody', children: [{ type: 'Text', name: 'inside', text: 'Inside the modal' }] }],
            },
          ],
        },
      },
      { type: 'Link', name: 'help', text: 'Help', slots: { overlay: [{ type: 'Tooltip', text: 'Opens the docs' }] } },
    ]);
    const board = screen.getByRole('region', { name: 'Overlay storyboard' });
    fireEvent.click(within(board).getByRole('button', { name: /Modal “Edit contact” · opened by Button “Edit”/ }));
    expect(useEditor.getState().selectedNodeId).toBe(byName('trigger').id);
    expect(within(board).getByRole('button', { name: /Tooltip “Opens the docs” · shown on hover of Link “Help”/ })).toBeInTheDocument();
    const inside = byName('inside');
    fireEvent.click(el(inside.id));
    expect(useEditor.getState().selectedNodeId).toBe(inside.id);
    fireEvent.doubleClick(el(inside.id));
    expect(screen.getByRole('textbox', { name: /Edit text of/ })).toHaveValue('Inside the modal');
  });

  it('is absent without overlays and in preview mode', () => {
    setup([{ type: 'Button', name: 'b', text: 'Plain' }]);
    expect(screen.queryByRole('region', { name: 'Overlay storyboard' })).toBeNull();
  });
});

describe('empty card', () => {
  it('offers shortcuts to components, templates and data', () => {
    setup([]);
    expect(document.querySelector('.ub-cv-card-body--empty')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start from a template' }));
    expect(useEditor.getState().leftPanel).toBe('templates');
    fireEvent.click(screen.getByRole('button', { name: 'Add data' }));
    expect(useEditor.getState().leftPanel).toBe('data');
    fireEvent.click(screen.getByRole('button', { name: 'Browse components' }));
    expect(useEditor.getState().leftPanel).toBe('components');
  });
});

describe('preview mode', () => {
  it('shows the banner with Reset and Exit preview', () => {
    setup([{ type: 'Text', text: 'Live' }]);
    act(() => useEditor.getState().setMode('preview'));
    expect(screen.getByText(/interactions run with mock data/)).toBeInTheDocument();
    expect(cardRoot()).toHaveClass('hsp-live');
    const before = useEditor.getState().previewResetKey;
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(useEditor.getState().previewResetKey).toBe(before + 1);
    fireEvent.click(screen.getByRole('button', { name: 'Exit preview' }));
    expect(useEditor.getState().mode).toBe('design');
    expect(screen.getByRole('navigation', { name: 'Selection path' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

describe('performance', () => {
  it('hover, selection and zoom never re-render the node tree (300 nodes)', () => {
    const rows: NodeTemplate[] = Array.from({ length: 100 }, (_, i) => ({
      type: 'Flex',
      name: `row${i}`,
      children: [
        { type: 'Text', name: `a${i}`, text: `Row ${i}` },
        { type: 'Button', name: `b${i}`, text: `Action ${i}` },
      ],
    }));
    setup(rows);
    expect(Object.keys(ext().nodes)).toHaveLength(301);
    const before = renderStats.cardBody;
    for (let i = 0; i < 100; i += 3) {
      const a = byName(`a${i}`);
      fireEvent.pointerMove(el(a.id));
      fireEvent.click(el(byName(`b${i}`).id));
    }
    act(() => useCanvasView.getState().setZoom(1.25));
    act(() => useEditor.getState().hover(null));
    expect(renderStats.cardBody).toBe(before);
  });
});
