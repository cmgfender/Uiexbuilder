import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createProject } from '../model/factory';
import { useEditor } from '../model/store';
import { ToastProvider } from '../ui';
import { ConnectorClient, setConnectorClient } from '../connect/client';
import { resetLiveDataForTests, useLiveData } from '../connect/records';
import { resetConnectionForTests, useConnection } from '../connect/store';
import { useConnectUiHost } from '../connect/ui/host';
import type { ConnectionStatus } from '../connect/store';
import type { CrmPropertyDef, CrmRecordSummary } from '../connect/types';
import { OBJECT_TYPES, PORTAL_ID, connectedInfo, healthFixture, json, routedFetch } from '../connect/testUtils';
import { useShell } from '../shell/shellStore';
import { isOverlayOpen } from '../shell/shortcuts';
import { FirstRun } from './FirstRun';
import { readFirstRun, resetOnboardingForTests, useOnboarding } from './store';

const CONTACTS: CrmRecordSummary[] = [
  { id: '101', objectType: 'contacts', objectTypeId: '0-1', label: 'Ada Lovelace', secondary: 'ada@example.com' },
  { id: '103', objectType: 'contacts', objectTypeId: '0-1', label: 'Grace Hopper', secondary: 'grace@example.com' },
];
const CONTACT_PROPERTIES: CrmPropertyDef[] = [
  { name: 'firstname', label: 'First name', type: 'string', fieldType: 'text', hubspotDefined: true },
  { name: 'lastname', label: 'Last name', type: 'string', fieldType: 'text', hubspotDefined: true },
  { name: 'email', label: 'Email', type: 'string', fieldType: 'text', hubspotDefined: true },
  { name: 'favorite_product', label: 'Favorite product', type: 'enumeration', fieldType: 'select', hubspotDefined: false, options: [{ label: 'Enterprise', value: 'enterprise' }] },
];

function connector() {
  const r = routedFetch({
    'GET /api/crm/object-types': () => json(OBJECT_TYPES),
    'GET /api/crm/properties/contacts': () => json(CONTACT_PROPERTIES),
    'GET /api/crm/records/contacts/search': (call) => {
      const q = (call.query.get('q') ?? '').toLowerCase();
      return json(q ? CONTACTS.filter((c) => c.label.toLowerCase().includes(q)) : CONTACTS);
    },
  });
  setConnectorClient(new ConnectorClient({ baseUrl: '', fetch: r.fetch }));
  return r;
}

function setStatus(status: ConnectionStatus, extra: Partial<ReturnType<typeof useConnection.getState>> = {}) {
  useConnection.setState({
    status,
    health: status === 'unavailable' ? null : healthFixture({ oauthConfigured: status !== 'not-configured' }),
    info: status === 'connected' ? connectedInfo() : { connected: false },
    ...extra,
  });
}

function renderFirstRun() {
  useOnboarding.setState({ open: true });
  return render(
    <ToastProvider>
      <FirstRun />
    </ToastProvider>,
  );
}

const realConnect = useConnection.getState().connect;

beforeEach(() => {
  localStorage.clear();
  resetOnboardingForTests();
  resetConnectionForTests();
  resetLiveDataForTests();
  connector();
  useEditor.getState().loadProject(createProject());
  useShell.setState({ saveStatus: 'idle', conflict: null });
});

afterEach(() => {
  useConnection.setState({ connect: realConnect });
  resetOnboardingForTests();
  resetConnectionForTests();
  resetLiveDataForTests();
  localStorage.clear();
});

describe('welcome', () => {
  it('states the promise and offers two choices plus the editor', () => {
    setStatus('disconnected');
    renderFirstRun();
    const dialog = screen.getByRole('dialog', { name: 'Build your own HubSpot cards' });
    expect(dialog).toHaveTextContent('no code, no terminal');
    expect(screen.getByRole('heading', { name: 'Build your own HubSpot cards' })).toHaveFocus();
    expect(screen.getByRole('button', { name: /Connect my HubSpot/ })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('button', { name: /Try it with sample data/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /I know what I’m doing/ }));
    expect(useOnboarding.getState().open).toBe(false);
    expect(readFirstRun()).toBe('skipped');
  });

  it('owns the keyboard: the editor’s shortcuts are off while it is up', () => {
    setStatus('disconnected');
    renderFirstRun();
    expect(isOverlayOpen()).toBe(true);
    expect(document.querySelector('[data-uiex-exclusive]')).not.toBeNull();
  });

  it('disables Connect with a one-line reason when there is no connector', () => {
    setStatus('unavailable');
    renderFirstRun();
    const connect = screen.getByRole('button', { name: /Connect my HubSpot/ });
    expect(connect).toHaveAttribute('aria-disabled', 'true');
    expect(connect).toHaveAccessibleDescription(/Not available in this copy of the builder/);
    fireEvent.click(connect);
    expect(useOnboarding.getState().view).toBe('welcome');
  });

  it('explains when sign-in is not switched on yet (with the setup checklist)', () => {
    setStatus('not-configured');
    renderFirstRun();
    expect(screen.getByRole('button', { name: /Connect my HubSpot/ })).toHaveAccessibleDescription(/isn’t switched on here yet/);
    expect(screen.getByRole('link', { name: 'setup checklist' })).toHaveAttribute('href', '/setup.html');
  });

  it('waits while the connection is being checked', () => {
    setStatus('checking');
    renderFirstRun();
    expect(screen.getByRole('button', { name: /Connect my HubSpot/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Checking whether HubSpot sign-in is available…')).toBeInTheDocument();
  });
});

describe('sample-data path', () => {
  it('asks where the card goes, offers starters for that type and lands in the editor with the card', async () => {
    setStatus('unavailable');
    renderFirstRun();
    fireEvent.click(screen.getByRole('button', { name: /Try it with sample data/ }));
    expect(screen.getByRole('heading', { name: 'Where should your card appear?' })).toHaveFocus();
    expect(screen.getByRole('list', { name: 'Setup progress: step 1 of 2' })).toBeInTheDocument();
    // Only the standard four without a connection.
    const types = screen.getByRole('group', { name: 'Which records is it for?' });
    expect(within(types).getAllByRole('radio')).toHaveLength(4);
    fireEvent.click(within(types).getByRole('radio', { name: /Deals/ }));
    const places = screen.getByRole('group', { name: 'Where on the page?' });
    // Help desk cards only appear on tickets.
    expect(within(places).getByRole('radio', { name: /Help desk/ })).toBeDisabled();
    fireEvent.click(within(places).getByRole('radio', { name: /Right sidebar/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    expect(screen.getByRole('heading', { name: 'Choose a starting point' })).toHaveFocus();
    const starters = screen.getByRole('group', { name: 'Start from…' });
    const options = within(starters).getAllByRole('radio');
    expect(options[0]).toBeChecked();
    expect(options[0]).toHaveAccessibleName(/Deal details/);
    expect(options[options.length - 1]).toHaveAccessibleName(/Blank card/);
    fireEvent.click(screen.getByRole('button', { name: /Create my card/ }));

    expect(useOnboarding.getState().open).toBe(false);
    expect(readFirstRun()).toBe('completed');
    expect(useOnboarding.getState().tour.active).toBe(true);
    const project = useEditor.getState().project;
    expect(project.extensions).toHaveLength(1);
    expect(project.extensions[0]).toMatchObject({ name: 'Deal Details', objectTypes: ['deals'], location: 'crm.record.sidebar' });
    expect(useLiveData.getState()).toMatchObject({ projectId: project.id, mode: 'mock' });
    // Nothing is selected: the inspector shows the card's settings, and click-to-add goes to the
    // end of the card.
    expect(useEditor.getState().selectedNodeId).toBeNull();
    await act(async () => {});
  });

  it('switching away from tickets leaves the help desk', () => {
    setStatus('unavailable');
    renderFirstRun();
    fireEvent.click(screen.getByRole('button', { name: /Try it with sample data/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Tickets/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Help desk/ }));
    expect(useOnboarding.getState().choices.location).toBe('helpdesk.sidebar');
    fireEvent.click(screen.getByRole('radio', { name: /Contacts/ }));
    expect(useOnboarding.getState().choices.location).toBe('crm.record.tab');
  });

  it('Back returns to the previous step, then to the welcome', () => {
    setStatus('unavailable');
    renderFirstRun();
    fireEvent.click(screen.getByRole('button', { name: /Try it with sample data/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Where should your card appear?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Build your own HubSpot cards' })).toBeInTheDocument();
  });

  it('Skip setup opens the editor and is remembered', () => {
    setStatus('unavailable');
    renderFirstRun();
    fireEvent.click(screen.getByRole('button', { name: /Try it with sample data/ }));
    fireEvent.click(screen.getByRole('button', { name: /Skip setup/ }));
    expect(useOnboarding.getState().open).toBe(false);
    expect(readFirstRun()).toBe('skipped');
  });
});

describe('HubSpot path', () => {
  it('connects in place, lists custom objects, picks a real record and opens the card with live data', async () => {
    setStatus('disconnected');
    const connect = vi.fn(async () => {});
    useConnection.setState({ connect });
    renderFirstRun();
    fireEvent.click(screen.getByRole('button', { name: /Connect my HubSpot/ }));

    // Step 1: the consent explainer in place, then the HubSpot window.
    expect(screen.getByRole('heading', { name: 'Connect your HubSpot account' })).toHaveFocus();
    expect(screen.getByText('It will never')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
    // While this screen is up it reports the sign-in result itself.
    expect(useConnectUiHost.getState().inline).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Connect HubSpot' }));
    expect(connect).toHaveBeenCalled();
    act(() => setStatus('connecting', { connectingSince: Date.now() }));
    expect(screen.getByText('Waiting for HubSpot…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show HubSpot window' })).toBeInTheDocument();
    act(() => setStatus('connected', { connectedAt: Date.now() }));
    expect(screen.getByText('Connected to acme.com')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'You’re connected' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    // Step 2: the portal's custom objects are offered by their labels.
    const types = screen.getByRole('group', { name: 'Which records is it for?' });
    expect(await within(types).findByRole('radio', { name: /Projects/ })).toBeInTheDocument();
    expect(within(types).getByRole('radio', { name: /Contacts/ })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));

    // Step 3: the most recently updated record is picked by itself (real data by default) …
    expect(screen.getByRole('heading', { name: 'Pick a real record and a starting point' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Previewing with Ada Lovelace')).toBeInTheDocument();
    // … and the admin can pick another one (search combobox).
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    const search = screen.getByRole('combobox', { name: 'Find a contact' });
    fireEvent.change(search, { target: { value: 'grace' } });
    fireEvent.click(await screen.findByRole('option', { name: /Grace Hopper/ }));
    expect(screen.getByLabelText('Previewing with Grace Hopper')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('radio', { name: /Contact details.*Your real properties/ })).toBeChecked());
    fireEvent.click(screen.getByRole('button', { name: /Create my card/ }));

    const project = useEditor.getState().project;
    const card = project.extensions[0];
    expect(card).toMatchObject({ name: 'Contact Details', objectTypes: ['contacts'], location: 'crm.record.tab' });
    const record = card.dataSources[0];
    expect(record.kind === 'crmProperties' && record.properties).toContain('favorite_product');
    expect(useLiveData.getState().mode).toBe('live');
    expect(useLiveData.getState().recordByExtension[card.id]).toMatchObject({ id: '103', label: 'Grace Hopper' });
    expect(useLiveData.getState().portalByExtension[card.id]).toBe(PORTAL_ID);
    expect(useOnboarding.getState().open).toBe(false);
    expect(useConnectUiHost.getState().inline).toBe(false);
  });

  it('picks the most recent record only once: after Change the admin decides', async () => {
    setStatus('connected', { connectedAt: Date.now() });
    useOnboarding.setState({ view: 'setup', path: 'hubspot', step: 2 });
    renderFirstRun();
    expect(await screen.findByLabelText('Previewing with Ada Lovelace')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByRole('combobox', { name: 'Find a contact' })).toBeInTheDocument();
    // Going back and forth doesn't pick one again.
    fireEvent.click(screen.getByRole('button', { name: /Back/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await act(async () => {});
    expect(screen.getByRole('combobox', { name: 'Find a contact' })).toBeInTheDocument();
    expect(useOnboarding.getState().choices.record).toBeNull();
  });

  it('explains a sign-in that did not work out, in place, with Try again', () => {
    setStatus('disconnected', { error: 'You chose not to give the builder access.', errorCode: 'access_denied', errorSource: 'sign-in' });
    const connect = vi.fn(async () => {});
    useConnection.setState({ connect });
    renderFirstRun();
    fireEvent.click(screen.getByRole('button', { name: /Connect my HubSpot/ }));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('HubSpot was not connected');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(connect).toHaveBeenCalled();
  });

  it('asks what HubSpot showed when its window closed, and gives the fix in place', () => {
    setStatus('disconnected', { error: 'The HubSpot window closed before connecting finished.', errorCode: 'popup_closed', errorSource: 'sign-in' });
    const connect = vi.fn(async () => {});
    useConnection.setState({ connect });
    renderFirstRun();
    fireEvent.click(screen.getByRole('button', { name: /Connect my HubSpot/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('HubSpot was not connected');
    const question = screen.getByRole('group', { name: 'What did HubSpot show?' });
    fireEvent.click(within(question).getByRole('radio', { name: /Acceptable Use Policy/i }));
    expect(screen.getByRole('button', { name: /Copy a note for whoever set up this builder/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(connect).toHaveBeenCalled();
  });

  it('offers Continue in this tab when the browser blocked the HubSpot window', () => {
    setStatus('disconnected', { error: 'Your browser blocked the HubSpot window.', errorCode: 'popup_blocked', errorSource: 'sign-in' });
    const connectInThisTab = vi.fn(async () => {});
    const connect = vi.fn(async () => {});
    useConnection.setState({ connect, connectInThisTab });
    renderFirstRun();
    fireEvent.click(screen.getByRole('button', { name: /Connect my HubSpot/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Your browser blocked the HubSpot window');
    fireEvent.click(screen.getByRole('button', { name: 'Continue in this tab' }));
    expect(connectInThisTab).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Try the window again' }));
    expect(connect).toHaveBeenCalled();
  });

  it('says it is still waiting and asks what the HubSpot window shows after a while', () => {
    setStatus('connecting', { connectingSince: Date.now() - 60_000 });
    useOnboarding.setState({ view: 'setup', path: 'hubspot', step: 0 });
    renderFirstRun();
    expect(screen.getByText('Still waiting for HubSpot…')).toBeInTheDocument();
    const question = screen.getByRole('group', { name: 'What does the HubSpot window show?' });
    // The window is still open: no "I closed it" choice.
    expect(within(question).queryByRole('radio', { name: /I closed it/ })).not.toBeInTheDocument();
  });

  it('offers sample data when connecting is not possible after all', () => {
    setStatus('disconnected');
    renderFirstRun();
    fireEvent.click(screen.getByRole('button', { name: /Connect my HubSpot/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with sample data' }));
    expect(useOnboarding.getState().path).toBe('sample');
    expect(screen.getByRole('heading', { name: 'Where should your card appear?' })).toBeInTheDocument();
  });
});

describe('replacing the starter project', () => {
  it('keeps real work: the open project is saved first and stays in Project › Open…', () => {
    setStatus('unavailable');
    const work = createProject('My work');
    useEditor.getState().loadProject(work);
    useEditor.getState().addExtension({ kind: 'card' });
    renderFirstRun();
    fireEvent.click(screen.getByRole('button', { name: /Try it with sample data/ }));
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    fireEvent.click(screen.getByRole('button', { name: /Create my card/ }));
    expect(useEditor.getState().project.id).not.toBe(work.id);
    expect(localStorage.getItem(`uiex-builder:project:${work.id}`)).toBeTruthy();
  });
});
