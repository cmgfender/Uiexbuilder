import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { isExpr } from '../model/types';
import { Inspector } from './Inspector';
import { parseRules } from './rules';
import { loadWith, nodeById, selectTop } from './testUtils';

function row(name: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-prop="${name}"]`);
  if (!el) throw new Error(`prop row ${name} not found`);
  return el;
}

function rulesOfProp(id: string, name: string) {
  const v = nodeById(id).props[name];
  return isExpr(v) ? parseRules(v.$expr) : null;
}

describe('Rules in the Properties tab', () => {
  beforeEach(() => loadWith([]));

  it('sets a progress bar color by percentage in one click and edits the thresholds', async () => {
    loadWith([{ type: 'ProgressBar', props: { title: 'Progress', value: 3, maxValue: 5 } }]);
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(within(row('variant')).getByRole('button', { name: 'Use rules for Color' }));

    const rules = rulesOfProp(node.id, 'variant')!;
    expect(rules.subject).toBe('3 / 5 * 100');
    expect(rules.cases.map((c) => [c.when, c.then])).toEqual([
      [80, 'success'],
      [40, 'warning'],
    ]);
    expect(rules.otherwise).toBe('danger');
    expect(within(row('variant')).getByLabelText(/Based on/)).toHaveDisplayValue('This bar’s percentage');

    const threshold = within(row('variant')).getByLabelText('Rule 2 value to compare with');
    await userEvent.clear(threshold);
    await userEvent.type(threshold, '50');
    expect(rulesOfProp(node.id, 'variant')!.cases[1].when).toBe(50);

    await userEvent.click(within(row('variant')).getByRole('button', { name: 'Add rule' }));
    expect(rulesOfProp(node.id, 'variant')!.cases).toHaveLength(3);
    await userEvent.click(within(row('variant')).getByRole('button', { name: 'Remove rule 3' }));
    expect(rulesOfProp(node.id, 'variant')!.cases).toHaveLength(2);
  });

  it('keeps following the bar when its value changes', async () => {
    loadWith([{ type: 'ProgressBar', props: { value: 3, maxValue: 5 } }]);
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(within(row('variant')).getByRole('button', { name: 'Use rules for Color' }));
    const value = within(row('value')).getByRole('spinbutton');
    await userEvent.clear(value);
    await userEvent.type(value, '4');
    expect(rulesOfProp(node.id, 'variant')!.subject).toBe('4 / 5 * 100');
  });

  it('switching rules off keeps the "Otherwise" value; fx shows the saved expression', async () => {
    loadWith([{ type: 'ProgressBar', props: { value: 3, maxValue: 5 } }]);
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(within(row('variant')).getByRole('button', { name: 'Use rules for Color' }));
    await userEvent.click(within(row('variant')).getByRole('button', { name: 'Use an expression for Color' }));
    expect(within(row('variant')).getByLabelText('Color expression')).toBeInTheDocument();
    await userEvent.click(within(row('variant')).getByRole('button', { name: 'Use rules for Color' }));
    expect(within(row('variant')).getByRole('group', { name: 'Color rules' })).toBeInTheDocument();
    await userEvent.click(within(row('variant')).getByRole('button', { name: 'Stop using rules for Color' }));
    expect(nodeById(node.id).props.variant).toBe('danger');
  });

  it('compares anything in scope, e.g. a state variable, and shows the result right now', async () => {
    loadWith([{ type: 'Tag', text: 'Status' }], 'card', { state: [{ id: 's1', name: 'score', type: 'number', initial: 72 }] });
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(within(row('variant')).getByRole('button', { name: /Use rules for/ }));
    expect(nodeById(node.id).props.variant).toBeUndefined(); // nothing to compare yet
    const basedOn = within(row('variant')).getByLabelText(/Based on/);
    await userEvent.selectOptions(basedOn, within(basedOn).getByRole('option', { name: /^score/ }));
    const rules = rulesOfProp(node.id, 'variant')!;
    expect(rules.subject).toBe('score');
    await userEvent.clear(within(row('variant')).getByLabelText('Rule 1 value to compare with'));
    await userEvent.type(within(row('variant')).getByLabelText('Rule 1 value to compare with'), '70');
    expect(within(row('variant')).getByText(/Right now: 72/)).toBeInTheDocument();
  });

  it('accepts any expression under "Something else"', async () => {
    loadWith([{ type: 'Tag', text: 'Status' }]);
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(within(row('variant')).getByRole('button', { name: /Use rules for/ }));
    const basedOn = within(row('variant')).getByLabelText(/Based on/);
    await userEvent.selectOptions(basedOn, within(basedOn).getByRole('option', { name: /Something else/ }));
    await userEvent.type(within(row('variant')).getByLabelText(/what the rules compare/), 'context.user.id');
    expect(rulesOfProp(node.id, 'variant')!.subject).toBe('context.user.id');
    expect(screen.getByRole('group', { name: /rules/ })).toBeInTheDocument();
  });

  it('shows different text depending on a value', async () => {
    loadWith([{ type: 'Text', text: 'On track' }], 'card', { state: [{ id: 's1', name: 'done', type: 'number', initial: 2 }] });
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(within(row('__text')).getByRole('button', { name: 'Use rules for Text' }));
    const basedOn = within(row('__text')).getByLabelText(/Based on/);
    await userEvent.selectOptions(basedOn, within(basedOn).getByRole('option', { name: /^done/ }));
    const otherwise = within(row('__text')).getByLabelText('Otherwise result');
    await userEvent.clear(otherwise);
    await userEvent.type(otherwise, 'Behind');
    const code = nodeById(node.id).text!;
    expect(code).toMatch(/^\{\{ \(done\) >= 50 \? "On track" : "Behind" \}\}$/);
    await userEvent.click(within(row('__text')).getByRole('button', { name: 'Stop using rules for Text' }));
    expect(nodeById(node.id).text).toBe('Behind');
  });
});
