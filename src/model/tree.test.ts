import { describe, expect, it } from 'vitest';
import { createExtension } from './factory';
import { collectSubtree, duplicateNode, findParent, instantiateTemplate, insertSubtree, moveNode, removeSubtree, toTemplate } from './tree';
import { canAccept } from './rules';

describe('tree ops', () => {
  it('instantiates, moves, duplicates and removes subtrees', () => {
    const ext = createExtension({
      content: [
        { type: 'Flex', children: [{ type: 'Text', text: 'a' }, { type: 'Text', text: 'b' }] },
        { type: 'Text', text: 'c' },
      ],
    });
    const root = ext.nodes[ext.rootId];
    expect(root.children).toHaveLength(2);
    const flexId = root.children[0];
    const [aId, bId] = ext.nodes[flexId].children;
    const cId = root.children[1];

    // move c into flex at index 1 (between a and b)
    expect(moveNode(ext, cId, { parentId: flexId, index: 1 })).toBe(true);
    expect(ext.nodes[flexId].children).toEqual([aId, cId, bId]);
    expect(root.children).toEqual([flexId]);

    // move a after b within same parent (drop index 3 = end before removal)
    moveNode(ext, aId, { parentId: flexId, index: 3 });
    expect(ext.nodes[flexId].children).toEqual([cId, bId, aId]);

    // cannot move into own subtree
    expect(moveNode(ext, flexId, { parentId: flexId, index: 0 })).toBe(false);

    const dup = duplicateNode(ext, flexId)!;
    expect(root.children).toEqual([flexId, dup]);
    expect(collectSubtree(ext, dup)).toHaveLength(4);
    expect(toTemplate(ext, dup)).toEqual(toTemplate(ext, flexId));

    removeSubtree(ext, flexId);
    expect(root.children).toEqual([dup]);
    expect(ext.nodes[aId]).toBeUndefined();
    expect(findParent(ext, dup)).toEqual({ parentId: ext.rootId, index: 0 });

    const sub = instantiateTemplate({ type: 'Text', text: 'x' });
    insertSubtree(ext, sub, { parentId: ext.rootId, index: 0 });
    expect(root.children[0]).toBe(sub.rootId);
  });

  it('enforces placement rules from the registry', () => {
    const ext = createExtension({ content: [{ type: 'Text', text: 'a' }] });
    const textId = ext.nodes[ext.rootId].children[0];
    expect(canAccept(ext, ext.rootId, 'Flex').ok).toBe(true);
    expect(canAccept(ext, textId, 'Flex').ok).toBe(false);
  });
});
