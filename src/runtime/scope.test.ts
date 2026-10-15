import { describe, expect, it } from 'vitest';
import type { AssociationsSource, CrmPropertiesSource, CrmSearchSource, FetchSource, FunctionSource } from '../model/types';
import { evaluate } from './expr';
import { generateAssociationRows, generateSearchRows, mockDataForSource, objectTypeName, sampleValue } from './mockData';
import {
  buildBaseScope,
  buildContext,
  createInitialScope,
  initialStateValues,
  reconcileStateValues,
  resolveDataSources,
  setterName,
} from './scope';
import { makeDoc } from './testing';

const props: CrmPropertiesSource = { id: 'd_props', name: 'record', kind: 'crmProperties', properties: ['firstname', 'not_a_prop'] };
const assoc: AssociationsSource = {
  id: 'd_assoc',
  name: 'companies',
  kind: 'associations',
  toObjectType: '0-2',
  properties: ['name', 'domain'],
  pageLength: 10,
};
const search: CrmSearchSource = {
  id: 'd_search',
  name: 'deals',
  kind: 'crmSearch',
  objectType: 'deals',
  properties: ['dealname', 'amount'],
  filters: [],
  sorts: [],
  pageLength: 2,
};
const lazyFetch: FetchSource = { id: 'd_fetch', name: 'weather', kind: 'fetch', url: 'https://api.example.com', method: 'GET', runOnMount: false };
const eagerFetch: FetchSource = { ...lazyFetch, id: 'd_fetch2', name: 'quote', runOnMount: true };
const fnSource: FunctionSource = { id: 'd_fn', name: 'stats', kind: 'function', functionId: 'f_1', runOnMount: true };

describe('setterName', () => {
  it('capitalises the state name', () => {
    expect(setterName('count')).toBe('setCount');
    expect(setterName('isOpen')).toBe('setIsOpen');
  });
});

describe('buildContext', () => {
  it('combines mock context, location and extension info', () => {
    const { project, ext } = makeDoc([]);
    const ctx = buildContext(project, ext) as Record<string, any>;
    expect(ctx.user.firstName).toBe('Jordan');
    expect(ctx.user.emails).toEqual(['jordan.lee@example.com']);
    expect(ctx.portal.id).toBe(12345678);
    expect(ctx.crm).toEqual({ objectId: 51, objectTypeId: '0-1' });
    expect(ctx.location).toBe('crm.record.tab');
    expect(ctx.extension).toEqual({ appId: 1, appName: 'Test App', cardTitle: ext.name });
  });

  it('uses settings / home locations for those extension kinds', () => {
    const { project, ext } = makeDoc([], { kind: 'settings' });
    expect((buildContext(project, ext) as { location: string }).location).toBe('settings');
  });
});

describe('buildBaseScope', () => {
  it('exposes state values, setters, data sources with Loading/Error and context', () => {
    const { project, ext } = makeDoc([], {
      state: [
        { name: 'count', type: 'number', initial: 3 },
        { name: 'tags', type: 'array', initial: ['a'] },
      ],
      dataSources: [props, lazyFetch],
    });
    const calls: unknown[] = [];
    const scope = buildBaseScope({
      project,
      extension: ext,
      stateValues: initialStateValues(ext.state),
      setters: { count: (v) => calls.push(v), tags: () => {} },
      dataSources: resolveDataSources(ext, {}),
    });
    expect(scope.count).toBe(3);
    expect(scope.tags).toEqual(['a']);
    expect(typeof scope.setCount).toBe('function');
    (scope.setCount as (v: unknown) => void)(4);
    expect(calls).toEqual([4]);
    expect(scope.record).toEqual({ firstname: 'Ada', not_a_prop: null });
    expect(scope.recordLoading).toBe(false);
    expect(scope.recordError).toBeNull();
    expect(scope.weather).toBeNull();
    expect(evaluate('context.user.firstName + " " + count', scope)).toEqual({ ok: true, value: 'Jordan 3' });
  });

  it('copies initial values so runtime mutation never touches the document', () => {
    const { ext } = makeDoc([], { state: [{ name: 'tags', type: 'array', initial: ['a'] }] });
    const values = initialStateValues(ext.state);
    (values.tags as string[]).push('b');
    expect(ext.state[0].initial).toEqual(['a']);
  });

  it('createInitialScope works without a provider', () => {
    const { project, ext } = makeDoc([], { state: [{ name: 'step', type: 'number', initial: 1 }], dataSources: [eagerFetch] });
    ext.mock.dataSources[eagerFetch.id] = { text: 'hi' };
    const scope = createInitialScope(project, ext);
    expect(scope.step).toBe(1);
    expect(scope.quote).toEqual({ text: 'hi' });
    expect(() => (scope.setStep as (v: unknown) => void)(2)).not.toThrow();
  });
});

describe('data source mock data', () => {
  it('generates association results shaped like useAssociations', () => {
    const { ext } = makeDoc([]);
    const rows = generateAssociationRows(assoc, ext);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['associationTypes', 'properties', 'toObjectId']);
      expect(typeof row.toObjectId).toBe('number');
      expect(row.associationTypes.length).toBeGreaterThan(0);
      for (const t of row.associationTypes) {
        expect(typeof t.category).toBe('string');
        expect(typeof t.typeId).toBe('number');
        expect(typeof t.label).toBe('string');
      }
      expect(Object.keys(row.properties)).toEqual(['name', 'domain']);
    }
    // Companies get company names; values are deterministic.
    expect(rows[0].properties.name).toBe('Globex Corporation');
    expect(generateAssociationRows(assoc, ext)).toEqual(rows);
  });

  it('generates CRM search results shaped like useCrmSearch (capped by pageLength)', () => {
    const rows = generateSearchRows(search);
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0]).sort()).toEqual(['objectId', 'properties']);
    expect(typeof rows[0].objectId).toBe('number');
    expect(rows[0].properties.dealname).toBeTruthy();
    expect(Number(rows[0].properties.amount)).toBeGreaterThan(0);
  });

  it('prefers configured mock data and never hands out the document object', () => {
    const { ext } = makeDoc([]);
    const configured = [{ toObjectId: 7, associationTypes: [], properties: { name: 'Mine' } }];
    ext.mock.dataSources[assoc.id] = configured;
    const data = mockDataForSource(ext, assoc) as typeof configured;
    expect(data).toEqual(configured);
    expect(data).not.toBe(configured);
  });

  it('fetch / function sources are null until run unless they run on mount', () => {
    const { ext } = makeDoc([], { dataSources: [lazyFetch, eagerFetch, fnSource] });
    ext.mock.dataSources[lazyFetch.id] = { v: 1 };
    ext.mock.functions.f_1 = { total: 9 };
    const initial = resolveDataSources(ext, {});
    expect(initial[lazyFetch.id].data).toBeNull();
    expect(initial[eagerFetch.id].data).toBeNull(); // no mock configured
    expect(initial[fnSource.id].data).toEqual({ total: 9 }); // falls back to the function mock
    const afterRun = resolveDataSources(ext, { [lazyFetch.id]: { loading: false, error: null, loaded: true } });
    expect(afterRun[lazyFetch.id].data).toEqual({ v: 1 });
  });

  it('normalises object type ids and names', () => {
    expect(objectTypeName('0-1')).toBe('contacts');
    expect(objectTypeName('company')).toBe('companies');
    expect(objectTypeName('DEALS')).toBe('deals');
    expect(objectTypeName('p_my_object')).toBe('p_my_object');
  });

  it('guesses plausible values for unknown properties', () => {
    const ctx = { objectType: 'contacts', index: 0, objectId: 1 };
    expect(sampleValue('renewal_date', ctx)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(sampleValue('contract_value', ctx)).toMatch(/^\d+$/);
    expect(sampleValue('hs_object_id', ctx)).toBe('1');
  });
});

describe('reconcileStateValues', () => {
  it('keeps values of unchanged variables and re-initialises changed ones', () => {
    const before = [
      { id: 's1', name: 'count', type: 'number' as const, initial: 0 },
      { id: 's2', name: 'label', type: 'string' as const, initial: 'a' },
    ];
    const after = [
      { id: 's1', name: 'count', type: 'number' as const, initial: 0 },
      { id: 's2', name: 'label', type: 'string' as const, initial: 'b' },
      { id: 's3', name: 'extra', type: 'boolean' as const, initial: true },
    ];
    expect(reconcileStateValues(before, after, { count: 5, label: 'x' })).toEqual({ count: 5, label: 'b', extra: true });
  });
});
