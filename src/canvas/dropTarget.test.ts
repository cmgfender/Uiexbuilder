import { describe, expect, it } from 'vitest';
import { createExtension } from '../model/factory';
import type { Extension, NodeTemplate, UINode } from '../model/types';
import {
  ATTACH_OVERLAY_LABEL,
  computeDropTarget,
  createDropModel,
  detectAxis,
  inEdgeZone,
  inferAxisFromRects,
  placeAmong,
  sideOf,
  type Axis,
  type ChildBox,
  type DropAccepted,
  type DropRejected,
  type HitLevel,
  type Rect,
} from './dropTarget';

const R = (left: number, top: number, width: number, height: number): Rect => ({ left, top, width, height });

function level(nodeId: string, rect: Rect, childAxis: Axis = 'vertical', children: ChildBox[] = []): HitLevel {
  return { nodeId, rect, childAxis, children };
}

function doc(content: NodeTemplate[]): Extension {
  return createExtension({ content });
}

function byName(ext: Extension, name: string): UINode {
  const node = Object.values(ext.nodes).find((n) => n.name === name);
  if (!node) throw new Error(`no node ${name}`);
  return node;
}

function accepted(r: ReturnType<typeof computeDropTarget>): DropAccepted {
  if (!r.ok) throw new Error(`expected an accepted drop, got: ${r.reason}`);
  return r;
}

function rejected(r: ReturnType<typeof computeDropTarget>): DropRejected {
  if (r.ok) throw new Error(`expected a rejection, got target ${JSON.stringify(r.target)}`);
  return r;
}

// ---------------------------------------------------------------------------
// Axis detection
// ---------------------------------------------------------------------------

describe('detectAxis', () => {
  it('reads flex direction and wrapping', () => {
    expect(detectAxis({ display: 'flex', flexDirection: 'row' })).toBe('horizontal');
    expect(detectAxis({ display: 'inline-flex', flexDirection: 'row-reverse' })).toBe('horizontal');
    expect(detectAxis({ display: 'flex', flexDirection: 'column' })).toBe('vertical');
    expect(detectAxis({ display: 'flex', flexDirection: 'column-reverse' })).toBe('vertical');
    expect(detectAxis({ display: 'flex', flexDirection: 'row', flexWrap: 'wrap' })).toBe('grid');
    expect(detectAxis({ display: 'flex' })).toBe('horizontal');
  });

  it('treats grids as 2-D and table parts by their row direction', () => {
    expect(detectAxis({ display: 'grid' })).toBe('grid');
    expect(detectAxis({ display: 'inline-grid' })).toBe('grid');
    expect(detectAxis({ display: 'table-row', tagName: 'TR' })).toBe('horizontal');
    expect(detectAxis({ display: 'table-row-group', tagName: 'TBODY' })).toBe('vertical');
    expect(detectAxis({ display: 'table-header-group', tagName: 'THEAD' })).toBe('vertical');
    expect(detectAxis({ display: 'table' })).toBe('vertical');
    // Environments without a computed display fall back to the tag name.
    expect(detectAxis({ display: '', tagName: 'tr' })).toBe('horizontal');
    expect(detectAxis({ display: 'block', tagName: 'TR' })).toBe('horizontal');
  });

  it('defaults to vertical block flow', () => {
    expect(detectAxis({ display: 'block' })).toBe('vertical');
    expect(detectAxis({ display: '' })).toBe('vertical');
  });

  it('infers the axis of inline flow from child rects', () => {
    expect(inferAxisFromRects([R(0, 0, 50, 20), R(60, 0, 50, 20), R(120, 0, 50, 20)])).toBe('horizontal');
    expect(inferAxisFromRects([R(0, 0, 50, 20), R(0, 30, 50, 20)])).toBe('vertical');
    expect(inferAxisFromRects([R(0, 0, 50, 20), R(60, 0, 50, 20), R(0, 30, 50, 20)])).toBe('grid');
    expect(inferAxisFromRects([R(0, 0, 50, 20)])).toBeNull();
    expect(inferAxisFromRects([R(0, 0, 0, 0), R(0, 0, 0, 0)])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Placement among children
// ---------------------------------------------------------------------------

describe('placeAmong', () => {
  const column: ChildBox[] = [
    { id: 'a', rect: R(0, 0, 100, 20) },
    { id: 'b', rect: R(0, 30, 100, 20) },
    { id: 'c', rect: R(0, 60, 100, 20) },
  ];
  const ids = ['a', 'b', 'c'];

  it('column: compares the pointer with child centers along y and centres the bar in the gap', () => {
    expect(placeAmong(column, ids, 'vertical', { x: 50, y: 5 })).toMatchObject({ index: 0, orientation: 'horizontal' });
    const between = placeAmong(column, ids, 'vertical', { x: 50, y: 25 });
    expect(between.index).toBe(1);
    expect(between.line).toEqual(R(0, 24, 100, 2));
    const end = placeAmong(column, ids, 'vertical', { x: 50, y: 200 });
    expect(end.index).toBe(3);
    expect(end.line).toEqual(R(0, 79, 100, 2));
  });

  it('row: compares x and draws a vertical bar', () => {
    const row: ChildBox[] = [
      { id: 'a', rect: R(0, 0, 80, 30) },
      { id: 'b', rect: R(100, 0, 80, 30) },
    ];
    const p = placeAmong(row, ['a', 'b'], 'horizontal', { x: 90, y: 15 });
    expect(p.index).toBe(1);
    expect(p.orientation).toBe('vertical');
    expect(p.line).toEqual(R(89, 0, 2, 30));
    expect(placeAmong(row, ['a', 'b'], 'horizontal', { x: 170, y: 15 }).index).toBe(2);
  });

  it('grid: anchors on the nearest item and uses its row', () => {
    const grid: ChildBox[] = [
      { id: 'a', rect: R(0, 0, 100, 50) },
      { id: 'b', rect: R(110, 0, 100, 50) },
      { id: 'c', rect: R(0, 60, 100, 50) },
      { id: 'd', rect: R(110, 60, 100, 50) },
    ];
    const gids = ['a', 'b', 'c', 'd'];
    // Right half of "b" -> after b (index 2), vertical bar on b's right edge.
    const p = placeAmong(grid, gids, 'grid', { x: 190, y: 20 });
    expect(p.index).toBe(2);
    expect(p.orientation).toBe('vertical');
    expect(p.line).toEqual(R(209, 0, 2, 50));
    // Left half of "d" -> before d; the bar sits in the gap between c and d.
    const q = placeAmong(grid, gids, 'grid', { x: 120, y: 80 });
    expect(q.index).toBe(3);
    expect(q.line).toEqual(R(104, 60, 2, 50));
  });

  it('maps rendered children to model indexes and skips hidden ones', () => {
    // "b" is hidden in the designer (not rendered), "c" is in an inactive tab (0x0).
    const kids: ChildBox[] = [
      { id: 'a', rect: R(0, 0, 100, 20) },
      { id: 'c', rect: R(0, 0, 0, 0) },
      { id: 'd', rect: R(0, 30, 100, 20) },
    ];
    expect(placeAmong(kids, ['a', 'b', 'c', 'd'], 'vertical', { x: 10, y: 35 }).index).toBe(3);
    expect(placeAmong(kids, ['a', 'b', 'c', 'd'], 'vertical', { x: 10, y: 90 }).index).toBe(4);
  });

  it('returns no bar for a container without rendered children', () => {
    expect(placeAmong([], ['x'], 'vertical', { x: 0, y: 0 })).toEqual({ index: 1, line: null, orientation: 'horizontal' });
  });
});

describe('edge zones and sides', () => {
  it('detects the 8px edge along the parent axis', () => {
    const r = R(0, 0, 200, 100);
    expect(inEdgeZone({ x: 100, y: 4 }, r, 'vertical')).toBe(true);
    expect(inEdgeZone({ x: 100, y: 96 }, r, 'vertical')).toBe(true);
    expect(inEdgeZone({ x: 4, y: 50 }, r, 'vertical')).toBe(false);
    expect(inEdgeZone({ x: 4, y: 50 }, r, 'horizontal')).toBe(true);
    expect(inEdgeZone({ x: 100, y: 50 }, r, 'grid')).toBe(false);
  });

  it('shrinks the edge zone for small nodes', () => {
    // 20px tall: the zone is 5px, leaving the middle for "inside".
    expect(inEdgeZone({ x: 50, y: 6 }, R(0, 0, 100, 20), 'vertical')).toBe(false);
  });

  it('grid side: above / below an item means previous / next row', () => {
    expect(sideOf({ x: 50, y: -5 }, R(0, 0, 100, 50), 'grid')).toEqual({ before: true, orientation: 'horizontal' });
    expect(sideOf({ x: 50, y: 60 }, R(0, 0, 100, 50), 'grid')).toEqual({ before: false, orientation: 'horizontal' });
    expect(sideOf({ x: 80, y: 20 }, R(0, 0, 100, 50), 'grid')).toEqual({ before: false, orientation: 'vertical' });
  });
});

// ---------------------------------------------------------------------------
// computeDropTarget with the real registry rules
// ---------------------------------------------------------------------------

describe('computeDropTarget', () => {
  it('column container: index among children (column axis)', () => {
    const ext = doc([
      {
        type: 'Flex',
        name: 'col',
        props: { direction: 'column' },
        children: [
          { type: 'Text', name: 't1', text: 'one' },
          { type: 'Text', name: 't2', text: 'two' },
          { type: 'Text', name: 't3', text: 'three' },
        ],
      },
    ]);
    const col = byName(ext, 'col');
    const [t1, t2, t3] = ['t1', 't2', 't3'].map((n) => byName(ext, n));
    const colLevel = level(col.id, R(0, 0, 300, 100), 'vertical', [
      { id: t1.id, rect: R(0, 0, 300, 20) },
      { id: t2.id, rect: R(0, 40, 300, 20) },
      { id: t3.id, rect: R(0, 80, 300, 20) },
    ]);
    const root = level(ext.rootId, R(0, 0, 300, 100), 'vertical', [{ id: col.id, rect: colLevel.rect }]);
    // Pointer in the gap between t1 and t2 (over the Flex itself).
    const res = accepted(computeDropTarget({ point: { x: 150, y: 30 }, chain: [colLevel, root] }, createDropModel(ext, 'Button')));
    expect(res.target).toEqual({ parentId: col.id, index: 1 });
    expect(res.mode).toBe('line');
    expect(res.orientation).toBe('horizontal');
    expect(res.rect).toEqual(R(0, 29, 300, 2));
  });

  it('row container: index along x with a vertical bar', () => {
    const ext = doc([
      {
        type: 'Flex',
        name: 'row',
        props: { direction: 'row' },
        children: [
          { type: 'Button', name: 'b1', text: 'One' },
          { type: 'Button', name: 'b2', text: 'Two' },
        ],
      },
    ]);
    const row = byName(ext, 'row');
    const b1 = byName(ext, 'b1');
    const b2 = byName(ext, 'b2');
    const rowLevel = level(row.id, R(0, 0, 400, 40), 'horizontal', [
      { id: b1.id, rect: R(0, 5, 80, 30) },
      { id: b2.id, rect: R(96, 5, 80, 30) },
    ]);
    const root = level(ext.rootId, R(0, 0, 400, 40), 'vertical', [{ id: row.id, rect: rowLevel.rect }]);
    const res = accepted(computeDropTarget({ point: { x: 300, y: 20 }, chain: [rowLevel, root] }, createDropModel(ext, 'Button')));
    expect(res.target).toEqual({ parentId: row.id, index: 2 });
    expect(res.orientation).toBe('vertical');
    // Over the first button (a leaf): before/after it along the row.
    const b1Level = level(b1.id, R(0, 5, 80, 30));
    const before = accepted(computeDropTarget({ point: { x: 20, y: 20 }, chain: [b1Level, rowLevel, root] }, createDropModel(ext, 'Button')));
    expect(before.target).toEqual({ parentId: row.id, index: 0 });
    expect(before.orientation).toBe('vertical');
    const after = accepted(computeDropTarget({ point: { x: 60, y: 20 }, chain: [b1Level, rowLevel, root] }, createDropModel(ext, 'Button')));
    expect(after.target).toEqual({ parentId: row.id, index: 1 });
    // Bar centred in the 16px gap between the buttons.
    expect(after.rect).toEqual(R(87, 5, 2, 30));
  });

  it('grid container: nearest item decides the index', () => {
    const ext = doc([
      {
        type: 'AutoGrid',
        name: 'grid',
        children: [
          { type: 'Tile', name: 'g1', children: [{ type: 'Text', text: '1' }] },
          { type: 'Tile', name: 'g2', children: [{ type: 'Text', text: '2' }] },
          { type: 'Tile', name: 'g3', children: [{ type: 'Text', text: '3' }] },
        ],
      },
    ]);
    const grid = byName(ext, 'grid');
    const [g1, g2, g3] = ['g1', 'g2', 'g3'].map((n) => byName(ext, n));
    const gridLevel = level(grid.id, R(0, 0, 420, 220), 'grid', [
      { id: g1.id, rect: R(0, 0, 200, 100) },
      { id: g2.id, rect: R(220, 0, 200, 100) },
      { id: g3.id, rect: R(0, 120, 200, 100) },
    ]);
    const root = level(ext.rootId, R(0, 0, 420, 220), 'vertical', [{ id: grid.id, rect: gridLevel.rect }]);
    // Empty cell right of g3 (second row): after g3.
    const res = accepted(computeDropTarget({ point: { x: 300, y: 170 }, chain: [gridLevel, root] }, createDropModel(ext, 'Tile')));
    expect(res.target).toEqual({ parentId: grid.id, index: 3 });
    expect(res.orientation).toBe('vertical');
  });

  it('table rows: walks up from a cell to insert a row between rows (ancestor fallback)', () => {
    const ext = doc([
      {
        type: 'Table',
        name: 'table',
        children: [
          {
            type: 'TableBody',
            name: 'body',
            children: [
              { type: 'TableRow', name: 'r1', children: [{ type: 'TableCell', name: 'c1', children: [{ type: 'Text', name: 'x', text: 'x' }] }] },
              { type: 'TableRow', name: 'r2', children: [{ type: 'TableCell', children: [{ type: 'Text', text: 'y' }] }] },
            ],
          },
        ],
      },
    ]);
    const [table, body, r1, r2, c1, x] = ['table', 'body', 'r1', 'r2', 'c1', 'x'].map((n) => byName(ext, n));
    const textLevel = level(x.id, R(10, 10, 100, 20));
    const cellLevel = level(c1.id, R(0, 0, 400, 40), 'vertical', [{ id: x.id, rect: textLevel.rect }]);
    const rowLevel = level(r1.id, R(0, 0, 400, 40), 'horizontal', [{ id: c1.id, rect: cellLevel.rect }]);
    const bodyLevel = level(body.id, R(0, 0, 400, 80), 'vertical', [
      { id: r1.id, rect: R(0, 0, 400, 40) },
      { id: r2.id, rect: R(0, 40, 400, 40) },
    ]);
    const tableLevel = level(table.id, R(0, 0, 400, 80), 'vertical', [{ id: body.id, rect: bodyLevel.rect }]);
    const root = level(ext.rootId, R(0, 0, 400, 80), 'vertical', [{ id: table.id, rect: tableLevel.rect }]);
    const chain = [textLevel, cellLevel, rowLevel, bodyLevel, tableLevel, root];

    // A new row dropped on the text of row 1's lower half -> after row 1 in the body.
    const row = accepted(computeDropTarget({ point: { x: 50, y: 30 }, chain }, createDropModel(ext, 'TableRow')));
    expect(row.target).toEqual({ parentId: body.id, index: 1 });
    expect(row.orientation).toBe('horizontal');
    expect(row.rect).toEqual(R(0, 39, 400, 2));

    // A new cell -> beside the cell along the row (vertical bar).
    const cell = accepted(computeDropTarget({ point: { x: 350, y: 20 }, chain: [cellLevel, rowLevel, bodyLevel, tableLevel, root] }, createDropModel(ext, 'TableCell')));
    expect(cell.target).toEqual({ parentId: r1.id, index: 1 });
    expect(cell.orientation).toBe('vertical');
  });

  it('near the edge of a container drops before / after it instead of inside', () => {
    const ext = doc([
      { type: 'Text', name: 'top', text: 'top' },
      { type: 'Box', name: 'box', children: [{ type: 'Text', name: 'inner', text: 'inner' }] },
    ]);
    const top = byName(ext, 'top');
    const box = byName(ext, 'box');
    const inner = byName(ext, 'inner');
    const boxLevel = level(box.id, R(0, 40, 300, 100), 'vertical', [{ id: inner.id, rect: R(16, 56, 268, 20) }]);
    const root = level(ext.rootId, R(0, 0, 300, 140), 'vertical', [
      { id: top.id, rect: R(0, 0, 300, 24) },
      { id: box.id, rect: boxLevel.rect },
    ]);
    const model = createDropModel(ext, 'Button');
    const edge = accepted(computeDropTarget({ point: { x: 150, y: 43 }, chain: [boxLevel, root] }, model));
    expect(edge.target).toEqual({ parentId: ext.rootId, index: 1 });
    const bottomEdge = accepted(computeDropTarget({ point: { x: 150, y: 137 }, chain: [boxLevel, root] }, model));
    expect(bottomEdge.target).toEqual({ parentId: ext.rootId, index: 2 });
    const insideBox = accepted(computeDropTarget({ point: { x: 150, y: 110 }, chain: [boxLevel, root] }, model));
    expect(insideBox.target).toEqual({ parentId: box.id, index: 1 });
  });

  it('over a non-container: before / after it in its parent', () => {
    const ext = doc([
      { type: 'Text', name: 'a', text: 'a' },
      { type: 'Text', name: 'b', text: 'b' },
    ]);
    const a = byName(ext, 'a');
    const b = byName(ext, 'b');
    const root = level(ext.rootId, R(0, 0, 300, 60), 'vertical', [
      { id: a.id, rect: R(0, 0, 300, 20) },
      { id: b.id, rect: R(0, 30, 300, 20) },
    ]);
    const res = accepted(computeDropTarget({ point: { x: 10, y: 34 }, chain: [level(b.id, R(0, 30, 300, 20)), root] }, createDropModel(ext, 'Heading')));
    expect(res.target).toEqual({ parentId: ext.rootId, index: 1 });
    expect(res.rect).toEqual(R(0, 24, 300, 2));
  });

  it('over an empty placeholder: inside that parent', () => {
    const ext = doc([{ type: 'Flex', name: 'empty', props: { direction: 'column' } }]);
    const empty = byName(ext, 'empty');
    const flexLevel = level(empty.id, R(0, 0, 300, 60));
    const root = level(ext.rootId, R(0, 0, 300, 60), 'vertical', [{ id: empty.id, rect: flexLevel.rect }]);
    const placeholder = { parentId: empty.id, rect: R(8, 8, 284, 44) };
    const res = accepted(computeDropTarget({ point: { x: 150, y: 30 }, chain: [flexLevel, root], placeholder }, createDropModel(ext, 'Text')));
    expect(res).toMatchObject({ target: { parentId: empty.id, index: 0 }, mode: 'inside', rect: placeholder.rect });
    // Within the container's edge zone the drop goes beside it.
    const edge = accepted(computeDropTarget({ point: { x: 150, y: 2 }, chain: [flexLevel, root], placeholder }, createDropModel(ext, 'Text')));
    expect(edge.target).toEqual({ parentId: ext.rootId, index: 0 });
  });

  it('empty card: the root placeholder takes the drop', () => {
    const ext = doc([]);
    const root = level(ext.rootId, R(0, 0, 600, 200));
    const res = accepted(
      computeDropTarget({ point: { x: 100, y: 100 }, chain: [root], placeholder: { parentId: ext.rootId, rect: R(16, 16, 568, 168) } }, createDropModel(ext, 'Text')),
    );
    expect(res).toMatchObject({ target: { parentId: ext.rootId, index: 0 }, mode: 'inside' });
  });

  it('overlay types attach to an empty overlay slot of the nearest trigger', () => {
    const ext = doc([
      {
        type: 'Flex',
        name: 'row',
        children: [
          { type: 'Button', name: 'free', text: 'Edit' },
          { type: 'Button', name: 'busy', text: 'Busy', slots: { overlay: [{ type: 'Tooltip', text: 'tip' }] } },
        ],
      },
    ]);
    const row = byName(ext, 'row');
    const free = byName(ext, 'free');
    const busy = byName(ext, 'busy');
    const rowLevel = level(row.id, R(0, 0, 400, 40), 'horizontal');
    const root = level(ext.rootId, R(0, 0, 400, 40), 'vertical');
    const res = accepted(computeDropTarget({ point: { x: 20, y: 20 }, chain: [level(free.id, R(0, 0, 80, 32)), rowLevel, root] }, createDropModel(ext, 'Modal')));
    expect(res.target).toEqual({ parentId: free.id, slot: 'overlay', index: 0 });
    expect(res.mode).toBe('inside');
    expect(res.label).toBe(ATTACH_OVERLAY_LABEL);

    const full = rejected(computeDropTarget({ point: { x: 120, y: 20 }, chain: [level(busy.id, R(100, 0, 80, 32)), rowLevel, root] }, createDropModel(ext, 'Panel')));
    // Names the trigger and what occupies its overlay (not the generic "must be attached" hint).
    expect(full.reason).toBe('Button “Busy” already has an overlay (Tooltip “tip”) — remove it first to attach a Panel');

    // Over a container without triggers: explains where overlays go.
    const none = rejected(computeDropTarget({ point: { x: 300, y: 20 }, chain: [rowLevel, root] }, createDropModel(ext, 'Modal')));
    expect(none.reason).toMatch(/must be attached/);
  });

  it('a Tooltip dropped on a button that already opens a Modal explains which overlay is in the way', () => {
    const ext = doc([
      {
        type: 'Button',
        name: 'trigger',
        text: 'Trigger',
        slots: { overlay: [{ type: 'Modal', props: { id: 'edit', title: 'Edit details' }, children: [{ type: 'ModalBody' }] }] },
      },
    ]);
    const trigger = byName(ext, 'trigger');
    const root = level(ext.rootId, R(0, 0, 400, 40), 'vertical', [{ id: trigger.id, rect: R(0, 0, 100, 32) }]);
    const res = rejected(computeDropTarget({ point: { x: 50, y: 16 }, chain: [level(trigger.id, R(0, 0, 100, 32)), root] }, createDropModel(ext, 'Tooltip')));
    expect(res.reason).toBe('Button “Trigger” already has an overlay (Modal “Edit details”) — remove it first to attach a Tooltip');
    // Moving the occupant itself back onto its own trigger is not "full".
    const modalId = ext.nodes[trigger.id].slots!.overlay[0];
    const back = accepted(computeDropTarget({ point: { x: 50, y: 16 }, chain: [level(trigger.id, R(0, 0, 100, 32)), root] }, createDropModel(ext, 'Modal', modalId)));
    expect(back.target).toEqual({ parentId: trigger.id, slot: 'overlay', index: 0 });
    // A type the slot does not accept keeps the slot's own explanation.
    const ddExt = doc([{ type: 'Dropdown', children: [{ type: 'Dropdown.ButtonItem', name: 'item', text: 'Edit', slots: { overlay: [{ type: 'Panel', props: { id: 'p', title: 'P' } }] } }] }]);
    const item = byName(ddExt, 'item');
    const ddChain = [level(item.id, R(0, 0, 100, 30)), level(ddExt.rootId, R(0, 0, 100, 30))];
    expect(rejected(computeDropTarget({ point: { x: 5, y: 5 }, chain: ddChain }, createDropModel(ddExt, 'Tooltip'))).reason).toMatch(/accepts Modal or Panel/);
  });

  it('overlay slot rules: Dropdown items accept Modals and Panels, not Tooltips', () => {
    const ext = doc([{ type: 'Dropdown', name: 'dd', children: [{ type: 'Dropdown.ButtonItem', name: 'item', text: 'Edit' }] }]);
    const dd = byName(ext, 'dd');
    const item = byName(ext, 'item');
    const chain = [level(item.id, R(0, 0, 100, 30)), level(dd.id, R(0, 0, 100, 30)), level(ext.rootId, R(0, 0, 100, 30))];
    expect(rejected(computeDropTarget({ point: { x: 5, y: 5 }, chain }, createDropModel(ext, 'Tooltip'))).reason).toMatch(/Modal or Panel/);
    expect(accepted(computeDropTarget({ point: { x: 5, y: 5 }, chain }, createDropModel(ext, 'Panel'))).target.slot).toBe('overlay');
  });

  it('walks up the ancestors until a parent accepts the type', () => {
    const ext = doc([
      {
        type: 'Tabs',
        name: 'tabs',
        children: [
          { type: 'Tab', name: 'tab1', props: { tabId: 'a', title: 'A' }, children: [{ type: 'Text', name: 'txt', text: 'hello' }] },
          { type: 'Tab', name: 'tab2', props: { tabId: 'b', title: 'B' } },
        ],
      },
    ]);
    const [tabs, tab1, tab2, txt] = ['tabs', 'tab1', 'tab2', 'txt'].map((n) => byName(ext, n));
    const tab1Level = level(tab1.id, R(0, 40, 400, 60), 'vertical', [{ id: txt.id, rect: R(0, 50, 400, 20) }]);
    const tabsLevel = level(tabs.id, R(0, 0, 400, 100), 'vertical', [
      { id: tab1.id, rect: tab1Level.rect },
      { id: tab2.id, rect: R(0, 0, 0, 0) },
    ]);
    const root = level(ext.rootId, R(0, 0, 400, 100), 'vertical', [{ id: tabs.id, rect: tabsLevel.rect }]);
    const res = accepted(computeDropTarget({ point: { x: 100, y: 82 }, chain: [level(txt.id, R(0, 50, 400, 40)), tab1Level, tabsLevel, root] }, createDropModel(ext, 'Tab')));
    expect(res.target).toEqual({ parentId: tabs.id, index: 1 });
  });

  it('rejects with the most specific reason when nothing accepts', () => {
    const ext = doc([{ type: 'Text', name: 't', text: 'top' }]);
    const t = byName(ext, 't');
    const root = level(ext.rootId, R(0, 0, 300, 40), 'vertical', [{ id: t.id, rect: R(0, 0, 300, 20) }]);
    const res = rejected(computeDropTarget({ point: { x: 10, y: 10 }, chain: [level(t.id, R(0, 0, 300, 20)), root] }, createDropModel(ext, 'Tab')));
    expect(res.reason).toBe('Tab must be placed inside Tabs');
    expect(res.rect).toEqual(R(0, 0, 300, 20));
  });

  it('nothing under the pointer: silent rejection', () => {
    const ext = doc([]);
    expect(computeDropTarget({ point: { x: 0, y: 0 }, chain: [] }, createDropModel(ext, 'Text'))).toEqual({ ok: false, reason: '', rect: null });
  });

  it('moving a node never targets its own subtree', () => {
    const ext = doc([
      { type: 'Text', name: 'first', text: 'first' },
      { type: 'Box', name: 'box', children: [{ type: 'Text', name: 'inner', text: 'inner' }] },
    ]);
    const first = byName(ext, 'first');
    const box = byName(ext, 'box');
    const inner = byName(ext, 'inner');
    const boxLevel = level(box.id, R(0, 30, 300, 100), 'vertical', [{ id: inner.id, rect: R(16, 46, 268, 20) }]);
    const root = level(ext.rootId, R(0, 0, 300, 130), 'vertical', [
      { id: first.id, rect: R(0, 0, 300, 20) },
      { id: box.id, rect: boxLevel.rect },
    ]);
    const res = accepted(computeDropTarget({ point: { x: 100, y: 50 }, chain: [level(inner.id, R(16, 46, 268, 20)), boxLevel, root] }, createDropModel(ext, 'Box', box.id)));
    expect(res.target.parentId).toBe(ext.rootId);
    expect([1, 2]).toContain(res.target.index);
  });

  it('storyboard: content inside an overlay never spills into the trigger’s parent', () => {
    const ext = doc([
      {
        type: 'Button',
        name: 'trigger',
        text: 'Open',
        slots: { overlay: [{ type: 'Modal', name: 'modal', props: { id: 'm', title: 'M' }, children: [{ type: 'ModalBody', name: 'mb', children: [{ type: 'Text', name: 'mt', text: 'x' }] }] }] },
      },
    ]);
    const [modal, mb, mt] = ['modal', 'mb', 'mt'].map((n) => byName(ext, n));
    const mbLevel = level(mb.id, R(0, 40, 400, 100), 'vertical', [{ id: mt.id, rect: R(10, 50, 380, 20) }]);
    const modalLevel = level(modal.id, R(0, 0, 400, 200), 'vertical', [{ id: mb.id, rect: mbLevel.rect }]);
    const ok = accepted(computeDropTarget({ point: { x: 100, y: 90 }, chain: [mbLevel, modalLevel] }, createDropModel(ext, 'Button')));
    expect(ok.target).toEqual({ parentId: mb.id, index: 1 });
    // A ModalBody can't go beside the Modal (overlay slot holds one) nor into the card.
    const no = rejected(computeDropTarget({ point: { x: 100, y: 2 }, chain: [modalLevel] }, createDropModel(ext, 'Heading')));
    expect(no.reason).toBeTruthy();
  });
});
