import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '../model/store';
import type { ActionStep, IfAction } from '../model/types';
import { createStep, summarizeHandler } from './actionModel';
import { Inspector } from './Inspector';
import { ext, loadWith, nodeById, selectTop } from './testUtils';

function steps(nodeId: string, event = 'onClick'): ActionStep[] {
  return nodeById(nodeId).events?.[event] ?? [];
}

async function addAction(label: string, within0: HTMLElement = document.body, index = 0) {
  const buttons = within(within0).getAllByRole('button', { name: 'Add action' });
  await userEvent.click(buttons[index]);
  const menu = screen.getByRole('menu', { name: 'Add action' });
  await userEvent.click(within(menu).getByRole('menuitem', { name: new RegExp(`^${label}`) }));
}

describe('Events tab', () => {
  beforeEach(() => {
    loadWith([{ type: 'Button', text: 'Go' }], 'card', { state: [{ id: 's1', name: 'count', type: 'number', initial: 0 }] });
    useEditor.setState({ rightPanel: 'events' });
  });

  it('adds, reorders and deletes actions (persisted via setEvent)', async () => {
    const node = selectTop();
    render(<Inspector />);
    expect(screen.getByText('When clicked: nothing happens yet')).toBeInTheDocument();
    await addAction('Set variable');
    expect(steps(node.id)).toHaveLength(1);
    expect(steps(node.id)[0]).toMatchObject({ type: 'setState', state: 'count', value: 'count + 1' });
    await addAction('Show alert');
    expect(steps(node.id).map((s) => s.type)).toEqual(['setState', 'addAlert']);
    expect(screen.getByText(/When clicked → set count to count \+ 1 → show a success alert/)).toBeInTheDocument();

    const second = screen.getByRole('group', { name: 'Step 2: Show alert' });
    await userEvent.click(within(second).getByRole('button', { name: 'Move up' }));
    expect(steps(node.id).map((s) => s.type)).toEqual(['addAlert', 'setState']);

    const dupTarget = screen.getByRole('group', { name: 'Step 1: Show alert' });
    await userEvent.click(within(dupTarget).getByRole('button', { name: 'Duplicate action' }));
    const after = steps(node.id);
    expect(after.map((s) => s.type)).toEqual(['addAlert', 'addAlert', 'setState']);
    expect(after[0].id).not.toBe(after[1].id);

    await userEvent.click(
      within(screen.getByRole('group', { name: 'Step 3: Set variable' })).getByRole('button', { name: 'Delete action' }),
    );
    await userEvent.click(within(screen.getByRole('group', { name: 'Step 2: Show alert' })).getByRole('button', { name: 'Delete action' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Step 1: Show alert' })).getByRole('button', { name: 'Delete action' }));
    expect(nodeById(node.id).events).toBeUndefined();
  });

  it('edits step fields and offers quick values', async () => {
    const node = selectTop();
    render(<Inspector />);
    await addAction('Set variable');
    fireEvent.change(screen.getByLabelText('New value'), { target: { value: 'count * 2' } });
    expect(steps(node.id)[0]).toMatchObject({ value: 'count * 2' });
    await userEvent.click(screen.getByRole('button', { name: 'Increment' }));
    expect(steps(node.id)[0]).toMatchObject({ value: 'count + 1' });

    await addAction('Show alert');
    const alert = screen.getByRole('group', { name: 'Step 2: Show alert' });
    await userEvent.click(within(alert).getByRole('button', { name: 'Warning' }));
    fireEvent.change(within(alert).getByLabelText('Message'), { target: { value: 'Count is {{ count }}' } });
    expect(steps(node.id)[1]).toMatchObject({ alertType: 'warning', message: 'Count is {{ count }}' });

    // Collapsing shows the plain-language summary.
    await userEvent.click(within(alert).getByRole('button', { name: /Show alert/ }));
    expect(within(alert).getByText('show a warning alert “Count is {{ count }}”')).toBeInTheDocument();
  });

  it('creates a state variable inline from a set-variable step', async () => {
    loadWith([{ type: 'Button', text: 'Go' }]);
    useEditor.setState({ rightPanel: 'events' });
    const node = selectTop();
    render(<Inspector />);
    await addAction('Set variable');
    await userEvent.click(screen.getByRole('button', { name: 'New state variable' }));
    const name = screen.getByLabelText('New variable name');
    await userEvent.clear(name);
    await userEvent.type(name, 'open');
    await userEvent.selectOptions(screen.getByLabelText('New variable type'), 'boolean');
    await userEvent.click(screen.getByRole('button', { name: 'Create variable' }));
    expect(ext().state.find((s) => s.name === 'open')).toMatchObject({ type: 'boolean', initial: false });
    expect(steps(node.id)[0]).toMatchObject({ state: 'open' });
    await userEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    expect(steps(node.id)[0]).toMatchObject({ value: '!open' });
  });

  it('edits nested if / else branches', async () => {
    const node = selectTop();
    render(<Inspector />);
    await addAction('If / else');
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'count > 3' } });
    const thenBranch = screen.getByRole('group', { name: 'Step 1: If / else' });
    // Buttons: [then Add action, else Add action, outer Add action]
    await addAction('Log', thenBranch, 0);
    await addAction('Show alert', thenBranch, 1);
    const s = steps(node.id)[0] as IfAction;
    expect(s.condition).toBe('count > 3');
    expect(s.then.map((x) => x.type)).toEqual(['log']);
    expect(s.else.map((x) => x.type)).toEqual(['addAlert']);
    const thenList = screen.getByRole('list', { name: 'Then actions' });
    fireEvent.change(within(thenList).getByLabelText('Message'), { target: { value: 'big' } });
    expect((steps(node.id)[0] as IfAction).then[0]).toMatchObject({ type: 'log', message: 'big' });
    await userEvent.click(within(thenList).getByRole('button', { name: 'Delete action' }));
    expect((steps(node.id)[0] as IfAction).then).toEqual([]);
  });

  it('fetch callbacks get response / error params', async () => {
    const node = selectTop();
    render(<Inspector />);
    await addAction('Fetch URL');
    const card = screen.getByRole('group', { name: 'Step 1: Fetch URL' });
    expect(within(card).getAllByText('response').length).toBeGreaterThan(0);
    expect(within(card).getAllByText('error').length).toBeGreaterThan(0);
    await addAction('Set variable', card, 0);
    const success = screen.getByRole('list', { name: 'On success actions' });
    expect(within(success).getByRole('button', { name: 'Use response' })).toBeInTheDocument();
    await userEvent.click(within(success).getByRole('button', { name: 'Use response' }));
    expect(steps(node.id)[0]).toMatchObject({ type: 'fetch', onSuccess: [{ type: 'setState', value: 'response' }] });
  });

  it('run function can create an app function', async () => {
    const node = selectTop();
    render(<Inspector />);
    await addAction('Run app function');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    const fn = useEditor.getState().project.functions[0];
    expect(fn).toBeDefined();
    expect(steps(node.id)[0]).toMatchObject({ type: 'runFunction', functionId: fn.id });
  });

  it('hides record refresh outside CRM cards', async () => {
    loadWith([{ type: 'Button', text: 'Go' }], 'settings');
    useEditor.setState({ rightPanel: 'events' });
    selectTop();
    render(<Inspector />);
    await userEvent.click(screen.getByRole('button', { name: 'Add action' }));
    const menu = screen.getByRole('menu', { name: 'Add action' });
    expect(within(menu).queryByRole('menuitem', { name: /Refresh record properties/ })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: /Reload page/ })).toBeInTheDocument();
  });

  it('shows the events count on the tab', () => {
    const node = selectTop();
    act(() =>
      useEditor
        .getState()
        .setEvent(node.id, 'onClick', [
          createStep('reloadPage', { project: useEditor.getState().project, ext: ext(), nodeId: node.id, eventParams: ['event'] }),
        ]),
    );
    render(<Inspector />);
    expect(screen.getByRole('tab', { name: /Events/ })).toHaveTextContent('1');
  });
});

describe('summaries', () => {
  it('reads as plain language', () => {
    loadWith([]);
    const ctx = { project: useEditor.getState().project, ext: ext() };
    const steps: ActionStep[] = [
      { id: 'a1', type: 'setState', state: 'count', value: 'count + 1' },
      { id: 'a2', type: 'addAlert', alertType: 'success', title: 'Saved', message: '' },
    ];
    expect(summarizeHandler('On click', steps, ctx)).toBe('When clicked → set count to count + 1 → show a success alert “Saved”');
    expect(summarizeHandler('On change', [], ctx)).toBe('When changed: nothing happens yet');
  });
});
