/**
 * Publish to HubSpot: the personal access key is checked with HubSpot before anything is uploaded,
 * and every problem with the key or its account (missing "Developer projects", another account,
 * ALLOWED_PORTALS, HubSpot's 403s) is shown with its fix — without losing the key or the project.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createExtension, createProject } from '../../model/factory';
import { useEditor } from '../../model/store';
import { useConnection } from '../../connect/store';
import type { DeployKeyAccount, DeployKeyCheck, DeployKeyCheckRequest, DeployStatus } from '../../connect/types';
import { ToastProvider } from '../../ui';
import { DeployToHubSpotPanel } from './DeployPanel';
import { DeployClientError, keyAccountFrom, keyCheckFrom, type DeployClient } from './client';
import { failureAdvice, isFormErrorCode, keyProblemCopy, keyProblemKind } from './model';
import { keyLooksComplete } from './useKeyCheck';

vi.mock('../../model/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../model/validate')>();
  return { ...actual, validateProject: () => [] };
});

vi.mock('../../codegen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../codegen')>();
  return { ...actual, formattedProjectFiles: async (p: Parameters<typeof actual.generateProjectFiles>[0]) => actual.generateProjectFiles(p) };
});

const PORTAL = 12345678;
const OTHER = 87654321;
const KEY = 'CiRuYTEtZmFrZS1rZXktZm9yLXRlc3Rz';

const account = (extra: Partial<DeployKeyAccount> = {}): DeployKeyAccount => ({
  portalId: PORTAL,
  name: 'Acme Demo',
  developerProjects: 'yes',
  keyPageUrl: `https://app.hubspot.com/personal-access-key/${PORTAL}`,
  ...extra,
});
const ok = (extra: Partial<DeployKeyCheck> = {}): DeployKeyCheck => ({ ok: true, key: account(), target: { portalId: PORTAL, name: 'acmedemo.com' }, ...extra });

function building(): DeployStatus {
  return { deployId: 'd1', phase: 'building', message: 'Building', log: [], portalId: PORTAL, projectName: 'deal-desk', buildId: 7 };
}

function mockClient(checks: Array<DeployKeyCheck | Error>, start?: DeployClient['start']) {
  const queue = [...checks];
  return {
    start: vi.fn<DeployClient['start']>(start ?? (async () => building())),
    status: vi.fn<DeployClient['status']>(async () => new Promise<DeployStatus>(() => {})),
    checkKey: vi.fn(async (_r: DeployKeyCheckRequest) => {
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      if (!next) throw new Error('no check');
      if (next instanceof Error) throw next;
      return next;
    }),
  };
}

function connectTo(connected = true) {
  useConnection.setState({
    status: connected ? 'connected' : 'not-configured',
    error: null,
    health: {
      ok: true,
      version: '1',
      oauthConfigured: connected,
      features: { crm: true, fetchProxy: true, deploy: true, ...(connected ? { deployNeedsSignIn: true } : {}) },
      scopes: { required: [], optional: [] },
    },
    info: connected
      ? { connected: true, portalId: PORTAL, hubDomain: 'acmedemo.com', user: { email: 'jordan@acmedemo.com' }, scopes: [], expiresAt: 0, appHost: 'app.hubspot.com' }
      : { connected: false },
    connect: vi.fn(async () => {}),
    switchPortal: vi.fn(async () => {}),
  });
}

function renderPanel(client: DeployClient) {
  return render(
    <ToastProvider>
      <DeployToHubSpotPanel client={client} pollIntervalMs={1} cliFallback={<div>CLI STEPS</div>} />
    </ToastProvider>,
  );
}

function typeKey(value = KEY) {
  fireEvent.change(screen.getByLabelText('Paste your key'), { target: { value } });
}

const publishButton = () => screen.getByRole('button', { name: /^(Publish to HubSpot|Checking your key…|Preparing files…)$/ });

const realConnect = useConnection.getState().connect;
const realSwitch = useConnection.getState().switchPortal;

beforeEach(() => {
  useEditor.getState().loadProject(createProject('Deal Desk', [createExtension({ name: 'Deal Card', objectTypes: ['deals'] })]));
  connectTo();
});

afterEach(() => {
  vi.restoreAllMocks();
  useConnection.setState({ connect: realConnect, switchPortal: realSwitch });
});

describe('the key is checked before anything is uploaded', () => {
  it('checks a pasted key by itself and says which account it belongs to', async () => {
    const client = mockClient([ok()]);
    renderPanel(client);
    typeKey();
    // Checked by itself shortly after pasting (no click).
    const okLine = await screen.findByText(/Key checked: it belongs to/, {}, { timeout: 3000 });
    expect(okLine.closest('[role="status"]')).toHaveTextContent('Key checked: it belongs to Acme Demo (account 12345678) and has the Developer projects permission. Ready to publish.');
    expect(client.checkKey).toHaveBeenCalledWith({ personalAccessKey: KEY });
    fireEvent.click(publishButton());
    await waitFor(() => expect(client.start).toHaveBeenCalledTimes(1));
    // Not checked twice.
    expect(client.checkKey).toHaveBeenCalledTimes(1);
  });

  it('Publish checks the key first when that has not happened yet', async () => {
    const client = mockClient([ok()]);
    renderPanel(client);
    typeKey();
    fireEvent.click(publishButton());
    await waitFor(() => expect(client.start).toHaveBeenCalledTimes(1));
    expect(client.checkKey).toHaveBeenCalledTimes(1);
    expect(client.checkKey.mock.invocationCallOrder[0]).toBeLessThan(client.start.mock.invocationCallOrder[0]);
  });

  it('a key without Developer projects: the fix, the key page of its account, Check again — and nothing uploaded', async () => {
    const missing = ok({
      ok: false,
      problem: 'missing_permission',
      key: account({ developerProjects: 'no' }),
      message: 'Your personal access key for Acme Demo (account 12345678) doesn’t have the “Developer projects” permission.',
    });
    const client = mockClient([missing, missing, ok()]);
    renderPanel(client);
    typeKey();
    fireEvent.click(publishButton());
    const problem = await screen.findByRole('alert', { name: /missing the “Developer projects” permission/ });
    expect(problem).toHaveTextContent('Key for Acme Demo (account 12345678) — the account you’re connected to');
    expect(within(problem).getByRole('link', { name: /Open the key page for Acme Demo/ })).toHaveAttribute('href', `https://app.hubspot.com/personal-access-key/${PORTAL}`);
    expect(client.start).not.toHaveBeenCalled();
    // Publish again: checks again (the admin may have fixed it), still refused, still nothing uploaded.
    fireEvent.click(publishButton());
    await waitFor(() => expect(client.checkKey).toHaveBeenCalledTimes(2));
    expect(client.start).not.toHaveBeenCalled();
    // Fixed in HubSpot: Check again keeps the key and the project.
    fireEvent.click(within(screen.getByRole('alert', { name: /Developer projects/ })).getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText(/Key checked: it belongs to/)).toBeInTheDocument();
    expect(screen.queryByRole('alert', { name: /Developer projects/ })).toBeNull();
    expect(screen.getByLabelText('Paste your key')).toHaveValue(KEY);
    fireEvent.click(publishButton());
    await waitFor(() => expect(client.start).toHaveBeenCalledTimes(1));
  });

  it('"Publish anyway" when the admin is sure the key has the permission', async () => {
    const client = mockClient([ok({ ok: false, problem: 'missing_permission', key: account({ developerProjects: 'no' }) })]);
    renderPanel(client);
    typeKey();
    fireEvent.click(publishButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Publish anyway' }));
    await waitFor(() => expect(client.start).toHaveBeenCalledTimes(1));
  });

  it('a key from another account: both accounts, the connected account’s key page, Switch HubSpot account', async () => {
    const client = mockClient([
      ok({ ok: false, problem: 'portal_mismatch', key: account({ portalId: OTHER, name: 'Other Co', keyPageUrl: `https://app.hubspot.com/personal-access-key/${OTHER}` }) }),
    ]);
    renderPanel(client);
    typeKey();
    fireEvent.click(publishButton());
    const problem = await screen.findByRole('alert', { name: /This key is for a different HubSpot account/ });
    expect(within(problem).getByText('Your key is for').nextSibling).toHaveTextContent('Other Co (account 87654321)');
    expect(within(problem).getByText('You’re connected to').nextSibling).toHaveTextContent('acmedemo.com (account 12345678)');
    expect(within(problem).getByRole('link', { name: /Open the key page for acmedemo\.com/ })).toHaveAttribute('href', `https://app.hubspot.com/personal-access-key/${PORTAL}`);
    fireEvent.click(within(problem).getByRole('button', { name: 'Switch HubSpot account' }));
    expect(useConnection.getState().switchPortal).toHaveBeenCalled();
    expect(client.start).not.toHaveBeenCalled();
  });

  it('an account this builder may not publish to: a note for whoever set it up', async () => {
    const client = mockClient([ok({ ok: false, problem: 'portal_not_allowed', key: account(), message: 'ALLOWED_PORTALS' })]);
    renderPanel(client);
    typeKey();
    fireEvent.click(publishButton());
    const problem = await screen.findByRole('alert', { name: /This builder doesn’t publish to account 12345678/ });
    fireEvent.click(within(problem).getByRole('button', { name: 'Show the note' }));
    expect((within(problem).getByRole('textbox', { name: 'Note to send' }) as HTMLTextAreaElement).value).toMatch(/add 12345678 to ALLOWED_PORTALS/);
    expect(within(problem).getByRole('button', { name: 'Copy a note for whoever set up this builder' })).toBeInTheDocument();
  });

  it('a key HubSpot refuses is explained on the key field, and nothing is uploaded', async () => {
    const client = mockClient([new DeployClientError(400, 'invalid_key', "HubSpot didn't accept this personal access key.")]);
    renderPanel(client);
    typeKey();
    fireEvent.click(publishButton());
    const err = await screen.findByText(/didn't accept this personal access key/);
    expect(err.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByLabelText('Paste your key')).toHaveAttribute('aria-invalid', 'true');
    expect(client.start).not.toHaveBeenCalled();
  });

  it('an older server without the key check publishes straight away', async () => {
    const client = mockClient([new DeployClientError(405, 'method_not_allowed', 'Use GET.')]);
    renderPanel(client);
    typeKey();
    fireEvent.click(publishButton());
    await waitFor(() => expect(client.start).toHaveBeenCalledTimes(1));
  });
});

describe('HubSpot refuses the upload (403s) — the fix, and Try again keeps everything', () => {
  it('forbidden: HubSpot’s own words, a note for the Super Admin, Try again', async () => {
    const start = vi
      .fn<DeployClient['start']>()
      .mockRejectedValueOnce(
        new DeployClientError(403, 'forbidden', 'HubSpot refused to take the project into Acme Demo (account 12345678). HubSpot said: “The user does not have permission to use developer tools in this account.”', undefined, undefined, account()),
      )
      .mockResolvedValueOnce(building());
    const client = mockClient([ok()], start);
    renderPanel(client);
    typeKey();
    fireEvent.click(publishButton());
    const problem = await screen.findByRole('alert', { name: /HubSpot refused to take the project/ });
    expect(problem).toHaveTextContent('HubSpot said: “The user does not have permission to use developer tools in this account.”');
    expect(within(problem).getByRole('button', { name: 'Copy a note for your Super Admin' })).toBeInTheDocument();
    fireEvent.click(within(problem).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(client.start).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('list', { name: 'Publish progress' })).toBeInTheDocument();
  });

  it('missing_scope from HubSpot (the check could not tell): the same Developer projects fix', async () => {
    const client = mockClient([ok({ key: account({ developerProjects: 'unknown' }) })], async () => {
      throw new DeployClientError(403, 'missing_scope', 'Your personal access key needs the “Developer projects” permission.', undefined, ['developer.projects.write'], account({ developerProjects: 'no' }));
    });
    renderPanel(client);
    typeKey();
    fireEvent.click(publishButton());
    const problem = await screen.findByRole('alert', { name: /missing the “Developer projects” permission/ });
    expect(within(problem).getByRole('link', { name: /Open the key page for Acme Demo/ })).toBeInTheDocument();
    expect(within(problem).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    // Still on the form with the key.
    expect(screen.getByLabelText('Paste your key')).toHaveValue(KEY);
  });

  it('not_available: developer projects are not on in that account', async () => {
    const client = mockClient([ok()], async () => {
      throw new DeployClientError(403, 'not_available', "HubSpot says developer projects aren't available in Acme Demo (account 12345678).", undefined, undefined, account());
    });
    renderPanel(client);
    typeKey();
    fireEvent.click(publishButton());
    const problem = await screen.findByRole('alert', { name: /doesn’t allow developer projects in this account/ });
    expect(problem).toHaveTextContent('developer test account');
  });
});

describe('pure helpers', () => {
  it('only checks keys that look complete', () => {
    expect(keyLooksComplete(KEY)).toBe(true);
    expect(keyLooksComplete('short')).toBe(false);
    expect(keyLooksComplete('CiRuYTEt with spaces in it 000')).toBe(false);
    expect(keyLooksComplete(['pat', 'na1', '11111111-2222-3333-4444-555555555555'].join('-'))).toBe(false);
  });

  it('maps every 403 variant (and the others) to a fix on the form', () => {
    for (const code of ['missing_scope', 'not_available', 'forbidden', 'portal_not_allowed', 'portal_mismatch', 'forbidden_origin', 'csrf', 'invalid_key', 'not_connected']) {
      expect(isFormErrorCode(code), code).toBe(true);
    }
    expect(isFormErrorCode('build_failed')).toBe(false);
    expect(keyProblemKind('missing_scope')).toBe('missing_permission');
    expect(keyProblemKind('forbidden_origin')).toBe('origin');
    expect(keyProblemKind('build_failed')).toBeNull();
    const ctx = { key: { portalId: 1, name: 'A' }, connected: { portalId: 2, hubDomain: 'b.com' }, builderUrl: 'https://x.test', setupUrl: 'https://x.test/setup.html' };
    expect(keyProblemCopy('portal_mismatch', ctx).steps[0]).toMatch(/Get a key for b\.com \(account 2\)/);
    expect(keyProblemCopy('origin', ctx).note).toContain('APP_URL is https://x.test');
    for (const code of ['missing_scope', 'not_available', 'forbidden', 'portal_not_allowed', 'not_connected', 'deploy_not_found']) {
      expect(failureAdvice(code)[0], code).not.toMatch(/^Click Try again\.$/);
    }
  });

  it('only trusts what the server says about a key when it looks right', () => {
    expect(keyAccountFrom({ portalId: 1, keyPageUrl: 'javascript:alert(1)', developerProjects: 'yes' })).toBeUndefined();
    expect(keyAccountFrom({ portalId: -1, keyPageUrl: 'https://app.hubspot.com/x' })).toBeUndefined();
    expect(keyAccountFrom({ portalId: 1, keyPageUrl: 'https://app.hubspot.com/x', developerProjects: 'maybe', accountType: 'evil type' })).toEqual({
      portalId: 1,
      keyPageUrl: 'https://app.hubspot.com/x',
      developerProjects: 'unknown',
    });
    expect(() => keyCheckFrom({ ok: true })).toThrow(/unexpected answer/);
    expect(keyCheckFrom({ ok: false, key: { portalId: 1, keyPageUrl: 'https://a.test/k' }, problem: 'weird' }).problem).toBe('missing_permission');
  });
});
