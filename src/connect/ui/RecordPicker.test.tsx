import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createExtension, createProject } from '../../model/factory';
import { useEditor } from '../../model/store';
import { ConnectorClient, setConnectorClient } from '../client';
import { resetLiveDataForTests, useLiveData } from '../records';
import { resetConnectionForTests, useConnection } from '../store';
import type { CrmRecordSummary } from '../types';
import { OBJECT_TYPES, PORTAL_ID, connectedInfo, errorBody, healthFixture, json, routedFetch } from '../testUtils';
import { PreviewDataNote, RecordPicker } from './RecordPicker';

const CONTACTS: CrmRecordSummary[] = [
  { id: '101', objectType: 'contacts', objectTypeId: '0-1', label: 'Ada Lovelace', secondary: 'ada@example.com', url: 'https://app.hubspot.com/contacts/12345678/record/0-1/101' },
  { id: '102', objectType: 'contacts', objectTypeId: '0-1', label: 'Alan Turing', secondary: 'alan@example.com' },
  { id: '103', objectType: 'contacts', objectTypeId: '0-1', label: 'Grace Hopper', secondary: 'grace@example.com' },
];
const COMPANIES: CrmRecordSummary[] = [{ id: '201', objectType: 'companies', objectTypeId: '0-2', label: 'Acme Inc', secondary: 'acme.com' }];

function setup(opts: { searchError?: boolean } = {}) {
  const r = routedFetch({
    'GET /api/crm/object-types': () => json(OBJECT_TYPES),
    'GET /api/crm/records/contacts/search': (call) => {
      if (opts.searchError) return errorBody('missing_scope', 403, { requiredScopes: ['crm.objects.contacts.read'] });
      const q = (call.query.get('q') ?? '').toLowerCase();
      return json(q ? CONTACTS.filter((c) => c.label.toLowerCase().includes(q) || c.id === q) : CONTACTS);
    },
    'GET /api/crm/records/companies/search': () => json(COMPANIES),
  });
  setConnectorClient(new ConnectorClient({ baseUrl: '', fetch: r.fetch }));
  const card = createExtension({ name: 'Contact Card', objectTypes: ['contacts', 'companies'] });
  const settings = createExtension({ kind: 'settings' });
  const project = createProject('Picker test', [card, settings]);
  useEditor.getState().loadProject(project);
  useEditor.getState().setActiveExtension(card.id);
  useConnection.setState({ status: 'connected', health: healthFixture(), info: connectedInfo() });
  useLiveData.getState().loadProject(project.id);
  return { ...r, card, settings, project };
}

function chip() {
  return screen.getByTestId('uiex-sample-record');
}

beforeEach(() => {
  resetConnectionForTests();
  resetLiveDataForTests();
  localStorage.clear();
});

afterEach(() => {
  resetConnectionForTests();
  resetLiveDataForTests();
  localStorage.clear();
});

describe('RecordPicker', () => {
  it('shows nothing while not connected', () => {
    const { container } = render(<RecordPicker />);
    expect(container).toBeEmptyDOMElement();
  });

  it('switches between mock and live data', () => {
    setup();
    render(<RecordPicker />);
    const group = screen.getByRole('group', { name: 'Preview data' });
    const mock = within(group).getByRole('button', { name: /Mock/ });
    const live = within(group).getByRole('button', { name: /Live/ });
    expect(mock).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByTestId('uiex-sample-record')).toBeNull();
    fireEvent.click(live);
    expect(useLiveData.getState().mode).toBe('live');
    expect(live).toHaveAttribute('aria-pressed', 'true');
    expect(chip()).toHaveAccessibleName('Pick a sample record to preview with real data');
  });

  it('picks a sample record with the keyboard', async () => {
    const { card } = setup();
    useLiveData.getState().setMode('live');
    render(<RecordPicker />);
    fireEvent.click(chip());
    const panel = screen.getByRole('dialog', { name: 'Sample record' });
    expect(panel).toHaveTextContent('Pick a sample record to preview with real data');

    const input = within(panel).getByRole('combobox', { name: 'Find a contact' });
    expect(input).toHaveFocus();
    // Recently updated records first.
    const listbox = within(panel).getByRole('listbox', { name: 'Matching contacts' });
    await waitFor(() => expect(within(listbox).getAllByRole('option')).toHaveLength(3));
    expect(within(panel).getByRole('status')).toHaveTextContent('Recently updated contacts');

    fireEvent.change(input, { target: { value: 'a' } });
    await waitFor(() => expect(within(panel).getByRole('status')).toHaveTextContent('3 matches'));
    fireEvent.change(input, { target: { value: 'al' } });
    await waitFor(() => expect(within(panel).getByRole('status')).toHaveTextContent('1 match'));
    fireEvent.change(input, { target: { value: 'a' } });
    await waitFor(() => expect(within(panel).getByRole('status')).toHaveTextContent('3 matches'));

    const options = within(listbox).getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveTextContent('Ada Lovelace');
    expect(options[0]).toHaveTextContent('ada@example.com');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', options[1].id);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' }); // wraps to the last
    expect(input).toHaveAttribute('aria-activedescendant', options[2].id);
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // wraps to the first
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useLiveData.getState().recordByExtension[card.id]).toMatchObject({ id: '101', label: 'Ada Lovelace' });
    expect(useLiveData.getState().portalByExtension[card.id]).toBe(PORTAL_ID);
    expect(chip()).toHaveTextContent('Live data · Ada Lovelace');
  });

  it('Enter typed before the search answers picks the first match of that search, not a stale row', async () => {
    const { card } = setup();
    useLiveData.getState().setMode('live');
    render(<RecordPicker />);
    fireEvent.click(chip());
    const panel = screen.getByRole('dialog', { name: 'Sample record' });
    const input = within(panel).getByRole('combobox', { name: 'Find a contact' });
    const listbox = within(panel).getByRole('listbox', { name: 'Matching contacts' });
    await waitFor(() => expect(within(listbox).getAllByRole('option')).toHaveLength(3));

    // Fast typist: "grace" + Enter while the list still shows the recent records (Ada first).
    fireEvent.change(input, { target: { value: 'grace' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: 'Sample record' })).toBeInTheDocument();
    expect(useLiveData.getState().recordByExtension[card.id]).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(useLiveData.getState().recordByExtension[card.id]).toMatchObject({ id: '103', label: 'Grace Hopper' });
  });

  it('a pending Enter is dropped when the search is cleared or finds nothing', async () => {
    const { card } = setup();
    useLiveData.getState().setMode('live');
    render(<RecordPicker />);
    fireEvent.click(chip());
    const panel = screen.getByRole('dialog', { name: 'Sample record' });
    const input = within(panel).getByRole('combobox', { name: 'Find a contact' });
    fireEvent.change(input, { target: { value: 'zzz' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(within(panel).getByRole('status')).toHaveTextContent('No contacts match “zzz”.'));
    expect(screen.getByRole('dialog', { name: 'Sample record' })).toBeInTheDocument();
    expect(useLiveData.getState().recordByExtension[card.id]).toBeUndefined();
    // A later search does not pick by itself.
    fireEvent.change(input, { target: { value: 'ada' } });
    await waitFor(() => expect(within(panel).getByRole('status')).toHaveTextContent('1 match'));
    expect(screen.getByRole('dialog', { name: 'Sample record' })).toBeInTheDocument();
  });

  it('first Escape clears the search, the next closes the picker', async () => {
    setup();
    useLiveData.getState().setMode('live');
    render(<RecordPicker />);
    fireEvent.click(chip());
    const panel = screen.getByRole('dialog', { name: 'Sample record' });
    const input = within(panel).getByRole('combobox', { name: 'Find a contact' });
    fireEvent.change(input, { target: { value: 'zzz' } });
    await waitFor(() => expect(within(panel).getByRole('status')).toHaveTextContent('No contacts match “zzz”.'));
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chip()).toHaveFocus();
  });

  it('limits record types to the card, shows the picked record and clears it', async () => {
    const { card, calls } = setup();
    useLiveData.getState().setMode('live');
    useLiveData.getState().setRecord(card.id, CONTACTS[0]);
    render(<RecordPicker />);
    fireEvent.click(chip());
    const panel = screen.getByRole('dialog', { name: 'Sample record' });
    const picked = within(panel).getByLabelText('Picked record');
    expect(picked).toHaveTextContent('Ada Lovelace');
    expect(within(picked).getByRole('link', { name: /Open in HubSpot/ })).toHaveAttribute('href', CONTACTS[0].url);

    const select = within(panel).getByLabelText('Record type');
    await waitFor(() => expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Contacts', 'Companies']));
    fireEvent.change(select, { target: { value: 'companies' } });
    await waitFor(() => expect(within(within(panel).getByRole('listbox')).getAllByRole('option', { name: /Acme Inc/ })).toHaveLength(1));
    expect(within(panel).getByRole('combobox', { name: 'Find a company' })).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/crm/records/companies/search')).toBe(true);

    fireEvent.click(within(panel).getByRole('button', { name: 'Clear sample record' }));
    expect(useLiveData.getState().recordByExtension[card.id]).toBeUndefined();
    expect(panel).toHaveTextContent('Pick a sample record to preview with real data');
  });

  it('explains a missing permission and offers to reconnect', async () => {
    setup({ searchError: true });
    useLiveData.getState().setMode('live');
    render(<RecordPicker />);
    fireEvent.click(chip());
    const panel = screen.getByRole('dialog', { name: 'Sample record' });
    await waitFor(() => expect(within(panel).getByRole('status')).toHaveTextContent('Permission needed'));
    expect(within(panel).getByRole('status')).toHaveTextContent(/allow “See contacts”/);
    expect(within(panel).getByRole('button', { name: 'Reconnect HubSpot' })).toBeInTheDocument();
  });

  it('shows live-data problems reported by the preview on the chip', () => {
    const { card } = setup();
    useLiveData.getState().setMode('live');
    useLiveData.getState().setRecord(card.id, CONTACTS[0]);
    render(<RecordPicker />);
    act(() => useLiveData.getState().reportError({ code: 'rate_limited', retryAfter: 3, message: 'x' }));
    expect(chip()).toHaveAccessibleName(/problem: HubSpot is busy/);
    fireEvent.click(chip());
    expect(screen.getByRole('alert')).toHaveTextContent('Wait 3 seconds and try again.');
  });

  it('looks the record name up again after a reload (only ids are stored)', async () => {
    const { card } = setup();
    useLiveData.getState().setMode('live');
    useLiveData.getState().setRecord(card.id, { id: '101', objectType: 'contacts', objectTypeId: '0-1', label: '' });
    render(<RecordPicker />);
    await waitFor(() => expect(chip()).toHaveTextContent('Live data · Ada Lovelace'));
  });

  it('shows the account badge for settings pages (no record needed)', () => {
    const { settings } = setup();
    useEditor.getState().setActiveExtension(settings.id);
    useLiveData.getState().setMode('live');
    render(
      <>
        <RecordPicker />
        <span data-testid="note">
          <PreviewDataNote />
        </span>
      </>,
    );
    expect(screen.queryByTestId('uiex-sample-record')).toBeNull();
    expect(screen.getByRole('button', { name: /Live data from acme\.com/ })).toHaveTextContent('Live data · acme.com');
    expect(screen.getByTestId('note')).toHaveTextContent('showing real HubSpot data (read-only)');
  });

  it('in preview mode, collapses into one chip whose popover holds the Mock | Live switch', async () => {
    const { card } = setup();
    useEditor.getState().setMode('preview');
    render(<RecordPicker />);
    // No switch in the toolbar: the preview banner keeps its room.
    expect(screen.queryByRole('group', { name: 'Preview data' })).toBeNull();
    const mockChip = screen.getByTestId('uiex-preview-data');
    expect(mockChip).toHaveTextContent('Mock data');
    fireEvent.click(mockChip);
    let popover = screen.getByRole('dialog', { name: 'Preview data' });
    expect(popover).toHaveTextContent('sample values from Data › Mock data');
    fireEvent.click(within(within(popover).getByRole('group', { name: 'Preview data' })).getByRole('button', { name: /Live/ }));
    expect(useLiveData.getState().mode).toBe('live');

    // The open popover turns into the record picker right away, keeping the switch above it.
    popover = screen.getByRole('dialog', { name: 'Sample record' });
    expect(chip()).toHaveAttribute('aria-expanded', 'true');
    expect(within(popover).getByRole('group', { name: 'Preview data' })).toBeInTheDocument();
    const listbox = within(popover).getByRole('listbox');
    await waitFor(() => expect(within(listbox).getAllByRole('option')).toHaveLength(3));
    fireEvent.click(within(listbox).getAllByRole('option')[1]);
    expect(useLiveData.getState().recordByExtension[card.id]?.label).toBe('Alan Turing');
    expect(chip()).toHaveTextContent('Live data · Alan Turing');
    act(() => useEditor.getState().setMode('design'));
    expect(screen.getByRole('group', { name: 'Preview data' })).toBeInTheDocument();
  });

  it('PreviewDataNote tells whether the preview uses mock or real data', () => {
    const { card } = setup();
    const { rerender } = render(<PreviewDataNote />);
    expect(document.body).toHaveTextContent('interactions run with mock data');
    act(() => useLiveData.getState().setMode('live'));
    rerender(<PreviewDataNote />);
    expect(document.body).toHaveTextContent('pick a sample record to use real data');
    act(() => useLiveData.getState().setRecord(card.id, CONTACTS[0]));
    expect(document.body).toHaveTextContent('showing real HubSpot data (read-only)');
  });
});
