import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createExtension, createProject } from '../model/factory';
import { selectActiveExtension, useEditor } from '../model/store';
import type { DataSource, NodeTemplate } from '../model/types';
import { useDialogs } from '../shell/dialogs';
import { ToastProvider } from '../ui';
import { DataPanel } from './DataPanel';
import { revealDataItem, useDataReveal } from './reveal';

function reset(content: NodeTemplate[] = []) {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  const ext = createExtension({ name: 'Test Card', objectTypes: ['contacts'], content });
  useEditor.getState().loadProject(createProject('Test App', [ext]));
  useDialogs.getState().close();
}

function active() {
  return selectActiveExtension(useEditor.getState());
}

function renderPanel() {
  return render(
    <ToastProvider>
      <DataPanel />
    </ToastProvider>,
  );
}

function commitInput(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

beforeEach(() => reset());

describe('<DataPanel> state variables', () => {
  it('adds, renames (updating references), retypes and deletes a state variable', () => {
    reset([{ type: 'Text', name: 'greeting', text: 'Hi {{ value }}' }]);
    renderPanel();
    expect(screen.getByText('No state yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add state variable' }));
    expect(active().state).toHaveLength(1);
    const v = active().state[0];
    expect(v).toMatchObject({ name: 'value', type: 'string', initial: '' });

    const name = screen.getByRole('textbox', { name: 'Variable name' });
    expect(name).toHaveFocus();
    commitInput(name, 'firstName');
    expect(active().state[0].name).toBe('firstName');
    const text = Object.values(active().nodes).find((n) => n.name === 'greeting')!;
    expect(text.text).toBe('Hi {{ firstName }}');
    expect(screen.getByText(/updated 1 reference/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Variable type' }), { target: { value: 'number' } });
    expect(active().state[0]).toMatchObject({ type: 'number', initial: 0 });
    fireEvent.change(screen.getByLabelText('Initial value'), { target: { value: '7' } });
    expect(active().state[0].initial).toBe(7);

    // Used in a text -> warning first.
    fireEvent.click(screen.getByRole('button', { name: 'Delete variable' }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('“firstName” is used in 1 place');
    expect(alert).toHaveTextContent('greeting · Text');
    fireEvent.click(within(alert).getByRole('button', { name: 'Cancel' }));
    expect(active().state).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete variable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete anyway' }));
    expect(active().state).toHaveLength(0);
  });

  it('rejects invalid and duplicate names without committing', () => {
    renderPanel();
    act(() => {
      useEditor.getState().addStateVar({ name: 'count', type: 'number', initial: 0 });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add state variable' }));
    const input = screen.getByRole('textbox', { name: 'Variable name' });
    commitInput(input, 'count');
    expect(screen.getByRole('alert')).toHaveTextContent('Already used by state variable “count”');
    commitInput(input, 'setCount');
    expect(screen.getByRole('alert')).toHaveTextContent(/Conflicts with “setCount”|Already used/);
    commitInput(input, 'my var');
    expect(screen.getByRole('alert')).toHaveTextContent(/letters, numbers/);
    expect(active().state.map((s) => s.name)).toEqual(['count', 'value']);
    // Escape / blur reverts the draft.
    fireEvent.blur(input);
    expect(input).toHaveValue('value');
  });

  it('deletes unused variables immediately and edits booleans and JSON values', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add state variable' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Variable type' }), { target: { value: 'boolean' } });
    expect(active().state[0]).toMatchObject({ type: 'boolean', initial: false });
    fireEvent.click(screen.getByLabelText(/Initial value/));
    expect(active().state[0].initial).toBe(true);
    fireEvent.change(screen.getByRole('combobox', { name: 'Variable type' }), { target: { value: 'array' } });
    expect(active().state[0]).toMatchObject({ type: 'array', initial: [] });
    const json = screen.getByRole('textbox', { name: 'Initial value (JSON)' });
    fireEvent.change(json, { target: { value: '[1, 2' } });
    expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument();
    expect(active().state[0].initial).toEqual([]);
    fireEvent.change(json, { target: { value: '[1, 2]' } });
    expect(active().state[0].initial).toEqual([1, 2]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete variable' }));
    expect(active().state).toHaveLength(0);
  });
});

describe('<DataPanel> data sources', () => {
  it('adds a record properties source, renames it, generates UI and deletes it with a warning', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add data' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Current record properties/ }));
    const ds = active().dataSources[0];
    expect(ds).toMatchObject({ kind: 'crmProperties', name: 'record', properties: ['firstname', 'lastname', 'email'] });
    expect(screen.getByText('3 properties of current record')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove email' })).toBeInTheDocument();

    commitInput(screen.getByRole('textbox', { name: 'Data source name' }), 'contact');
    expect(active().dataSources[0].name).toBe('contact');

    fireEvent.click(screen.getByRole('button', { name: /Generate UI/ }));
    const ext = active();
    const root = ext.nodes[ext.rootId];
    expect(root.children).toHaveLength(1);
    const block = ext.nodes[root.children[0]];
    expect(block.children.map((id) => ext.nodes[id].type)).toEqual(['LoadingSpinner', 'Alert', 'Button', 'DescriptionList']);
    expect(ext.nodes[block.children[1]].text).toBe('{{ contactError }}');
    const list = ext.nodes[block.children[3]];
    expect(list.children).toHaveLength(3);
    expect(ext.nodes[ext.nodes[list.children[0]].children[0]].text).toBe('{{ contact.firstname }}');
    expect(useEditor.getState().selectedNodeId).toBe(block.id);

    // Rename again: generated references follow.
    commitInput(screen.getByRole('textbox', { name: 'Data source name' }), 'person');
    const after = active();
    expect(after.nodes[after.nodes[list.children[0]].children[0]].text).toBe('{{ person.firstname }}');

    fireEvent.click(screen.getByRole('button', { name: 'Delete source' }));
    // 3 property values plus the loading / error / loaded conditions, the error text and the retry button.
    expect(screen.getByRole('alert')).toHaveTextContent('is used in 9 places');
    fireEvent.click(screen.getByRole('button', { name: 'Delete anyway' }));
    expect(active().dataSources).toHaveLength(0);
  });

  it('edits properties with suggestions', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add data' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Current record properties/ }));
    const chips = screen.getByRole('combobox', { name: 'Properties' });
    fireEvent.focus(chips);
    fireEvent.change(chips, { target: { value: 'jobt' } });
    const option = screen.getByRole('option', { name: /jobtitle/ });
    fireEvent.mouseDown(option);
    expect(active().dataSources[0]).toMatchObject({ properties: ['firstname', 'lastname', 'email', 'jobtitle'] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove lastname' }));
    expect(active().dataSources[0]).toMatchObject({ properties: ['firstname', 'email', 'jobtitle'] });
  });

  it('adds an association source and generates a table with loading, error and empty states', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add data' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Associated records/ }));
    const ds = active().dataSources[0];
    expect(ds).toMatchObject({ kind: 'associations', name: 'associatedDeals', toObjectType: '0-3' });
    expect(screen.getByText(/Associated deals/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Associated object type' }), { target: { value: '0-2' } });
    expect(active().dataSources[0]).toMatchObject({ toObjectType: '0-2' });
    fireEvent.click(screen.getByRole('button', { name: /Generate UI/ }));
    const ext = active();
    const flex = ext.nodes[ext.nodes[ext.rootId].children[0]];
    expect(flex.children.map((id) => ext.nodes[id].type)).toEqual(['LoadingSpinner', 'Alert', 'Button', 'Table', 'EmptyState']);
    expect(ext.nodes[flex.children[0]].condition).toBe('associatedDealsLoading');
    expect(ext.nodes[flex.children[1]].condition).toBe('!associatedDealsLoading && associatedDealsError');
    expect(ext.nodes[flex.children[4]].condition).toBe('!associatedDealsLoading && !associatedDealsError && associatedDeals.length === 0');
  });

  it('creates an app function when adding a function source to a project without functions', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add data' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /App function/ }));
    const fn = useEditor.getState().project.functions[0];
    expect(fn).toBeDefined();
    expect(active().dataSources[0]).toMatchObject({ kind: 'function', functionId: fn.id, runOnMount: true });
    expect(screen.getAllByText(`Runs ${fn.uid}`).length).toBeGreaterThan(0);
  });

  it('shows the permitted URL origin for fetch sources', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add data' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /External API/ }));
    expect(active().dataSources[0]).toMatchObject({ kind: 'fetch', url: 'https://api.example.com/items' });
    expect(screen.getByText('https://api.example.com')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Method'), { target: { value: 'POST' } });
    expect(active().dataSources[0]).toMatchObject({ method: 'POST' });
    expect(screen.getByLabelText('Request body')).toBeInTheDocument();
  });

  it('disables CRM-only kinds outside record cards', () => {
    const settings = createExtension({ kind: 'settings' });
    useEditor.getState().loadProject(createProject('S', [settings]));
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add data' }));
    expect(screen.getByRole('menuitem', { name: /Current record properties/ })).toBeDisabled();
    expect(screen.getByRole('menuitem', { name: /External API/ })).not.toBeDisabled();
  });
});

describe('<DataPanel> functions and mock data', () => {
  it('lists app functions and opens the functions dialog', () => {
    act(() => {
      useEditor.getState().addFunction('getQuote');
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /getquote/ }));
    expect(useDialogs.getState().current).toBe('functions');
    expect(useDialogs.getState().arg).toBe(useEditor.getState().project.functions[0].id);
    fireEvent.click(screen.getByRole('button', { name: 'Manage functions…' }));
    expect(useDialogs.getState()).toMatchObject({ current: 'functions', arg: null });
  });

  it('adds missing mock properties and edits mock values', () => {
    act(() => {
      useEditor.getState().updateMock((m) => {
        m.properties = { firstname: 'Ada' };
      });
      useEditor.getState().addDataSource({ kind: 'crmProperties', name: 'record', properties: ['firstname', 'jobtitle', 'city'] } as DataSource);
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Mock data/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add missing (2)' }));
    const props = active().mock.properties;
    expect(Object.keys(props)).toEqual(['firstname', 'jobtitle', 'city']);
    expect(props.jobtitle).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Value of firstname' }), { target: { value: 'Grace' } });
    expect(active().mock.properties.firstname).toBe('Grace');
    fireEvent.click(screen.getByRole('button', { name: 'Remove city' }));
    expect(active().mock.properties.city).toBeUndefined();
    fireEvent.change(screen.getByLabelText('User first name'), { target: { value: 'Sam' } });
    expect(active().mock.context.user.firstName).toBe('Sam');
  });

  it('generates and clears mock results for data sources', () => {
    act(() => {
      useEditor
        .getState()
        .addDataSource({ kind: 'associations', name: 'deals', toObjectType: '0-3', properties: ['dealname'], pageLength: 2 } as DataSource);
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Mock data/ }));
    const id = active().dataSources[0].id;
    fireEvent.click(screen.getByRole('button', { name: 'Generate sample for deals' }));
    const mock = active().mock.dataSources[id] as Array<{ properties: Record<string, string> }>;
    expect(mock).toHaveLength(2);
    expect(mock[0].properties.dealname).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear mock for deals (use generated)' }));
    expect(active().mock.dataSources[id]).toBeUndefined();
  });

  it('simulates loading, empty and error states per data source', () => {
    act(() => {
      useEditor.getState().addDataSource({ kind: 'fetch', name: 'weather', url: 'https://api.example.com/w', method: 'GET', runOnMount: true } as DataSource);
    });
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Mock data/ }));
    const id = active().dataSources[0].id;
    const group = screen.getByRole('group', { name: 'Simulate weather' });
    expect(within(group).getByRole('button', { name: 'Normal' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: 'Error' }));
    expect(active().mock.simulate).toEqual({ [id]: 'error' });
    fireEvent.click(within(group).getByRole('button', { name: 'Loading' }));
    expect(active().mock.simulate).toEqual({ [id]: 'loading' });
    fireEvent.click(within(group).getByRole('button', { name: 'Normal' }));
    expect(active().mock.simulate).toBeUndefined();
  });
});

describe('<DataPanel> reveal requests', () => {
  it('expands the state variable or data source a problem points at', () => {
    useEditor.getState().addStateVar({ name: 'count', type: 'number', initial: 0 });
    const ds = useEditor.getState().addDataSource({ kind: 'fetch', name: 'quote', url: 'https://api.example.com/q', method: 'GET', runOnMount: true } as Omit<DataSource, 'id'>);
    const stateId = active().state[0].id;
    revealDataItem('state', stateId);
    renderPanel();
    // The state row opened (its name field is visible) and the request was consumed.
    expect(screen.getByDisplayValue('count')).toBeInTheDocument();
    expect(useDataReveal.getState().target).toBeNull();

    act(() => revealDataItem('dataSource', ds.id));
    expect(screen.getByDisplayValue('quote')).toBeInTheDocument();
    expect(useDataReveal.getState().target).toBeNull();
  });
});
