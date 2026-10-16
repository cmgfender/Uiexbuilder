import { describe, expect, it } from 'vitest';
import { getComponent } from '../registry';
import type { PropDef } from '../registry/types';
import { initialRules, parseRules, rulesOf, rulesToExpr, supportsRules, syncRuleSubjects, type RuleSet } from './rules';

const variantDef = getComponent('ProgressBar')!.props.find((p) => p.name === 'variant') as PropDef;
const descDef = getComponent('ProgressBar')!.props.find((p) => p.name === 'valueDescription') as PropDef;

function evaluate(expr: string): unknown {
  return new Function(`return (${expr});`)();
}

describe('rules', () => {
  const colorByPercent: RuleSet = {
    subject: '3 / 5 * 100',
    cases: [
      { op: '>=', when: 80, then: 'success' },
      { op: '>=', when: 40, then: 'warning' },
    ],
    otherwise: 'danger',
  };

  it('writes a plain expression that picks the first matching rule', () => {
    const expr = rulesToExpr(colorByPercent);
    expect(expr).toBe('(3 / 5 * 100) >= 80 ? "success" : (3 / 5 * 100) >= 40 ? "warning" : "danger"');
    expect(evaluate(expr)).toBe('warning');
    expect(evaluate(rulesToExpr({ ...colorByPercent, subject: '9 / 10 * 100' }))).toBe('success');
    expect(evaluate(rulesToExpr({ ...colorByPercent, subject: '1 / 10 * 100' }))).toBe('danger');
  });

  it('reads back what it wrote, including text, quotes and nested parentheses', () => {
    expect(parseRules(rulesToExpr(colorByPercent))).toEqual(colorByPercent);
    const text: RuleSet = {
      subject: 'String(properties.dealstage ?? "(none)")',
      cases: [
        { op: '===', when: 'closedwon', then: 'Won — "great" job' },
        { op: '!==', when: 'open', then: '' },
      ],
      otherwise: null,
    };
    expect(parseRules(rulesToExpr(text))).toEqual(text);
    expect(parseRules(rulesToExpr({ subject: 'x', cases: [{ op: '<', when: -1.5, then: false }], otherwise: true }))).toEqual({
      subject: 'x',
      cases: [{ op: '<', when: -1.5, then: false }],
      otherwise: true,
    });
  });

  it('leaves other expressions alone', () => {
    for (const expr of [
      'count > 0',
      '"success"',
      'a >= 1 ? "x" : "y"', // subject not parenthesised
      '(a) >= 1 ? "x" : (b) >= 2 ? "y" : "z"', // different subjects
      '(a) >= 1 ? x : "y"', // result is not a literal
      '(a) >= 1 ? "x" : "y" + z',
      '(a >= 1 ? "x" : "y"',
    ]) {
      expect(parseRules(expr)).toBeNull();
    }
    expect(rulesOf('literal')).toBeNull();
  });

  it('starts a progress bar color with green / yellow / red by percentage', () => {
    const node = { type: 'ProgressBar', props: { value: 3, maxValue: 5 } };
    const rules = initialRules(node, variantDef);
    expect(rules.subject).toBe('3 / 5 * 100');
    expect(rules.cases.map((c) => [c.op, c.when, c.then])).toEqual([
      ['>=', 80, 'success'],
      ['>=', 40, 'warning'],
    ]);
    expect(rules.otherwise).toBe('danger');
    // Other props start from their current value.
    const desc = initialRules({ type: 'ProgressBar', props: { value: 3, maxValue: 5, valueDescription: 'On track' } }, descDef);
    expect(desc.cases[0].then).toBe('On track');
    expect(desc.otherwise).toBe('On track');
  });

  it('uses expressions the bar is computed from', () => {
    const node = { type: 'ProgressBar', props: { value: { $expr: 'properties.done' }, maxValue: 10 } };
    expect(initialRules(node, variantDef).subject).toBe('(properties.done) / 10 * 100');
  });

  it('keeps rules following the bar when its value changes', () => {
    const node = {
      type: 'ProgressBar',
      props: {
        value: 3,
        maxValue: 5,
        variant: { $expr: rulesToExpr(colorByPercent) },
        title: { $expr: rulesToExpr({ subject: 'otherThing', cases: [{ op: '>', when: 1, then: 'a' }], otherwise: 'b' }) },
      },
    };
    const extra = syncRuleSubjects(node, { value: { $expr: 'properties.done' } });
    expect(Object.keys(extra)).toEqual(['variant']);
    expect(rulesOf(extra.variant)!.subject).toBe('(properties.done) / 5 * 100');
    expect(syncRuleSubjects(node, { title: 'x' })).toEqual({});
    expect(syncRuleSubjects({ type: 'Text', props: {} }, { text: 'x' })).toEqual({});
  });

  it('is offered for simple values only', () => {
    expect(supportsRules(variantDef)).toBe(true);
    expect(supportsRules(descDef)).toBe(true);
    const options = getComponent('Select')!.props.find((p) => p.name === 'options') as PropDef;
    expect(supportsRules(options)).toBe(false);
  });
});
