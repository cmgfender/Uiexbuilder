import { describe, expect, it } from 'vitest';
import { createExtension } from '../model/factory';
import type { Extension, NodeTemplate, UINode } from '../model/types';
import { addableOverlays, ancestorChain, canWrap, nodeCapabilities, usedStateVars } from './nodeActions';

function doc(content: NodeTemplate[]): Extension {
  return createExtension({ content });
}
function byName(ext: Extension, name: string): UINode {
  const node = Object.values(ext.nodes).find((n) => n.name === name);
  if (!node) throw new Error(name);
  return node;
}

describe('nodeActions', () => {
  it('canWrap follows the placement rules', () => {
    const ext = doc([
      { type: 'Text', name: 't', text: 'x' },
      { type: 'Tabs', name: 'tabs', children: [{ type: 'Tab', name: 'tab', props: { tabId: 'a', title: 'A' } }] },
      { type: 'Button', name: 'locked', text: 'L' },
    ]);
    ext.nodes[byName(ext, 'locked').id].locked = true;
    expect(canWrap(ext, byName(ext, 't').id, 'Flex')).toBe(true);
    expect(canWrap(ext, byName(ext, 't').id, 'Tile')).toBe(true);
    // A Tab must stay directly inside Tabs.
    expect(canWrap(ext, byName(ext, 'tab').id, 'Box')).toBe(false);
    expect(canWrap(ext, byName(ext, 'locked').id, 'Box')).toBe(false);
  });

  it('addableOverlays lists what fits an empty overlay slot', () => {
    const ext = doc([
      { type: 'Button', name: 'b', text: 'B' },
      { type: 'Dropdown', children: [{ type: 'Dropdown.ButtonItem', name: 'item', text: 'I' }] },
      { type: 'Link', name: 'busy', text: 'L', slots: { overlay: [{ type: 'Tooltip', text: 'tip' }] } },
      { type: 'Text', name: 'text', text: 'T' },
    ]);
    expect(addableOverlays(ext, byName(ext, 'b').id)).toEqual(['Modal', 'Panel', 'Tooltip']);
    expect(addableOverlays(ext, byName(ext, 'item').id)).toEqual(['Modal', 'Panel']);
    expect(addableOverlays(ext, byName(ext, 'busy').id)).toEqual([]);
    expect(addableOverlays(ext, byName(ext, 'text').id)).toEqual([]);
  });

  it('nodeCapabilities: move bounds, parent and duplication', () => {
    const ext = doc([
      {
        type: 'Box',
        name: 'box',
        children: [
          { type: 'Text', name: 'a', text: 'a' },
          { type: 'Button', name: 'b', text: 'b', slots: { overlay: [{ type: 'Tooltip', name: 'tip', text: 'tip' }] } },
        ],
      },
    ]);
    const a = nodeCapabilities(ext, byName(ext, 'a').id)!;
    expect(a).toMatchObject({ canMoveUp: false, canMoveDown: true, hasParentNode: true, canDuplicate: true, isText: true });
    const box = nodeCapabilities(ext, byName(ext, 'box').id)!;
    expect(box.hasParentNode).toBe(false);
    const tip = nodeCapabilities(ext, byName(ext, 'tip').id)!;
    expect(tip).toMatchObject({ inSlot: true, canMoveUp: false, canMoveDown: false, canDuplicate: false });
    expect(nodeCapabilities(ext, ext.rootId)).toBeNull();
    expect(ancestorChain(ext, byName(ext, 'tip').id)).toEqual([byName(ext, 'box').id, byName(ext, 'b').id, byName(ext, 'tip').id]);
  });

  it('usedStateVars finds state referenced anywhere in a subtree', () => {
    const ext = doc([
      {
        type: 'Flex',
        name: 'f',
        children: [
          { type: 'Text', text: 'Total: {{ total }}' },
          { type: 'Input', props: { name: 'email', label: 'Email' }, binding: { state: 'email' } },
        ],
      },
    ]);
    ext.state = [
      { id: '1', name: 'total', type: 'number', initial: 0 },
      { id: '2', name: 'email', type: 'string', initial: '' },
      { id: '3', name: 'tot', type: 'number', initial: 1 },
      { id: '4', name: 'other', type: 'string', initial: '' },
    ];
    const names = usedStateVars(ext, byName(ext, 'f').id).map((v) => v.name);
    expect(names).toEqual(['total', 'email']);
  });

  it('usedStateVars ignores JSON keys, literal text and option values; counts setters and slot content', () => {
    const ext = doc([
      {
        type: 'Flex',
        name: 'picker',
        children: [
          { type: 'Text', text: 'Pick a stage value' },
          { type: 'Select', props: { label: 'Stage', name: 'stage', options: [{ label: 'Open', value: 'open' }] } },
        ],
      },
      {
        type: 'Button',
        name: 'counter',
        text: 'Add',
        events: { onClick: [{ id: 's1', type: 'custom', code: 'setCount(c => c + 1)' }] },
        slots: { overlay: [{ type: 'Tooltip', text: 'Clicked {{ clicks }} times' }] },
      },
    ]);
    ext.state = ['value', 'text', 'label', 'type', 'count', 'clicks', 'unused'].map((name, i) => ({ id: String(i), name, type: 'string', initial: '' }));
    // Keys (`text`, `label`, `type`, `value`) and words in literal text are not references.
    expect(usedStateVars(ext, byName(ext, 'picker').id)).toEqual([]);
    // `setCount` needs `count`; the overlay's template needs `clicks`.
    expect(usedStateVars(ext, byName(ext, 'counter').id).map((v) => v.name)).toEqual(['count', 'clicks']);
    expect(usedStateVars(ext, 'missing')).toEqual([]);
  });
});
