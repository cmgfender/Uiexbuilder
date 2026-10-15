import { describe, expect, it } from 'vitest';
import {
  applyExpressionSuggestion,
  applyTemplateSuggestion,
  expressionTokenAt,
  filterSuggestions,
  hasMembers,
  insertTemplateVariable,
  insideString,
  liveKeySuggestions,
  templateTokenAt,
  valueAtPath,
} from './autocomplete';
import type { ScopeVariable } from './scope';

const vars: ScopeVariable[] = [
  { name: 'count', kind: 'state' },
  { name: 'contacts', kind: 'dataSource' },
  { name: 'context.user.firstName', kind: 'context' },
  { name: 'context.user.email', kind: 'context' },
  { name: 'record.firstname', kind: 'property' },
  { name: 'setCount', kind: 'setter' },
];

describe('expressionTokenAt', () => {
  it('finds identifiers and paths before the cursor', () => {
    expect(expressionTokenAt('count + co', 10)).toEqual({ start: 8, end: 10, text: 'co' });
    expect(expressionTokenAt('context.us', 10)).toEqual({ start: 0, end: 10, text: 'context.us' });
    expect(expressionTokenAt('context.', 8)).toEqual({ start: 0, end: 8, text: 'context.' });
  });
  it('extends over the rest of the word', () => {
    expect(expressionTokenAt('cou + 1', 2)).toEqual({ start: 0, end: 3, text: 'co' });
  });
  it('ignores strings, numbers and call results', () => {
    expect(expressionTokenAt("'co", 3)).toBeNull();
    expect(insideString('`a ${b')).toBe(false);
    expect(insideString('`a ${b} c')).toBe(true);
    expect(expressionTokenAt('1.5', 3)).toBeNull();
    expect(expressionTokenAt('foo().ba', 8)).toBeNull();
    expect(expressionTokenAt('a + ', 4)).toBeNull();
  });
});

describe('templateTokenAt', () => {
  it('only triggers inside an open {{ segment', () => {
    expect(templateTokenAt('Hello {{', 8)).toMatchObject({ text: '', segmentStart: 6, closed: false });
    expect(templateTokenAt('Hello {{ co', 11)).toMatchObject({ start: 9, text: 'co' });
    expect(templateTokenAt('Hello {{ a }} co', 16)).toBeNull();
    expect(templateTokenAt('Hello co', 8)).toBeNull();
    expect(templateTokenAt('{{ co }}', 5)).toMatchObject({ text: 'co', closed: true });
  });
});

describe('filterSuggestions', () => {
  it('ranks prefix matches first and drops exact matches', () => {
    const names = filterSuggestions(vars, 'co').map((v) => v.name);
    expect(names.slice(0, 2)).toEqual(['count', 'contacts']);
    expect(names).toContain('context.user.firstName');
    expect(filterSuggestions(vars, 'count').map((v) => v.name)).not.toContain('count');
  });
  it('matches path segments and camelCase words', () => {
    expect(filterSuggestions(vars, 'first').map((v) => v.name)).toEqual(['record.firstname', 'context.user.firstName']);
    expect(filterSuggestions(vars, 'context.user.').map((v) => v.name)).toEqual(['context.user.firstName', 'context.user.email']);
  });
});

describe('liveKeySuggestions', () => {
  it('lists keys of live objects', () => {
    const scope = { record: { firstname: 'Ada', 'bad key': 1 }, list: [1, 2] };
    expect(liveKeySuggestions('record.', scope).map((v) => v.name)).toEqual(['record.firstname']);
    expect(liveKeySuggestions('list.', scope).map((v) => v.name)).toEqual(['list.length']);
    expect(liveKeySuggestions('nope.', scope)).toEqual([]);
    expect(liveKeySuggestions('record', scope)).toEqual([]);
  });
});

describe('apply suggestions', () => {
  it('replaces the token in expressions', () => {
    const tok = expressionTokenAt('count + co', 10)!;
    expect(applyExpressionSuggestion('count + co', tok, 'contacts')).toEqual({ value: 'count + contacts', cursor: 16 });
  });
  it('wraps template insertions as {{ name }}', () => {
    const value = 'Hi {{';
    expect(applyTemplateSuggestion(value, templateTokenAt(value, 5)!, 'count')).toEqual({ value: 'Hi {{ count }}', cursor: 14 });
    const v2 = 'Hi {{co}} there';
    expect(applyTemplateSuggestion(v2, templateTokenAt(v2, 7)!, 'count')).toEqual({ value: 'Hi {{ count }} there', cursor: 14 });
  });
});

describe('object completions stay open for members', () => {
  const scope = { record: { firstname: 'Ada', tags: ['x'] }, count: 2, owner: null, fn: () => 1 };

  it('looks up own paths only', () => {
    expect(valueAtPath(scope, 'record.firstname')).toEqual({ found: true, value: 'Ada' });
    expect(valueAtPath(scope, 'record.toString').found).toBe(false);
    expect(valueAtPath(scope, 'owner.name').found).toBe(false);
    expect(valueAtPath(null, 'x').found).toBe(false);
  });

  it('detects object / array values (live first, then the declared shape)', () => {
    expect(hasMembers({ name: 'record', kind: 'dataSource' }, scope)).toBe(true);
    expect(hasMembers({ name: 'record.tags', kind: 'property' }, scope)).toBe(true);
    expect(hasMembers({ name: 'record.firstname', kind: 'property' }, scope)).toBe(false);
    expect(hasMembers({ name: 'count', kind: 'state', members: true }, scope)).toBe(false);
    expect(hasMembers({ name: 'owner', kind: 'state' }, scope)).toBe(false);
    expect(hasMembers({ name: 'fn', kind: 'helper' }, scope)).toBe(false);
    // Not in the preview scope (e.g. still loading): the declared shape decides.
    expect(hasMembers({ name: 'deals', kind: 'dataSource', members: true }, scope)).toBe(true);
    expect(hasMembers({ name: 'dealsLoading', kind: 'dataSource' }, scope)).toBe(false);
  });

  it('leaves the caret inside the closed segment', () => {
    const value = '{{ rec';
    const res = applyTemplateSuggestion(value, templateTokenAt(value, 6)!, 'record', { caretInside: true });
    expect(res).toEqual({ value: '{{ record }}', cursor: 9 });
    // Typing "." there continues the path inside the segment.
    const typed = `${res.value.slice(0, res.cursor)}.fi${res.value.slice(res.cursor)}`;
    expect(typed).toBe('{{ record.fi }}');
    const tok = templateTokenAt(typed, res.cursor + 3)!;
    expect(tok.text).toBe('record.fi');
    expect(liveKeySuggestions(tok.text, scope).map((v) => v.name)).toContain('record.firstname');
    expect(applyTemplateSuggestion(typed, tok, 'record.firstname')).toEqual({ value: '{{ record.firstname }}', cursor: 22 });
  });

  it('flags object-valued live keys', () => {
    const keys = liveKeySuggestions('record.', scope);
    expect(keys.find((k) => k.name === 'record.tags')?.members).toBe(true);
    expect(keys.find((k) => k.name === 'record.firstname')?.members).toBeUndefined();
  });
});

describe('insertTemplateVariable', () => {
  it('separates the variable from adjoining words', () => {
    expect(insertTemplateVariable('Heading', 7, 7, 'x')).toEqual({ value: 'Heading {{ x }}', cursor: 15 });
    expect(insertTemplateVariable('Hello world', 5, 5, 'x')).toEqual({ value: 'Hello {{ x }} world', cursor: 13 });
    expect(insertTemplateVariable('Hi ', 3, 3, 'x')).toEqual({ value: 'Hi {{ x }}', cursor: 10 });
    expect(insertTemplateVariable('', 0, 0, 'x')).toEqual({ value: '{{ x }}', cursor: 7 });
  });
  it('leaves URL-like and code-like neighbours alone', () => {
    expect(insertTemplateVariable('https://x.test/items/', 21, 21, 'id').value).toBe('https://x.test/items/{{ id }}');
    expect(insertTemplateVariable('?q=&page=2', 3, 3, 'q').value).toBe('?q={{ q }}&page=2');
  });
  it('replaces a selection', () => {
    expect(insertTemplateVariable('Hi NAME!', 3, 7, 'name')).toEqual({ value: 'Hi {{ name }}!', cursor: 13 });
  });
});
