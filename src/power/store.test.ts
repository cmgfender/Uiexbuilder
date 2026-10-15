import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../model/factory';
import { selectActiveExtension, useEditor } from '../model/store';

const ext = () => selectActiveExtension(useEditor.getState());
const s = () => useEditor.getState();

beforeEach(() => {
  s().loadProject(createProject('Store Test'));
});

describe('computed value store actions', () => {
  it('addComputed creates unique valid names avoiding state, data, computed and helpers', () => {
    s().addStateVar({ name: 'total', type: 'number', initial: 0 });
    s().setHelpers('function computed() {}');
    const a = s().addComputed();
    const b = s().addComputed({ name: 'total', expr: 'total * 2' });
    const c = s().addComputed({ name: 'My value!', description: 'note' });
    expect(a.name).toBe('computed2');
    expect(b).toMatchObject({ name: 'total2', expr: 'total * 2' });
    expect(c).toMatchObject({ name: 'myValue', description: 'note', expr: '' });
    expect(a.id).toMatch(/^c_/);
    expect(ext().computed!.map((x) => x.name)).toEqual(['computed2', 'total2', 'myValue']);
  });

  it('updateComputed patches fields and coalesces rapid edits into one undo step', () => {
    const c = s().addComputed({ name: 'x' });
    const before = s().past.length;
    s().updateComputed(c.id, { expr: '1' });
    s().updateComputed(c.id, { expr: '1 +' });
    s().updateComputed(c.id, { expr: '1 + 2' });
    expect(ext().computed![0].expr).toBe('1 + 2');
    expect(s().past.length).toBe(before + 1);
    s().updateComputed(c.id, { description: 'hello' });
    expect(ext().computed![0].description).toBe('hello');
    s().updateComputed(c.id, { description: '' });
    expect('description' in ext().computed![0]).toBe(false);
    // Both description edits were one burst: a single undo reverts them, the next the expression.
    s().undo();
    expect(ext().computed![0]).toMatchObject({ expr: '1 + 2' });
    expect(ext().computed![0].description).toBeUndefined();
    s().undo();
    expect(ext().computed![0].expr).toBe('');
  });

  it('moveComputed reorders and removeComputed deletes (dropping the empty list)', () => {
    const a = s().addComputed({ name: 'a' });
    const b = s().addComputed({ name: 'b' });
    const c = s().addComputed({ name: 'c' });
    s().moveComputed(c.id, 0);
    expect(ext().computed!.map((x) => x.name)).toEqual(['c', 'a', 'b']);
    s().moveComputed(c.id, 99);
    expect(ext().computed!.map((x) => x.name)).toEqual(['a', 'b', 'c']);
    s().removeComputed(b.id);
    s().removeComputed(a.id);
    s().removeComputed(c.id);
    expect(ext().computed).toBeUndefined();
    s().undo();
    expect(ext().computed!.map((x) => x.name)).toEqual(['c']);
  });

  it('setHelpers coalesces typing and removes empty code', () => {
    const before = s().past.length;
    s().setHelpers('f');
    s().setHelpers('fu');
    s().setHelpers('function f() {}');
    expect(ext().helpers).toBe('function f() {}');
    expect(s().past.length).toBe(before + 1);
    s().setHelpers('  ');
    expect(ext().helpers).toBeUndefined();
  });

  it('duplicateExtension copies computed values and helpers', () => {
    s().addComputed({ name: 'answer', expr: '42' });
    s().setHelpers('const k = 1;');
    const id = s().duplicateExtension(ext().id)!;
    const copy = s().project.extensions.find((e) => e.id === id)!;
    expect(copy.computed?.map((c) => c.name)).toEqual(['answer']);
    expect(copy.helpers).toBe('const k = 1;');
  });
});
