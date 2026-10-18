import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { CONNECT_TIMINGS, resetConnectionForTests, useConnection, type ConnectionState } from '../store';
import { ToastProvider } from '../../ui';
import { connectedInfo, healthFixture } from '../testUtils';
import { ConnectButton } from './ConnectButton';
import { HOSTING_DOCS_URL } from './links';
import { resetStatusAdminForTests } from '../../status/useStatusAdmin';

const original: ConnectionState = { ...useConnection.getState() };

function stubActions() {
  const actions = {
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    switchPortal: vi.fn(async () => {}),
    cancelConnect: vi.fn(),
    focusPopup: vi.fn(),
    restartConnect: vi.fn(async () => {}),
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

describe('ConnectButton: waiting and notices', () => {
  it('after a few seconds of waiting, shows a visible panel to show the window, start again or cancel', () => {
    vi.useFakeTimers();
    try {
      const actions = stubActions();
      useConnection.setState({ status: 'connecting', health: healthFixture(), connectingSince: Date.now() });
      render(<ConnectButton />);
      // The Cancel button has a visible label.
      expect(screen.getByRole('button', { name: 'Cancel connecting' })).toHaveTextContent('Cancel');
      expect(screen.queryByRole('region', { name: 'Waiting for HubSpot' })).toBeNull();
      act(() => {
        vi.advanceTimersByTime(CONNECT_TIMINGS.waitingHintMs + 10);
      });
      const panel = screen.getByRole('region', { name: 'Waiting for HubSpot' });
      expect(panel).toHaveTextContent('Finish in the HubSpot window');
      fireEvent.click(within(panel).getByRole('button', { name: 'Show HubSpot window' }));
      expect(actions.focusPopup).toHaveBeenCalled();
      fireEvent.click(within(panel).getByRole('button', { name: 'Start again' }));
      expect(actions.restartConnect).toHaveBeenCalled();
      fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' }));
      expect(actions.cancelConnect).toHaveBeenCalled();
      act(() => useConnection.setState({ status: 'disconnected', connectingSince: null }));
      expect(screen.queryByRole('region', { name: 'Waiting for HubSpot' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('turns connection notices into toasts (expired offers Reconnect)', () => {
    const actions = stubActions();
    useConnection.setState({ status: 'connected', health: healthFixture(), info: connectedInfo() });
    render(
      <ToastProvider>
        <ConnectButton />
      </ToastProvider>,
    );
    act(() => useConnection.setState({ notice: { id: 1, kind: 'connected', account: 'acme.com' } }));
    expect(screen.getByText('Connected to acme.com. Pick a sample record above the card to see real data.')).toBeInTheDocument();
    act(() => useConnection.setState({ status: 'disconnected', info: { connected: false, reason: 'expired' }, notice: { id: 2, kind: 'expired' } }));
    expect(screen.getByText('Your HubSpot sign-in expired, so the preview is back to mock data.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(actions.connect).toHaveBeenCalled();
  });
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
    // Plain language for admins: who to ask and what to send them — no server setting names.
    expect(note).toHaveTextContent(/person who set up this builder needs to finish one step/);
    expect(note).toHaveTextContent(/keep building with mock data/);
    expect(note).not.toHaveTextContent('HUBSPOT_CLIENT_ID');
    expect(note).not.toHaveTextContent('APP_URL');
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
    expect(within(menu).getByRole('list', { name: 'Not included in this connection' })).toHaveTextContent('See tickets');

    expect(within(menu).getByRole('link', { name: /Open HubSpot/ })).toHaveAttribute('href', 'https://app.hubspot.com/contacts/12345678');
    fireEvent.click(within(menu).getByRole('button', { name: /Switch account/ }));
    expect(actions.switchPortal).toHaveBeenCalled();

    fireEvent.click(chip);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'HubSpot account' })).getByRole('button', { name: /Disconnect/ }));
    expect(actions.disconnect).toHaveBeenCalled();
  });

  it('links admins of this builder to the status page from the account menu', async () => {
    stubActions();
    resetStatusAdminForTests();
    const access = (admin: boolean) =>
      vi.fn(async () => new Response(JSON.stringify({ signInConfigured: true, signedIn: true, admin, adminConfigured: true }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', access(true));
    try {
      useConnection.setState({ status: 'connected', health: healthFixture(), info: connectedInfo() });
      const { unmount } = render(<ConnectButton />);
      fireEvent.click(screen.getByRole('button', { name: /Connected to HubSpot/ }));
      const menu = screen.getByRole('dialog', { name: 'HubSpot account' });
      expect(await within(menu).findByRole('link', { name: /Status page/ })).toHaveAttribute('href', '/status');
      unmount();

      // Someone who isn't an admin never sees the link.
      resetStatusAdminForTests();
      const notAdmin = access(false);
      vi.stubGlobal('fetch', notAdmin);
      render(<ConnectButton />);
      fireEvent.click(screen.getByRole('button', { name: /Connected to HubSpot/ }));
      await act(async () => {});
      expect(notAdmin).toHaveBeenCalled();
      expect(within(screen.getByRole('dialog', { name: 'HubSpot account' })).queryByRole('link', { name: /Status page/ })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      resetStatusAdminForTests();
    }
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
