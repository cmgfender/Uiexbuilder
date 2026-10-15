import { describe, expect, it } from 'vitest';
import {
  applyExpressionSuggestion,
  applyTemplateSuggestion,
  expressionTokenAt,
  filterSuggestions,
  insideString,
  liveKeySuggestions,
  templateTokenAt,
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
