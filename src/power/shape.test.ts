import { describe, expect, it } from 'vitest';
import {
  describeShape,
  formatExpr,
  formatName,
  guessFormat,
  guessSortAs,
  listChoices,
  parseShape,
  rowFields,
  shapeToExpr,
  type ListShape,
} from './shape';
import type { Extension } from '../model/types';

function run(expr: string, scope: Record<string, unknown>): unknown {
  const names = Object.keys(scope);
  return new Function(...names, `return (${expr});`)(...names.map((n) => scope[n]));
}

const deals = [
  { toObjectId: 1, properties: { dealname: 'Renewal', amount: '48000', closedate: '2026-09-21T00:00:00Z', probability: '0.4' } },
  { toObjectId: 2, properties: { dealname: 'Upgrade', amount: '12500', closedate: '2026-09-04T00:00:00Z', probability: '0.9' } },
  { toObjectId: 3, properties: { dealname: 'Pilot', amount: '7800', closedate: null, probability: null } },
];

const full: ListShape = {
  source: 'deals',
  filter: 'Number(row.properties.amount) > 10000',
  sort: { field: ['properties', 'amount'], dir: 'desc', as: 'number' },
  limit: 5,
  formats: [
    { name: 'amountFormatted', field: ['properties', 'amount'], kind: 'currency', currency: 'USD' },
    { name: 'closeDate', field: ['properties', 'closedate'], kind: 'date' },
  ],
};

describe('shaped lists', () => {
  it('writes a readable chain', () => {
    expect(shapeToExpr(full)).toBe(
      [
        '[...(deals ?? [])]',
        '  .filter((row) => Number(row.properties.amount) > 10000)',
        '  .sort((a, b) => Number(b.properties.amount ?? 0) - Number(a.properties.amount ?? 0))',
        '  .slice(0, 5)',
        '  .map((row) => ({ ...row, amountFormatted: Number(row.properties.amount || 0).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }), closeDate: row.properties.closedate ? new Date(isNaN(row.properties.closedate) ? row.properties.closedate : Number(row.properties.closedate)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "" }))',
      ].join('\n'),
    );
    // The list is copied first, so sorting never changes the data itself.
    expect(shapeToExpr({ source: 'items', sort: { field: ['name'], dir: 'asc', as: 'text' } })).toBe(
      '[...(items ?? [])]\n  .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")))',
    );
    expect(shapeToExpr({ source: 'weather.days' })).toBe('[...(weather.days ?? [])]');
    expect(shapeToExpr({ source: 'a || b', limit: 0 })).toBe('[...((a || b) ?? [])]\n  .slice(0, 0)');
  });

  it('shapes rows as described', () => {
    const rows = run(shapeToExpr(full), { deals }) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.toObjectId)).toEqual([1, 2]);
    expect(rows[0].amountFormatted).toBe('$48,000');
    expect(rows[0].closeDate).toBe('Sep 21, 2026');
    // The data itself is not changed.
    expect(deals.map((d) => d.toObjectId)).toEqual([1, 2, 3]);
    const sorted = run(shapeToExpr({ source: 'deals', sort: { field: ['properties', 'dealname'], dir: 'asc', as: 'text' } }), { deals }) as typeof deals;
    expect(sorted.map((d) => d.properties.dealname)).toEqual(['Pilot', 'Renewal', 'Upgrade']);
    expect(deals[0].properties.dealname).toBe('Renewal');
    expect(run(shapeToExpr({ source: 'missing' }), { missing: null })).toEqual([]);
  });

  it('sorts HubSpot’s formatted numbers ("$48,000.00") as numbers, and reads that back', () => {
    const formatted = [
      { properties: { dealname: 'Renewal', amount: '$48,000.00' } },
      { properties: { dealname: 'Add-on', amount: '$7,800.00' } },
      { properties: { dealname: 'Upgrade', amount: '$12,500.00' } },
    ];
    expect(guessSortAs(formatted, ['properties', 'amount'])).toBe('formatted');
    expect(guessSortAs([{ p: '45%' }, { p: '5%' }], ['p'])).toBe('formatted');
    // Dates, ids with letters and words stay text.
    expect(guessSortAs([{ d: '09/21/2026' }, { d: '2026-09-04' }], ['d'])).toBe('text');
    expect(guessSortAs([{ s: 'Closed won' }], ['s'])).toBe('text');
    const shape: ListShape = { source: 'deals', sort: { field: ['properties', 'amount'], dir: 'desc', as: 'formatted' } };
    const rows = run(shapeToExpr(shape), { deals: formatted }) as typeof formatted;
    expect(rows.map((r) => r.properties.dealname)).toEqual(['Renewal', 'Upgrade', 'Add-on']);
    expect(parseShape(shapeToExpr(shape))).toEqual(shape);
    expect(describeShape(shape)).toContain('highest first');
  });

  it('formats numbers, percents and relative dates', () => {
    const value = (kind: 'number' | 'percent' | 'relative', v: unknown, decimals?: number) =>
      run(formatExpr({ name: 'x', field: ['v'], kind, decimals }), { row: { v } });
    expect(value('number', '1234.567')).toBe('1,234.57');
    expect(value('number', '1234.567', 0)).toBe('1,235');
    expect(value('percent', '0.255')).toBe('26%');
    const inDays = (d: number) => new Date(Date.now() + d * 86400000 + 3600000).toISOString();
    expect(value('relative', inDays(3))).toBe('in 3 days');
    expect(value('relative', inDays(-1))).toBe('yesterday');
    expect(value('relative', inDays(-90))).toBe('3 months ago');
    expect(value('relative', inDays(800))).toBe('in 2 years');
    expect(value('relative', String(Date.now() + 2 * 86400000 + 3600000))).toBe('in 2 days');
    expect(value('relative', '')).toBe('');
    expect(run(formatExpr({ name: 'x', field: ['v'], kind: 'currency', currency: 'EUR', decimals: 2 }), { row: { v: 9.5 } })).toBe('€9.50');
  });

  it('reads back what it wrote', () => {
    expect(parseShape(shapeToExpr(full))).toEqual(full);
    const all: ListShape[] = [
      { source: 'deals' },
      { source: 'a || b', limit: 3 },
      { source: 'items', sort: { field: ['first name'], dir: 'asc', as: 'text' } },
      { source: 'items', filter: 'row.done', sort: { field: ['n'], dir: 'asc', as: 'number' } },
      {
        source: 'items',
        formats: [
          { name: 'p', field: ['v'], kind: 'percent', decimals: 1 },
          { name: 'n', field: ['v'], kind: 'number', decimals: 3 },
          { name: 'n2', field: ['v'], kind: 'number' },
          { name: 'r', field: ['when'], kind: 'relative' },
          { name: 'c', field: ['v'], kind: 'currency', currency: 'GBP', decimals: 2 },
        ],
      },
    ];
    for (const s of all) expect(parseShape(shapeToExpr(s))).toEqual(s);
  });

  it('leaves other expressions alone', () => {
    for (const expr of [
      'deals',
      'deals.filter((d) => d.done)',
      '(deals ?? []).filter((row) => row.done)',
      '[...(deals ?? [])].filter((d) => d.done)',
      '[...(deals ?? [])].sort((a, b) => a.x - b.x)',
      '[...(deals ?? [])].slice().sort((a, b) => Number(a.x ?? 0) - Number(b.x ?? 0))',
      '[...(deals ?? [])].slice(0, 3).filter((row) => row.x)',
      '[...(deals ?? [])].map((row) => ({ ...row, x: 1 }))',
      '[...(deals ?? [])].map((row) => row.x)',
      '[...(deals ?? [])] // note',
      '[...(a + b ?? [])]',
      '[...deals]',
      '[...(deals ?? []), 1]',
    ]) {
      expect(parseShape(expr), expr).toBeNull();
    }
  });

  it('knows the lists of an extension and the fields of their rows', () => {
    const ext = {
      state: [{ id: 's', name: 'todo', type: 'array', initial: [] }],
      dataSources: [
        { id: 'd', kind: 'associations', name: 'deals', toObjectType: '0-3', properties: ['amount'], pageLength: 10 },
        { id: 'f', kind: 'fetch', name: 'api', url: 'x', method: 'GET', runOnMount: true },
      ],
      computed: [
        { id: 'c1', name: 'top', expr: '[]' },
        { id: 'c2', name: 'me', expr: '[]' },
        { id: 'c3', name: 'later', expr: '[]' },
      ],
    } as unknown as Extension;
    const scope = { api: [{ id: 1 }], top: [], me: [], later: [] };
    expect(listChoices(ext, scope, 'c2').map((c) => c.expr)).toEqual(['deals', 'api', 'todo', 'top']);
    expect(rowFields(deals, ['amount'])).toEqual([
      ['properties', 'amount'],
      ['toObjectId'],
      ['properties', 'dealname'],
      ['properties', 'closedate'],
      ['properties', 'probability'],
    ]);
    expect(guessSortAs(deals, ['properties', 'amount'])).toBe('number');
    expect(guessSortAs(deals, ['properties', 'dealname'])).toBe('text');
    expect(guessFormat(['properties', 'amount'], '1')).toBe('currency');
    expect(guessFormat(['properties', 'closedate'], null)).toBe('date');
    expect(formatName(['properties', 'amount'], ['amountFormatted'])).toBe('amountFormatted2');
    expect(formatName(['first name'], [])).toBe('firstNameFormatted');
    expect(describeShape(full)).toBe('deals · filtered · sorted by amount (highest first) · first 5 · 2 formatted fields');
  });
});
