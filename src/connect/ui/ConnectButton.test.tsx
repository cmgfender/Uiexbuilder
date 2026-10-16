import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { resetConnectionForTests, useConnection, type ConnectionState } from '../store';
import { connectedInfo, healthFixture } from '../testUtils';
import { ConnectButton } from './ConnectButton';
import { HOSTING_DOCS_URL } from './links';

const original: ConnectionState = { ...useConnection.getState() };

function stubActions() {
  const actions = {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    switchPortal: vi.fn(async () => {}),
    cancelConnect: vi.fn(),
    focusPopup: vi.fn(),
    init: vi.fn(async () => {}),
  };
  useConnection.setState(actions);
  return actions;
}

function connectButton() {
  return screen.getAllByRole('button').find((b) => b.classList.contains('ub-cn-btn'))!;
}

beforeEach(() => {
  resetConnectionForTests();
  localStorage.clear();
});

afterEach(() => {
  useConnection.setState(original, true);
  resetConnectionForTests();
  localStorage.clear();
});

describe('ConnectButton', () => {
  it('is muted with an explanation when there is no connector (static hosting)', () => {
    stubActions();
    useConnection.setState({ status: 'unavailable' });
    render(<ConnectButton />);
    const btn = screen.getByRole('button', { name: 'Connect HubSpot' });
    // Muted, but still operable (it opens the explanation), so not announced as disabled.
    expect(btn).not.toHaveAttribute('aria-disabled');
    expect(btn).toHaveClass('ub-cn-btn--muted');
    expect(btn).toHaveAttribute('title', 'Available on the hosted version');
    expect(btn).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(btn);
    const note = screen.getByRole('dialog', { name: 'About Connect HubSpot' });
    expect(note).toHaveTextContent(/available on the hosted version/i);
    expect(within(note).getByRole('link', { name: /How to host the builder/ })).toHaveAttribute('href', HOSTING_DOCS_URL);
    expect(useConnection.getState().connect).not.toHaveBeenCalled();
    // Escape closes the note and returns focus to the button.
    fireEvent.keyDown(note, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(btn).toHaveFocus();
  });

  it('explains what the host must set up when sign-in is not configured', () => {
    stubActions();
    useConnection.setState({ status: 'not-configured', health: healthFixture({ oauthConfigured: false }) });
    render(<ConnectButton />);
    const btn = connectButton();
    expect(btn.getAttribute('title')).toMatch(/not set up/);
    fireEvent.click(btn);
    const note = screen.getByRole('dialog', { name: 'About Connect HubSpot' });
    expect(note).toHaveTextContent('HUBSPOT_CLIENT_ID');
    expect(note).toHaveTextContent('SESSION_SECRET');
    expect(within(note).getByRole('link', { name: /Read the hosting guide/ })).toHaveAttribute('href', expect.stringContaining('docs/HOSTING.md'));
    expect(within(note).getByRole('link', { name: /setup checklist/ })).toHaveAttribute('href', '/setup.html');
  });

  it('shows the consent explainer before the first connect, then goes straight to HubSpot', () => {
    const actions = stubActions();
    useConnection.setState({ status: 'disconnected', health: healthFixture() });
    render(<ConnectButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect HubSpot' }));
    const dialog = screen.getByRole('dialog', { name: 'Connect your HubSpot account' });
    expect(dialog).toHaveTextContent(/read-only/i);
    expect(dialog).toHaveTextContent(/Store your CRM data on a server/);
    expect(dialog).toHaveTextContent(/Connected apps/);
    // The exact scopes, in plain language.
    fireEvent.click(within(dialog).getByRole('button', { name: /Exact permissions/ }));
    expect(dialog).toHaveTextContent('See contacts');
    expect(dialog).toHaveTextContent('See tickets');
    expect(actions.connect).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue to HubSpot' }));
    expect(actions.connect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    // Next time: no explainer.
    fireEvent.click(screen.getByRole('button', { name: 'Connect HubSpot' }));
    expect(actions.connect).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('cancelling the explainer does not connect', () => {
    const actions = stubActions();
    useConnection.setState({ status: 'disconnected', health: healthFixture() });
    render(<ConnectButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect HubSpot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(actions.connect).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows a spinner while connecting, brings the window forward and can cancel', () => {
    const actions = stubActions();
    useConnection.setState({ status: 'connecting', health: healthFixture() });
    render(<ConnectButton />);
    const btn = screen.getByRole('button', { name: /Connecting to HubSpot/ });
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveTextContent('Connecting…');
    fireEvent.click(btn);
    expect(actions.focusPopup).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel connecting' }));
    expect(actions.cancelConnect).toHaveBeenCalled();
  });

  it('shows the connected account and its menu', () => {
    const actions = stubActions();
    useConnection.setState({ status: 'connected', health: healthFixture(), info: connectedInfo() });
    render(<ConnectButton />);
    const chip = screen.getByRole('button', { name: /Connected to HubSpot: acme\.com, account 12345678, signed in as ada@acme\.com/ });
    expect(chip).toHaveTextContent('acme.com · 12345678');
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(chip);
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('dialog', { name: 'HubSpot account' });
    expect(menu).toHaveTextContent('Account ID 12345678');
    expect(menu).toHaveTextContent('Signed in as ada@acme.com');
    expect(menu).toHaveTextContent(/Read-only/);

    const scopes = within(menu).getByRole('button', { name: /What the builder can see \(2\)/ });
    expect(scopes).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(scopes);
    expect(within(menu).getByRole('list', { name: 'Allowed' })).toHaveTextContent('See contacts');
    expect(within(menu).getByRole('list', { name: 'Not allowed' })).toHaveTextContent('See tickets');

    expect(within(menu).getByRole('link', { name: /Open HubSpot/ })).toHaveAttribute('href', 'https://app.hubspot.com/contacts/12345678');
    fireEvent.click(within(menu).getByRole('button', { name: /Switch account/ }));
    expect(actions.switchPortal).toHaveBeenCalled();

    fireEvent.click(chip);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'HubSpot account' })).getByRole('button', { name: /Disconnect/ }));
    expect(actions.disconnect).toHaveBeenCalled();
  });

  it('flags an expired sign-in', () => {
    stubActions();
    useConnection.setState({ status: 'disconnected', health: healthFixture(), info: { connected: false, reason: 'expired' } });
    render(<ConnectButton />);
    const btn = screen.getByRole('button', { name: 'Connect HubSpot' });
    expect(btn.className).toContain('ub-cn-btn--attention');
    expect(btn.getAttribute('title')).toMatch(/expired/);
  });

  it('explains a sign-in that did not work out and offers to try again', () => {
    const actions = stubActions();
    localStorage.setItem('uiex-builder:hubspot-connect-explained', '1');
    useConnection.setState({ status: 'disconnected', health: healthFixture() });
    render(<ConnectButton />);
    act(() => {
      useConnection.setState({ errorCode: 'access_denied', errorSource: 'sign-in', error: 'You chose not to give the builder access. Nothing was shared.' });
    });
    const dialog = screen.getByRole('dialog', { name: 'HubSpot was not connected' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Nothing was shared');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(actions.connect).toHaveBeenCalledTimes(1);
    expect(useConnection.getState().error).toBeNull();
  });

  it('explains a failed disconnect and retries signing out (not signing in)', () => {
    const actions = stubActions();
    useConnection.setState({ status: 'connected', health: healthFixture(), info: connectedInfo() });
    render(<ConnectButton />);
    act(() => {
      useConnection.setState({ errorCode: 'internal_error', errorSource: 'sign-out', error: "Couldn't disconnect: Something went wrong." });
    });
    const dialog = screen.getByRole('dialog', { name: "Couldn't disconnect HubSpot" });
    expect(dialog).toHaveTextContent("You're still connected");
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(actions.disconnect).toHaveBeenCalledTimes(1);
    expect(actions.connect).not.toHaveBeenCalled();
  });

  it('does not open a dialog for startup problems (the button shows them)', () => {
    stubActions();
    useConnection.setState({ status: 'error', errorCode: 'network_error', errorSource: 'startup', error: 'Check your internet connection and try again.' });
    render(<ConnectButton />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const btn = screen.getByRole('button', { name: 'Connect HubSpot' });
    expect(btn.getAttribute('title')).toMatch(/Check your internet connection/);
    fireEvent.click(btn);
    expect(useConnection.getState().init).toHaveBeenCalled();
  });
});
