import { describe, expect, it } from 'vitest';
import { createExtension } from '../model/factory';
import type { Extension } from '../model/types';
import { buildPreviewScope, listScopeVariables, safeEvaluate } from './scope';

function fixture(): { ext: Extension; inner: string; outer: string } {
  const ext = createExtension({
    content: [
      {
        type: 'Flex',
        repeat: { items: 'deals', itemName: 'deal', indexName: 'i' },
        children: [
          {
            type: 'Flex',
            repeat: { items: 'deal.contacts', itemName: 'contact', indexName: 'j' },
            children: [{ type: 'Text', text: 'x' }],
          },
        ],
      },
    ],
  });
  ext.state = [
    { id: 's1', name: 'count', type: 'number', initial: 1 },
    { id: 's2', name: 'deals', type: 'array', initial: [{ name: 'A', contacts: ['x', 'y'] }] },
  ];
  ext.computed = [{ id: 'c1', name: 'double', expr: 'count * 2' }];
  ext.helpers = 'function money(v) { return "$" + v; }\nconst TAX = 0.2;';
  ext.dataSources = [
    { id: 'd1', name: 'record', kind: 'crmProperties', properties: ['firstname', 'lastname'] },
    { id: 'd2', name: 'companies', kind: 'associations', toObjectType: '0-2', properties: ['name'], pageLength: 10 },
    { id: 'd3', name: 'api', kind: 'fetch', url: 'https://x.test', method: 'GET', runOnMount: true },
  ];
  const root = ext.nodes[ext.rootId];
  const outer = root.children[0];
  const middle = ext.nodes[outer].children[0];
  const inner = ext.nodes[middle].children[0];
  return { ext, inner, outer };
}

describe('listScopeVariables', () => {
  it('lists state, setters, computed, helpers, data sources and context', () => {
    const { ext } = fixture();
    const vars = listScopeVariables(ext);
    const byName = new Map(vars.map((v) => [v.name, v]));
    expect(byName.get('count')).toMatchObject({ kind: 'state', detail: 'number' });
    expect(byName.get('setCount')).toMatchObject({ kind: 'setter' });
    expect(byName.get('double')).toMatchObject({ kind: 'computed' });
    expect(byName.get('money')).toMatchObject({ kind: 'helper' });
    expect(byName.get('TAX')).toMatchObject({ kind: 'helper' });
    expect(byName.get('record')).toMatchObject({ kind: 'dataSource' });
    expect(byName.get('record.firstname')).toMatchObject({ kind: 'property' });
    expect(byName.get('recordLoading')).toMatchObject({ kind: 'dataSource', detail: 'boolean' });
    expect(byName.get('recordError')).toMatchObject({ kind: 'dataSource' });
    expect(byName.get('companies')?.detail).toMatch(/array/);
    expect(byName.get('companies.length')).toBeDefined();
    expect(byName.get('api')).toBeDefined();
    expect(byName.get('context.user.firstName')).toMatchObject({ kind: 'context' });
    expect(byName.get('context.crm.objectId')).toBeDefined();
    expect(byName.get('context.location')).toBeDefined();
  });

  it('includes repeat variables of the node and its ancestors', () => {
    const { ext, inner, outer } = fixture();
    const names = listScopeVariables(ext, inner)
      .filter((v) => v.kind === 'repeat')
      .map((v) => v.name);
    expect(names).toEqual(['contact', 'j', 'deal', 'i']);
    expect(
      listScopeVariables(ext, outer)
        .filter((v) => v.kind === 'repeat')
        .map((v) => v.name),
    ).toEqual(['deal', 'i']);
    expect(listScopeVariables(ext, null).some((v) => v.kind === 'repeat')).toBe(false);
  });

  it('lists event params first', () => {
    const { ext } = fixture();
    const vars = listScopeVariables(ext, null, ['value', 'event']);
    expect(vars.slice(0, 2)).toEqual([
      { name: 'value', kind: 'param', detail: 'event parameter' },
      { name: 'event', kind: 'param', detail: 'event parameter' },
    ]);
  });
});

describe('buildPreviewScope', () => {
  it('adds helpers, computed values and the first repeat items; neutralises setters', () => {
    const { ext, inner } = fixture();
    const calls: unknown[] = [];
    const base = { count: 3, deals: [{ name: 'A', contacts: ['x', 'y'] }], setCount: (v: unknown) => calls.push(v) };
    const scope = buildPreviewScope(ext, base, inner);
    expect(scope.double).toBe(6);
    expect((scope.money as (v: number) => string)(5)).toBe('$5');
    expect(scope.deal).toEqual({ name: 'A', contacts: ['x', 'y'] });
    expect(scope.contact).toBe('x');
    expect(scope.j).toBe(0);
    (scope.setCount as (v: unknown) => void)(9);
    expect(calls).toEqual([]);
  });

  it('skips previews for code with side effects or loops', () => {
    expect(safeEvaluate('alert(1)', {})).toBeNull();
    expect(safeEvaluate('(() => { while (true) {} })()', {})).toBeNull();
    expect(safeEvaluate('window.location', {})).toBeNull();
    expect(safeEvaluate('context.location', { context: { location: 'crm.record.tab' } })).toEqual({ ok: true, value: 'crm.record.tab' });
    expect(safeEvaluate("'fetch(' + 1", {})).toEqual({ ok: true, value: 'fetch(1' });
  });
});
