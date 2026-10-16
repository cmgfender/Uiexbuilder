/**
 * "Publish to HubSpot" (beta; `deploy` in code) — the Publish dialog's wizard that uploads the
 * project to HubSpot with the admin's personal access key, through the hosted connector (no
 * terminal):
 *   1. Get your key   — a direct link to HubSpot's personal access key page (the page the HubSpot
 *                       CLI opens, for the connected account), the clicks to make, the paste field
 *   2. Publish        — progress (uploading → building → going live → published)
 *   3. Finish in HubSpot — a checklist with direct links: install the app, add the card to the
 *                       record page (the exact clicks), open a record to see it. Ticks are remembered.
 * Failures say what to do next in plain words. Shows the HubSpot CLI instructions instead when
 * there is no connector (static hosting) or publishing is turned off, and says what is missing
 * when the server isn't set up for it yet (SESSION_SECRET).
 *
 * Once HubSpot sign-in is set up on the server, publishing needs a connected account (the key must
 * belong to it). The key is pasted for every publish and never stored.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Download,
  ExternalLink,
  Info,
  KeyRound,
  ListChecks,
  Loader2,
  PartyPopper,
  Repeat,
  RotateCcw,
  Rocket,
  Terminal,
  TriangleAlert,
  UploadCloud,
  X,
} from 'lucide-react';
import { useConnection } from '../../connect/store';
import { useObjectTypes } from '../../connect/catalog';
import { useLiveData } from '../../connect/records';
import type { DeployRequest, DeployStatus } from '../../connect/types';
import { setupPageUrl } from '../../connect/ui/links';
import { HubSpotMark } from '../../connect/ui/HubSpotMark';
import { formattedProjectFiles, generateProjectFiles } from '../../codegen';
import { downloadFile, serializeProject } from '../../model/persistence';
import { useEditor } from '../../model/store';
import type { Project } from '../../model/types';
import { validateProject } from '../../model/validate';
import { Badge, Button, Field, Switch, TextInput, cx } from '../../ui';
import { Callout } from '../common';
import { useLastPublish, type LastPublish } from './checklist';
import { deployClient, type DeployClient } from './client';
import {
  DEPLOY_STEPS,
  KEY_GUIDE_FALLBACK,
  KEY_GUIDE_STEPS,
  PRIVATE_APP_TOKEN_HINT,
  WIZARD_STEPS,
  failingExtensions,
  failureAdvice,
  hubspotOrigin,
  isConnectorApp,
  looksLikePrivateAppToken,
  personalAccessKeyUrl,
  phaseMessage,
  publishChecklist,
  stepIndex,
  stepStates,
  type ChecklistItem,
  type StepState,
} from './model';
import { useDeployJob, type DeployFormError } from './useDeployJob';
import './deploy.css';

export interface DeployToHubSpotPanelProps {
  /** The CLI instructions, shown when publishing from the builder isn't possible here. */
  cliFallback: ReactNode;
  /** Switch to the CLI instructions. */
  onShowCli?: () => void;
  /** Close the dialog (used by "Show problems"). */
  onClose?: () => void;
  /** Injected in tests. */
  client?: DeployClient;
  pollIntervalMs?: number;
}

export function DeployToHubSpotPanel({ cliFallback, onShowCli, onClose, client = deployClient, pollIntervalMs }: DeployToHubSpotPanelProps) {
  const status = useConnection((s) => s.status);
  const deployEnabled = useConnection((s) => s.health?.features.deploy);
  const reason = useConnection((s) => s.health?.features.deployUnavailableReason);

  if (status === 'checking') {
    return (
      <div className="ub-pn-form ub-dp" role="status">
        <span className="ub-dp-status">
          <Loader2 size={14} className="ub-dp-spin" aria-hidden /> Checking the connection to HubSpot…
        </span>
      </div>
    );
  }
  if (status !== 'unavailable' && deployEnabled === false && reason === 'session_secret') {
    // Setup isn't finished (typical right after a Vercel deploy with "later" everywhere).
    return (
      <div className="ub-pn-form ub-dp">
        <Callout tone="warning" icon={<TriangleAlert size={14} aria-hidden />}>
          <div className="ub-pn-strong">Publishing from the builder needs one more server setting</div>
          <div>
            The server is missing <strong>SESSION_SECRET</strong> (48 random characters), which keeps publishing private. If you set up this
            builder, open the setup checklist — it makes one for you and says where to add it. Otherwise, ask the person who set it up.
          </div>
          <div className="ub-pn-row">
            <a className="ub-btn ub-btn--sm ub-btn--primary ub-dp-linkbtn" href={setupPageUrl()} target="_blank" rel="noopener noreferrer">
              Open the setup checklist <ExternalLink size={12} aria-hidden />
              <span className="ub-sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        </Callout>
        <p className="ub-pn-muted ub-dp-p">Comfortable with a terminal? You can also publish with the HubSpot CLI:</p>
        {cliFallback}
      </div>
    );
  }
  if (status === 'unavailable' || deployEnabled === false) {
    return (
      <div className="ub-pn-form ub-dp">
        <Callout tone="warning" icon={<Terminal size={14} aria-hidden />}>
          <div className="ub-pn-strong">Publishing from the builder isn’t available here</div>
          <div>
            {status === 'unavailable'
              ? 'This copy of the builder runs without its HubSpot connector, so it can’t send projects to HubSpot for you. You can still publish with the HubSpot CLI — follow the steps below.'
              : 'The person who hosts this builder turned off publishing from the builder (ENABLE_DEPLOY). You can still publish with the HubSpot CLI — follow the steps below.'}
          </div>
        </Callout>
        {cliFallback}
      </div>
    );
  }
  return <DeployFlow client={client} pollIntervalMs={pollIntervalMs} onShowCli={onShowCli} onClose={onClose} />;
}

// ---------------------------------------------------------------------------

interface DeployFlowProps {
  client: DeployClient;
  pollIntervalMs?: number;
  onShowCli?: () => void;
  onClose?: () => void;
}

interface LastTarget {
  portalId?: number;
}

/** "1 Get your key · 2 Publish · 3 Finish in HubSpot" at the top of the wizard. */
function WizardSteps({ current, failed = false }: { current: number; failed?: boolean }) {
  return (
    <ol className="ub-dp-wizard" aria-label="Publish steps">
      {WIZARD_STEPS.map((label, i) => {
        const state = i < current ? 'done' : i === current ? (failed ? 'failed' : 'current') : 'todo';
        return (
          <li key={label} className={cx('ub-dp-wizard__step', `ub-dp-wizard__step--${state}`)} aria-current={i === current ? 'step' : undefined}>
            <span className="ub-dp-wizard__num" aria-hidden>
              {state === 'done' ? <Check size={11} /> : state === 'failed' ? <X size={11} /> : i + 1}
            </span>
            <span>{label}</span>
            <span className="ub-sr-only">{state === 'done' ? ' (done)' : state === 'current' ? ' (current step)' : state === 'failed' ? ' (failed)' : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

function DeployFlow({ client, pollIntervalMs, onShowCli, onClose }: DeployFlowProps) {
  const project = useEditor((s) => s.project);
  const connStatus = useConnection((s) => s.status);
  const info = useConnection((s) => s.info);
  const needsSignIn = useConnection((s) => !!s.health?.features.deployNeedsSignIn);
  const appBase = useConnection((s) => s.health?.appBase);
  const connected = info.connected ? info : null;
  const job = useDeployJob(client, pollIntervalMs);
  const publish = useLastPublish(project.id);

  const [key, setKey] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [last, setLast] = useState<LastTarget>({});

  const deploy = async (portalId?: number) => {
    setPreparing(true);
    let files: Array<{ path: string; contents: string }>;
    try {
      files = await formattedProjectFiles(project);
    } catch {
      files = generateProjectFiles(project);
    } finally {
      setPreparing(false);
    }
    const target = portalId ?? connected?.portalId;
    setLast({ portalId });
    const request: DeployRequest = {
      projectName: project.name,
      platformVersion: project.platformVersion,
      files,
      personalAccessKey: key.trim(),
    };
    if (target !== undefined) request.portalId = target;
    await job.start(request);
  };

  const state = job.state;
  const origin = hubspotOrigin(connected?.appHost, appBase);
  // Remember a successful publish (the checklist is still there when the admin comes back).
  const succeeded = state.kind === 'success' ? state.status : null;
  const recordPublish = publish.record;
  useEffect(() => {
    if (succeeded) recordPublish(succeeded);
  }, [succeeded?.deployId, recordPublish]);
  let body: ReactNode;
  let wizardStep = 0;
  let wizardFailed = false;
  if (state.kind === 'running') {
    wizardStep = 1;
    body = <Progress status={state.status} />;
  } else if (state.kind === 'success') {
    wizardStep = 2;
    body = (
      <SuccessView
        status={state.status}
        project={project}
        origin={origin}
        publish={publish}
        hubDomain={connected && connected.portalId === state.status.portalId ? connected.hubDomain : undefined}
        onAgain={() => {
          job.reset();
          setKey('');
        }}
        onClose={onClose}
      />
    );
  } else if (state.kind === 'failed') {
    wizardStep = 1;
    wizardFailed = true;
    body = (
      <FailureView
        message={state.message}
        code={state.code}
        log={state.log}
        failedStep={state.failedStep}
        status={state.status}
        project={project}
        onRetry={() => void deploy(last.portalId)}
        onBack={job.reset}
        onShowCli={onShowCli}
        onClose={onClose}
      />
    );
  } else if (needsSignIn && !connected) {
    // HubSpot sign-in is set up on this server: publishing goes to the connected account only.
    body = <SignInFirst connecting={connStatus === 'connecting'} onShowCli={onShowCli} />;
  } else {
    body = (
      <>
        {publish.last && (
          <EarlierPublish last={publish.last} project={project} origin={origin} onToggle={publish.toggle} hubDomain={connected?.portalId === publish.last.portalId ? connected?.hubDomain : undefined} />
        )}
        <DeployForm
          project={project}
          returning={!!publish.last}
          connected={connected ? { portalId: connected.portalId, hubDomain: connected.hubDomain, appHost: connected.appHost } : null}
          appBase={appBase}
          keyValue={key}
          onKeyChange={(v) => {
            setKey(v);
            if (job.formError && job.formError.code !== 'portal_mismatch') job.clearFormError();
          }}
          preparing={preparing}
          formError={job.formError}
          onDeploy={(portalId) => void deploy(portalId)}
          onDismissError={job.clearFormError}
          onShowCli={onShowCli}
          onClose={onClose}
        />
      </>
    );
  }

  return (
    <div className="ub-dp-flow">
      <WizardSteps current={wizardStep} failed={wizardFailed} />
      {body}
    </div>
  );
}

/** Publishing needs a HubSpot sign-in on this server: connect first. */
function SignInFirst({ connecting, onShowCli }: { connecting: boolean; onShowCli?: () => void }) {
  return (
    <div className="ub-pn-form ub-dp">
      <Callout tone="info" icon={<Rocket size={14} aria-hidden />}>
        <div className="ub-pn-strong ub-dp-title">
          Put your cards live in HubSpot — no terminal needed <Badge tone="accent">Beta</Badge>
        </div>
        <div>
          The builder sends your project to HubSpot, which builds it and makes your cards available in your account. Your CRM records are not
          changed.
        </div>
      </Callout>
      <section className="ub-pn-card" aria-label="Connect HubSpot first">
        <h3 className="ub-pn-h3">First, connect HubSpot</h3>
        <p className="ub-dp-p">
          Your cards are published to the HubSpot account you’re connected to, so the builder knows it’s the right one. Connect HubSpot, then come
          back here.
        </p>
        <div className="ub-pn-row">
          <Button variant="primary" icon={connecting ? <Loader2 size={14} className="ub-dp-spin" aria-hidden /> : <HubSpotMark />} disabled={connecting} onClick={() => void useConnection.getState().connect()}>
            {connecting ? 'Connecting…' : 'Connect HubSpot'}
          </Button>
        </div>
      </section>
      {onShowCli && (
        <button type="button" className="ub-pn-link" onClick={onShowCli}>
          Prefer the terminal? Use the HubSpot CLI
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: key + publish
// ---------------------------------------------------------------------------

interface DeployFormProps {
  project: Project;
  /** Published from this browser before: the key steps start folded away. */
  returning?: boolean;
  connected: { portalId: number; hubDomain: string; appHost: string } | null;
  appBase?: string;
  keyValue: string;
  onKeyChange: (value: string) => void;
  preparing: boolean;
  formError: DeployFormError | null;
  onDeploy: (portalId?: number) => void;
  onDismissError: () => void;
  onShowCli?: () => void;
  onClose?: () => void;
}

function DeployForm(p: DeployFormProps) {
  const ids = useId();
  const keyId = `${ids}-key`;
  const [showKey, setShowKey] = useState(false);
  const [ack, setAck] = useState(false);
  const issues = useMemo(() => validateProject(p.project), [p.project]);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const blocked = errors.length > 0 && !ack;
  const keyUrl = personalAccessKeyUrl(p.connected?.appHost, p.connected?.portalId, p.appBase);
  const mismatch = p.formError?.code === 'portal_mismatch' ? p.formError : null;
  const accountError = p.formError && (p.formError.code === 'not_connected' || p.formError.code === 'portal_not_allowed') ? p.formError : null;
  const keyError = p.formError && !mismatch && !accountError ? p.formError : null;
  const hasKey = p.keyValue.trim().length > 0;
  const canDeploy = hasKey && !blocked && !p.preparing && !mismatch;
  const privateAppToken = looksLikePrivateAppToken(p.keyValue);

  const showProblems = () => {
    useEditor.getState().setBottomPanel('problems');
    p.onClose?.();
  };

  return (
    <div className="ub-pn-form ub-dp ub-dp--form">
      <p className="ub-dp-intro">
        <Rocket size={14} aria-hidden className="ub-dp-intro__icon" />
        <span>
          <strong>Put your cards live in HubSpot — no terminal needed</strong> <Badge tone="accent">Beta</Badge> HubSpot checks and builds your
          project, then makes your cards available in your account. Your CRM records are not changed.
        </span>
      </p>

      {errors.length > 0 ? (
        <Callout tone="danger" icon={<TriangleAlert size={14} aria-hidden />} role="alert">
          <div className="ub-pn-strong">
            {errors.length} problem{errors.length === 1 ? '' : 's'} will probably stop HubSpot from building this project.
          </div>
          <div className="ub-pn-row">
            <button type="button" className="ub-pn-link" onClick={showProblems}>
              Show problems
            </button>
            <span className="ub-pn-spacer" />
            <Switch checked={ack} onChange={setAck} label="Publish anyway" />
          </div>
        </Callout>
      ) : warnings.length > 0 ? (
        <Callout tone="warning" icon={<TriangleAlert size={14} aria-hidden />}>
          {warnings.length} warning{warnings.length === 1 ? '' : 's'} — you can still publish.{' '}
          <button type="button" className="ub-pn-link" onClick={showProblems}>
            Show problems
          </button>
        </Callout>
      ) : null}

      <section className="ub-pn-card ub-dp-keycard" aria-labelledby={`${ids}-keyhead`}>
        <h3 className="ub-pn-h3" id={`${ids}-keyhead`}>
          <KeyRound size={13} aria-hidden /> Get your personal access key
        </h3>
        <p className="ub-dp-p">
          {p.returning ? (
            <>
              Copy your key from HubSpot’s key page again (the builder never keeps it) and paste it below — or create a new one there
              {p.connected ? <> for <strong>{p.connected.hubDomain || `account ${p.connected.portalId}`}</strong></> : null}.
            </>
          ) : (
            <>
              HubSpot asks for a personal access key before it accepts a project — think of it as a password for HubSpot’s developer tools. You
              create it once in HubSpot{p.connected ? <> for <strong>{p.connected.hubDomain || `account ${p.connected.portalId}`}</strong></> : null}.
            </>
          )}
        </p>
        <div className="ub-pn-row">
          <a className="ub-btn ub-btn--primary ub-dp-linkbtn" href={keyUrl} target="_blank" rel="noreferrer">
            Open HubSpot’s key page <ExternalLink size={13} aria-hidden />
            <span className="ub-sr-only"> (opens in a new tab)</span>
          </a>
        </div>
        {p.returning ? <FoldedKeyGuide /> : <KeyGuide />}
        <Field
          label="Paste your key"
          htmlFor={keyId}
          error={keyError ? <KeyErrorText error={keyError} keyUrl={keyUrl} /> : undefined}
          hint="Used for this publish only — the builder never saves it."
        >
          <div className="ub-dp-key">
            <TextInput
              id={keyId}
              type={showKey ? 'text' : 'password'}
              value={p.keyValue}
              onChange={p.onKeyChange}
              code
              invalid={!!keyError}
              autoComplete="off"
              placeholder="e.g. CiRuYTEt…"
              aria-invalid={keyError ? true : undefined}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canDeploy) {
                  e.preventDefault();
                  p.onDeploy();
                }
              }}
            />
            <Button size="sm" variant="ghost" aria-pressed={showKey} aria-controls={keyId} onClick={() => setShowKey((v) => !v)}>
              {showKey ? 'Hide' : 'Show'}
            </Button>
          </div>
        </Field>
        {privateAppToken && !keyError && (
          <p className="ub-dp-hint" role="status">
            <TriangleAlert size={13} aria-hidden /> {PRIVATE_APP_TOKEN_HINT}
          </p>
        )}
      </section>

      {accountError && (
        <Callout tone="warning" icon={<TriangleAlert size={14} aria-hidden />} role="alert">
          <div>{accountError.message}</div>
          {accountError.code === 'not_connected' && (
            <div className="ub-pn-row">
              <Button size="sm" icon={<HubSpotMark />} onClick={() => void useConnection.getState().connect()}>
                Reconnect
              </Button>
            </div>
          )}
        </Callout>
      )}

      {mismatch && (
        <Callout tone="warning" icon={<TriangleAlert size={14} aria-hidden />} role="alert">
          <div className="ub-pn-strong">This key is for a different HubSpot account</div>
          <div>{mismatch.message}</div>
          <div className="ub-pn-row">
            {p.connected ? (
              <Button size="sm" icon={<Repeat size={13} aria-hidden />} onClick={() => void useConnection.getState().switchPortal()}>
                Switch HubSpot account
              </Button>
            ) : (
              mismatch.portalId !== undefined && (
                <Button size="sm" onClick={() => p.onDeploy(mismatch.portalId)}>
                  Publish to account {mismatch.portalId} instead
                </Button>
              )
            )}
            <Button size="sm" variant="ghost" icon={<X size={13} aria-hidden />} onClick={p.onDismissError}>
              Use a different key
            </Button>
          </div>
        </Callout>
      )}

      {p.onShowCli && (
        <button type="button" className="ub-pn-link ub-dp-cli-link" onClick={p.onShowCli}>
          Prefer the terminal? Use the HubSpot CLI
        </button>
      )}

      {/* Always in view at the bottom of the dialog, so nobody has to hunt for it. */}
      <div className="ub-dp-actions">
        <p className="ub-dp-p ub-dp-target">
          {p.connected ? (
            <>
              Publishing to <strong>{p.connected.hubDomain || 'your HubSpot account'}</strong> (account {p.connected.portalId}), the account you’re
              connected to.
            </>
          ) : (
            'The project goes to the HubSpot account your personal access key belongs to.'
          )}
        </p>
        <Button
          variant="primary"
          icon={p.preparing ? <Loader2 size={14} className="ub-dp-spin" aria-hidden /> : <UploadCloud size={14} aria-hidden />}
          disabled={!canDeploy}
          title={blocked ? 'Fix the problems or turn on “Publish anyway”' : !hasKey ? 'Paste your personal access key first' : undefined}
          onClick={() => p.onDeploy()}
        >
          {p.preparing ? 'Preparing files…' : 'Publish to HubSpot'}
        </Button>
      </div>
    </div>
  );
}

function KeyErrorText({ error, keyUrl }: { error: DeployFormError; keyUrl: string }) {
  return (
    <span role="alert">
      {error.message}
      {(error.code === 'invalid_key' || error.code === 'missing_scope') && (
        <>
          {' '}
          <a className="ub-pn-link" href={keyUrl} target="_blank" rel="noreferrer">
            Open the key page in HubSpot
          </a>
        </>
      )}
    </span>
  );
}

/** The clicks on HubSpot's key page (always visible: this is step 1). */
function KeyGuide() {
  return (
    <div className="ub-dp-guide" role="region" aria-label="How to get a personal access key">
      <ol className="ub-dp-gsteps">
        {KEY_GUIDE_STEPS.slice(1).map((s, i) => (
          <li key={s.title} className="ub-dp-gstep">
            <span className="ub-dp-gstep__num" aria-hidden>
              {i + 1}
            </span>
            <span>
              <strong>{s.title}.</strong> {s.body && <span className="ub-pn-muted">{s.body}</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className="ub-pn-muted ub-dp-p">{KEY_GUIDE_FALLBACK}</p>
    </div>
  );
}

/** For someone who has published before: the same steps, one click away. */
function FoldedKeyGuide() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="ub-dp-guidewrap">
      <button type="button" className="ub-pn-link ub-dp-guide-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />} How do I get my key?
      </button>
      <div id={id}>{open && <KeyGuide />}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: progress (and failure)
// ---------------------------------------------------------------------------

const STATE_TEXT: Record<StepState, string> = { done: 'done', current: 'in progress', failed: 'failed', todo: 'not started' };

function Stepper({ current, failed = false }: { current: number; failed?: boolean }) {
  const states = stepStates(current, failed);
  return (
    <ol className="ub-dp-stepper" aria-label="Publish progress">
      {DEPLOY_STEPS.map((s, i) => {
        const st = states[i];
        return (
          <li key={s.key} className={cx('ub-dp-stepper__step', `ub-dp-stepper__step--${st}`)} aria-current={st === 'current' ? 'step' : undefined}>
            <span className="ub-dp-stepper__icon" aria-hidden>
              {st === 'done' ? <Check size={12} /> : st === 'failed' ? <X size={12} /> : st === 'current' ? <Loader2 size={12} className="ub-dp-spin" /> : i + 1}
            </span>
            <span className="ub-dp-stepper__text">
              <span className="ub-dp-stepper__label">{s.label}</span>
              <span className="ub-dp-stepper__hint">{s.hint}</span>
            </span>
            <span className="ub-sr-only"> — {STATE_TEXT[st]}</span>
          </li>
        );
      })}
    </ol>
  );
}

function DeployLog({ lines, label = 'Publish log' }: { lines: string[]; label?: string }) {
  if (lines.length === 0) return null;
  return (
    <div className="ub-dp-log ub-scroll" role="log" aria-label={label} tabIndex={0}>
      <ol>
        {lines.map((line, i) => (
          <li key={i} className={cx(line.startsWith('Warning:') && 'ub-dp-log__warn', /failed|blocked|can't be deployed/i.test(line) && 'ub-dp-log__error')}>
            {line}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Progress({ status }: { status: DeployStatus | null }) {
  const current = status ? stepIndex(status.phase) : 0;
  const percent = Math.round(((current + 0.5) / DEPLOY_STEPS.length) * 100);
  return (
    <div className="ub-pn-form ub-dp">
      <div
        className="ub-dp-bar"
        role="progressbar"
        aria-label="Publishing"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${DEPLOY_STEPS[current]?.label ?? 'Uploading'} (step ${current + 1} of ${DEPLOY_STEPS.length})`}
      >
        <span className="ub-dp-bar__fill" style={{ width: `${percent}%` }} />
      </div>
      <Stepper current={current} />
      <p className="ub-dp-status" role="status" aria-live="polite">
        <Loader2 size={14} className="ub-dp-spin" aria-hidden />
        {phaseMessage(status?.phase)}
      </p>
      <DeployLog lines={status?.log ?? []} />
      <p className="ub-pn-muted ub-dp-p">This usually takes a minute or two. Closing this window only stops the progress view — HubSpot finishes either way.</p>
    </div>
  );
}

function HubSpotLink({ href, children, primary, small, onOpen }: { href: string; children: ReactNode; primary?: boolean; small?: boolean; onOpen?: () => void }) {
  return (
    <a
      className={cx('ub-btn', primary && 'ub-btn--primary', small && 'ub-btn--sm', 'ub-dp-linkbtn')}
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={onOpen}
      onAuxClick={(e) => {
        if (e.button === 1) onOpen?.();
      }}
    >
      {children} <ExternalLink size={small ? 12 : 13} aria-hidden />
      <span className="ub-sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** Failures that trying again won't fix (the project itself needs a change). */
const PROJECT_FAILURES = new Set(['build_failed', 'deploy_failed', 'deploy_blocked', 'invalid_project', 'invalid_files', 'hubspot_rejected', 'superseded']);

function FailureView({
  message,
  code,
  log,
  failedStep,
  status,
  project,
  onRetry,
  onBack,
  onShowCli,
  onClose,
}: {
  message: string;
  code: string;
  log: string[];
  failedStep: number;
  status: DeployStatus | null;
  project: Project;
  onRetry: () => void;
  onBack: () => void;
  onShowCli?: () => void;
  onClose?: () => void;
}) {
  // The builder's server can't publish at all (unreachable, or not set up for it): the CLI still can.
  const offline = code === 'network' || code === 'connector_unavailable' || code === 'not_configured';
  const projectProblem = PROJECT_FAILURES.has(code);
  const affected = useMemo(() => (code === 'build_failed' ? failingExtensions(project, log) : []), [code, project, log]);
  const advice = failureAdvice(code);
  const ids = useId();
  const downloadDocument = () => downloadFile(`${project.name || 'project'}.uiex.json`, serializeProject(project), 'application/json');
  const showProblems = () => {
    useEditor.getState().setBottomPanel('problems');
    onClose?.();
  };
  return (
    <div className="ub-pn-form ub-dp">
      <Stepper current={failedStep} failed />
      <Callout tone="danger" icon={<TriangleAlert size={14} aria-hidden />} role="alert">
        <div className="ub-pn-strong">The publish didn’t finish</div>
        <div>{message}</div>
        {affected.length > 0 && <div>In the builder: {affected.map((n) => `“${n}”`).join(', ')}.</div>}
      </Callout>
      <section className="ub-pn-card ub-dp-advice" aria-labelledby={`${ids}-next`}>
        <h3 className="ub-pn-h3" id={`${ids}-next`}>
          What to do next
        </h3>
        <ul>
          {advice.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      <DeployLog lines={log} />
      <div className="ub-pn-row">
        {projectProblem ? (
          <>
            <Button variant="primary" onClick={onBack}>
              Back
            </Button>
            {code === 'build_failed' && (
              <Button icon={<Download size={14} aria-hidden />} onClick={downloadDocument}>
                Download builder file
              </Button>
            )}
            {(code === 'invalid_project' || code === 'invalid_files' || code === 'hubspot_rejected') && <Button onClick={showProblems}>Show problems</Button>}
            <Button icon={<RotateCcw size={14} aria-hidden />} onClick={onRetry}>
              Try again
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" icon={<RotateCcw size={14} aria-hidden />} onClick={onRetry}>
              Try again
            </Button>
            <Button onClick={onBack}>Back</Button>
          </>
        )}
        {status?.projectUrl && <HubSpotLink href={status.projectUrl}>Open project in HubSpot</HubSpotLink>}
        {offline && onShowCli && (
          <button type="button" className="ub-pn-link" onClick={onShowCli}>
            Use the HubSpot CLI instead
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: finish in HubSpot
// ---------------------------------------------------------------------------

interface ChecklistSource {
  project: Project;
  origin: string;
  installUrl?: string;
  projectUrl?: string;
  portalId?: number;
}

/** The "Finish in HubSpot" items for the open project (direct links for the account it went to). */
function useChecklistItems({ project, origin, installUrl, projectUrl, portalId }: ChecklistSource): ChecklistItem[] {
  const records = useLiveData((s) => (s.projectId === project.id ? s.recordByExtension : null));
  const { objectTypes } = useObjectTypes();
  return useMemo(
    () => publishChecklist(project, { portalId, origin, installUrl, projectUrl, records: records ?? undefined, types: objectTypes, setupUrl: setupPageUrl() }),
    [project, portalId, origin, installUrl, projectUrl, records, objectTypes],
  );
}

/** “Contact Summary” / “A” and “B” / your 3 cards — what was published, in words. */
function cardsLabel(project: Project): { text: string; many: boolean } {
  const cards = project.extensions.filter((e) => e.kind === 'card');
  if (cards.length === 1) return { text: `“${cards[0].name}”`, many: false };
  if (cards.length === 2) return { text: `“${cards[0].name}” and “${cards[1].name}”`, many: true };
  if (cards.length > 2) return { text: `Your ${cards.length} cards`, many: true };
  return { text: 'Your project', many: false };
}

/** The "Finish in HubSpot" checklist for the open project (ticks are remembered). */
function FinishChecklist({
  project,
  origin,
  last,
  onToggle,
  installUrl,
  projectUrl,
  portalId,
}: ChecklistSource & {
  last: LastPublish | null;
  onToggle: (key: string, done: boolean) => void;
}) {
  const items = useChecklistItems({ project, origin, installUrl, projectUrl, portalId });
  const done = new Set(last?.done ?? []);
  const count = items.filter((i) => done.has(i.key)).length;
  const allDone = items.length > 0 && count === items.length;
  const ids = useId();
  return (
    <section className="ub-pn-card ub-dp-checklist" aria-labelledby={`${ids}-title`}>
      <div className="ub-dp-checklist__head">
        <h3 className="ub-pn-h3" id={`${ids}-title`}>
          <ListChecks size={14} aria-hidden /> Finish in HubSpot
        </h3>
        <span className="ub-dp-checklist__count" aria-live="polite">
          {count} of {items.length} done
        </span>
      </div>
      <ol className="ub-dp-checklist__list">
        {items.map((item, i) => {
          const checked = done.has(item.key);
          const id = `${ids}-${i}`;
          return (
            <li key={item.key} className={cx('ub-dp-check', checked && 'ub-dp-check--done')}>
              <input id={id} type="checkbox" className="ub-dp-check__box" checked={checked} disabled={!last} onChange={(e) => onToggle(item.key, e.target.checked)} />
              <div className="ub-dp-check__body">
                <label htmlFor={id} className="ub-dp-check__title">
                  {item.title}
                </label>
                {!checked && (
                  <>
                    <p className="ub-dp-check__text">{item.body}</p>
                    {item.steps && item.steps.length > 0 && (
                      <ol className="ub-dp-check__steps">
                        {item.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    )}
                  </>
                )}
                {item.link && (
                  <HubSpotLink
                    href={item.link.href}
                    small
                    primary={item.key === 'install' && !checked}
                    // Opening the step in HubSpot ticks it (untick it if it didn't work out).
                    onOpen={() => {
                      if (last && !checked) onToggle(item.key, true);
                    }}
                  >
                    {item.link.label}
                  </HubSpotLink>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {allDone && (
        <p className="ub-dp-alldone" role="status">
          <PartyPopper size={15} aria-hidden /> All done — your {project.extensions.some((e) => e.kind === 'card') ? 'card is' : 'pages are'} live in HubSpot.
          Come back and publish again whenever you change {project.extensions.length === 1 ? 'it' : 'them'}.
        </p>
      )}
    </section>
  );
}

function SuccessView({
  status,
  project,
  origin,
  publish,
  hubDomain,
  onAgain,
  onClose,
}: {
  status: DeployStatus;
  project: Project;
  origin: string;
  publish: ReturnType<typeof useLastPublish>;
  hubDomain?: string;
  onAgain: () => void;
  onClose?: () => void;
}) {
  const connectorApp = isConnectorApp(project);
  const [showLog, setShowLog] = useState(false);
  const logId = useId();
  const what = cardsLabel(project);
  const account = hubDomain ? `the HubSpot account ${hubDomain} (${status.portalId})` : `HubSpot account ${status.portalId}`;
  return (
    <div className="ub-pn-form ub-dp">
      <Callout tone="success" icon={<CircleCheck size={14} aria-hidden />} role="status">
        <div className="ub-pn-strong">{connectorApp ? 'Your HubSpot sign-in app is in HubSpot.' : `Published! ${what.text} ${what.many ? 'are' : 'is'} in HubSpot.`}</div>
        <div>
          {connectorApp ? (
            <>
              Build #{status.buildId} of “{status.projectName}” is in HubSpot account {status.portalId}.
            </>
          ) : (
            <>
              It’s in {account}. A few quick steps in HubSpot and {what.many ? 'they show' : 'it shows'} on your records.
            </>
          )}
        </div>
      </Callout>
      <FinishChecklist
        project={project}
        origin={origin}
        last={publish.last}
        onToggle={publish.toggle}
        installUrl={status.installUrl}
        projectUrl={status.projectUrl}
        portalId={status.portalId}
      />
      {status.log.length > 0 && (
        <div className="ub-dp-logwrap">
          <button type="button" className="ub-pn-link ub-dp-guide-toggle" aria-expanded={showLog} aria-controls={logId} onClick={() => setShowLog((v) => !v)}>
            {showLog ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />} Publish log
            {status.log.some((l) => l.startsWith('Warning:')) && <Badge tone="warning">warnings</Badge>}
          </button>
          <div id={logId}>{showLog && <DeployLog lines={status.log} />}</div>
        </div>
      )}
      <div className="ub-dp-actions">
        <div className="ub-pn-row">
          {status.projectUrl && (
            <HubSpotLink href={status.projectUrl} primary={connectorApp}>
              Open project in HubSpot
            </HubSpotLink>
          )}
          <Button icon={<RotateCcw size={14} aria-hidden />} onClick={onAgain}>
            Publish again
          </Button>
        </div>
        {onClose && (
          <Button variant={connectorApp ? 'default' : 'primary'} icon={<Check size={14} aria-hidden />} onClick={onClose}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}

/** Coming back after a publish: when it was, how far the checklist got, and whether the cards changed since. */
function EarlierPublish({
  last,
  project,
  origin,
  onToggle,
  hubDomain,
}: {
  last: LastPublish;
  project: Project;
  origin: string;
  onToggle: (key: string, done: boolean) => void;
  hubDomain?: string;
}) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const items = useChecklistItems({ project, origin, installUrl: last.installUrl, projectUrl: last.projectUrl, portalId: last.portalId });
  const doneCount = items.filter((i) => last.done.includes(i.key)).length;
  const when = new Date(last.at);
  const label = Number.isNaN(when.getTime()) ? 'earlier' : when.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const where = hubDomain || (last.portalId ? `account ${last.portalId}` : '');
  const changedSince = !Number.isNaN(when.getTime()) && Date.parse(project.updatedAt) > when.getTime();
  return (
    <div className="ub-dp-earlier">
      <button type="button" className="ub-pn-link ub-dp-guide-toggle" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />} Last published {label}
        {where ? ` to ${where}` : ''} · Finish in HubSpot: {doneCount} of {items.length} done
      </button>
      {changedSince && (
        <p className="ub-dp-hint ub-dp-hint--info" role="status">
          <Info size={13} aria-hidden /> You’ve changed your cards since then — publish again to update them in HubSpot.
        </p>
      )}
      <div id={regionId}>
        {open && (
          <FinishChecklist project={project} origin={origin} last={last} onToggle={onToggle} installUrl={last.installUrl} projectUrl={last.projectUrl} portalId={last.portalId} />
        )}
      </div>
    </div>
  );
}
