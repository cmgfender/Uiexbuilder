import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { createExtension } from '../model/factory';
import type { Extension, NodeTemplate } from '../model/types';
import { findUsages, referencedIdentifiers, renameReferences, replaceIdentifiers, scanIdentifiers } from './findUsages';

function ext(content: NodeTemplate[], patch: Partial<Extension> = {}): Extension {
  return { ...createExtension({ name: 'Test', content }), ...patch };
}

function nodeByName(e: Extension, name: string) {
  return Object.values(e.nodes).find((n) => n.name === name)!;
}

const CONTENT: NodeTemplate[] = [
  { type: 'Text', name: 'label', text: 'You have {{ count }} items' },
  { type: 'Text', name: 'member', text: '{{ record.count }} and {{ "count" }} and {{ ({ count: 1 }).count }}' },
  {
    type: 'Button',
    name: 'inc',
    text: 'Add',
    events: { onClick: [{ id: 'a1', type: 'setState', state: 'count', value: 'count + 1' }] },
  },
  {
    type: 'Button',
    name: 'custom',
    text: 'Reset',
    events: { onClick: [{ id: 'a2', type: 'custom', code: 'setCount(0);\n// count in a comment' }] },
  },
  { type: 'Flex', name: 'cond', condition: 'count > 2', children: [{ type: 'Text', text: 'Many' }] },
  { type: 'Image', name: 'img', props: { src: 'https://img.example.com/{{ count }}.png', alt: 'x' } },
  { type: 'Input', name: 'email', props: { label: 'Email', name: 'email' }, binding: { state: 'email' } },
  {
    type: 'Button',
    name: 'nested',
    text: 'Go',
    events: {
      onClick: [
        {
          id: 'a3',
          type: 'if',
          condition: 'true',
          then: [{ id: 'a4', type: 'addAlert', alertType: 'info', title: 'Hi', message: '{{ deals.length }} deals' }],
          else: [{ id: 'a5', type: 'runDataSource', dataSourceId: 'd_deals' }],
        },
      ],
    },
  },
  { type: 'Text', name: 'loading', text: 'Loading: {{ dealsLoading }}' },
];

function fixture(): Extension {
  return ext(CONTENT, {
    state: [
      { id: 's1', name: 'count', type: 'number', initial: 0 },
      { id: 's2', name: 'email', type: 'string', initial: '' },
    ],
    dataSources: [
      { id: 'd_deals', kind: 'associations', name: 'deals', toObjectType: '0-3', properties: ['dealname'], pageLength: 10 },
      { id: 'd_api', kind: 'fetch', name: 'api', url: 'https://api.example.com/items/{{ count }}', method: 'GET', runOnMount: true },
    ],
    computed: [{ id: 'c1', name: 'double', expr: 'count * 2' }],
  });
}

describe('scanIdentifiers', () => {
  it('classifies references, members, keys and shorthand properties', () => {
    const kinds = scanIdentifiers('a.b + { c: d, e } + `x ${f} y` + "g" // h').map((t) => `${t.word}:${t.kind}`);
    expect(kinds).toEqual(['a:ref', 'b:member', 'c:key', 'd:ref', 'e:shorthand', 'f:ref']);
  });

  it('skips regex literals and comments', () => {
    expect([...referencedIdentifiers('/count/g.test(x) /* count */')]).toEqual(['x']);
  });

  it('keeps spread references', () => {
    expect(referencedIdentifiers('{ ...count }').has('count')).toBe(true);
  });
});

describe('findUsages', () => {
  it('finds text, events, custom code, conditions, props, bindings, data sources and computed values', () => {
    const e = fixture();
    const usages = findUsages(e, 'count');
    const byNode = (name: string) => usages.filter((u) => u.nodeId === nodeByName(e, name).id).map((u) => u.field);
    expect(byNode('label')).toEqual(['text']);
    expect(byNode('member')).toEqual([]);
    expect(byNode('inc')).toEqual(['event:onClick']);
    expect(byNode('custom')).toEqual(['event:onClick']);
    expect(byNode('cond')).toEqual(['condition']);
    expect(byNode('img')).toEqual(['prop:src']);
    expect(usages.some((u) => u.field === 'dataSource:d_api')).toBe(true);
    expect(usages.some((u) => u.field === 'computed:c1')).toBe(true);
    expect(usages.find((u) => u.field === 'computed:c1')?.location).toBe('Computed value “double”');
  });

  it('finds two-way bindings', () => {
    const e = fixture();
    const usages = findUsages(e, 'email');
    expect(usages).toEqual([expect.objectContaining({ nodeId: nodeByName(e, 'email').id, field: 'binding' })]);
  });

  it('finds data sources through derived names and runDataSource actions', () => {
    const e = fixture();
    const usages = findUsages(e, 'deals');
    expect(usages.map((u) => u.nodeId)).toEqual([nodeByName(e, 'nested').id, nodeByName(e, 'loading').id]);
  });

  it('returns nothing for unused names', () => {
    expect(findUsages(fixture(), 'unused')).toEqual([]);
    expect(findUsages(fixture(), '')).toEqual([]);
  });

  it('uses readable locations', () => {
    const e = fixture();
    const loc = findUsages(e, 'count').find((u) => u.nodeId === nodeByName(e, 'cond').id)?.location;
    expect(loc).toBe('cond · Show when');
  });
});

describe('replaceIdentifiers', () => {
  const map = new Map([
    ['count', 'total'],
    ['setCount', 'setTotal'],
  ]);
  it('renames references only', () => {
    expect(replaceIdentifiers('count + record.count + "count"', map)).toBe('total + record.count + "count"');
    expect(replaceIdentifiers('setCount(count + 1)', map)).toBe('setTotal(total + 1)');
    expect(replaceIdentifiers('`n=${count}`', map)).toBe('`n=${total}`');
  });
  it('keeps object keys and shorthand keys', () => {
    expect(replaceIdentifiers('{ count: count }', map)).toBe('{ count: total }');
    expect(replaceIdentifiers('{ a: 1, count }', map)).toBe('{ a: 1, count: total }');
  });
  it('returns the input unchanged when nothing matches', () => {
    const code = 'foo(bar)';
    expect(replaceIdentifiers(code, map)).toBe(code);
  });
});

describe('renameReferences', () => {
  it('renames a state variable everywhere (bindings, setState, templates, custom code, sources, computed)', () => {
    const e = fixture();
    let changed = 0;
    const next = produce(e, (d) => {
      changed = renameReferences(d as Extension, 'count', 'total');
    });
    expect(changed).toBeGreaterThan(5);
    expect(nodeByName(next, 'label').text).toBe('You have {{ total }} items');
    expect(nodeByName(next, 'member').text).toBe(nodeByName(e, 'member').text);
    const inc = nodeByName(next, 'inc').events!.onClick[0];
    expect(inc).toMatchObject({ type: 'setState', state: 'total', value: 'total + 1' });
    expect(nodeByName(next, 'custom').events!.onClick[0]).toMatchObject({ code: 'setTotal(0);\n// count in a comment' });
    expect(nodeByName(next, 'cond').condition).toBe('total > 2');
    expect(nodeByName(next, 'img').props.src).toBe('https://img.example.com/{{ total }}.png');
    expect(next.dataSources.find((d) => d.id === 'd_api')).toMatchObject({ url: 'https://api.example.com/items/{{ total }}' });
    expect(next.computed![0].expr).toBe('total * 2');
    expect(findUsages(next, 'count')).toEqual([]);
  });

  it('renames bindings and derived data source names', () => {
    const e = fixture();
    const next = produce(e, (d) => {
      renameReferences(d as Extension, 'email', 'workEmail');
      renameReferences(d as Extension, 'deals', 'openDeals');
    });
    expect(nodeByName(next, 'email').binding).toEqual({ state: 'workEmail' });
    expect(nodeByName(next, 'loading').text).toBe('Loading: {{ openDealsLoading }}');
    const ifStep = nodeByName(next, 'nested').events!.onClick[0];
    expect(ifStep.type === 'if' && ifStep.then[0]).toMatchObject({ message: '{{ openDeals.length }} deals' });
  });

  it('is a no-op for identical names', () => {
    const e = fixture();
    expect(renameReferences(e, 'count', 'count')).toBe(0);
  });
});
