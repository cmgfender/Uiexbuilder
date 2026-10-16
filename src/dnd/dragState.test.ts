import { describe, expect, it } from 'vitest';
import { createExtension } from '../model/factory';
import { getComponent } from '../registry';
import type { Extension, NodeTemplate, UINode } from '../model/types';
import { formActionsStart, isFullWidthComponent, smartInsertTarget } from './dragState';

function doc(content: NodeTemplate[]): Extension {
  return createExtension({ content });
}

function byName(ext: Extension, name: string): UINode {
  const node = Object.values(ext.nodes).find((n) => n.name === name);
  if (!node) throw new Error(`no node ${name}`);
  return node;
}

const submit = (name = 'submit'): NodeTemplate => ({ type: 'Button', name, props: { type: 'submit', variant: 'primary' }, text: 'Submit' });

describe('smartInsertTarget', () => {
  it('into a selected container (at the end), else after the selection, else at the end of the root', () => {
    const ext = doc([
      { type: 'Flex', name: 'col', children: [{ type: 'Text', name: 'a', text: 'A' }] },
      { type: 'Text', name: 'b', text: 'B' },
    ]);
    const col = byName(ext, 'col');
    expect(smartInsertTarget(ext, col.id, 'Text')).toEqual({ parentId: col.id, index: 1 });
    expect(smartInsertTarget(ext, byName(ext, 'a').id, 'Text')).toEqual({ parentId: col.id, index: 1 });
    expect(smartInsertTarget(ext, byName(ext, 'b').id, 'Text')).toEqual({ parentId: ext.rootId, index: 2 });
    expect(smartInsertTarget(ext, null, 'Text')).toEqual({ parentId: ext.rootId, index: 2 });
    // Nowhere accepts a Tab without Tabs.
    expect(smartInsertTarget(ext, null, 'Tab')).toBeNull();
  });

  it('nothing selected: the end of the card’s main column (a single Flex column under the root)', () => {
    const ext = doc([{ type: 'Flex', name: 'main', props: { direction: 'column' }, children: [{ type: 'Text', name: 'a', text: 'A' }] }]);
    expect(smartInsertTarget(ext, null, 'Table')).toEqual({ parentId: byName(ext, 'main').id, index: 1 });
    // A row at the root is not a main column: the end of the root.
    const row = doc([{ type: 'Flex', name: 'row', children: [{ type: 'Text', text: 'A' }] }]);
    expect(smartInsertTarget(row, null, 'Text')).toEqual({ parentId: row.rootId, index: 1 });
  });

  it('full-width components never squeeze into a row next to the selection (e.g. a name beside a status tag)', () => {
    const ext = doc([
      {
        type: 'Flex',
        name: 'main',
        props: { direction: 'column' },
        children: [
          {
            type: 'Flex',
            name: 'header',
            props: { direction: 'row', justify: 'between' },
            children: [
              { type: 'Flex', name: 'titles', props: { direction: 'column' }, children: [{ type: 'Heading', name: 'name', text: 'Ada' }] },
              { type: 'StatusTag', name: 'stage', text: 'Customer' },
            ],
          },
          { type: 'Text', name: 'body', text: 'Body' },
        ],
      },
    ]);
    const main = byName(ext, 'main').id;
    // A table after the name goes after the header row, in the main column.
    expect(smartInsertTarget(ext, byName(ext, 'name').id, 'Table')).toEqual({ parentId: main, index: 1 });
    expect(smartInsertTarget(ext, byName(ext, 'name').id, 'CrmAssociationTable')).toEqual({ parentId: main, index: 1 });
    expect(smartInsertTarget(ext, byName(ext, 'stage').id, 'DescriptionList')).toEqual({ parentId: main, index: 1 });
    // Small things still go right next to the selection.
    expect(smartInsertTarget(ext, byName(ext, 'name').id, 'Text')).toEqual({ parentId: byName(ext, 'titles').id, index: 1 });
    expect(smartInsertTarget(ext, byName(ext, 'stage').id, 'Tag')).toEqual({ parentId: byName(ext, 'header').id, index: 2 });
  });

  it('a deliberate columns layout keeps full-width content in the selected column', () => {
    const ext = doc([
      {
        type: 'Flex',
        name: 'columns',
        props: { direction: 'row' },
        children: [
          { type: 'Flex', name: 'left', props: { direction: 'column' }, children: [{ type: 'Text', name: 'l', text: 'L' }] },
          { type: 'Box', name: 'right', children: [{ type: 'Text', name: 'r', text: 'R' }] },
        ],
      },
    ]);
    expect(smartInsertTarget(ext, byName(ext, 'l').id, 'Table')).toEqual({ parentId: byName(ext, 'left').id, index: 1 });
    // …but not as a third column next to them.
    expect(smartInsertTarget(ext, byName(ext, 'left').id, 'Table')).toEqual({ parentId: byName(ext, 'left').id, index: 1 });
    expect(isFullWidthComponent('Table')).toBe(true);
    expect(isFullWidthComponent('Button')).toBe(false);
  });

  it('adding to the registry Form goes into its fields Flex, before the Submit button', () => {
    const form = getComponent('Form')!.create!();
    const ext = doc([{ ...form, name: 'form' }]);
    const formNode = byName(ext, 'form');
    const flex = ext.nodes[formNode.children[0]];
    expect(flex.type).toBe('Flex');
    const submitIndex = flex.children.findIndex((id) => ext.nodes[id].type === 'Button');
    expect(submitIndex).toBe(2);
    expect(smartInsertTarget(ext, formNode.id, 'TextArea')).toEqual({ parentId: flex.id, index: submitIndex });
    // Also when the Flex inside the form is selected.
    expect(smartInsertTarget(ext, flex.id, 'TextArea')).toEqual({ parentId: flex.id, index: submitIndex });
    // ...and when the Submit button itself is selected (a field never lands after it).
    expect(smartInsertTarget(ext, flex.children[submitIndex], 'Select')).toEqual({ parentId: flex.id, index: submitIndex });
    // After a selected field: right after it.
    expect(smartInsertTarget(ext, flex.children[0], 'Input')).toEqual({ parentId: flex.id, index: 1 });
    // Buttons still go where asked (after the selection / at the end).
    expect(smartInsertTarget(ext, formNode.id, 'Button')).toEqual({ parentId: flex.id, index: 3 });
  });

  it('keeps a Cancel button next to Submit and treats a ButtonRow with a submit as the action area', () => {
    const ext = doc([
      {
        type: 'Form',
        name: 'form',
        children: [
          {
            type: 'Flex',
            name: 'fields',
            props: { direction: 'column' },
            children: [{ type: 'Input', name: 'email', props: { label: 'Email', name: 'email' } }],
          },
          { type: 'ButtonRow', name: 'actions', children: [submit(), { type: 'Button', name: 'cancel', text: 'Cancel' }] },
        ],
      },
      {
        type: 'Form',
        name: 'flat',
        children: [
          { type: 'Input', name: 'x', props: { label: 'X', name: 'x' } },
          { type: 'Button', name: 'cancel2', text: 'Cancel' },
          submit('submit2'),
        ],
      },
    ]);
    const form = byName(ext, 'form');
    const fields = byName(ext, 'fields');
    expect(formActionsStart(ext, form.id)).toBe(1);
    expect(smartInsertTarget(ext, form.id, 'Checkbox')).toEqual({ parentId: fields.id, index: 1 });
    expect(smartInsertTarget(ext, byName(ext, 'cancel').id, 'Text')).toEqual({ parentId: form.id, index: 1 });

    const flat = byName(ext, 'flat');
    // Cancel right before Submit belongs to the action area.
    expect(formActionsStart(ext, flat.id)).toBe(1);
    expect(smartInsertTarget(ext, flat.id, 'Input')).toEqual({ parentId: flat.id, index: 1 });
  });

  it('outside forms nothing changes: a trailing button in a plain Flex is not special', () => {
    const ext = doc([{ type: 'Flex', name: 'col', children: [{ type: 'Text', name: 't', text: 'T' }, submit()] }]);
    const col = byName(ext, 'col');
    expect(formActionsStart(ext, col.id)).toBe(1);
    expect(smartInsertTarget(ext, col.id, 'Input')).toEqual({ parentId: col.id, index: 2 });
  });

  it('an empty Form receives the first field directly', () => {
    const ext = doc([{ type: 'Form', name: 'form' }]);
    const form = byName(ext, 'form');
    expect(smartInsertTarget(ext, form.id, 'Input')).toEqual({ parentId: form.id, index: 0 });
  });
});
