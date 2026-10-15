import { describe, expect, it } from 'vitest';
import { createExtension, createProject } from '../model/factory';
import { selectActiveExtension, useEditor } from '../model/store';
import { insertBlock } from '../templates/actions';
import { pasteAt, stateVarsUsedBy } from './actions';
import { resetEditor } from './testUtils';

const ext = () => selectActiveExtension(useEditor.getState());

describe('location rules for pasted and inserted content', () => {
  it('says which nested component a settings page cannot hold when pasting', () => {
    resetEditor(
      createProject('Rules', [
        createExtension({ name: 'Card', content: [{ type: 'Tile', children: [{ type: 'CrmPropertyList', props: { properties: ['email'] } }] }] }),
      ]),
    );
    useEditor.getState().copyNode(ext().nodes[ext().rootId].children[0]);
    useEditor.getState().addExtension({ kind: 'settings' });
    const messages: string[] = [];
    expect(pasteAt(null, (m) => messages.push(m))).toBeNull();
    expect(messages).toEqual(['Can\'t paste Tile here: it contains Property list, which isn’t available on this settings page.']);
  });

  it('refuses a block whose content is not available in the location', () => {
    resetEditor(createProject('Rules', [createExtension({ name: 'Settings', kind: 'settings' })]));
    const res = insertBlock({ type: 'Tile', children: [{ type: 'CrmPropertyList', props: { properties: ['email'] } }] }, undefined, 'Record facts');
    expect(res).toEqual({ ok: false, message: '“Record facts” contains Property list, which isn’t available on this settings page.' });
    expect(ext().nodes[ext().rootId].children).toEqual([]);
  });

  it('lists only state variables the subtree really uses for “Save as block”', () => {
    const card = createExtension({
      name: 'Card',
      content: [
        {
          type: 'Flex',
          children: [
            { type: 'Text', text: 'Pick a stage value' },
            { type: 'Button', text: 'Add', events: { onClick: [{ id: 'a1', type: 'setState', state: 'count', value: 'count + 1' }] } },
          ],
        },
      ],
    });
    card.state = [
      { id: 's1', name: 'value', type: 'string', initial: '' },
      { id: 's2', name: 'count', type: 'number', initial: 0 },
    ];
    resetEditor(createProject('Rules', [card]));
    const flex = ext().nodes[ext().rootId].children[0];
    expect(stateVarsUsedBy(ext(), flex).map((v) => v.name)).toEqual(['count']);
  });
});
