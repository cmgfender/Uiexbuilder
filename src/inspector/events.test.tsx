import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '../model/store';
import type { ActionStep, FetchAction, IfAction } from '../model/types';
import { createStep, defaultSetValue, summarizeHandler } from './actionModel';
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
    await userEvent.click(screen.getByRole('button', { name: 'If: edit as code' }));
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

  it('fetch actions can set request headers and a timeout', async () => {
    const node = selectTop();
    render(<Inspector />);
    await addAction('Fetch URL');
    const card = screen.getByRole('group', { name: 'Step 1: Fetch URL' });
    await userEvent.click(within(card).getByRole('button', { name: /Headers & timeout/ }));
    await userEvent.click(within(card).getByRole('button', { name: 'Add header' }));
    fireEvent.change(within(card).getByRole('textbox', { name: 'Header 1 name' }), { target: { value: 'X-API-Version' } });
    fireEvent.change(within(card).getByLabelText('Value of header X-API-Version'), { target: { value: '2' } });
    fireEvent.change(within(card).getByLabelText('Timeout (ms)'), { target: { value: '5000' } });
    expect(steps(node.id)[0]).toMatchObject({ type: 'fetch', headers: [{ key: 'X-API-Version', value: '2' }], timeout: 5000 });
    expect(within(card).getByRole('button', { name: /Headers & timeout/ })).toHaveTextContent('1 header, timeout 5000 ms');
    await userEvent.click(within(card).getByRole('button', { name: 'Remove header X-API-Version' }));
    fireEvent.change(within(card).getByLabelText('Timeout (ms)'), { target: { value: '' } });
    const after = steps(node.id)[0] as FetchAction;
    expect(after.headers).toBeUndefined();
    expect(after.timeout).toBeUndefined();
  });

  it('custom code opens in a large editor bound to the step', async () => {
    const node = selectTop();
    render(<Inspector />);
    await addAction('Custom code');
    await userEvent.click(screen.getByRole('button', { name: 'Open custom code in a large editor' }));
    const dialog = screen.getByRole('dialog', { name: 'Custom code' });
    const big = within(dialog).getByLabelText('Custom code (large editor)');
    expect(big).toHaveFocus();
    fireEvent.change(big, { target: { value: 'setCount(count + 2);' } });
    expect(steps(node.id)[0]).toMatchObject({ type: 'custom', code: 'setCount(count + 2);' });
    expect(screen.getByRole('textbox', { name: 'Custom code' })).toHaveValue('setCount(count + 2);');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Custom code' })).toBeNull();
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

describe('context-aware step defaults', () => {
  it('requests start with an error alert; steps added in On error report the failure', async () => {
    loadWith([{ type: 'Button', text: 'Go' }]);
    useEditor.setState({ rightPanel: 'events' });
    const node = selectTop();
    render(<Inspector />);
    await addAction('Fetch URL');
    const failure = { type: 'addAlert', alertType: 'danger', title: 'Something went wrong', message: '{{ error.message }}' };
    expect((steps(node.id)[0] as FetchAction).onError).toEqual([expect.objectContaining(failure)]);
    const card = screen.getByRole('group', { name: 'Step 1: Fetch URL' });
    // [On success "Add action", On error "Add action"]
    await addAction('Show alert', card, 1);
    await addAction('Log', card, 1);
    await addAction('If / else', card, 1);
    await addAction('Show alert', card, 0);
    const f = steps(node.id)[0] as FetchAction;
    expect(f.onError?.[1]).toMatchObject(failure);
    expect(f.onError?.[2]).toMatchObject({ type: 'log', level: 'error', message: '{{ error.message }}' });
    expect(f.onSuccess?.[0]).toMatchObject({ type: 'addAlert', alertType: 'success', message: 'Saved successfully' });
    // If / else branches inside On error inherit it.
    const ifCard = within(screen.getByRole('list', { name: 'On error actions' })).getByRole('group', { name: 'Step 4: If / else' });
    await addAction('Show alert', ifCard, 0);
    expect(((steps(node.id)[0] as FetchAction).onError?.[3] as IfAction).then[0]).toMatchObject(failure);
    // Outside a callback the success default stays.
    await addAction('Show alert', document.body, within(document.body).getAllByRole('button', { name: 'Add action' }).length - 1);
    expect(steps(node.id)[1]).toMatchObject({ type: 'addAlert', alertType: 'success' });
  });

  it('copy to clipboard starts with a copy-worthy variable, or says that nothing will be copied', async () => {
    loadWith([{ type: 'Button', text: 'Copy email' }], 'card', {
      dataSources: [{ id: 'd1', name: 'record', kind: 'crmProperties', properties: ['firstname', 'email'] }],
    });
    useEditor.setState({ rightPanel: 'events' });
    const node = selectTop();
    const { unmount } = render(<Inspector />);
    await addAction('Copy to clipboard');
    expect(steps(node.id)[0]).toMatchObject({ type: 'copyToClipboard', text: '{{ record.email }}' });
    expect(screen.queryByText(/Nothing will be copied yet/)).toBeNull();
    unmount();

    loadWith([{ type: 'Button', text: 'Copy' }]);
    useEditor.setState({ rightPanel: 'events' });
    const other = selectTop();
    render(<Inspector />);
    await addAction('Copy to clipboard');
    expect(steps(other.id)[0]).toMatchObject({ type: 'copyToClipboard', text: '' });
    expect(screen.getByText(/Nothing will be copied yet/)).toBeInTheDocument();
    expect(screen.getByLabelText('Text to copy')).toHaveAttribute('placeholder', 'Text or {{ variable }} to copy');
  });

  it('a new set-variable step gets a typed value, never a blank one', () => {
    const ev = ['event'];
    expect(defaultSetValue({ id: 's', name: 'name', type: 'string', initial: '' }, ev)).toBe("''");
    expect(defaultSetValue({ id: 's', name: 'rows', type: 'array', initial: [] }, ev)).toBe('[]');
    expect(defaultSetValue({ id: 's', name: 'info', type: 'object', initial: {} }, ev)).toBe('{}');
    expect(defaultSetValue({ id: 's', name: 'x', type: 'any', initial: null }, ev)).toBe('null');
    expect(defaultSetValue({ id: 's', name: 'name', type: 'string', initial: '' }, ['value'])).toBe('value');
    expect(defaultSetValue({ id: 's', name: 'n', type: 'number', initial: 0 }, ev)).toBe('n + 1');
  });

  it('switching the variable updates a value the user did not write', async () => {
    loadWith([{ type: 'Button', text: 'Go' }], 'card', {
      state: [
        { id: 's1', name: 'count', type: 'number', initial: 0 },
        { id: 's2', name: 'label', type: 'string', initial: '' },
      ],
    });
    useEditor.setState({ rightPanel: 'events' });
    const node = selectTop();
    render(<Inspector />);
    await addAction('Set variable');
    expect(steps(node.id)[0]).toMatchObject({ state: 'count', value: 'count + 1' });
    await userEvent.selectOptions(screen.getByLabelText('Variable'), 'label');
    expect(steps(node.id)[0]).toMatchObject({ state: 'label', value: "''" });
    fireEvent.change(screen.getByLabelText('New value'), { target: { value: "'Done'" } });
    await userEvent.selectOptions(screen.getByLabelText('Variable'), 'count');
    expect(steps(node.id)[0]).toMatchObject({ state: 'count', value: "'Done'" });
  });
});

describe('new state variable from an action', () => {
  beforeEach(() => {
    loadWith([{ type: 'Button', text: 'Go' }], 'card', {
      dataSources: [{ id: 'd1', name: 'contacts', kind: 'crmSearch', objectType: '0-1', properties: [], filters: [], sorts: [], pageLength: 5 }],
      computed: [{ id: 'c1', name: 'total', expr: '1' }],
    });
    useEditor.setState({ rightPanel: 'events' });
  });

  it('uses the Data panel naming rules', async () => {
    selectTop();
    render(<Inspector />);
    await addAction('Set variable');
    await userEvent.click(screen.getByRole('button', { name: 'New state variable' }));
    const name = screen.getByLabelText('New variable name');
    const create = screen.getByRole('button', { name: 'Create variable' });
    for (const [typed, message] of [
      ['contactsLoading', /Already used by data source “contacts”/],
      ['total', /Already used by computed value “total”/],
      ['logger', /reserved word/],
      ['Math', /reserved word/],
      ['2fast', /cannot start with a number/],
    ] as const) {
      fireEvent.change(name, { target: { value: typed } });
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(create).toBeDisabled();
    }
    fireEvent.change(name, { target: { value: 'status' } });
    expect(create).toBeEnabled();
  });

  it('creating the variable and using it is one undo step', async () => {
    const node = selectTop();
    render(<Inspector />);
    await addAction('Set variable');
    const before = useEditor.getState().past.length;
    await userEvent.click(screen.getByRole('button', { name: 'New state variable' }));
    fireEvent.change(screen.getByLabelText('New variable name'), { target: { value: 'status' } });
    await userEvent.click(screen.getByRole('button', { name: 'Create variable' }));
    expect(ext().state.map((s) => s.name)).toEqual(['status']);
    expect(steps(node.id)[0]).toMatchObject({ state: 'status', value: "''" });
    expect(useEditor.getState().past.length).toBe(before + 1);
    act(() => useEditor.getState().undo());
    expect(ext().state).toEqual([]);
    expect(steps(node.id)[0]).toMatchObject({ type: 'setState', state: '' });
    act(() => useEditor.getState().redo());
    expect(ext().state.map((s) => s.name)).toEqual(['status']);
    expect(steps(node.id)[0]).toMatchObject({ state: 'status' });
  });

  it('creating an app function from a step is one undo step', async () => {
    const node = selectTop();
    render(<Inspector />);
    await addAction('Run app function');
    const before = useEditor.getState().past.length;
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(useEditor.getState().past.length).toBe(before + 1);
    act(() => useEditor.getState().undo());
    expect(useEditor.getState().project.functions).toEqual([]);
    expect(steps(node.id)[0]).toMatchObject({ type: 'runFunction', functionId: '' });
  });
});
