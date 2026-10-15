import { describe, expect, it } from 'vitest';
import { createExtension } from '../model/factory';
import type { Extension } from '../model/types';
import { COMMON_PROPERTIES, objectTypeKey, objectTypeLabel, propertyLabel, propertySuggestions } from './crmProperties';
import { summarizeDataSource } from './dataSourceMeta';
import { declaredNames, uniqueDeclaredName, validateDeclaredName } from './names';
import { createProject } from '../model/factory';
import {
  checkFunctionSyntax,
  convertInitial,
  defaultEndpointPath,
  extensionFileNameError,
  functionFileNameError,
  projectUidError,
  validateEndpointPath,
  formatRelativeTime,
  previewValue,
  validateEmail,
  validatePermittedUrl,
  validatePhone,
  validateProjectSlug,
  validateUid,
} from './utils';

function ext(): Extension {
  return {
    ...createExtension({ name: 'Names' }),
    state: [{ id: 's1', name: 'count', type: 'number', initial: 0 }],
    dataSources: [
      { id: 'd1', kind: 'crmProperties', name: 'record', properties: [] },
      { id: 'd2', kind: 'fetch', name: 'api', url: '', method: 'GET', runOnMount: true },
    ],
    computed: [{ id: 'c1', name: 'total', expr: '1' }],
    helpers: 'function formatMoney(v) { return v; }',
  };
}

describe('names', () => {
  it('collects declared and derived names', () => {
    const names = declaredNames(ext());
    for (const n of ['count', 'setCount', 'record', 'recordLoading', 'recordError', 'api', 'setApi', 'setApiLoading', 'total', 'formatMoney']) {
      expect(names.has(n), n).toBe(true);
    }
    expect(names.has('setRecord')).toBe(false);
  });

  it('validates identifiers, reserved words and collisions', () => {
    const e = ext();
    const asState = { kind: 'state', id: 'new' } as const;
    expect(validateDeclaredName(e, 'firstName', asState)).toBeNull();
    expect(validateDeclaredName(e, '', asState)).toMatch(/required/);
    expect(validateDeclaredName(e, 'first name', asState)).toMatch(/letters/);
    expect(validateDeclaredName(e, '1st', asState)).toMatch(/number/);
    expect(validateDeclaredName(e, 'class', asState)).toMatch(/reserved/);
    expect(validateDeclaredName(e, 'JSON', asState)).toMatch(/reserved/);
    expect(validateDeclaredName(e, 'count', asState)).toMatch(/state variable “count”/);
    expect(validateDeclaredName(e, 'recordLoading', asState)).toMatch(/data source “record”/);
    expect(validateDeclaredName(e, 'total', asState)).toMatch(/computed value/);
    expect(validateDeclaredName(e, 'formatMoney', asState)).toMatch(/helper/);
    // `apiLoading` is declared by the fetch source `api`.
    expect(validateDeclaredName(e, 'apiLoading', asState)).toMatch(/Already used/);
    expect(validateDeclaredName(e, 'set', { kind: 'dataSource', id: 'x', dsKind: 'crmProperties' })).toBeNull();
    // Renaming an item to its own name is allowed.
    expect(validateDeclaredName(e, 'count', { kind: 'state', id: 's1' })).toBeNull();
  });

  it('detects collisions through names the new item would declare', () => {
    const e = ext();
    // State `api` declares `setApi`, already declared by the fetch source `api`.
    expect(validateDeclaredName(e, 'api', { kind: 'state', id: 'n' })).not.toBeNull();
    // Data source `count` would declare `count` (taken).
    expect(validateDeclaredName(e, 'count', { kind: 'dataSource', id: 'n', dsKind: 'crmSearch' })).not.toBeNull();
  });

  it('picks unique names', () => {
    const e = ext();
    expect(uniqueDeclaredName(e, 'record', { kind: 'dataSource', id: 'n', dsKind: 'crmProperties' })).toBe('record2');
    expect(uniqueDeclaredName(e, 'associated Deals', { kind: 'dataSource', id: 'n', dsKind: 'associations' })).toBe('associatedDeals');
  });
});

describe('convertInitial', () => {
  it('converts between types sensibly', () => {
    expect(convertInitial(42, 'string')).toBe('42');
    expect(convertInitial({ a: 1 }, 'string')).toBe('{"a":1}');
    expect(convertInitial(null, 'string')).toBe('');
    expect(convertInitial('12.5', 'number')).toBe(12.5);
    expect(convertInitial('abc', 'number')).toBe(0);
    expect(convertInitial(true, 'number')).toBe(1);
    expect(convertInitial('false', 'boolean')).toBe(false);
    expect(convertInitial('yes', 'boolean')).toBe(true);
    expect(convertInitial(0, 'boolean')).toBe(false);
    expect(convertInitial('a, b', 'array')).toEqual(['a', 'b']);
    expect(convertInitial('[1,2]', 'array')).toEqual([1, 2]);
    expect(convertInitial(5, 'array')).toEqual([5]);
    expect(convertInitial('{"x":1}', 'object')).toEqual({ x: 1 });
    expect(convertInitial([1], 'object')).toEqual({});
    expect(convertInitial([1], 'any')).toEqual([1]);
  });

  it('previews values compactly', () => {
    expect(previewValue('')).toBe('""');
    expect(previewValue([1, 2])).toBe('[2 items]');
    expect(previewValue({ a: 1, b: 2, c: 3, d: 4 })).toBe('{ a, b, c, … }');
    expect(previewValue('x'.repeat(50)).length).toBeLessThanOrEqual(28);
  });
});

describe('validators', () => {
  it('validates project slugs and uids', () => {
    expect(validateProjectSlug('my-app')).toBeNull();
    expect(validateProjectSlug('My App')).not.toBeNull();
    expect(validateUid('my_app.v2-x')).toBeNull();
    expect(validateUid('bad uid')).not.toBeNull();
    expect(validateUid('taken', ['taken'])).toMatch(/already/);
  });

  it('validates permitted URLs', () => {
    expect(validatePermittedUrl('https://api.example.com')).toBeNull();
    expect(validatePermittedUrl('http://localhost:3000')).toBeNull();
    expect(validatePermittedUrl('http://api.example.com')).toMatch(/https/);
    expect(validatePermittedUrl('api.example.com')).toMatch(/valid URL/);
  });

  it('validates support fields', () => {
    expect(validateEmail('a@b.co')).toBeNull();
    expect(validateEmail('nope')).not.toBeNull();
    expect(validateEmail('')).toBeNull();
    expect(validatePhone('+18005555555')).toBeNull();
    expect(validatePhone('555-1234')).not.toBeNull();
  });

  it('checks function syntax without running it', () => {
    expect(checkFunctionSyntax('exports.main = async () => ({ ok: true });')).toBeNull();
    expect(checkFunctionSyntax('exports.main = async () => {')).not.toBeNull();
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-10-15T12:00:00Z');
    expect(formatRelativeTime('2026-10-15T11:59:40Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-10-15T11:55:00Z', now)).toBe('5 min ago');
    expect(formatRelativeTime('2026-10-15T09:00:00Z', now)).toBe('3 h ago');
    expect(formatRelativeTime('2026-10-14T09:00:00Z', now)).toBe('yesterday');
    expect(formatRelativeTime('2026-10-11T12:00:00Z', now)).toBe('4 days ago');
    expect(formatRelativeTime('garbage', now)).toBe('unknown');
  });
});

describe('crm properties catalog', () => {
  it('has at least 12 common properties for the main object types', () => {
    for (const t of ['contacts', 'companies', 'deals', 'tickets']) expect(COMMON_PROPERTIES[t].length).toBeGreaterThanOrEqual(12);
    expect(COMMON_PROPERTIES.line_items.length).toBeGreaterThan(0);
    expect(COMMON_PROPERTIES.products.length).toBeGreaterThan(0);
  });

  it('normalises object types and merges suggestions', () => {
    expect(objectTypeKey('0-3')).toBe('deals');
    expect(objectTypeKey('Deal')).toBe('deals');
    expect(objectTypeKey('company')).toBe('companies');
    expect(objectTypeLabel('0-5')).toBe('Tickets');
    const merged = propertySuggestions(['contacts', 'companies']).map((p) => p.name);
    expect(new Set(merged).size).toBe(merged.length);
    expect(merged).toContain('firstname');
    expect(merged).toContain('domain');
    expect(propertyLabel('dealname')).toBe('Deal name');
    expect(propertyLabel('my_custom_field')).toBe('My custom field');
  });

  it('summarises data sources in plain language', () => {
    expect(summarizeDataSource({ id: 'a', kind: 'crmProperties', name: 'r', properties: ['a', 'b', 'c'] })).toBe(
      '3 properties of current record',
    );
    expect(summarizeDataSource({ id: 'a', kind: 'associations', name: 'r', toObjectType: '0-3', properties: [], pageLength: 5 })).toBe(
      'Associated deals',
    );
    expect(
      summarizeDataSource({ id: 'a', kind: 'fetch', name: 'r', url: 'https://api.example.com/items?x=1', method: 'GET', runOnMount: true }),
    ).toBe('GET api.example.com/items?x=1');
    expect(summarizeDataSource({ id: 'a', kind: 'function', name: 'r', functionId: 'f', runOnMount: true }, [])).toBe(
      'No function selected',
    );
  });
});

describe('endpoint paths', () => {
  it('accepts the official "/api/…" format and slash-less paths', () => {
    // hubspot-project-components 2025.2 / 2026.03 / 2026.09 endpoint templates.
    expect(validateEndpointPath('/api/function-one')).toBeNull();
    expect(validateEndpointPath('/status')).toBeNull();
    expect(validateEndpointPath('status')).toBeNull();
    expect(validateEndpointPath('api/v2/my_fn')).toBeNull();
  });
  it('rejects empty, malformed and spaced paths', () => {
    expect(validateEndpointPath('')).toMatch(/required/);
    for (const bad of ['/', '//api', '/api/', '/bad path', '/api//x', '/api?x=1']) expect(validateEndpointPath(bad), bad).not.toBeNull();
  });
  it('defaults to /api/<uid>', () => {
    expect(defaultEndpointPath('get_quote')).toBe('/api/get_quote');
    expect(defaultEndpointPath('my.fn v2')).toBe('/api/my-fn-v2');
    expect(defaultEndpointPath('...')).toBe('/api/function');
    expect(validateEndpointPath(defaultEndpointPath('my.fn v2'))).toBeNull();
  });
});

describe('project-wide uid and file name rules', () => {
  function project() {
    const p = createProject('Rules App');
    p.functions = [
      { id: 'f1', uid: 'quote_fn', fileName: 'quote', code: '', secretKeys: [] },
      { id: 'f2', uid: 'other_fn', fileName: 'other', code: '', secretKeys: [] },
    ];
    return p;
  }

  it('shares one uid namespace between the app, extensions and functions', () => {
    const p = project();
    const card = p.extensions[0];
    expect(projectUidError(p, p.app.uid, { kind: 'extension', id: card.id })).toBe('The app already uses this UID');
    expect(projectUidError(p, card.uid, { kind: 'function', id: 'f1' })).toMatch(/^Card “.+” already uses this UID$/);
    expect(projectUidError(p, 'other_fn', { kind: 'app' })).toBe('App function “other” already uses this UID');
    // Its own uid is fine.
    expect(projectUidError(p, card.uid, { kind: 'extension', id: card.id })).toBeNull();
    expect(projectUidError(p, p.app.uid, { kind: 'app' })).toBeNull();
    expect(projectUidError(p, 'bad uid', { kind: 'app' })).toMatch(/no spaces/);
    expect(projectUidError(p, '', { kind: 'app' })).toBe('UID is required');
    expect(projectUidError(p, 'x'.repeat(65), { kind: 'app' })).toMatch(/64/);
  });

  it('requires PascalCase extension file names, unique across every extension ignoring case', () => {
    const p = project();
    const [card] = p.extensions;
    p.extensions.push({ ...card, id: 'e2', kind: 'settings', name: 'Settings', fileName: 'SettingsPage' });
    expect(extensionFileNameError(p, 'my-card', card.id)).toMatch(/PascalCase/);
    expect(extensionFileNameError(p, 'myCard', card.id)).toMatch(/PascalCase/);
    expect(extensionFileNameError(p, 'SETTINGSPAGE', card.id)).toBe('“Settings” already uses this file name');
    expect(extensionFileNameError(p, card.fileName, card.id)).toBeNull();
    expect(extensionFileNameError(p, 'MyCard_2', card.id)).toBeNull();
  });

  it('checks function file names like validation (characters, package, case-insensitive uniqueness)', () => {
    const p = project();
    expect(functionFileNameError(p, 'Other', 'f1')).toBe('App function “other_fn” already uses this file name');
    expect(functionFileNameError(p, 'package', 'f1')).toMatch(/reserved/);
    expect(functionFileNameError(p, 'my fn', 'f1')).not.toBeNull();
    expect(functionFileNameError(p, 'quote', 'f1')).toBeNull();
    expect(functionFileNameError(p, 'get-quote_2', 'f1')).toBeNull();
  });
});
