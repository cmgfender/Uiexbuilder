import { beforeEach, describe, expect, it } from 'vitest';
import { createExtension, createProject } from './factory';
import { allHaveText, commonPropDefs, sharedProp, sharedText } from './settings';
import { selectActiveExtension, useEditor } from './store';
import type { NodeTemplate, UINode } from './types';

function load(content: NodeTemplate[]) {
  const ext = createExtension({ kind: 'card', name: 'Card', content });
  useEditor.getState().loadProject(createProject('App', [ext]));
}
const ext = () => selectActiveExtension(useEditor.getState());
const top = (i: number): UINode => {
  const e = ext();
  return e.nodes[e.nodes[e.rootId].children[i]];
};

describe('copy / paste settings', () => {
  beforeEach(() =>
    load([
      { type: 'Button', props: { variant: 'primary', size: 'sm', testId: 'save' }, text: 'Save {{ 1 }}' },
      { type: 'Button', props: { variant: 'secondary', disabled: true, testId: 'other' }, text: 'Cancel' },
      { type: 'Link', props: { href: 'https://x.test' }, text: 'Docs' },
      { type: 'Input', props: { label: 'Email', name: 'email', required: true } },
      { type: 'Input', props: { label: 'Phone', name: 'phone' } },
    ]),
  );

  it('copies props, rules and text, but not ids', () => {
    const s = useEditor.getState();
    useEditor.getState().setProp(top(0).id, 'disabled', { $expr: '(count) >= 3 ? true : false' });
    const clip = s.copySettings(top(0).id)!;
    expect(clip).toMatchObject({ type: 'Button', props: { variant: 'primary', size: 'sm', disabled: { $expr: '(count) >= 3 ? true : false' } }, text: 'Save {{ 1 }}' });
    expect(clip.props.testId).toBeUndefined();
    expect(useEditor.getState().settingsClipboard).toBe(clip);
  });

  it('pastes onto every component of the same type in one undo step', () => {
    const s = useEditor.getState();
    s.copySettings(top(0).id);
    const before = useEditor.getState().past.length;
    expect(useEditor.getState().pasteSettings([top(1).id, top(2).id])).toBe(1);
    expect(top(1).props).toEqual({ variant: 'primary', size: 'sm', testId: 'other' });
    expect(top(1).text).toBe('Save {{ 1 }}');
    expect(top(2).props).toEqual({ href: 'https://x.test' }); // a Link is not a Button
    expect(useEditor.getState().past.length).toBe(before + 1);
    useEditor.getState().undo();
    expect(top(1).props).toEqual({ variant: 'secondary', disabled: true, testId: 'other' });
  });

  it('keeps an input’s own form name', () => {
    const s = useEditor.getState();
    s.copySettings(top(3).id);
    s.pasteSettings([top(4).id]);
    expect(top(4).props).toEqual({ label: 'Email', name: 'phone', required: true });
  });

  it('pastes copies, not shared objects', () => {
    useEditor.getState().setProp(top(0).id, 'variant', { $expr: 'v' });
    useEditor.getState().copySettings(top(0).id);
    useEditor.getState().pasteSettings([top(1).id]);
    expect(top(1).props.variant).toEqual({ $expr: 'v' });
    expect(top(1).props.variant).not.toBe(top(0).props.variant);
  });
});

describe('multi-selection', () => {
  beforeEach(() =>
    load([
      { type: 'Button', props: { variant: 'primary' }, text: 'A' },
      { type: 'Button', props: { variant: 'primary' }, text: 'B' },
      { type: 'Button', props: { variant: 'secondary' }, text: 'B' },
      { type: 'Link', props: { variant: 'primary' }, text: 'L' },
    ]),
  );

  it('adds and removes nodes; a plain select clears it', () => {
    const s = useEditor.getState();
    s.select(top(0).id);
    s.toggleSelection(top(1).id);
    expect(useEditor.getState()).toMatchObject({ selectedNodeId: top(1).id, selectedNodeIds: [top(0).id, top(1).id] });
    s.toggleSelection(top(2).id);
    s.toggleSelection(top(1).id);
    expect(useEditor.getState()).toMatchObject({ selectedNodeId: top(2).id, selectedNodeIds: [top(0).id, top(2).id] });
    s.toggleSelection(top(0).id);
    expect(useEditor.getState()).toMatchObject({ selectedNodeId: top(2).id, selectedNodeIds: [] });
    s.selectMany([top(0).id, top(1).id, ext().rootId]);
    expect(useEditor.getState().selectedNodeIds).toEqual([top(0).id, top(1).id]);
    s.select(top(3).id);
    expect(useEditor.getState().selectedNodeIds).toEqual([]);
  });

  it('drops deleted nodes from the selection', () => {
    const s = useEditor.getState();
    s.selectMany([top(0).id, top(1).id, top(2).id]);
    const gone = top(1).id;
    s.removeNode(gone);
    expect(useEditor.getState().selectedNodeIds).not.toContain(gone);
    expect(useEditor.getState().selectedNodeIds).toHaveLength(2);
  });

  it('edits a shared setting on all of them', () => {
    const ids = [top(0).id, top(1).id, top(2).id];
    const nodes = ids.map((id) => ext().nodes[id]);
    expect(sharedProp(nodes, 'variant')).toEqual({ mixed: true });
    expect(sharedText(nodes.slice(1))).toEqual({ mixed: false, value: 'B' });
    useEditor.getState().setPropsMany(ids, { variant: 'destructive' });
    useEditor.getState().setTextMany(ids, 'Go');
    expect(ids.map((id) => [ext().nodes[id].props.variant, ext().nodes[id].text])).toEqual([
      ['destructive', 'Go'],
      ['destructive', 'Go'],
      ['destructive', 'Go'],
    ]);
    useEditor.getState().setPropsMany(ids, { variant: undefined });
    expect(ids.every((id) => !('variant' in ext().nodes[id].props))).toBe(true);
  });

  it('knows which settings different components share', () => {
    const buttons = [top(0), top(1)];
    expect(commonPropDefs(buttons).map((p) => p.name)).toContain('variant');
    const mixed = commonPropDefs([top(0), top(3)]).map((p) => p.name);
    // Button and Link variants have different options, so they are not shared.
    expect(mixed).not.toContain('variant');
    expect(allHaveText([top(0), top(3)])).toBe(true);
  });
});
