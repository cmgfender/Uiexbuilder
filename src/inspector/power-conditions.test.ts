import { describe, expect, it } from 'vitest';
import {
  literalComparisons,
  rawComparisonMismatch,
  clauseProblem,
  conditionToExpr,
  declaredSubjectType,
  describeCondition,
  isSimpleRef,
  opsFor,
  parseCondition,
  parseValueText,
  subjectType,
  type ConditionSet,
} from './power-conditions';
import type { Extension } from '../model/types';

function run(expr: string, scope: Record<string, unknown>): unknown {
  const names = Object.keys(scope);
  return new Function(...names, `return (${expr});`)(...names.map((n) => scope[n]));
}

const ext = {
  state: [
    { id: 's1', name: 'count', type: 'number', initial: 0 },
    { id: 's2', name: 'search', type: 'string', initial: '' },
    { id: 's3', name: 'open', type: 'boolean', initial: false },
    { id: 's4', name: 'picked', type: 'array', initial: [] },
  ],
  dataSources: [
    { id: 'd1', kind: 'associations', name: 'deals', toObjectType: '0-3', properties: ['amount'], pageLength: 10 },
    { id: 'd2', kind: 'crmProperties', name: 'contact', properties: ['email', 'firstname'] },
  ],
} as unknown as Pick<Extension, 'state' | 'dataSources'>;
const typeOf = (s: string) => declaredSubjectType(ext, s);

describe('condition builder expressions', () => {
  const set: ConditionSet = {
    groups: [
      [
        { subject: 'deal.properties.amount', op: 'gt', value: { kind: 'literal', value: 1000 } },
        { subject: 'deal.properties.dealstage', op: 'eq', value: { kind: 'literal', value: 'closedwon' } },
      ],
      [{ subject: 'contact.email', op: 'contains', value: { kind: 'literal', value: 'ACME' } }],
    ],
  };

  it('writes readable code: AND groups joined by OR', () => {
    expect(conditionToExpr(set, { typeOf })).toBe(
      '(Number(deal.properties.amount) > 1000 && deal.properties.dealstage === "closedwon") || String(contact.email ?? "").toLowerCase().includes("acme")',
    );
    expect(conditionToExpr({ groups: [[{ subject: 'count', op: 'gte', value: { kind: 'literal', value: 3 } }]] }, { typeOf })).toBe('count >= 3');
    expect(conditionToExpr({ groups: [] })).toBe('');
    expect(conditionToExpr({ groups: [[{ subject: '', op: 'isTrue' }]] })).toBe('');
  });

  it('evaluates as described', () => {
    const expr = conditionToExpr(set, { typeOf });
    const deal = (amount: string, dealstage: string) => ({ properties: { amount, dealstage } });
    expect(run(expr, { deal: deal('2500', 'closedwon'), contact: { email: null } })).toBe(true);
    expect(run(expr, { deal: deal('500', 'closedwon'), contact: { email: null } })).toBe(false);
    expect(run(expr, { deal: deal('500', 'open'), contact: { email: 'Sam@Acme.com' } })).toBe(true);
  });

  it('reads back what it wrote', () => {
    expect(parseCondition(conditionToExpr(set, { typeOf }))).toEqual({
      groups: [
        [
          { subject: 'deal.properties.amount', op: 'gt', value: { kind: 'literal', value: 1000 } },
          { subject: 'deal.properties.dealstage', op: 'eq', value: { kind: 'literal', value: 'closedwon' } },
        ],
        [{ subject: 'contact.email', op: 'contains', value: { kind: 'literal', value: 'acme' } }],
      ],
    });
    const all: ConditionSet = {
      groups: [
        [
          { subject: 'items', op: 'empty' },
          { subject: 'items', op: 'notEmpty' },
          { subject: 'open', op: 'isTrue' },
          { subject: 'open', op: 'isFalse' },
          { subject: 'a + b', op: 'lte', value: { kind: 'literal', value: -2.5 } },
          { subject: 'x["first name"]', op: 'neq', value: { kind: 'literal', value: null } },
          { subject: 'row.name', op: 'notContains', value: { kind: 'ref', expr: 'search' } },
          { subject: 'deal.properties.amount', op: 'gte', value: { kind: 'ref', expr: 'minAmount' } },
          { subject: 'when', op: 'lt', value: { kind: 'literal', value: '2026-01-01' } },
          { subject: 'flag', op: 'eq', value: { kind: 'literal', value: false } },
        ],
      ],
    };
    expect(parseCondition(conditionToExpr(all))).toEqual(all);
  });

  it('recognises hand-written conditions of the same shape', () => {
    expect(parseCondition('!dealsLoading && !dealsError && deals.length === 0')).toEqual({
      groups: [
        [
          { subject: 'dealsLoading', op: 'isFalse' },
          { subject: 'dealsError', op: 'isFalse' },
          { subject: 'deals.length', op: 'eq', value: { kind: 'literal', value: 0 } },
        ],
      ],
    });
    expect(parseCondition("deal.properties.hs_is_closed_won === 'true'")!.groups[0][0].value).toEqual({ kind: 'literal', value: 'true' });
    expect(parseCondition('a || b && c')).toEqual({
      groups: [[{ subject: 'a', op: 'isTrue' }], [{ subject: 'b', op: 'isTrue' }, { subject: 'c', op: 'isTrue' }]],
    });
    expect(parseCondition('Number(deal.amount) > 5')!.groups[0][0]).toEqual({ subject: 'deal.amount', op: 'gt', value: { kind: 'literal', value: 5 } });
    expect(parseCondition('')).toEqual({ groups: [] });
  });

  it('leaves everything else to the expression editor', () => {
    for (const expr of [
      'a ? b : c',
      'a == 1',
      'x && (a || b)',
      'items.some((i) => i.done)',
      'a + b > 5',
      '/* note */ a',
      'typeof a === "string"',
      'a > 1 > 0',
      '!a === b',
      'foo()',
      'String(a).includes("x")',
      'String(a ?? "").length === 1',
    ]) {
      expect(parseCondition(expr), expr).toBeNull();
    }
  });

  it('knows simple references', () => {
    expect(isSimpleRef('deal.properties.amount')).toBe(true);
    expect(isSimpleRef('a?.b[0]["x y"]')).toBe(true);
    expect(isSimpleRef('a + b')).toBe(false);
    expect(isSimpleRef('true')).toBe(false);
    expect(isSimpleRef('f()')).toBe(false);
  });

  it('types subjects and the values typed for them', () => {
    expect(typeOf('count')).toBe('number');
    expect(typeOf('deals')).toBe('array');
    expect(typeOf('deals.length')).toBe('number');
    expect(typeOf('dealsLoading')).toBe('boolean');
    expect(typeOf('contact.email')).toBe('string');
    expect(typeOf('context.user.id')).toBe('any');
    expect(typeOf('context.user.email')).toBe('string');
    expect(typeOf('whatever')).toBe('any');
    expect(subjectType('any', 5)).toBe('number');
    expect(subjectType('any', ['x'])).toBe('array');

    // CRM values are text even when they look like booleans / numbers.
    expect(parseValueText('true', 'eq', 'any', 'false')).toBe('true');
    expect(parseValueText('125000', 'eq', 'string', '1')).toBe('125000');
    expect(parseValueText('true', 'eq', 'boolean', undefined)).toBe(true);
    expect(parseValueText('42', 'eq', 'number', undefined)).toBe(42);
    expect(parseValueText('42', 'gt', 'string', undefined)).toBe(42);
    expect(parseValueText('2026-01-01', 'gt', 'any', undefined)).toBe('2026-01-01');
    expect(parseValueText('7', 'eq', 'any', 3)).toBe(7);

    expect(clauseProblem({ subject: 'count', op: 'eq', value: { kind: 'literal', value: 'x' } }, 'number')).toMatch(/number/);
    expect(clauseProblem({ subject: '', op: 'isTrue' }, 'any')).toMatch(/Choose/);
  });

  it('offers only operators whose code type-checks', () => {
    expect(opsFor('number')).not.toContain('empty');
    expect(opsFor('boolean')).not.toContain('gt');
    expect(opsFor('array')).toContain('notEmpty');
    expect(opsFor('number', 'isTrue')).toContain('isTrue');
  });

  it('typed state compares without Number(); text compares with it', () => {
    expect(conditionToExpr({ groups: [[{ subject: 'search', op: 'gt', value: { kind: 'literal', value: 3 } }]] }, { typeOf })).toBe(
      'Number(search) > 3',
    );
    expect(
      conditionToExpr({ groups: [[{ subject: 'count', op: 'gt', value: { kind: 'ref', expr: 'deals.length' } }]] }, { typeOf }),
    ).toBe('count > deals.length');
  });

  it('describes a condition in words', () => {
    expect(describeCondition(set)).toBe(
      'deal.properties.amount is more than 1000 and deal.properties.dealstage is “closedwon”, or contact.email contains “ACME”',
    );
  });
});

describe('comparisons with fixed values, as written', () => {
  it('finds whole `reference op literal` comparisons only', () => {
    expect(literalComparisons('count === "" && (open) >= 80 ? "a" : deal.properties.amount !== -5')).toEqual([
      { subject: 'count', op: 'eq', value: '' },
      { subject: 'open', op: 'gte', value: 80 },
      { subject: 'deal.properties.amount', op: 'neq', value: -5 },
    ]);
    expect(literalComparisons('items[0]?.name === null || x["a b"] < 2')).toEqual([
      { subject: 'items[0]?.name', op: 'eq', value: null },
      { subject: 'x["a b"]', op: 'lt', value: 2 },
    ]);
    // Converted, calculated, typeof, negated or followed by more: not a plain comparison.
    for (const code of ['Number(count) > 5', 'String(label ?? "") > "a"', 'a + count === 5', 'count === 5 + 1', 'typeof x === "string"', '!open === true', 'f(count) === 1', 'String(x ?? "").length === 0']) {
      expect(literalComparisons(code)).toEqual([]);
    }
  });

  it('knows what the strict type-check refuses', () => {
    expect(rawComparisonMismatch('eq', '', 'number', false)).toBe('number');
    expect(rawComparisonMismatch('eq', null, 'number', true)).toBeNull();
    expect(rawComparisonMismatch('gte', 80, 'number', false)).toBeNull();
    expect(rawComparisonMismatch('gte', 80, 'number', true)).toBe('start value');
    expect(rawComparisonMismatch('lt', 'b', 'string', false)).toBeNull();
    expect(rawComparisonMismatch('lt', 5, 'string', false)).toBe('text');
    expect(rawComparisonMismatch('gt', null, 'any', false)).toBe('number or text');
    expect(rawComparisonMismatch('eq', 'x', 'any', false)).toBeNull();
    expect(rawComparisonMismatch('eq', 'x', 'array', false)).toBe('value');
  });
});
