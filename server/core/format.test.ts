// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatProperties, formatPropertyValue } from './format';
import type { CrmPropertyDef } from '../../src/connect/types';

const def = (type: string, extra: Partial<CrmPropertyDef> = {}): CrmPropertyDef => ({ name: 'p', label: 'P', type, fieldType: 'text', ...extra });

describe('formatPropertyValue', () => {
  it('formats dates (UTC calendar date) from ISO or epoch ms', () => {
    expect(formatPropertyValue('2023-03-14', def('date'))).toBe('Mar 14, 2023');
    expect(formatPropertyValue('1678752000000', def('date'))).toBe('Mar 14, 2023');
    expect(formatPropertyValue('not a date', def('date'))).toBe('not a date');
  });

  it('formats datetimes with time and zone', () => {
    expect(formatPropertyValue('2025-02-28T17:00:00.000Z', def('datetime'))).toBe('Feb 28, 2025, 5:00 PM UTC');
  });

  it('formats numbers with grouping', () => {
    expect(formatPropertyValue('1234567.5', def('number'))).toBe('1,234,567.5');
    expect(formatPropertyValue('-42', def('number'))).toBe('-42');
    expect(formatPropertyValue('abc', def('number'))).toBe('abc');
  });

  it('maps enumeration values (incl. multi-select) to option labels', () => {
    const d = def('enumeration', { options: [{ label: 'Red', value: 'r' }, { label: 'Blue', value: 'b' }] });
    expect(formatPropertyValue('r', d)).toBe('Red');
    expect(formatPropertyValue('r;b;x', d)).toBe('Red, Blue, x');
  });

  it('formats booleans', () => {
    expect(formatPropertyValue('true', def('bool'))).toBe('Yes');
    expect(formatPropertyValue('false', def('enumeration', { fieldType: 'booleancheckbox' }))).toBe('No');
  });

  it('leaves nulls, empty strings, unknown properties and text alone', () => {
    expect(formatPropertyValue(null, def('number'))).toBeNull();
    expect(formatPropertyValue('', def('number'))).toBe('');
    expect(formatPropertyValue('42', undefined)).toBe('42');
    expect(formatPropertyValue('hello', def('string'))).toBe('hello');
  });

  it('formatProperties applies per property', () => {
    const defs = new Map<string, CrmPropertyDef>([['n', { ...def('number'), name: 'n' }]]);
    expect(formatProperties({ n: '1000', other: '1000' }, defs)).toEqual({ n: '1,000', other: '1000' });
  });
});
