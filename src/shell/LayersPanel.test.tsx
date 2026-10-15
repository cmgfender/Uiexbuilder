import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { selectActiveExtension, useEditor } from '../model/store';
import type { NodeTemplate } from '../model/types';
import { useDragStore } from '../dnd/dragState';
import { ToastProvider } from '../ui';
import { listUserBlocks } from '../templates';
import { LayersPanel } from './LayersPanel';
import { ancestorRowKeys, flattenLayers, resolveLayerDrop, resolveRootDrop, slotRowKey, zoneForOffset } from './layersModel';
import { applyDropPayload } from './actions';
import { activeNodes, projectWith, resetEditor, rootChildren } from './testUtils';

const content: NodeTemplate[] = [
  {
    type: 'Flex',
    name: 'Stack',
    props: { direction: 'column' },
    children: [
      { type: 'Text', name: 'Intro', text: 'hello' },
      {
        type: 'Button',
        name: 'Open',
        text: 'Open',
        slots: { overlay: [{ type: 'Modal', name: 'Dialog', props: { id: 'dlg', title: 'Hi' }, children: [] }] },
      },
    ],
  },
  { type: 'Divider', name: 'Rule' },
];

function setup() {
  resetEditor(projectWith(content));
  const [stack, rule] = rootChildren();
  const [intro, open] = activeNodes()[stack].children;
  const modal = activeNodes()[open].slots!.overlay[0];
  return { stack, rule, intro, open, modal };
}

function renderLayers() {
  return render(
    <ToastProvider>
      <LayersPanel />
    </ToastProvider>,
  );
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-layer-key="${id}"]`)!;

function fakeDataTransfer() {
  const data: Record<string, string> = {};
  return {
    setData: (k: string, v: string) => {
      data[k] = v;
    },
    getData: (k: string) => data[k] ?? '',
    setDragImage: () => {},
    get types() {
      return Object.keys(data);
    },
    effectAllowed: 'all',
    dropEffect: 'none',
  };
}

describe('layers model', () => {
  it('flattens the tree with an Overlay pseudo-row for slot content', () => {
    const { stack, rule, intro, open, modal } = setup();
    const ext = selectActiveExtension(useEditor.getState());
    const rows = flattenLayers(ext, {});
    expect(rows.map((r) => r.key)).toEqual([stack, intro, open, slotRowKey(open, 'overlay'), modal, rule]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 1, 2, 3, 0]);
    expect(rows[3]).toMatchObject({ kind: 'slot', nodeId: open, slot: 'overlay' });
    expect(rows[4].parent).toEqual({ parentId: open, slot: 'overlay', index: 0 });
  });

  it('expands to depth 3 by default and honours overrides', () => {
    const { stack, intro } = setup();
    const ext = selectActiveExtension(useEditor.getState());
    expect(flattenLayers(ext, { [stack]: false }).map((r) => r.key)).not.toContain(intro);
    const deep = resetEditor(
      projectWith([{ type: 'Flex', children: [{ type: 'Flex', children: [{ type: 'Flex', children: [{ type: 'Flex', children: [{ type: 'Text', text: 'x' }] }] }] }] }]),
    );
    const dext = deep.extensions[0];
    const rows = flattenLayers(dext, {});
    // depths 0,1,2 expanded -> depth-3 Flex visible but collapsed.
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 3]);
    expect(rows[3].expanded).toBe(false);
  });

  it('lists the rows to expand to reveal a node', () => {
    const { stack, open, modal } = setup();
    const ext = selectActiveExtension(useEditor.getState());
    expect(ancestorRowKeys(ext, modal)).toEqual([slotRowKey(open, 'overlay'), open, stack]);
  });

  it('resolves drop zones before / inside / after and validates them', () => {
    const { stack, rule, intro, open } = setup();
    const ext = selectActiveExtension(useEditor.getState());
    const rows = flattenLayers(ext, {});
    const stackRow = rows.find((r) => r.key === stack)!;
    const ruleRow = rows.find((r) => r.key === rule)!;
    const introRow = rows.find((r) => r.key === intro)!;

    expect(zoneForOffset(0.1, true)).toBe('before');
    expect(zoneForOffset(0.5, true)).toBe('inside');
    expect(zoneForOffset(0.9, true)).toBe('after');
    expect(zoneForOffset(0.6, false)).toBe('after');

    expect(resolveLayerDrop(ext, stackRow, 0.5, 'Text')).toMatchObject({ position: 'inside', ok: true, target: { parentId: stack, index: 2 } });
    expect(resolveLayerDrop(ext, ruleRow, 0.1, 'Text')).toMatchObject({ position: 'before', ok: true, target: { parentId: ext.rootId, index: 1 } });
    // Below an expanded container with children -> first child.
    expect(resolveLayerDrop(ext, stackRow, 0.95, 'Text')).toMatchObject({ position: 'after', target: { parentId: stack, index: 0 } });
    // A leaf only offers before / after.
    expect(resolveLayerDrop(ext, introRow, 0.5, 'Text').position).toBe('after');
    // Structural rules: a Tab can't go into a Flex.
    const bad = resolveLayerDrop(ext, stackRow, 0.5, 'Tab');
    expect(bad.ok).toBe(false);
    // A node can't move into itself.
    expect(resolveLayerDrop(ext, introRow, 0.1, 'Flex', stack).ok).toBe(false);
    // Dropping a Modal onto a Button attaches it as the overlay (when free).
    const openRow = rows.find((r) => r.key === open)!;
    expect(resolveLayerDrop(ext, openRow, 0.5, 'Panel').ok).toBe(false); // overlay already taken
    expect(resolveRootDrop(ext, 'Text')).toEqual({ target: { parentId: ext.rootId, index: 2 }, ok: true, reason: undefined });
  });

  it('reorders through the store with the resolved targets', () => {
    const { stack, rule, intro, open } = setup();
    const ext = selectActiveExtension(useEditor.getState());
    const rows = flattenLayers(ext, {});
    // Move the Divider before Intro (inside Stack).
    const introRow = rows.find((r) => r.key === intro)!;
    const drop = resolveLayerDrop(ext, introRow, 0.1, 'Divider', rule);
    expect(drop.ok).toBe(true);
    expect(applyDropPayload({ kind: 'move', nodeId: rule }, drop.target)).toBe(true);
    expect(activeNodes()[stack].children).toEqual([rule, intro, open]);
    expect(rootChildren()).toEqual([stack]);
    expect(useEditor.getState().selectedNodeId).toBe(rule);

    // Locked nodes refuse to move.
    useEditor.getState().updateNode(intro, { locked: true });
    expect(applyDropPayload({ kind: 'move', nodeId: intro }, { parentId: ext.rootId, index: 0 })).toBe(false);
  });

  it('block template drops add missing state variables first', () => {
    setup();
    const ext = selectActiveExtension(useEditor.getState());
    const ok = applyDropPayload(
      {
        kind: 'template',
        label: 'Counter',
        template: { type: 'Text', text: 'Count: {{ count }}' },
        state: [{ name: 'count', type: 'number', initial: 0 }],
      },
      { parentId: ext.rootId, index: 0 },
    );
    expect(ok).toBe(true);
    const after = selectActiveExtension(useEditor.getState());
    expect(after.state.map((s) => s.name)).toEqual(['count']);
    expect(after.nodes[after.nodes[after.rootId].children[0]].text).toBe('Count: {{ count }}');
  });
});

describe('<LayersPanel>', () => {
  it('shows the tree and keeps selection in sync both ways', () => {
    const { stack, intro, open, modal } = setup();
    renderLayers();
    expect(screen.getByRole('tree', { name: 'Layers' })).toBeInTheDocument();
    expect(within(row(stack)).getByText('Stack')).toBeInTheDocument();
    expect(within(row(slotRowKey(open, 'overlay'))).getByText('Overlay')).toBeInTheDocument();

    fireEvent.click(row(intro));
    expect(useEditor.getState().selectedNodeId).toBe(intro);
    expect(row(intro)).toHaveAttribute('aria-selected', 'true');

    act(() => useEditor.getState().select(modal));
    expect(row(modal)).toHaveAttribute('aria-selected', 'true');
    expect(row(intro)).toHaveAttribute('aria-selected', 'false');
  });

  it('reveals a selected node inside a collapsed parent', () => {
    const { stack, intro } = setup();
    renderLayers();
    fireEvent.click(within(row(stack)).getByRole('button', { name: 'Collapse' }));
    expect(document.querySelector(`[data-layer-key="${intro}"]`)).toBeNull();
    act(() => useEditor.getState().select(intro));
    expect(row(intro)).toBeInTheDocument();
  });

  it('lets the user collapse the parent of the selected layer', () => {
    const { stack, intro } = setup();
    renderLayers();
    act(() => useEditor.getState().select(intro));
    fireEvent.click(within(row(stack)).getByRole('button', { name: 'Collapse' }));
    expect(document.querySelector(`[data-layer-key="${intro}"]`)).toBeNull();
    expect(row(stack)).toHaveAttribute('aria-expanded', 'false');
  });

  it('hovering a row highlights the node on the canvas', () => {
    const { intro } = setup();
    renderLayers();
    fireEvent.mouseEnter(row(intro));
    expect(useEditor.getState().hoveredNodeId).toBe(intro);
    fireEvent.mouseLeave(screen.getByRole('tree'));
    expect(useEditor.getState().hoveredNodeId).toBeNull();
  });

  it('renames inline with double-click / F2, Enter commits and Escape cancels', () => {
    const { intro, rule } = setup();
    renderLayers();
    fireEvent.doubleClick(row(intro));
    const input = screen.getByLabelText('Layer name');
    fireEvent.change(input, { target: { value: 'Greeting' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(activeNodes()[intro].name).toBe('Greeting');
    expect(within(row(intro)).getByText('Greeting')).toBeInTheDocument();

    act(() => useEditor.getState().select(rule));
    fireEvent.keyDown(row(rule), { key: 'F2' });
    const input2 = screen.getByLabelText('Layer name');
    fireEvent.change(input2, { target: { value: 'Nope' } });
    fireEvent.keyDown(input2, { key: 'Escape' });
    expect(activeNodes()[rule].name).toBe('Rule');
    expect(screen.queryByLabelText('Layer name')).toBeNull();
  });

  it('supports keyboard navigation and deletion (but not of locked nodes)', () => {
    const { stack, intro, open, rule } = setup();
    renderLayers();
    const tree = screen.getByRole('tree');
    act(() => useEditor.getState().select(stack));
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(useEditor.getState().selectedNodeId).toBe(intro);
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    expect(useEditor.getState().selectedNodeId).toBe(open);
    fireEvent.keyDown(tree, { key: 'ArrowLeft' }); // expanded: collapse first
    expect(row(open)).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(tree, { key: 'ArrowLeft' }); // then parent
    expect(useEditor.getState().selectedNodeId).toBe(stack);
    fireEvent.keyDown(tree, { key: 'End' });
    expect(useEditor.getState().selectedNodeId).toBe(rule);

    fireEvent.click(within(row(rule)).getByRole('button', { name: 'Lock' }));
    expect(activeNodes()[rule].locked).toBe(true);
    expect(row(rule)).toHaveAttribute('draggable', 'false');
    fireEvent.keyDown(tree, { key: 'Delete' });
    expect(activeNodes()[rule]).toBeDefined();
    expect(screen.getByText(/is locked/)).toBeInTheDocument();

    fireEvent.click(within(row(rule)).getByRole('button', { name: 'Unlock' }));
    fireEvent.keyDown(tree, { key: 'Delete' });
    expect(activeNodes()[rule]).toBeUndefined();
  });

  it('toggles visibility in the designer and shows logic badges', () => {
    const { intro, open } = setup();
    useEditor.getState().updateNode(intro, { condition: 'count > 1' });
    useEditor.getState().setEvent(open, 'onClick', [{ id: 'a1', type: 'reloadPage' }]);
    renderLayers();
    fireEvent.click(within(row(intro)).getByRole('button', { name: 'Hide in designer' }));
    expect(activeNodes()[intro].hiddenInDesigner).toBe(true);
    expect(row(intro).className).toMatch(/ub-sh-lyr-row--hidden/);
    expect(within(row(intro)).getByLabelText('Has condition')).toBeInTheDocument();
    expect(within(row(open)).getByLabelText('Events')).toBeInTheDocument();
  });

  it('context menu duplicates, wraps and saves blocks', () => {
    const { stack, intro } = setup();
    renderLayers();
    fireEvent.contextMenu(row(intro));
    expect(useEditor.getState().selectedNodeId).toBe(intro);
    fireEvent.click(screen.getByRole('menuitem', { name: /Duplicate/ }));
    expect(activeNodes()[stack].children).toHaveLength(3);

    fireEvent.contextMenu(row(intro));
    fireEvent.click(screen.getByRole('menuitem', { name: /Wrap in Box/ }));
    const wrapper = activeNodes()[stack].children[0];
    expect(activeNodes()[wrapper].type).toBe('Box');
    expect(activeNodes()[wrapper].children).toEqual([intro]);

    fireEvent.contextMenu(row(intro));
    fireEvent.click(screen.getByRole('menuitem', { name: /Save as block/ }));
    const name = screen.getByLabelText('Block name');
    fireEvent.change(name, { target: { value: 'My intro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save block' }));
    expect(listUserBlocks()[0]).toMatchObject({ name: 'My intro', template: { type: 'Text', text: 'hello' } });
  });

  it('reorders rows with drag and drop', () => {
    const { stack, intro, open, rule } = setup();
    renderLayers();
    const dt = fakeDataTransfer();
    fireEvent.dragStart(row(rule), { dataTransfer: dt });
    expect(useDragStore.getState().payload).toEqual({ kind: 'move', nodeId: rule });
    // jsdom rows have no height: the pointer counts as the middle of the row -> after a leaf.
    fireEvent.dragOver(row(intro), { dataTransfer: dt, clientY: 0 });
    fireEvent.drop(row(intro), { dataTransfer: dt, clientY: 0 });
    expect(activeNodes()[stack].children).toEqual([intro, rule, open]);
    expect(useDragStore.getState().payload).toBeNull();
  });

  it('shows a helpful empty state', () => {
    resetEditor(projectWith([]));
    renderLayers();
    expect(screen.getByText('No components yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Browse components' }));
    expect(useEditor.getState().leftPanel).toBe('components');
  });
});
