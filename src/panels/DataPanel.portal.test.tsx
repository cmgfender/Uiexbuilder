import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as connect from '../connect';
import type { CrmPropertyDef, CrmRecord } from '../connect';
import { createExtension, createProject } from '../model/factory';
import { selectActiveExtension, useEditor } from '../model/store';
import type { DataSource } from '../model/types';
import { useDialogs } from '../shell/dialogs';
import { ToastProvider } from '../ui';
import { DataPanel } from './DataPanel';
import { connectFakePortal, disconnectFakePortal } from './portalTestUtils';
import { revealDataItem } from './reveal';

// A fake connected HubSpot account behind the catalog hooks (the connection store stays real).
vi.mock('../connect', async (importOriginal) => {
  const { mockConnect } = await import('./portalTestUtils');
  return mockConnect(await importOriginal());
});

function reset() {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  const ext = createExtension({ name: 'Test Card', objectTypes: ['contacts'], content: [] });
  useEditor.getState().loadProject(createProject('Test App', [ext]));
  useDialogs.getState().close();
  connect.useLiveData.setState({ mode: 'mock', recordByExtension: {}, portalByExtension: {}, error: null });
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

function addSearch(patch: Partial<Extract<DataSource, { kind: 'crmSearch' }>> = {}) {
  const ds = useEditor.getState().addDataSource({
    kind: 'crmSearch',
    name: 'found',
    objectType: '0-1',
    properties: ['firstname'],
    filters: [],
    sorts: [],
    pageLength: 5,
    ...patch,
  } as Omit<DataSource, 'id'>);
  revealDataItem('dataSource', ds.id);
  return ds;
}

function historyLength(): number {
  return useEditor.getState().past.length;
}

beforeEach(() => reset());
afterEach(() => {
  disconnectFakePortal(connect);
  vi.restoreAllMocks();
});

describe('<DataPanel> with a connected HubSpot account', () => {
  beforeEach(() => connectFakePortal(connect));

  it('lists the account’s custom objects in the search object type and suggests their properties', () => {
    addSearch();
    renderPanel();
    const select = screen.getByRole('combobox', { name: 'Object type' });
    const custom = select.querySelector('optgroup[label="Your custom objects"]') as HTMLElement;
    expect(custom).not.toBeNull();
    fireEvent.change(select, { target: { value: within(custom).getByRole('option', { name: 'Projects (2-555)' }).getAttribute('value') } });
    expect(active().dataSources[0]).toMatchObject({ objectType: '2-555' });

    const picker = screen.getByRole('combobox', { name: 'Properties' });
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: 'Budget' } });
    fireEvent.keyDown(picker, { key: 'Enter' });
    expect(active().dataSources[0]).toMatchObject({ properties: ['firstname', 'budget'] });
    expect(screen.getByRole('list', { name: 'Property warnings' })).toHaveTextContent('firstname: Not found in your portal');
  });

  it('offers a dropdown property’s choices as the filter value and a date picker for dates', () => {
    addSearch({
      filters: [
        { propertyName: 'lifecyclestage', operator: 'EQ', value: '' },
        { propertyName: 'renewal_date', operator: 'GT', value: '' },
      ],
    });
    renderPanel();
    const choice = screen.getByRole('combobox', { name: 'Filter 1 value' });
    expect(choice.tagName).toBe('SELECT');
    // HubSpot's display order.
    expect(within(choice).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a value…', 'Subscriber', 'Lead', 'Customer']);
    fireEvent.change(choice, { target: { value: 'customer' } });
    expect(active().dataSources[0]).toMatchObject({ filters: [{ propertyName: 'lifecyclestage', value: 'customer' }, {}] });

    const date = screen.getByLabelText('Filter 2 value');
    expect(date).toHaveAttribute('type', 'date');
    fireEvent.change(date, { target: { value: '2026-12-31' } });
    expect(active().dataSources[0]).toMatchObject({ filters: [{}, { propertyName: 'renewal_date', value: '2026-12-31' }] });

    // "Is any of" offers the choices as checkboxes (the chosen value stays checked).
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter 1 operator' }), { target: { value: 'IN' } });
    const group = screen.getByRole('group', { name: 'Filter 1 value' });
    expect(within(group).getByRole('checkbox', { name: 'Customer' })).toBeChecked();
    fireEvent.click(within(group).getByRole('checkbox', { name: 'Lead' }));
    expect(active().dataSources[0]).toMatchObject({ filters: [{ operator: 'IN', value: 'lead, customer' }, {}] });
    fireEvent.click(within(group).getByRole('checkbox', { name: 'Customer' }));
    expect(active().dataSources[0]).toMatchObject({ filters: [{ operator: 'IN', value: 'lead' }, {}] });
  });

  it('switches a filter to another property with the picker and clears a value that no longer fits', () => {
    addSearch({ filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'lead' }] });
    renderPanel();
    const picker = screen.getByRole('combobox', { name: 'Filter 1 property' });
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: 'Favorite' } });
    fireEvent.keyDown(picker, { key: 'Enter' });
    expect(active().dataSources[0]).toMatchObject({ filters: [{ propertyName: 'favorite_color', value: '' }] });
    expect(within(screen.getByRole('combobox', { name: 'Filter 1 value' })).getByRole('option', { name: 'Red' })).toBeInTheDocument();
  });

  it('“Generate UI” uses the account’s property labels', () => {
    const labelled: CrmPropertyDef[] = [{ name: 'favorite_color', label: 'Favourite colour', type: 'enumeration', fieldType: 'select', groupName: 'preferences' }];
    vi.spyOn(connect.getConnectorClient(), 'peek').mockImplementation(((kind: string, type?: string) =>
      kind === 'properties' && type === 'contacts' ? labelled : undefined) as never);
    const ds = useEditor.getState().addDataSource({ kind: 'crmProperties', name: 'record', properties: ['favorite_color', 'firstname'] } as Omit<DataSource, 'id'>);
    revealDataItem('dataSource', ds.id);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Generate UI/ }));
    const ext = active();
    const labels = Object.values(ext.nodes)
      .filter((n) => n.type === 'DescriptionListItem')
      .map((n) => n.props.label);
    expect(labels).toEqual(['Favourite colour', 'First name']);
  });

  it('copies the sample record’s values into the mock record as one undo step', async () => {
    const extId = active().id;
    useEditor.getState().addDataSource({ kind: 'crmProperties', name: 'record', properties: ['firstname', 'favorite_color'] } as Omit<DataSource, 'id'>);
    act(() => {
      useEditor.getState().updateMock((m) => {
        m.properties = { firstname: 'Mock', email: 'mock@example.com' };
      });
    });
    const getRecord = vi.spyOn(connect.getConnectorClient(), 'getRecord').mockResolvedValue({
      id: '101',
      objectType: 'contacts',
      objectTypeId: '0-1',
      properties: { firstname: 'Ada', email: 'ada@acme.com', favorite_color: 'blue' },
    } satisfies CrmRecord);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Mock data/ }));

    // No sample record picked yet: the button explains what to do first.
    const button = screen.getByRole('button', { name: 'Use a real record as mock data' });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Pick a sample record in the preview toolbar first/)).toBeInTheDocument();

    act(() => {
      connect.useLiveData.setState({
        recordByExtension: { [extId]: { id: '101', objectType: 'contacts', objectTypeId: '0-1', label: 'Ada Lovelace' } },
        portalByExtension: { [extId]: 12345678 },
      });
    });
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    const steps = historyLength();
    fireEvent.click(screen.getByRole('button', { name: 'Use a real record as mock data' }));
    await waitFor(() => expect(active().mock.properties.firstname).toBe('Ada'));
    expect(getRecord).toHaveBeenCalledWith('0-1', '101', { properties: ['firstname', 'email', 'favorite_color'] });
    expect(active().mock.properties).toEqual({ firstname: 'Ada', email: 'ada@acme.com', favorite_color: 'blue' });
    expect(active().mock.context.crm).toMatchObject({ objectId: 101, objectTypeId: '0-1' });
    expect(historyLength()).toBe(steps + 1);
    expect(await screen.findByText(/Copied 3 properties from Ada Lovelace/)).toBeInTheDocument();

    act(() => useEditor.getState().undo());
    expect(active().mock.properties).toEqual({ firstname: 'Mock', email: 'mock@example.com' });
  });

  it('marks sources that load live from HubSpot instead of offering mock simulations', () => {
    const extId = active().id;
    addSearch();
    useEditor.getState().addDataSource({ kind: 'function', name: 'calc', functionId: 'calc', runOnMount: true } as Omit<DataSource, 'id'>);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Mock data/ }));
    // Mock mode: every source can be simulated.
    expect(screen.getByRole('group', { name: 'Simulate found' })).toBeInTheDocument();
    expect(screen.queryByText(/Sources marked Live load real data/)).toBeNull();

    act(() => {
      connect.useLiveData.setState({
        mode: 'live',
        recordByExtension: { [extId]: { id: '101', objectType: 'contacts', objectTypeId: '0-1', label: 'Ada Lovelace' } },
        portalByExtension: { [extId]: 12345678 },
      });
    });
    expect(screen.queryByRole('group', { name: 'Simulate found' })).toBeNull();
    expect(screen.getByTitle('Loads real data from HubSpot')).toHaveTextContent('Live');
    expect(screen.getByText(/Sources marked Live load real data/)).toBeInTheDocument();
    // Functions keep their mocks, so they can still be simulated.
    expect(screen.getByRole('group', { name: 'Simulate calc' })).toBeInTheDocument();
    act(() => connect.useLiveData.setState({ mode: 'mock' }));
    expect(screen.getByRole('group', { name: 'Simulate found' })).toBeInTheDocument();
  });

  it('explains a failed copy in plain language and leaves the mock data alone', async () => {
    const extId = active().id;
    act(() => {
      useEditor.getState().updateMock((m) => {
        m.properties = { firstname: 'Mock' };
      });
      connect.useLiveData.setState({
        recordByExtension: { [extId]: { id: '101', objectType: 'contacts', objectTypeId: '0-1', label: 'Ada Lovelace' } },
        portalByExtension: { [extId]: 12345678 },
      });
    });
    vi.spyOn(connect.getConnectorClient(), 'getRecord').mockRejectedValue(
      new connect.ConnectorError({ code: 'not_found', message: 'Record not found', status: 404 }),
    );
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /Mock data/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Use a real record as mock data' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(active().mock.properties).toEqual({ firstname: 'Mock' });
  });
});

describe('<DataPanel> without HubSpot', () => {
  it('keeps the standard object types, text filter values and no “real record” button', () => {
    addSearch({ filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: '' }] });
    renderPanel();
    const select = screen.getByRole('combobox', { name: 'Object type' });
    expect(select.querySelector('optgroup[label="Your custom objects"]')).toBeNull();
    expect(screen.getByLabelText('Filter 1 value').tagName).not.toBe('SELECT');
    // Built-in suggestions still work.
    const picker = screen.getByRole('combobox', { name: 'Properties' });
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: 'jobt' } });
    expect(within(screen.getByRole('listbox', { name: 'Property suggestions' })).getByRole('option', { name: /jobtitle/ })).toBeInTheDocument();
    expect(screen.queryByText(/Not found in your portal/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Mock data/ }));
    expect(screen.queryByRole('button', { name: 'Use a real record as mock data' })).toBeNull();
  });
});
