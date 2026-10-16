import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createExtension, createProject } from '../../model/factory';
import { useEditor } from '../../model/store';
import type { Issue } from '../../model/validate';
import { useConnection } from '../../connect/store';
import type { DeployRequest, DeployStatus } from '../../connect/types';
import { ToastProvider } from '../../ui';
import { ExportDialog } from '../dialogs';
import { DeployToHubSpotPanel } from './DeployPanel';
import { DeployClientError, type DeployClient } from './client';

const mocks = vi.hoisted(() => ({ issues: null as Issue[] | null }));

vi.mock('../../model/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../model/validate')>();
  return { ...actual, validateProject: (p: Parameters<typeof actual.validateProject>[0]) => mocks.issues ?? actual.validateProject(p) };
});

vi.mock('../../codegen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../codegen')>();
  // Skip prettier in tests (the real panel formats like the zip export does).
  return { ...actual, formattedProjectFiles: async (p: Parameters<typeof actual.generateProjectFiles>[0]) => actual.generateProjectFiles(p) };
});

const PORTAL = 12345678;
const PROJECT_URL = `https://app.hubspot.com/developer-projects/${PORTAL}/project/deal-desk`;

function status(phase: DeployStatus['phase'], n: number, extra: Partial<DeployStatus> = {}): DeployStatus {
  return {
    deployId: `d${n}`,
    phase,
    message: phase === 'building' ? `HubSpot is building your project (build #7).` : phase === 'deploying' ? 'Deploying build #7 to your HubSpot account…' : 'Your project is live in HubSpot.',
    log: ['Signed in to HubSpot account 12345678 with your personal access key.', `Uploaded 15 files. HubSpot started build #7.`],
    portalId: PORTAL,
    projectName: 'deal-desk',
    buildId: 7,
    projectUrl: PROJECT_URL,
    ...extra,
  };
}

function mockClient(opts: { start?: DeployClient['start']; statuses?: Array<DeployStatus | Error>; remembered?: boolean } = {}) {
  const queue = [...(opts.statuses ?? [])];
  const client = {
    start: vi.fn(opts.start ?? (async () => status('building', 1))),
    status: vi.fn(async (_deployId: string) => {
      const next = queue.shift();
      if (!next) throw new Error('no more statuses');
      if (next instanceof Error) throw next;
      return next;
    }),
    keyInfo: vi.fn(async () => (opts.remembered ? { remembered: true, portalId: PORTAL } : { remembered: false })),
    forgetKey: vi.fn(async () => ({ remembered: false })),
  } satisfies DeployClient;
  return client;
}

function connect(state: 'connected' | 'disconnected' | 'unavailable' | 'checking' = 'connected', deploy = true) {
  useConnection.setState({
    status: state,
    error: null,
    health: state === 'unavailable' ? null : { ok: true, version: '1', oauthConfigured: true, features: { crm: true, fetchProxy: true, deploy }, scopes: { required: [], optional: [] } },
    info:
      state === 'connected'
        ? { connected: true, portalId: PORTAL, hubDomain: 'acmedemo.com', user: { email: 'jordan@acmedemo.com' }, scopes: [], expiresAt: 0, appHost: 'app.hubspot.com' }
        : { connected: false },
    connect: vi.fn(async () => {}),
  });
}

function loadProject() {
  const card = createExtension({ name: 'Deal Card', objectTypes: ['deals'] });
  useEditor.getState().loadProject(createProject('Deal Desk', [card]));
}

function renderPanel(client: DeployClient, extra: { onShowCli?: () => void; onClose?: () => void } = {}) {
  return render(
    <ToastProvider>
      <DeployToHubSpotPanel client={client} pollIntervalMs={1} cliFallback={<div>CLI STEPS</div>} {...extra} />
    </ToastProvider>,
  );
}

function typeKey(value = 'CiRuYTEtZmFrZS1rZXktZm9yLXRlc3Rz') {
  fireEvent.change(screen.getByLabelText('Paste your key'), { target: { value } });
}

const realConnect = useConnection.getState().connect;

beforeEach(() => {
  mocks.issues = [];
  loadProject();
  connect('connected');
});

afterEach(() => {
  vi.restoreAllMocks();
  useConnection.setState({ connect: realConnect });
});

describe('<DeployToHubSpotPanel> availability', () => {
  it('shows the CLI instructions when there is no connector', () => {
    connect('unavailable');
    renderPanel(mockClient());
    expect(screen.getByText('Deploying from the builder isn’t available here')).toBeInTheDocument();
    expect(screen.getByText(/runs without its HubSpot connector/)).toBeInTheDocument();
    expect(screen.getByText('CLI STEPS')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deploy to HubSpot' })).toBeNull();
  });

  it('shows the CLI instructions when deploy is turned off on the server', () => {
    connect('connected', false);
    renderPanel(mockClient());
    expect(screen.getByText(/turned off deploying from the builder/)).toBeInTheDocument();
    expect(screen.getByText('CLI STEPS')).toBeInTheDocument();
  });

  it('waits while the connection is being checked', () => {
    connect('checking');
    renderPanel(mockClient());
    expect(screen.getByText('Checking the connection to HubSpot…').closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Deploy to HubSpot' })).toBeNull();
  });

  it('is a tab of the Export dialog', async () => {
    connect('unavailable');
    render(
      <ToastProvider>
        <ExportDialog open onClose={() => {}} arg="hubspot" />
      </ToastProvider>,
    );
    const tab = screen.getByRole('tab', { name: 'Deploy to HubSpot' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Deploy with CLI' })).toBeInTheDocument();
    // The fallback is the existing CLI guide.
    expect(screen.getByText('hs project upload')).toBeInTheDocument();
  });
});

describe('<DeployToHubSpotPanel> deploying', () => {
  it('explains the deploy, guides the admin to a key and runs upload → build → deploy → done', async () => {
    const client = mockClient({
      statuses: [
        status('building', 2),
        status('deploying', 3),
        status('success', 4, {
          installUrl: `https://app.hubspot.com/static-token/${PORTAL}/authorize?appId=55`,
          log: ['Signed in…', 'Build #7 succeeded.', 'Warning: Card "deal_card" has no description.', 'Deployed build #7.'],
        }),
      ],
    });
    renderPanel(client);
    expect(screen.getByText(/no terminal needed/)).toBeInTheDocument();
    expect(screen.getByText(/Your CRM records are not changed/)).toBeInTheDocument();
    expect(screen.getByText('acmedemo.com')).toBeInTheDocument();

    const deployBtn = screen.getByRole('button', { name: 'Deploy to HubSpot' });
    expect(deployBtn).toBeDisabled();

    // Guide
    const toggle = screen.getByRole('button', { name: /How do I get this\?/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const guide = screen.getByRole('region', { name: 'How to get a personal access key' });
    expect(within(guide).getByText('Create a key if you don’t have one yet')).toBeInTheDocument();
    expect(within(guide).getByText(/“Developer projects” permission/)).toBeInTheDocument();
    expect(within(guide).getByText(/search for “personal access key”/)).toBeInTheDocument();
    expect(within(guide).getByRole('link', { name: /Open the personal access key page/ })).toHaveAttribute('href', `https://app.hubspot.com/personal-access-key/${PORTAL}`);

    // Key field: hidden by default, can be shown.
    const input = screen.getByLabelText('Paste your key');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(input).toHaveAttribute('type', 'text');
    typeKey();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remember on this browser' }));
    expect(deployBtn).toBeEnabled();
    fireEvent.click(deployBtn);

    await waitFor(() => expect(client.start).toHaveBeenCalledTimes(1));
    const req = client.start.mock.calls[0][0] as DeployRequest;
    expect(req).toMatchObject({ personalAccessKey: 'CiRuYTEtZmFrZS1rZXktZm9yLXRlc3Rz', remember: true, portalId: PORTAL, projectName: 'deal-desk', platformVersion: '2026.03' });
    expect(req.useRememberedKey).toBeUndefined();
    expect(req.files.map((f) => f.path)).toEqual(expect.arrayContaining(['hsproject.json', 'src/app/app-hsmeta.json', 'src/app/cards/DealCard.tsx']));

    // Progress: stepper + live status + log.
    const stepper = await screen.findByRole('list', { name: 'Deploy progress' });
    expect(within(stepper).getAllByRole('listitem').map((li) => li.textContent?.split('—')[0].trim())).toEqual([
      expect.stringContaining('Uploading'),
      expect.stringContaining('Building'),
      expect.stringContaining('Deploying'),
      expect.stringContaining('Done'),
    ]);

    // Done.
    expect(await screen.findByText('Your project is live in HubSpot.')).toBeInTheDocument();
    expect(client.status.mock.calls.map((c) => c[0])).toEqual(['d1', 'd2', 'd3']);
    expect(screen.getByRole('link', { name: /Open project in HubSpot/ })).toHaveAttribute('href', PROJECT_URL);
    expect(screen.getByRole('link', { name: /Install the app/ })).toHaveAttribute('href', `https://app.hubspot.com/static-token/${PORTAL}/authorize?appId=55`);
    const next = screen.getByRole('region', { name: 'Next steps' });
    expect(within(next).getByText('Install the app in your account')).toBeInTheDocument();
    expect(within(next).getByText('Add “Deal Card” to a tab in the middle column')).toBeInTheDocument();
    expect(within(next).getByText(/Open a deals record, click Customize/)).toBeInTheDocument();
    const stepItems = within(screen.getByRole('list', { name: 'Deploy progress' })).getAllByRole('listitem');
    expect(stepItems.every((li) => li.textContent?.includes('done'))).toBe(true);

    // Log is folded away with a warnings badge.
    const logToggle = screen.getByRole('button', { name: /Deploy log/ });
    expect(logToggle).toHaveTextContent('warnings');
    fireEvent.click(logToggle);
    expect(screen.getByRole('log', { name: 'Deploy log' })).toHaveTextContent('Warning: Card "deal_card" has no description.');

    fireEvent.click(screen.getByRole('button', { name: 'Deploy again' }));
    expect(screen.getByRole('button', { name: 'Deploy to HubSpot' })).toBeInTheDocument();
  });

  it('shows a failed build with its log, and retries', async () => {
    const client = mockClient({
      statuses: [
        status('failed', 2, {
          error: 'build_failed',
          message: "HubSpot couldn't build your project (build #7). The log below says why — fix it in the builder and deploy again.",
          log: ['Uploaded 15 files. HubSpot started build #7.', 'deal_card failed: Card deal_card failed to compile', "• src/app/cards/DealCard.tsx(3,1): error TS2304: Cannot find name 'x'."],
        }),
      ],
    });
    renderPanel(client);
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Deploy to HubSpot' }));
    expect(await screen.findByText('The deploy didn’t finish')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't build your project/);
    expect(screen.getByRole('log', { name: 'Deploy log' })).toHaveTextContent('error TS2304');
    const steps = within(screen.getByRole('list', { name: 'Deploy progress' })).getAllByRole('listitem');
    expect(steps[0]).toHaveTextContent('done');
    expect(steps[1]).toHaveTextContent('failed');
    expect(screen.getByRole('link', { name: /Open project in HubSpot/ })).toHaveAttribute('href', PROJECT_URL);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(client.start).toHaveBeenCalledTimes(2));
    expect((client.start.mock.calls[1][0] as DeployRequest).personalAccessKey).toBe('CiRuYTEtZmFrZS1rZXktZm9yLXRlc3Rz');
  });

  it('keeps polling through brief connection problems', async () => {
    const client = mockClient({
      statuses: [new DeployClientError(0, 'network', 'offline'), new DeployClientError(503, 'hubspot_error', 'busy'), status('success', 3)],
    });
    renderPanel(client);
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Deploy to HubSpot' }));
    expect(await screen.findByText('Your project is live in HubSpot.')).toBeInTheDocument();
    expect(client.status).toHaveBeenCalledTimes(3);
  });

  it('shows key problems on the key field and clears them when the key changes', async () => {
    const client = mockClient({
      start: async () => {
        throw new DeployClientError(400, 'invalid_key', "HubSpot didn't accept this personal access key.");
      },
    });
    renderPanel(client);
    typeKey('CiRuYTEtd3Jvbmcta2V5LTAwMDAwMDAw');
    fireEvent.click(screen.getByRole('button', { name: 'Deploy to HubSpot' }));
    const err = await screen.findByText(/didn't accept this personal access key/);
    expect(err.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Open the key page in HubSpot' })).toHaveAttribute('href', `https://app.hubspot.com/personal-access-key/${PORTAL}`);
    expect(screen.getByLabelText('Paste your key')).toHaveAttribute('aria-invalid', 'true');
    typeKey('CiRuYTEtYW5vdGhlci1rZXktMDAwMDAw');
    expect(screen.queryByText(/didn't accept this personal access key/)).toBeNull();
  });

  it('warns when the key belongs to another account and can deploy there instead', async () => {
    const client = mockClient({
      start: vi
        .fn<DeployClient['start']>()
        .mockRejectedValueOnce(new DeployClientError(409, 'portal_mismatch', 'This personal access key belongs to HubSpot account 999, but the deploy is going to account 12345678.', 999))
        .mockResolvedValueOnce(status('building', 1, { portalId: 999 })),
      statuses: [status('success', 2, { portalId: 999 })],
    });
    renderPanel(client);
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Deploy to HubSpot' }));
    expect(await screen.findByText('This key is for a different HubSpot account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deploy to HubSpot' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Deploy to account 999 instead' }));
    await waitFor(() => expect(client.start).toHaveBeenCalledTimes(2));
    expect((client.start.mock.calls[1][0] as DeployRequest).portalId).toBe(999);
    expect(await screen.findByText(/deployed to HubSpot account 999/)).toBeInTheDocument();
  });

  it('dismisses the account warning to try another key', async () => {
    const client = mockClient({
      start: async () => {
        throw new DeployClientError(409, 'portal_mismatch', 'Other account.', 999);
      },
    });
    renderPanel(client);
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Deploy to HubSpot' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use a different key' }));
    expect(screen.queryByText('This key is for a different HubSpot account')).toBeNull();
    expect(screen.getByRole('button', { name: 'Deploy to HubSpot' })).toBeEnabled();
  });

  it('uses and forgets the remembered key', async () => {
    const client = mockClient({ remembered: true, statuses: [status('success', 2)] });
    renderPanel(client);
    expect(await screen.findByText('Using the personal access key saved on this browser.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Paste your key')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Deploy to HubSpot' }));
    await waitFor(() => expect(client.start).toHaveBeenCalled());
    const req = client.start.mock.calls[0][0] as DeployRequest;
    expect(req.useRememberedKey).toBe(true);
    expect(req.personalAccessKey).toBeUndefined();
    await screen.findByText('Your project is live in HubSpot.');
    fireEvent.click(screen.getByRole('button', { name: 'Deploy again' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Forget saved key' }));
    expect(await screen.findByLabelText('Paste your key')).toBeInTheDocument();
    expect(client.forgetKey).toHaveBeenCalled();
  });

  it('offers the saved key right after a deploy that remembered it', async () => {
    let remembered = false;
    const client = mockClient({
      start: async (req) => {
        if (req.remember) remembered = true;
        return status('building', 1);
      },
      statuses: [status('success', 2)],
    });
    client.keyInfo.mockImplementation(async () => (remembered ? { remembered: true, portalId: PORTAL } : { remembered: false }));
    renderPanel(client);
    await waitFor(() => expect(client.keyInfo).toHaveBeenCalledTimes(1));
    typeKey();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remember on this browser' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deploy to HubSpot' }));
    await screen.findByText('Your project is live in HubSpot.');
    fireEvent.click(screen.getByRole('button', { name: 'Deploy again' }));
    expect(await screen.findByText('Using the personal access key saved on this browser.')).toBeInTheDocument();
    expect(client.keyInfo).toHaveBeenCalledTimes(2);

    // Forgetting it also empties the key field.
    fireEvent.click(screen.getByRole('button', { name: 'Forget saved key' }));
    expect(await screen.findByLabelText('Paste your key')).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: 'Remember on this browser' })).not.toBeChecked();
  });

  it('lets a disconnected admin deploy, but only a connected one remember the key', async () => {
    connect('disconnected');
    const client = mockClient();
    renderPanel(client);
    expect(screen.getByText(/goes to the HubSpot account your personal access key belongs to/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Remember on this browser' })).toBeDisabled();
    expect(screen.getByText('Connect HubSpot to remember the key.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Connect HubSpot' }));
    expect(useConnection.getState().connect).toHaveBeenCalled();
    expect(client.keyInfo).not.toHaveBeenCalled();
    // Not connected: the guide links to the account chooser.
    fireEvent.click(screen.getByRole('button', { name: /How do I get this\?/ }));
    expect(screen.getByRole('link', { name: /Open the personal access key page/ })).toHaveAttribute('href', 'https://app.hubspot.com/l/personal-access-key');
    typeKey();
    fireEvent.keyDown(screen.getByLabelText('Paste your key'), { key: 'Enter' });
    await waitFor(() => expect(client.start).toHaveBeenCalled());
    const req = client.start.mock.calls[0][0] as DeployRequest;
    expect(req.portalId).toBeUndefined();
    expect(req.remember).toBeUndefined();
  });

  it('gates on validation errors until "Deploy anyway"', () => {
    mocks.issues = [{ severity: 'error', rule: 'project-name', message: 'Bad name' } as Issue];
    const onClose = vi.fn();
    renderPanel(mockClient(), { onClose });
    typeKey();
    const deployBtn = screen.getByRole('button', { name: 'Deploy to HubSpot' });
    expect(screen.getByText(/1 problem will probably stop HubSpot/)).toBeInTheDocument();
    expect(deployBtn).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Deploy anyway' }));
    expect(deployBtn).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show problems' }));
    expect(onClose).toHaveBeenCalled();
    expect(useEditor.getState().bottomPanel).toBe('problems');
  });

  it('offers the CLI when the builder server cannot be reached', async () => {
    const onShowCli = vi.fn();
    const client = mockClient({
      start: async () => {
        throw new DeployClientError(0, 'network', "Couldn't reach the builder's server.");
      },
    });
    renderPanel(client, { onShowCli });
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Deploy to HubSpot' }));
    expect(await screen.findByText("Couldn't reach the builder's server.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use the HubSpot CLI instead' }));
    expect(onShowCli).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Paste your key')).toHaveValue('CiRuYTEtZmFrZS1rZXktZm9yLXRlc3Rz');
  });

  it('offers the CLI when the builder server is not set up to deploy', async () => {
    const onShowCli = vi.fn();
    const client = mockClient({
      start: async () => {
        throw new DeployClientError(503, 'not_configured', 'Deploying from the builder needs SESSION_SECRET on the server.');
      },
    });
    renderPanel(client, { onShowCli });
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Deploy to HubSpot' }));
    expect(await screen.findByText(/needs SESSION_SECRET/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use the HubSpot CLI instead' }));
    expect(onShowCli).toHaveBeenCalled();
  });

  it('stops polling when closed', async () => {
    const client = mockClient({ statuses: [status('building', 2), status('building', 3), status('building', 4)] });
    const view = renderPanel(client);
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Deploy to HubSpot' }));
    await waitFor(() => expect(client.status).toHaveBeenCalled());
    view.unmount();
    const calls = client.status.mock.calls.length;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(client.status.mock.calls.length).toBeLessThanOrEqual(calls + 1);
  });
});
