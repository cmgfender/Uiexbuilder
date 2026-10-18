import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '../model/store';
import type { IfAction } from '../model/types';
import { Inspector } from './Inspector';
import { loadWith, nodeById, selectTop } from './testUtils';

const showWhen = () => screen.getByRole('group', { name: 'Show when' });

function pick(select: HTMLElement, name: RegExp) {
  return userEvent.selectOptions(select, within(select).getByRole('option', { name }));
}

describe('condition builder: Advanced › Visibility', () => {
  beforeEach(() => {
    loadWith([{ type: 'Text', text: 'Hi' }], 'card', {
      state: [
        { id: 's1', name: 'count', type: 'number', initial: 0 },
        { id: 's2', name: 'items', type: 'array', initial: ['a'] },
        { id: 's3', name: 'name', type: 'string', initial: 'Ada' },
      ],
      dataSources: [{ id: 'd1', name: 'record', kind: 'crmProperties', properties: ['firstname'] }],
    });
    useEditor.setState({ rightPanel: 'advanced' });
  });

  it('builds AND / OR checks without code and shows the result right now', async () => {
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(within(showWhen()).getByRole('button', { name: 'Add a condition' }));
    await pick(within(showWhen()).getByLabelText('Check 1: what to check'), /^count/);
    // A number starts with "is more than".
    expect(within(showWhen()).getByLabelText('Check 1: comparison')).toHaveDisplayValue('is more than');
    const value = within(showWhen()).getByLabelText('Check 1: value');
    await userEvent.clear(value);
    await userEvent.type(value, '5');
    expect(nodeById(node.id).condition).toBe('count > 5');
    expect(screen.getByText('Currently: hidden')).toBeInTheDocument();

    await userEvent.click(within(showWhen()).getByRole('button', { name: /Or…/ }));
    await pick(within(showWhen()).getByLabelText('Group 2, check 1: what to check'), /^items/);
    expect(within(showWhen()).getByLabelText('Group 2, check 1: comparison')).toHaveDisplayValue('is not empty');
    expect(nodeById(node.id).condition).toBe('count > 5 || String(items ?? "").length !== 0');
    expect(screen.getByText('Currently: shown')).toBeInTheDocument();
    expect(within(showWhen()).getAllByRole('img', { name: /right now/ }).map((e) => e.getAttribute('aria-label'))).toEqual([
      'False right now',
      'True right now',
    ]);

    // Text: "contains" is case-insensitive.
    await userEvent.click(within(showWhen()).getAllByRole('button', { name: /And…/ })[0]);
    await pick(within(showWhen()).getByLabelText('Group 1, check 2: what to check'), /^name/);
    await userEvent.selectOptions(within(showWhen()).getByLabelText('Group 1, check 2: comparison'), 'contains');
    await userEvent.type(within(showWhen()).getByLabelText('Group 1, check 2: value'), 'AD');
    expect(nodeById(node.id).condition).toBe('(count > 5 && String(name ?? "").toLowerCase().includes("ad")) || String(items ?? "").length !== 0');

    await userEvent.click(within(showWhen()).getByRole('button', { name: 'Remove group 2, check 1' }));
    expect(nodeById(node.id).condition).toBe('count > 5 && String(name ?? "").toLowerCase().includes("ad")');
  });

  it('shows hand-written conditions of the same shape in the builder', () => {
    useEditor.getState().updateNode(selectTop().id, { condition: '!recordLoading && count === 0' });
    render(<Inspector />);
    expect(within(showWhen()).getByLabelText('Check 1: what to check')).toHaveDisplayValue(/^recordLoading/);
    expect(within(showWhen()).getByLabelText('Check 1: comparison')).toHaveDisplayValue('is false');
    expect(within(showWhen()).getByLabelText('Check 2: value')).toHaveValue('0');
  });

  it('falls back to code for anything else', async () => {
    const node = selectTop();
    useEditor.getState().updateNode(node.id, { condition: 'items.some((i) => i === "a")' });
    render(<Inspector />);
    expect(screen.getByLabelText('Visibility condition')).toHaveValue('items.some((i) => i === "a")');
    expect(within(showWhen()).getByRole('button', { name: 'Use the builder' })).toBeDisabled();
    await userEvent.click(within(showWhen()).getByRole('button', { name: 'Start over with the builder' }));
    expect(nodeById(node.id).condition).toBeUndefined();
    expect(within(showWhen()).getByLabelText('Check 1: what to check')).toBeInTheDocument();
  });

  it('compares with another value in scope', async () => {
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(within(showWhen()).getByRole('button', { name: 'Add a condition' }));
    await pick(within(showWhen()).getByLabelText('Check 1: what to check'), /^items\.length|^count/);
    await userEvent.click(within(showWhen()).getByRole('button', { name: /Compare with another value/ }));
    await pick(within(showWhen()).getByLabelText('Check 1: value to compare with'), /^items\.length$|^name/);
    expect(nodeById(node.id).condition).toMatch(/^count > (Number\(name\)|items\.length)$/);
  });
});

describe('condition builder: If step', () => {
  it('a new If step starts with a check to fill in', async () => {
    loadWith([{ type: 'Button', text: 'Go' }], 'card', { state: [{ id: 's1', name: 'open', type: 'boolean', initial: false }] });
    useEditor.setState({ rightPanel: 'events' });
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(screen.getAllByRole('button', { name: 'Add action' })[0]);
    await userEvent.click(screen.getByRole('menuitem', { name: /If \/ else/ }));
    const cond = screen.getByRole('group', { name: 'If' });
    await pick(within(cond).getByLabelText('Check 1: what to check'), /^open/);
    expect(within(cond).getByLabelText('Check 1: comparison')).toHaveDisplayValue('is true');
    const step = nodeById(node.id).events!.onClick[0] as IfAction;
    expect(step.condition).toBe('open');
    expect(screen.getByText(/if open has a value|if open is true/)).toBeInTheDocument();
  });
});
