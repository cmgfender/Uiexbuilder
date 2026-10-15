import { describe, expect, it } from 'vitest';
import { generateExtensionSource } from '../codegen';
import { createExtension, createProject } from '../model/factory';
import { formatDiagnostics, scratchDir, typecheck, writeFiles } from '../test/typecheck';
import { canAccept } from '../model/rules';
import { insertSubtree, instantiateTemplate, walk } from '../model/tree';
import type { DataSource, Extension, NodeTemplate } from '../model/types';
import { getComponent } from '../registry';
import { accessPath, generateUiForSource, generatedRootType } from './generators';

const SOURCES: DataSource[] = [
  { id: 'd1', kind: 'crmProperties', name: 'record', properties: ['firstname', 'hs_lead_status', 'custom-prop'] },
  { id: 'd2', kind: 'associations', name: 'deals', toObjectType: '0-3', properties: ['dealname', 'amount'], pageLength: 10 },
  { id: 'd3', kind: 'crmSearch', name: 'tickets', objectType: '0-5', properties: [], filters: [], sorts: [], pageLength: 5 },
  { id: 'd4', kind: 'fetch', name: 'api', url: 'https://api.example.com', method: 'GET', runOnMount: true },
  { id: 'd5', kind: 'function', name: 'quote', functionId: 'f1', runOnMount: false },
  { id: 'd6', kind: 'crmProperties', name: 'empty', properties: [] },
];

/** Inserts the template at the end of the root and checks every node against the placement rules. */
function insertAndCheck(tpl: NodeTemplate, kind: 'card' | 'settings' = 'card'): Extension {
  const ext = createExtension({ kind, objectTypes: ['contacts'] });
  expect(canAccept(ext, ext.rootId, tpl.type).ok).toBe(true);
  const sub = instantiateTemplate(tpl);
  insertSubtree(ext, sub, { parentId: ext.rootId, index: 0 });
  walk(ext, (node, _depth, parent) => {
    if (!parent) return;
    const check = canAccept(ext, parent.parentId, node.type, parent.slot, node.id);
    expect(check, `${node.type} in ${ext.nodes[parent.parentId].type}`).toEqual({ ok: true });
    const def = getComponent(node.type)!;
    for (const p of def.props.filter((x) => x.required)) {
      expect(node.props[p.name], `${node.type}.${p.name} is required`).toBeDefined();
    }
    if (def.children.mode === 'nodes' && def.children.required) {
      expect(node.children.length, `${node.type} needs children`).toBeGreaterThan(0);
    }
    if (def.children.mode === 'text') expect(typeof node.text).toBe('string');
  });
  return ext;
}

function findAll(tpl: NodeTemplate, type: string): NodeTemplate[] {
  const out: NodeTemplate[] = [];
  const visit = (t: NodeTemplate) => {
    if (t.type === type) out.push(t);
    t.children?.forEach(visit);
  };
  visit(tpl);
  return out;
}

describe('generateUiForSource', () => {
  it.each(SOURCES.map((s) => [s.kind + ':' + s.name, s] as const))('%s satisfies placement rules and required props', (_l, ds) => {
    const tpl = generateUiForSource(ds, ['contacts']);
    expect(tpl.type).toBe(generatedRootType(ds));
    insertAndCheck(tpl);
    insertAndCheck(tpl, 'settings');
  });

  it('crmProperties -> DescriptionList with a humanised label and template per property', () => {
    const tpl = generateUiForSource(SOURCES[0], ['contacts']);
    expect(tpl.type).toBe('Flex');
    const list = findAll(tpl, 'DescriptionList')[0];
    expect(list.condition).toBe('!recordLoading && !recordError');
    const items = list.children!;
    expect(items.map((i) => i.props?.label)).toEqual(['First name', 'Lead status', 'Custom prop']);
    expect(items.map((i) => i.children![0])).toEqual([
      { type: 'Text', text: '{{ record.firstname }}' },
      { type: 'Text', text: '{{ record.hs_lead_status }}' },
      { type: 'Text', text: '{{ record["custom-prop"] }}' },
    ]);
  });

  it('crmProperties without properties still produces a valid list', () => {
    const tpl = generateUiForSource(SOURCES[5]);
    const list = findAll(tpl, 'DescriptionList')[0];
    expect(list.children).toHaveLength(1);
    expect(list.children![0].children![0].text).toBe('{{ JSON.stringify(empty) }}');
  });

  it.each(SOURCES.map((s) => [s.kind + ':' + s.name, s] as const))('%s covers loading and error states', (_l, ds) => {
    const tpl = generateUiForSource(ds, ['contacts']);
    expect(tpl.children![0]).toMatchObject({ type: 'LoadingSpinner', condition: `${ds.name}Loading` });
    const alert = findAll(tpl, 'Alert')[0];
    expect(alert).toMatchObject({ props: { variant: 'error' }, text: `{{ ${ds.name}Error }}`, condition: `!${ds.name}Loading && ${ds.name}Error` });
    expect(String(alert.props?.title)).toMatch(/^Couldn’t /);
    // A way to retry: "Try again" next to the error, or the block's own Reload button.
    const retry = findAll(tpl, 'Button').find((b) => b.condition === alert.condition || b.text === 'Reload')!;
    expect(retry.events?.onClick).toEqual([expect.objectContaining({ type: 'runDataSource', dataSourceId: ds.id })]);
    // The data itself only shows once loaded without an error.
    for (const child of tpl.children!.slice(1)) {
      if (child === alert || child.type === 'Button') continue;
      expect(child.condition, child.type).toMatch(new RegExp(`^!${ds.name}Loading && !${ds.name}Error`));
    }
  });

  it('associations -> table repeating over results with loading, error and empty states', () => {
    const tpl = generateUiForSource(SOURCES[1]);
    const spinner = findAll(tpl, 'LoadingSpinner')[0];
    expect(spinner.condition).toBe('dealsLoading');
    expect(findAll(tpl, 'Alert')[0]).toMatchObject({ props: { title: 'Couldn’t load associated deals' }, condition: '!dealsLoading && dealsError' });
    expect(findAll(tpl, 'Button')[0]).toMatchObject({ text: 'Try again', condition: '!dealsLoading && dealsError' });
    const empty = findAll(tpl, 'EmptyState')[0];
    // A failed request is not "no associated deals".
    expect(empty.condition).toBe('!dealsLoading && !dealsError && deals.length === 0');
    expect(empty.props?.title).toBe('No associated deals');
    const headers = findAll(tpl, 'TableHeader').map((h) => h.text);
    expect(headers).toEqual(['Deal name', 'Amount']);
    const rows = findAll(tpl, 'TableRow');
    const bodyRow = rows.find((r) => r.repeat)!;
    expect(bodyRow.repeat).toEqual({ items: 'deals', itemName: 'item', indexName: 'index', key: 'item.toObjectId' });
    expect(findAll(bodyRow, 'Text').map((t) => t.text)).toEqual(['{{ item.properties.dealname }}', '{{ item.properties.amount }}']);
    expect(findAll(tpl, 'Table')[0].condition).toBe('!dealsLoading && !dealsError && deals.length > 0');
  });

  it('crmSearch without properties shows the record id column', () => {
    const tpl = generateUiForSource(SOURCES[2]);
    expect(findAll(tpl, 'TableHeader').map((h) => h.text)).toEqual(['Record ID']);
    const bodyRow = findAll(tpl, 'TableRow').find((r) => r.repeat)!;
    expect(bodyRow.repeat?.key).toBe('item.objectId');
    expect(findAll(bodyRow, 'Text')[0].text).toBe('{{ item.objectId }}');
    expect(findAll(tpl, 'EmptyState')[0].condition).toBe('!ticketsLoading && !ticketsError && tickets.length === 0');
    expect(findAll(tpl, 'Alert')[0].props?.title).toBe('Couldn’t search tickets');
  });

  it('fetch / function -> error alert, JSON text and a Reload button running the source', () => {
    for (const ds of [SOURCES[3], SOURCES[4]]) {
      const tpl = generateUiForSource(ds);
      expect(findAll(tpl, 'Text')[0]).toMatchObject({ text: `{{ JSON.stringify(${ds.name}) }}`, condition: `!${ds.name}Loading && !${ds.name}Error` });
      const button = findAll(tpl, 'Button')[0];
      expect(button.text).toBe('Reload');
      expect(button.condition).toBeUndefined();
      expect(button.events?.onClick).toEqual([expect.objectContaining({ type: 'runDataSource', dataSourceId: ds.id })]);
    }
    expect(findAll(generateUiForSource(SOURCES[3]), 'Alert')[0].props?.title).toBe('Couldn’t load api');
    expect(findAll(generateUiForSource(SOURCES[4]), 'Alert')[0].props?.title).toBe('Couldn’t run quote');
  });
});

describe('generated blocks in generated code', () => {
  it('type-check against @hubspot/ui-extensions', () => {
    const sources = SOURCES.filter((s) => s.name !== 'empty');
    const ext = createExtension({
      name: 'Generated',
      objectTypes: ['contacts'],
      content: sources.map((ds) => generateUiForSource(ds, ['contacts'])),
    });
    ext.dataSources = sources;
    const project = createProject('Gen App', [ext]);
    project.functions = [{ id: 'f1', uid: 'quote_fn', fileName: 'quote', code: 'exports.main = async () => ({});', secretKeys: [] }];
    const source = generateExtensionSource(project, ext);
    const dir = scratchDir('panels-generators');
    const paths = writeFiles(dir, [{ path: 'Generated.tsx', contents: source }]);
    expect(formatDiagnostics(typecheck(paths))).toBe('');
  });
});

describe('accessPath', () => {
  it('uses dot access for identifiers and brackets otherwise', () => {
    expect(accessPath('a', 'b_c')).toBe('a.b_c');
    expect(accessPath('a', 'b-c')).toBe('a["b-c"]');
    expect(accessPath('a', '1x')).toBe('a["1x"]');
  });
});
