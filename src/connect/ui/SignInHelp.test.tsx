import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CONNECT_TIMINGS, resetConnectionForTests, useConnection, type ConnectionState } from '../store';
import { signInFix, signInTroubleChoices } from '../signInHelp';
import { healthFixture } from '../testUtils';
import { ConnectButton } from './ConnectButton';
import { SIGN_IN_FEEDBACK_SETTLE_MS, SignInHelp } from './SignInHelp';
import { HOSTING_DOCS_URL } from './links';
import { resetErrorReporterForTests } from '../../status/reporter';

const original: ConnectionState = { ...useConnection.getState() };
const CTX = { builderUrl: 'https://builder.example.com', setupUrl: 'https://builder.example.com/setup.html', docsUrl: HOSTING_DOCS_URL };

function stubActions() {
  const actions = {
    connect: vi.fn(async () => {}),
    connectInThisTab: vi.fn(async () => {}),
    cancelConnect: vi.fn(),
    focusPopup: vi.fn(),
    restartConnect: vi.fn(async () => {}),
  };
  useConnection.setState(actions);
  return actions;
}

function showResult(errorCode: string) {
  localStorage.setItem('uiex-builder:hubspot-connect-explained', '1');
  useConnection.setState({ status: 'disconnected', health: healthFixture() });
  render(<ConnectButton />);
  act(() => {
    useConnection.setState({ errorCode, errorSource: 'sign-in', error: 'The HubSpot window closed before connecting finished.' });
  });
}

beforeEach(() => {
  resetConnectionForTests();
  localStorage.clear();
});

afterEach(() => {
  useConnection.setState(original, true);
  resetConnectionForTests();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('signInFix: the fix for what HubSpot showed', () => {
  it('the Acceptable Use Policy is for whoever set up the builder, with the exact clicks and a note to send', () => {
    const fix = signInFix('aup', CTX);
    expect(fix.who).toBe('host');
    expect(fix.steps.join(' ')).toMatch(/Development → Projects → uiex-builder-connector → the app → Distribution/);
    expect(fix.steps.join(' ')).toMatch(/Begin publishing/);
    expect(fix.links.map((l) => l.href)).toEqual([CTX.setupUrl, `${HOSTING_DOCS_URL}#accept-hubspots-acceptable-use-policy-once`]);
    expect(fix.note).toContain('https://builder.example.com');
    expect(fix.note).toContain('has not signed the acceptable use policy');
    expect(fix.note).toContain('no Marketplace listing needed');
  });

  it('not allowed to install apps is for a Super Admin of the person’s own account', () => {
    const fix = signInFix('install_permission', CTX);
    expect(fix.who).toBe('super_admin');
    expect(fix.summary).toMatch(/Super Admins \(or users with App Marketplace access\)/);
    expect(fix.note).toMatch(/click Connect HubSpot and approve once/);
  });

  it('a window that closed by itself offers this tab; "something else" lists the host-side causes and quotes HubSpot', () => {
    expect(signInFix('nothing', CTX)).toMatchObject({ who: 'you', continueInTab: true });
    expect(signInFix('nothing', CTX).steps.join(' ')).toContain('builder.example.com');
    const other = signInFix('other', { ...CTX, details: 'This app has reached its install limit' });
    expect(other.steps.join(' ')).toMatch(/up to 25 HubSpot accounts/);
    expect(other.note).toContain('“This app has reached its install limit”');
    expect(signInFix('cancelled', CTX)).toMatchObject({ who: 'you', steps: [] });
  });

  it('while the window is still open, "I closed it" is not offered', () => {
    expect(signInTroubleChoices().map((c) => c.kind)).toEqual(['aup', 'install_permission', 'cancelled', 'nothing', 'other']);
    expect(signInTroubleChoices(true).map((c) => c.kind)).toEqual(['aup', 'install_permission', 'nothing', 'other']);
  });
});

describe('The HubSpot window closed without a result: "What did HubSpot show?"', () => {
  it('asks what HubSpot showed and gives the fix with a note to copy for whoever set up the builder', async () => {
    stubActions();
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    vi.stubGlobal('isSecureContext', true);
    showResult('popup_closed');
    const dialog = screen.getByRole('dialog', { name: 'HubSpot was not connected' });
    const group = within(dialog).getByRole('group', { name: 'What did HubSpot show?' });
    expect(within(group).getAllByRole('radio')).toHaveLength(5);
    fireEvent.click(within(group).getByRole('radio', { name: /acceptable use policy/ }));
    const fix = within(dialog).getByRole('region', { name: /needs to sign HubSpot’s Acceptable Use Policy/ });
    expect(fix).toHaveTextContent('Fixed by whoever set up this builder');
    expect(within(fix).getByRole('link', { name: /Setup checklist/ })).toHaveAttribute('href', expect.stringMatching(/\/setup\.html$/));
    fireEvent.click(within(fix).getByRole('button', { name: 'Copy a note for whoever set up this builder' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('acceptable use policy')));
    expect(await within(fix).findByRole('status')).toHaveTextContent(/Copied/);
    // Trying again right away won't help with a host-side problem: it is no longer the main button.
    expect(within(dialog).getByRole('button', { name: 'Try again' })).not.toHaveClass('ub-btn--primary');
  });

  it('without clipboard access the note is shown selected, ready to copy by hand', async () => {
    stubActions();
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
    showResult('popup_closed');
    const dialog = screen.getByRole('dialog', { name: 'HubSpot was not connected' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /not allowed to install apps/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Copy a note for your Super Admin' }));
    const note = await within(dialog).findByRole('textbox', { name: 'Note to send' });
    expect((note as HTMLTextAreaElement).value).toMatch(/Super Admin/);
    expect(within(dialog).getByRole('status')).toHaveTextContent(/press Ctrl\+C/);
  });

  it('"It closed by itself" makes continuing in this tab the main button', () => {
    const actions = stubActions();
    showResult('popup_closed');
    const dialog = screen.getByRole('dialog', { name: 'HubSpot was not connected' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /closed by itself/ }));
    const inTab = within(dialog).getByRole('button', { name: 'Continue in this tab' });
    expect(inTab).toHaveClass('ub-btn--primary');
    fireEvent.click(inTab);
    expect(actions.connectInThisTab).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('"I closed it" keeps Try again as the main button', () => {
    const actions = stubActions();
    showResult('timeout');
    const dialog = screen.getByRole('dialog', { name: 'Connecting took too long' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /I closed it/ }));
    expect(within(dialog).getByRole('region', { name: /nothing was shared/ })).toBeInTheDocument();
    const retry = within(dialog).getByRole('button', { name: 'Try again' });
    expect(retry).toHaveClass('ub-btn--primary');
    fireEvent.click(retry);
    expect(actions.connect).toHaveBeenCalledTimes(1);
  });

  it('"Something else" puts what HubSpot said into the note', async () => {
    stubActions();
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    vi.stubGlobal('isSecureContext', true);
    render(<SignInHelp initial="other" />);
    fireEvent.change(screen.getByPlaceholderText('Type or paste HubSpot’s message'), { target: { value: 'redirect_uri mismatch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy a note for whoever set up this builder' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('“redirect_uri mismatch”')));
  });
});

describe('A blocked HubSpot window', () => {
  it('offers one click to continue in this tab, or the window again', () => {
    const actions = stubActions();
    showResult('popup_blocked');
    const dialog = screen.getByRole('dialog', { name: 'Your browser blocked the HubSpot window' });
    expect(dialog).toHaveTextContent('nothing happened yet');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Try the window again' }));
    expect(actions.connect).toHaveBeenCalledTimes(1);
    act(() => {
      useConnection.setState({ errorCode: 'popup_blocked', errorSource: 'sign-in', error: 'Your browser blocked the HubSpot window.' });
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Continue in this tab' }));
    expect(actions.connectInThisTab).toHaveBeenCalledTimes(1);
  });
});

describe('Still waiting for HubSpot', () => {
  it('offers "Having trouble?" early, and opens the help by itself after half a minute', () => {
    vi.useFakeTimers();
    try {
      stubActions();
      useConnection.setState({ status: 'connecting', health: healthFixture(), connectingSince: Date.now() });
      render(<ConnectButton />);
      act(() => {
        vi.advanceTimersByTime(CONNECT_TIMINGS.waitingHintMs + 10);
      });
      const panel = screen.getByRole('region', { name: 'Waiting for HubSpot' });
      expect(within(panel).getByRole('status')).toHaveTextContent('Waiting for HubSpot…');
      const toggle = within(panel).getByRole('button', { name: 'Having trouble?' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      act(() => {
        vi.advanceTimersByTime(CONNECT_TIMINGS.stillWaitingMs);
      });
      expect(within(panel).getByRole('status')).toHaveTextContent('Still waiting for HubSpot…');
      const group = within(panel).getByRole('group', { name: 'What does the HubSpot window show?' });
      // The window is still open: no "I closed it".
      expect(within(group).queryByRole('radio', { name: /I closed it/ })).toBeNull();
      fireEvent.click(within(group).getByRole('radio', { name: /acceptable use policy/ }));
      expect(within(panel).getByRole('button', { name: 'Copy a note for whoever set up this builder' })).toBeInTheDocument();
      // Closing the help by hand keeps it closed.
      fireEvent.click(within(panel).getByRole('button', { name: /Having trouble\? Tell us what HubSpot shows/ }));
      expect(within(panel).queryByRole('group')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays out of the way while the guided setup runs the sign-in itself', async () => {
    vi.useFakeTimers();
    try {
      stubActions();
      const { setConnectResultsInline } = await import('./host');
      setConnectResultsInline(true);
      useConnection.setState({ status: 'connecting', health: healthFixture(), connectingSince: Date.now() });
      render(<ConnectButton />);
      act(() => {
        vi.advanceTimersByTime(CONNECT_TIMINGS.waitingHintMs + 10);
      });
      expect(screen.queryByRole('region', { name: 'Waiting for HubSpot' })).toBeNull();
      setConnectResultsInline(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tells the host’s status page what the window did and what HubSpot showed (no free text)', async () => {
    resetErrorReporterForTests();
    stubActions();
    const posted: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)));
        return new Response(null, { status: 204 });
      }),
    );
    showResult('popup_closed');
    const dialog = screen.getByRole('dialog', { name: 'HubSpot was not connected' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Something else/ }));
    const details = within(dialog).getByPlaceholderText('Type or paste HubSpot’s message');
    // Acting on the fix settles the answer at once.
    fireEvent.focus(details);
    fireEvent.change(details, { target: { value: 'secret words' } });
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted).toEqual([
      { type: 'signin_feedback', kind: 'popup_closed' },
      { type: 'signin_feedback', kind: 'other' },
    ]);
    expect(JSON.stringify(posted)).not.toContain('secret');
    resetErrorReporterForTests();
  });

  it('reports only the answer the person settles on, not every choice they move through', async () => {
    resetErrorReporterForTests();
    stubActions();
    const posted: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        posted.push(JSON.parse(String(init.body)));
        return new Response(null, { status: 204 });
      }),
    );
    showResult('popup_closed');
    const dialog = screen.getByRole('dialog', { name: 'HubSpot was not connected' });
    // Like arrow keys in a radio group: every option is selected on the way.
    for (const name of [/acceptable use policy/i, /not allowed to install/i, /Something else/, /acceptable use policy/i]) {
      fireEvent.click(within(dialog).getByRole('radio', { name }));
    }
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted).toEqual([{ type: 'signin_feedback', kind: 'popup_closed' }]);
    await waitFor(() => expect(posted).toHaveLength(2), { timeout: SIGN_IN_FEEDBACK_SETTLE_MS + 1500 });
    expect(posted[1]).toEqual({ type: 'signin_feedback', kind: 'aup' });
    // Changing their mind later is sent too (the status page keeps the latest answer).
    fireEvent.click(within(dialog).getByRole('radio', { name: /not allowed to install/i }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Copy a note/ }));
    await waitFor(() => expect(posted).toHaveLength(3));
    expect(posted[2]).toEqual({ type: 'signin_feedback', kind: 'install_permission' });
    resetErrorReporterForTests();
  }, 10_000);
});
