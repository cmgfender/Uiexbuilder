import { describe, expect, it } from 'vitest';
import {
  dateToInput,
  exprToLiteral,
  inputToDate,
  inputToTime,
  isMismatchedLiteral,
  literalToExpr,
  moveItem,
  optionsToLines,
  parseOptionLines,
  prettyJson,
  stringToExpr,
  templateLiteralToTemplate,
  templateValueAsExpr,
  timeToInput,
  urlHint,
  formatPreviewValue,
} from './propValue';
import { evaluate, interpolate } from '../runtime/expr';

describe('literal -> expression (fx on)', () => {
  it('quotes plain strings and keeps other JSON', () => {
    expect(literalToExpr('hello')).toBe('"hello"');
    expect(literalToExpr(42)).toBe('42');
    expect(literalToExpr(true)).toBe('true');
    expect(literalToExpr(null)).toBe('null');
    expect(literalToExpr([1, 'a'])).toBe('[1, "a"]');
    expect(literalToExpr({ url: 'x', 'data-x': 1 })).toBe('{ url: "x", "data-x": 1 }');
  });
  it('turns templates into expressions', () => {
    expect(stringToExpr('{{ count }}')).toBe('count');
    expect(stringToExpr('Hello {{ name }}!')).toBe('`Hello ${toText(name)}!`');
    expect(stringToExpr('a `b` ${c} {{ d }}')).toBe('`a \\`b\\` \\${c} ${toText(d)}`');
    // Every value goes through toText like interpolation; literals need no conversion.
    expect(stringToExpr("x {{ a || 'n/a' }} {{ fmt(total) }} {{ 'lit' }} {{ String(n) }}")).toBe(
      "`x ${toText(a || 'n/a')} ${toText(fmt(total))} ${'lit'} ${String(n)}`",
    );
  });
  it('unset yields an empty expression', () => {
    expect(literalToExpr(undefined)).toBe('');
  });
});

describe('expression -> literal (fx off)', () => {
  it('parses literals matching the prop kind', () => {
    expect(exprToLiteral('"primary"', { kind: 'enum', options: [{ value: 'primary' }] })).toEqual({ ok: true, value: 'primary' });
    expect(exprToLiteral("'x'", { kind: 'string' })).toEqual({ ok: true, value: 'x' });
    expect(exprToLiteral('12', { kind: 'number' })).toEqual({ ok: true, value: 12 });
    expect(exprToLiteral('true', { kind: 'boolean' })).toEqual({ ok: true, value: true });
    expect(exprToLiteral('', { kind: 'number' })).toEqual({ ok: true, value: undefined });
  });
  it('keeps expression text for string props as a template', () => {
    expect(exprToLiteral('count + 1', { kind: 'string' })).toEqual({ ok: true, value: '{{ count + 1 }}' });
    expect(exprToLiteral('`Hi ${toText(name)}`', { kind: 'string' })).toEqual({ ok: true, value: 'Hi {{ name }}' });
    // Expressions written by earlier versions (`?? ''`) still convert back.
    expect(exprToLiteral("`Hi ${name ?? ''}`", { kind: 'string' })).toEqual({ ok: true, value: 'Hi {{ name }}' });
    // A bare `${name}` prints "null" for null; String() keeps that in the template.
    expect(exprToLiteral('`Hi ${name}`', { kind: 'string' })).toEqual({ ok: true, value: 'Hi {{ String(name) }}' });
  });
  it('refuses dynamic values for non-string kinds', () => {
    expect(exprToLiteral('count + 1', { kind: 'number' })).toEqual({ ok: false });
    expect(exprToLiteral('"nope"', { kind: 'enum', options: [{ value: 'a' }] })).toEqual({ ok: false });
  });
  it('round-trips templates through fx', () => {
    const tpl = 'Hello {{ user.name }}, you have {{ count }} items';
    const code = stringToExpr(tpl);
    expect(templateLiteralToTemplate(code)).toBe(tpl);
    for (const t of ["{{ a || 'x' }} and {{ fmt(b) }}", "{{ 'q' }}-{{ String(n) }}", "v: {{ x ?? '' }}", 'id {{ a[0] }}']) {
      expect(templateLiteralToTemplate(stringToExpr(t))).toBe(t);
    }
  });

  it('keeps the rendered text when toggling fx on and off (null, booleans, objects, arrays)', () => {
    const scope = { owner: null, missing: undefined, name: 'Ada', count: 3, deal: { amount: 5 }, done: false, tags: ['a', 'b'] };
    const cases = [
      'Owner: {{ owner }}',
      'Hi {{ name }} ({{ count }})',
      'x{{ missing }}y',
      'Amount {{ deal.amount }}',
      'Done: {{ done }}',
      'Deal {{ deal }}',
      'Tags {{ tags }}',
    ];
    for (const tpl of cases) {
      const literal = interpolate(tpl, scope);
      const code = stringToExpr(tpl);
      const r = evaluate(code, scope);
      expect(r.ok && r.value).toBe(literal);
      // ... and back again.
      expect(interpolate(templateLiteralToTemplate(code)!, scope)).toBe(literal);
    }
    // Expression -> literal keeps JS string conversion for hand-written placeholders.
    const handWritten = '`Owner: ${owner}`';
    const r = evaluate(handWritten, scope);
    expect(interpolate(templateLiteralToTemplate(handWritten)!, scope)).toBe(r.ok ? r.value : 'x');
  });
});

describe('type helpers', () => {
  it('presents template strings of non-string props as expressions', () => {
    expect(templateValueAsExpr('{{ count }}', { kind: 'number' })).toBe('count');
    expect(templateValueAsExpr('{{ count }}', { kind: 'string' })).toBeNull();
  });
  it('detects mismatched literals', () => {
    expect(isMismatchedLiteral({ a: 1 }, { kind: 'boolean' })).toBe(true);
    expect(isMismatchedLiteral(true, { kind: 'boolean' })).toBe(false);
    expect(isMismatchedLiteral({ $expr: 'x' }, { kind: 'boolean' })).toBe(false);
  });
  it('converts dates and times', () => {
    expect(dateToInput({ year: 2026, month: 0, date: 5 })).toBe('2026-01-05');
    expect(inputToDate('2026-12-31')).toEqual({ year: 2026, month: 11, date: 31 });
    expect(inputToDate('')).toBeUndefined();
    expect(timeToInput({ hours: 9, minutes: 5 })).toBe('09:05');
    expect(inputToTime('17:45')).toEqual({ hours: 17, minutes: 45 });
  });
  it('parses option lines', () => {
    expect(parseOptionLines('New York\nParis | fr\n\n')).toEqual([
      { label: 'New York', value: 'new_york' },
      { label: 'Paris', value: 'fr' },
    ]);
    expect(
      optionsToLines([
        { label: 'New York', value: 'new_york' },
        { label: 'Paris', value: 'fr' },
      ]),
    ).toBe('New York\nParis | fr');
  });
  it('moves items', () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 0, 5)).toEqual([1, 2, 3]);
  });
  it('hints at bad URLs', () => {
    expect(urlHint('example.com')).toMatch(/https/);
    expect(urlHint('https://example.com/x')).toBeNull();
    expect(urlHint('https://{{ host }}/x')).toBeNull();
  });
  it('formats preview values', () => {
    expect(formatPreviewValue('a')).toBe('"a"');
    expect(formatPreviewValue([1, 2])).toBe('(2) [1,2]');
    expect(formatPreviewValue(undefined)).toBe('undefined');
    expect(formatPreviewValue('x'.repeat(200), 10)).toHaveLength(10);
  });
});

describe('prettyJson', () => {
  it('keeps flat rows on one line', () => {
    expect(prettyJson([{ month: 'Jan', amount: 1 }, { month: 'Feb', amount: 2 }])).toBe(
      '[\n  { "month": "Jan", "amount": 1 },\n  { "month": "Feb", "amount": 2 }\n]',
    );
    expect(prettyJson(['a', 'b'])).toBe('["a", "b"]');
    const long = Array.from({ length: 4 }, (_, i) => ({ month: `Month ${i}`, amount: 1000 * i }));
    expect(prettyJson(long).split('\n')).toHaveLength(6);
    expect(JSON.parse(prettyJson({ a: { b: [1, 2] }, c: 'x' }))).toEqual({ a: { b: [1, 2] }, c: 'x' });
  });
});
