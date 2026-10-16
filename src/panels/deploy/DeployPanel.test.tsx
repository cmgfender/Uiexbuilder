import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function mockClient(opts: { start?: DeployClient['start']; statuses?: Array<DeployStatus | Error> } = {}) {
  const queue = [...(opts.statuses ?? [])];
  const client = {
    start: vi.fn(opts.start ?? (async () => status('building', 1))),
    status: vi.fn(async (_deployId: string) => {
      const next = queue.shift();
      if (!next) throw new Error('no more statuses');
      if (next instanceof Error) throw next;
      return next;
    }),
  } satisfies DeployClient;
  return client;
}

function connect(
  state: 'connected' | 'disconnected' | 'unavailable' | 'checking' | 'not-configured' = 'connected',
  deploy = true,
  extra: { reason?: 'disabled' | 'session_secret'; appBase?: string } = {},
) {
  const oauth = state !== 'not-configured';
  useConnection.setState({
    status: state,
    error: null,
    health:
      state === 'unavailable'
        ? null
        : {
            ok: true,
            version: '1',
            oauthConfigured: oauth,
            features: {
              crm: oauth,
              fetchProxy: oauth,
              deploy,
              ...(oauth ? { deployNeedsSignIn: true } : {}),
              ...(extra.reason ? { deployUnavailableReason: extra.reason } : {}),
            },
            scopes: { required: [], optional: [] },
            ...(extra.appBase ? { appBase: extra.appBase } : {}),
          },
    info:
      state === 'connected'
        ? { connected: true, portalId: PORTAL, hubDomain: 'acmedemo.com', user: { email: 'jordan@acmedemo.com' }, scopes: [], expiresAt: 0, appHost: 'app.hubspot.com' }
        : { connected: false },
    connect: vi.fn(async () => {}),
    switchPortal: vi.fn(async () => {}),
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
const realSwitch = useConnection.getState().switchPortal;

beforeEach(() => {
  mocks.issues = [];
  loadProject();
  connect('connected');
});

afterEach(() => {
  vi.restoreAllMocks();
  useConnection.setState({ connect: realConnect, switchPortal: realSwitch });
});

describe('<DeployToHubSpotPanel> availability', () => {
  it('shows the CLI instructions when there is no connector', () => {
    connect('unavailable');
    renderPanel(mockClient());
    expect(screen.getByText('Publishing from the builder isn’t available here')).toBeInTheDocument();
    expect(screen.getByText(/runs without its HubSpot connector/)).toBeInTheDocument();
    expect(screen.getByText('CLI STEPS')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish to HubSpot' })).toBeNull();
  });

  it('shows the CLI instructions when deploy is turned off on the server', () => {
    connect('connected', false, { reason: 'disabled' });
    renderPanel(mockClient());
    expect(screen.getByText(/turned off publishing from the builder/)).toBeInTheDocument();
    expect(screen.getByText('CLI STEPS')).toBeInTheDocument();
  });

  it('says what is missing when the server has no SESSION_SECRET yet (setup not finished), with the setup checklist', () => {
    connect('not-configured', false, { reason: 'session_secret' });
    renderPanel(mockClient());
    expect(screen.getByText('Publishing from the builder needs one more server setting')).toBeInTheDocument();
    expect(screen.queryByText(/turned off/)).toBeNull();
    expect(screen.getByRole('link', { name: /Open the setup checklist/ })).toHaveAttribute('href', '/setup.html');
    expect(screen.getByText('CLI STEPS')).toBeInTheDocument();
  });

  it('asks to connect HubSpot first when the server has sign-in set up', () => {
    connect('disconnected');
    renderPanel(mockClient());
    expect(screen.getByRole('heading', { name: 'First, connect HubSpot' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Paste your key')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Connect HubSpot' }));
    expect(useConnection.getState().connect).toHaveBeenCalled();
  });

  it('waits while the connection is being checked', () => {
    connect('checking');
    renderPanel(mockClient());
    expect(screen.getByText('Checking the connection to HubSpot…').closest('[role="status"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish to HubSpot' })).toBeNull();
  });

  it('opens the Publish dialog on Publish to HubSpot when this builder can publish', () => {
    connect('connected');
    render(
      <ToastProvider>
        <ExportDialog open onClose={() => {}} />
      </ToastProvider>,
    );
    expect(screen.getByRole('tab', { name: 'Publish to HubSpot' })).toHaveAttribute('aria-selected', 'true');
  });

  it('is a tab of the Publish dialog', async () => {
    connect('unavailable');
    render(
      <ToastProvider>
        <ExportDialog open onClose={() => {}} arg="hubspot" />
      </ToastProvider>,
    );
    const tab = screen.getByRole('tab', { name: 'Publish to HubSpot' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Use the HubSpot CLI' })).toBeInTheDocument();
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
    expect(screen.getAllByText('acmedemo.com').length).toBeGreaterThan(0);
    // Wizard: step 1 of 3.
    const wizard = screen.getByRole('list', { name: 'Publish steps' });
    expect(within(wizard).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('Get your key'),
      expect.stringContaining('Publish'),
      expect.stringContaining('Finish in HubSpot'),
    ]);
    expect(within(wizard).getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'step');

    const deployBtn = screen.getByRole('button', { name: 'Publish to HubSpot' });
    expect(deployBtn).toBeDisabled();

    // Step 1: a direct link to the connected account's personal access key page (the page the
    // HubSpot CLI opens) and the clicks to make there.
    expect(screen.getByRole('link', { name: /Open HubSpot’s key page/ })).toHaveAttribute('href', `https://app.hubspot.com/personal-access-key/${PORTAL}`);
    const guide = screen.getByRole('region', { name: 'How to get a personal access key' });
    expect(within(guide).getByText(/Create a key if you don’t have one yet/)).toBeInTheDocument();
    expect(within(guide).getByText(/“Developer projects” permission/)).toBeInTheDocument();
    expect(within(guide).getByText(/search for “personal access key”/)).toBeInTheDocument();

    // Key field: hidden by default, can be shown.
    const input = screen.getByLabelText('Paste your key');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(input).toHaveAttribute('type', 'text');
    typeKey();
    // Nothing to remember: the key is used for this deploy only.
    expect(screen.queryByRole('checkbox', { name: /Remember/ })).toBeNull();
    expect(screen.getByText(/never saves it/)).toBeInTheDocument();
    expect(deployBtn).toBeEnabled();
    fireEvent.click(deployBtn);

    await waitFor(() => expect(client.start).toHaveBeenCalledTimes(1));
    const req = client.start.mock.calls[0][0] as DeployRequest;
    expect(req).toMatchObject({ personalAccessKey: 'CiRuYTEtZmFrZS1rZXktZm9yLXRlc3Rz', portalId: PORTAL, projectName: 'deal-desk', platformVersion: '2026.03' });
    expect(req.remember).toBeUndefined();
    expect(req.useRememberedKey).toBeUndefined();
    expect(req.files.map((f) => f.path)).toEqual(expect.arrayContaining(['hsproject.json', 'src/app/app-hsmeta.json', 'src/app/cards/DealCard.tsx']));

    // Progress: stepper + live status + log.
    const stepper = await screen.findByRole('list', { name: 'Publish progress' });
    expect(within(stepper).getAllByRole('listitem').map((li) => li.textContent?.split('—')[0].trim())).toEqual([
      expect.stringContaining('Uploading'),
      expect.stringContaining('Building'),
      expect.stringContaining('Going live'),
      expect.stringContaining('Published'),
    ]);
    expect(screen.getByRole('progressbar', { name: 'Publishing' })).toBeInTheDocument();

    // Done.
    expect(await screen.findByText('Published! “Deal Card” is in HubSpot.')).toBeInTheDocument();
    expect(client.status.mock.calls.map((c) => c[0])).toEqual(['d1', 'd2', 'd3']);
    expect(screen.getByRole('link', { name: /Open project in HubSpot/ })).toHaveAttribute('href', PROJECT_URL);
    const install = screen.getByRole('link', { name: /Install the app/ });
    expect(install).toHaveAttribute('href', `https://app.hubspot.com/static-token/${PORTAL}/authorize?appId=55`);
    // Installing is the next thing to do: it is the primary action.
    expect(install).toHaveClass('ub-btn--primary');
    expect(screen.getByRole('link', { name: /Open project in HubSpot/ })).not.toHaveClass('ub-btn--primary');
    // Step 3: the "Finish in HubSpot" checklist with direct links.
    const next = screen.getByRole('region', { name: 'Finish in HubSpot' });
    expect(within(next).getByText('Install the app in your account')).toBeInTheDocument();
    expect(within(next).getByText('Add “Deal Card” to deals records')).toBeInTheDocument();
    // The exact clicks, numbered.
    expect(within(next).getByText('Go to Data Management → Objects → Deals.')).toBeInTheDocument();
    expect(within(next).getByText('Pick a tab in the middle column, then click Add cards → Card library.')).toBeInTheDocument();
    expect(within(next).getByRole('link', { name: /Open HubSpot settings/ })).toHaveAttribute('href', `https://app.hubspot.com/settings/${PORTAL}`);
    expect(within(next).getByText('Open a deal to see your card')).toBeInTheDocument();
    expect(within(next).getByRole('link', { name: /Open your deals/ })).toHaveAttribute('href', `https://app.hubspot.com/contacts/${PORTAL}/objects/0-3`);
    expect(within(next).getByText('0 of 3 done')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Publish steps' })).getAllByRole('listitem')[2]).toHaveAttribute('aria-current', 'step');
    // Done: the progress tiles make room for the checklist; the success line says what went where.
    expect(screen.queryByRole('list', { name: 'Publish progress' })).toBeNull();
    expect(screen.getByText(/It’s in the HubSpot account acmedemo\.com \(12345678\)/)).toBeInTheDocument();

    // Ticked items are remembered for this project.
    fireEvent.click(within(next).getByRole('checkbox', { name: 'Install the app in your account' }));
    expect(within(next).getByText('1 of 3 done')).toBeInTheDocument();
    const stored = JSON.parse(window.localStorage.getItem(`uiex-builder:publish:${useEditor.getState().project.id}`)!);
    expect(stored).toMatchObject({ portalId: PORTAL, projectUrl: PROJECT_URL, done: ['install'] });

    // Log is folded away with a warnings badge.
    const logToggle = screen.getByRole('button', { name: /Publish log/ });
    expect(logToggle).toHaveTextContent('warnings');
    fireEvent.click(logToggle);
    expect(screen.getByRole('log', { name: 'Publish log' })).toHaveTextContent('Warning: Card "deal_card" has no description.');

    fireEvent.click(screen.getByRole('button', { name: 'Publish again' }));
    expect(screen.getByRole('button', { name: 'Publish to HubSpot' })).toBeInTheDocument();
    // Coming back: the checklist of the last publish is one click away, with its ticks.
    const earlier = screen.getByRole('button', { name: /Last published .* to acmedemo\.com · Finish in HubSpot: 1 of 3 done/ });
    // Published before: the key steps are one click away instead of in the way.
    expect(screen.queryByRole('region', { name: 'How to get a personal access key' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /How do I get my key\?/ }));
    expect(screen.getByRole('region', { name: 'How to get a personal access key' })).toBeInTheDocument();
    fireEvent.click(earlier);
    expect(screen.getByRole('checkbox', { name: 'Install the app in your account' })).toBeChecked();
  });

  it('shows a failed build with its log, and retries', async () => {
    const client = mockClient({
      statuses: [
        status('failed', 2, {
          error: 'build_failed',
          message: "HubSpot couldn't build your project (build #7). The log below says why.",
          log: ['Uploaded 15 files. HubSpot started build #7.', 'deal_card failed: Card deal_card failed to compile', "• src/app/cards/DealCard.tsx(3,1): error TS2304: Cannot find name 'x'."],
        }),
      ],
    });
    renderPanel(client);
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Publish to HubSpot' }));
    expect(await screen.findByText('The publish didn’t finish')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't build your project/);
    expect(screen.getByRole('log', { name: 'Publish log' })).toHaveTextContent('error TS2304');
    const steps = within(screen.getByRole('list', { name: 'Publish progress' })).getAllByRole('listitem');
    expect(steps[0]).toHaveTextContent('done');
    expect(steps[1]).toHaveTextContent('failed');
    expect(screen.getByRole('link', { name: /Open project in HubSpot/ })).toHaveAttribute('href', PROJECT_URL);
    // Trying the same build again won't help: Back is the main action, the failing card is named,
    // and the builder file can be downloaded to send to whoever looks after the builder.
    expect(screen.getByRole('alert')).toHaveTextContent('In the builder: “Deal Card”.');
    expect(screen.getByRole('region', { name: 'What to do next' })).toHaveTextContent(/usually a problem in the generated code, not something you did/);
    expect(screen.getByRole('button', { name: 'Back' })).toHaveClass('ub-btn--primary');
    expect(screen.getByRole('button', { name: 'Download builder file' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(client.start).toHaveBeenCalledTimes(2));
    expect((client.start.mock.calls[1][0] as DeployRequest).personalAccessKey).toBe('CiRuYTEtZmFrZS1rZXktZm9yLXRlc3Rz');
  });

  it('ticks a step when its HubSpot link is opened, celebrates when all are done, and Done closes the dialog', async () => {
    const client = mockClient({
      statuses: [status('success', 2, { installUrl: `https://app.hubspot.com/static-token/${PORTAL}/authorize?appId=55` })],
    });
    const onClose = vi.fn();
    renderPanel(client, { onClose });
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Publish to HubSpot' }));
    const next = await screen.findByRole('region', { name: 'Finish in HubSpot' });
    for (const name of [/Install the app/, /Open HubSpot settings/, /Open your deals/]) fireEvent.click(within(next).getByRole('link', { name }));
    expect(within(next).getByText('3 of 3 done')).toBeInTheDocument();
    expect(within(next).getByText(/All done — your card is live in HubSpot/)).toBeInTheDocument();
    // Ticked steps fold their instructions away.
    expect(within(next).queryByText('Go to Data Management → Objects → Deals.')).toBeNull();
    // Unticking stays possible (it didn't work out after all).
    fireEvent.click(within(next).getByRole('checkbox', { name: 'Install the app in your account' }));
    expect(within(next).getByText('2 of 3 done')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('says in plain words what is happening while publishing', async () => {
    const client = mockClient({ statuses: [status('building', 1), status('deploying', 2), status('success', 3)] });
    renderPanel(client);
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Publish to HubSpot' }));
    expect(await screen.findByText('HubSpot is checking and building your cards…')).toBeInTheDocument();
    expect(screen.queryByText('HubSpot is building your project (build #7).')).toBeNull();
    expect(await screen.findByText('Published! “Deal Card” is in HubSpot.')).toBeInTheDocument();
  });

  it('coming back after changing the card: says the cards changed since the last publish', async () => {
    const client = mockClient({ statuses: [status('success', 2)] });
    renderPanel(client);
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Publish to HubSpot' }));
    await screen.findByRole('region', { name: 'Finish in HubSpot' });
    fireEvent.click(screen.getByRole('button', { name: 'Publish again' }));
    expect(screen.queryByText(/changed your cards since then/)).toBeNull();
    const key = `uiex-builder:publish:${useEditor.getState().project.id}`;
    const stored = JSON.parse(window.localStorage.getItem(key)!);
    window.localStorage.setItem(key, JSON.stringify({ ...stored, at: new Date(Date.parse(useEditor.getState().project.updatedAt) - 60_000).toISOString() }));
    cleanup();
    renderPanel(client);
    expect(screen.getByText(/You’ve changed your cards since then — publish again to update them in HubSpot\./)).toBeInTheDocument();
  });

  it('keeps polling through brief connection problems', async () => {
    const client = mockClient({
      statuses: [new DeployClientError(0, 'network', 'offline'), new DeployClientError(503, 'hubspot_error', 'busy'), status('success', 3)],
    });
    renderPanel(client);
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Publish to HubSpot' }));
    expect(await screen.findByText('Published! “Deal Card” is in HubSpot.')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Publish to HubSpot' }));
    const err = await screen.findByText(/didn't accept this personal access key/);
    expect(err.closest('[role="alert"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Open the key page in HubSpot' })).toHaveAttribute('href', `https://app.hubspot.com/personal-access-key/${PORTAL}`);
    expect(screen.getByLabelText('Paste your key')).toHaveAttribute('aria-invalid', 'true');
    typeKey('CiRuYTEtYW5vdGhlci1rZXktMDAwMDAw');
    expect(screen.queryByText(/didn't accept this personal access key/)).toBeNull();
  });

  it('warns when the key belongs to another account and offers to switch the connected account', async () => {
    const client = mockClient({
      start: async () => {
        throw new DeployClientError(409, 'portal_mismatch', "This personal access key belongs to HubSpot account 999, but you're connected to account 12345678.", 999);
      },
    });
    renderPanel(client);
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Publish to HubSpot' }));
    expect(await screen.findByText('This key is for a different HubSpot account')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish to HubSpot' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Publish to account 999 instead/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Switch HubSpot account' }));
    expect(useConnection.getState().switchPortal).toHaveBeenCalled();
  });

  it('before sign-in is set up, can deploy to the account the key belongs to', async () => {
    connect('not-configured');
    const client = mockClient({
      start: vi
        .fn<DeployClient['start']>()
        .mockRejectedValueOnce(new DeployClientError(409, 'portal_mismatch', 'This personal access key belongs to HubSpot account 999, but the deploy is going to account 5.', 999))
        .mockResolvedValueOnce(status('building', 1, { portalId: 999 })),
      statuses: [status('success', 2, { portalId: 999 })],
    });
    renderPanel(client);
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Publish to HubSpot' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Publish to account 999 instead' }));
    await waitFor(() => expect(client.start).toHaveBeenCalledTimes(2));
    expect((client.start.mock.calls[1][0] as DeployRequest).portalId).toBe(999);
    expect(await screen.findByText(/It’s in HubSpot account 999\./)).toBeInTheDocument();
  });

  it('points out a private app token pasted instead of a personal access key', () => {
    renderPanel(mockClient());
    typeKey(['pat', 'na1', '11111111-2222-3333-4444-555555555555'].join('-'));
    expect(screen.getByText(/looks like a private app access token/).closest('[role="status"]')).not.toBeNull();
    typeKey('CiRuYTEtZmFrZS1rZXktZm9yLXRlc3Rz');
    expect(screen.queryByText(/looks like a private app access token/)).toBeNull();
  });

  it('after deploying the HubSpot sign-in app, lists what the host does next (policy, client id, settings)', async () => {
    const app = createExtension({ kind: 'settings', name: 'UI Extension Builder' });
    const project = createProject('UI Extension Builder', [app]);
    project.name = 'uiex-builder-connector';
    useEditor.getState().loadProject(project);
    const client = mockClient({ statuses: [status('success', 2, { projectName: 'uiex-builder-connector' })] });
    renderPanel(client);
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Publish to HubSpot' }));
    expect(await screen.findByText('Your HubSpot sign-in app is in HubSpot.')).toBeInTheDocument();
    const next = screen.getByRole('region', { name: 'Finish in HubSpot' });
    expect(within(next).getByText('Sign HubSpot’s Acceptable Use Policy')).toBeInTheDocument();
    expect(within(next).getByText('Copy the Client ID and Client secret')).toBeInTheDocument();
    expect(within(next).getByText('Add them to your host and redeploy')).toBeInTheDocument();
    expect(within(next).queryByText('Install the app in your account')).toBeNull();
    expect(screen.getByRole('link', { name: /Open project in HubSpot/ })).toHaveClass('ub-btn--primary');
  });

  it('asks to connect again when the server says the sign-in is gone', async () => {
    const client = mockClient({
      start: async () => {
        throw new DeployClientError(401, 'not_connected', 'Connect HubSpot first: deploying needs you to be signed in to the HubSpot account you deploy to.');
      },
    });
    renderPanel(client);
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Publish to HubSpot' }));
    expect(await screen.findByText(/Connect HubSpot first/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(useConnection.getState().connect).toHaveBeenCalled();
  });

  it('dismisses the account warning to try another key', async () => {
    const client = mockClient({
      start: async () => {
        throw new DeployClientError(409, 'portal_mismatch', 'Other account.', 999);
      },
    });
    renderPanel(client);
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Publish to HubSpot' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use a different key' }));
    expect(screen.queryByText('This key is for a different HubSpot account')).toBeNull();
    expect(screen.getByRole('button', { name: 'Publish to HubSpot' })).toBeEnabled();
  });

  it('links the key guide to the demo HubSpot when the server uses another HubSpot address', () => {
    connect('connected', true, { appBase: 'http://localhost:4011' });
    renderPanel(mockClient());
    expect(screen.getByRole('link', { name: /Open HubSpot’s key page/ })).toHaveAttribute('href', `http://localhost:4011/personal-access-key/${PORTAL}`);
    expect(screen.getByText(/Then click Publish to HubSpot/)).toBeInTheDocument();
  });

  it('gates on validation errors until "Publish anyway"', () => {
    mocks.issues = [{ severity: 'error', rule: 'project-name', message: 'Bad name' } as Issue];
    const onClose = vi.fn();
    renderPanel(mockClient(), { onClose });
    typeKey();
    const deployBtn = screen.getByRole('button', { name: 'Publish to HubSpot' });
    expect(screen.getByText(/1 problem will probably stop HubSpot/)).toBeInTheDocument();
    expect(deployBtn).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Publish anyway' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Publish to HubSpot' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Publish to HubSpot' }));
    expect(await screen.findByText(/needs SESSION_SECRET/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use the HubSpot CLI instead' }));
    expect(onShowCli).toHaveBeenCalled();
  });

  it('stops polling when closed', async () => {
    const client = mockClient({ statuses: [status('building', 2), status('building', 3), status('building', 4)] });
    const view = renderPanel(client);
    typeKey();
    fireEvent.click(screen.getByRole('button', { name: 'Publish to HubSpot' }));
    await waitFor(() => expect(client.status).toHaveBeenCalled());
    view.unmount();
    const calls = client.status.mock.calls.length;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(client.status.mock.calls.length).toBeLessThanOrEqual(calls + 1);
  });
});
