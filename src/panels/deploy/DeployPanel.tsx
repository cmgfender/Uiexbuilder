/**
 * "Deploy to HubSpot" (beta) — the Export dialog section that uploads the project to HubSpot with
 * the admin's personal access key, through the hosted connector (no terminal). Shows the HubSpot
 * CLI instructions instead when there is no connector (static hosting) or deploy is turned off.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, CircleCheck, ExternalLink, KeyRound, Loader2, RotateCcw, Rocket, Terminal, TriangleAlert, UploadCloud, X } from 'lucide-react';
import { useConnection } from '../../connect/store';
import type { DeployRequest, DeployStatus } from '../../connect/types';
import { formattedProjectFiles, generateProjectFiles } from '../../codegen';
import { useEditor } from '../../model/store';
import type { Project } from '../../model/types';
import { validateProject } from '../../model/validate';
import { Badge, Button, Field, Switch, TextInput, cx } from '../../ui';
import { Callout } from '../common';
import { deployClient, type DeployClient } from './client';
import { DEPLOY_STEPS, KEY_GUIDE_FALLBACK, KEY_GUIDE_STEPS, installHint, nextSteps, personalAccessKeyUrl, stepIndex, stepStates, type StepState } from './model';
import { useDeployJob, type DeployFormError } from './useDeployJob';
import './deploy.css';

export interface DeployToHubSpotPanelProps {
  /** The CLI instructions, shown when deploying from the builder isn't possible here. */
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

  if (status === 'checking') {
    return (
      <div className="ub-pn-form ub-dp" role="status">
        <span className="ub-dp-status">
          <Loader2 size={14} className="ub-dp-spin" aria-hidden /> Checking the connection to HubSpot…
        </span>
      </div>
    );
  }
  if (status === 'unavailable' || deployEnabled === false) {
    return (
      <div className="ub-pn-form ub-dp">
        <Callout tone="warning" icon={<Terminal size={14} aria-hidden />}>
          <div className="ub-pn-strong">Deploying from the builder isn’t available here</div>
          <div>
            {status === 'unavailable'
              ? 'This copy of the builder runs without its HubSpot connector, so it can’t send projects to HubSpot for you. You can still deploy with the HubSpot CLI — follow the steps below.'
              : 'Whoever hosts this builder has turned off deploying from the builder. You can still deploy with the HubSpot CLI — follow the steps below.'}
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

function DeployFlow({ client, pollIntervalMs, onShowCli, onClose }: DeployFlowProps) {
  const project = useEditor((s) => s.project);
  const connStatus = useConnection((s) => s.status);
  const info = useConnection((s) => s.info);
  const connect = useConnection((s) => s.connect);
  const connected = info.connected ? info : null;
  const job = useDeployJob(client, pollIntervalMs);

  const [key, setKey] = useState('');
  const [remember, setRemember] = useState(false);
  const [savedKey, setSavedKey] = useState<{ remembered: boolean; portalId?: number } | null>(null);
  const [useOtherKey, setUseOtherKey] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [last, setLast] = useState<LastTarget>({});

  // Is a key remembered in this browser's session? (Only possible while connected.)
  const connectedPortal = connected?.portalId;
  useEffect(() => {
    if (!connectedPortal) {
      setSavedKey(null);
      return;
    }
    let alive = true;
    client
      .keyInfo()
      .then((k) => alive && setSavedKey(k))
      .catch(() => alive && setSavedKey(null));
    return () => {
      alive = false;
    };
  }, [client, connectedPortal]);

  const usingSavedKey = !!savedKey?.remembered && !useOtherKey;

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
    };
    if (target !== undefined) request.portalId = target;
    if (usingSavedKey) request.useRememberedKey = true;
    else {
      request.personalAccessKey = key.trim();
      if (remember && connected) request.remember = true;
    }
    await job.start(request);
  };

  const forgetKey = async () => {
    try {
      setSavedKey(await client.forgetKey());
    } catch {
      setSavedKey({ remembered: false });
    }
  };

  const state = job.state;
  if (state.kind === 'running') return <Progress status={state.status} />;
  if (state.kind === 'success') {
    return (
      <SuccessView
        status={state.status}
        project={project}
        onAgain={() => {
          job.reset();
          if (!remember) setKey('');
        }}
      />
    );
  }
  if (state.kind === 'failed') {
    return (
      <FailureView
        message={state.message}
        code={state.code}
        log={state.log}
        failedStep={state.failedStep}
        status={state.status}
        onRetry={() => void deploy(last.portalId)}
        onBack={job.reset}
        onShowCli={onShowCli}
      />
    );
  }

  return (
    <DeployForm
      project={project}
      connected={connected ? { portalId: connected.portalId, hubDomain: connected.hubDomain, appHost: connected.appHost } : null}
      canConnect={connStatus === 'disconnected' || connStatus === 'error'}
      onConnect={() => void connect()}
      keyValue={key}
      onKeyChange={(v) => {
        setKey(v);
        if (job.formError && job.formError.code !== 'portal_mismatch') job.clearFormError();
      }}
      remember={remember}
      onRememberChange={setRemember}
      usingSavedKey={usingSavedKey}
      onUseOtherKey={() => setUseOtherKey(true)}
      onUseSavedKey={savedKey?.remembered ? () => setUseOtherKey(false) : undefined}
      onForgetKey={() => void forgetKey()}
      preparing={preparing}
      formError={job.formError}
      onDeploy={(portalId) => void deploy(portalId)}
      onDismissError={job.clearFormError}
      onShowCli={onShowCli}
      onClose={onClose}
    />
  );
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

interface DeployFormProps {
  project: Project;
  connected: { portalId: number; hubDomain: string; appHost: string } | null;
  canConnect: boolean;
  onConnect: () => void;
  keyValue: string;
  onKeyChange: (value: string) => void;
  remember: boolean;
  onRememberChange: (value: boolean) => void;
  usingSavedKey: boolean;
  onUseOtherKey: () => void;
  onUseSavedKey?: () => void;
  onForgetKey: () => void;
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
  const guideId = `${ids}-guide`;
  const [showKey, setShowKey] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const issues = useMemo(() => validateProject(p.project), [p.project]);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const blocked = errors.length > 0 && !ack;
  const keyUrl = personalAccessKeyUrl(p.connected?.appHost, p.connected?.portalId);
  const mismatch = p.formError?.code === 'portal_mismatch' ? p.formError : null;
  const keyError = p.formError && !mismatch ? p.formError : null;
  const hasKey = p.usingSavedKey || p.keyValue.trim().length > 0;
  const canDeploy = hasKey && !blocked && !p.preparing && !mismatch;

  const showProblems = () => {
    useEditor.getState().setBottomPanel('problems');
    p.onClose?.();
  };

  return (
    <div className="ub-pn-form ub-dp">
      <Callout tone="info" icon={<Rocket size={14} aria-hidden />}>
        <div className="ub-pn-strong ub-dp-title">
          Put this project live in HubSpot — no terminal needed <Badge tone="accent">Beta</Badge>
        </div>
        <div>
          The builder sends your project’s files to HubSpot. HubSpot checks and builds them, then makes your cards live in your account — the same
          thing developers do with “hs project upload”. Your CRM records are not changed.
        </div>
      </Callout>

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
            <Switch checked={ack} onChange={setAck} label="Deploy anyway" />
          </div>
        </Callout>
      ) : warnings.length > 0 ? (
        <Callout tone="warning" icon={<TriangleAlert size={14} aria-hidden />}>
          {warnings.length} warning{warnings.length === 1 ? '' : 's'} — you can still deploy.{' '}
          <button type="button" className="ub-pn-link" onClick={showProblems}>
            Show problems
          </button>
        </Callout>
      ) : null}

      <section className="ub-pn-card" aria-labelledby={`${ids}-acct`}>
        <h3 className="ub-pn-h3" id={`${ids}-acct`}>
          HubSpot account
        </h3>
        {p.connected ? (
          <p className="ub-dp-p">
            Deploying to <strong>{p.connected.hubDomain || 'your HubSpot account'}</strong> (account {p.connected.portalId}), the account you’re
            connected to.
          </p>
        ) : (
          <p className="ub-dp-p">
            The project goes to the HubSpot account your personal access key belongs to.
            {p.canConnect && (
              <>
                {' '}
                <button type="button" className="ub-pn-link" onClick={p.onConnect}>
                  Connect HubSpot
                </button>{' '}
                to check it’s the right account and to remember the key.
              </>
            )}
          </p>
        )}
      </section>

      <section className="ub-pn-card" aria-labelledby={`${ids}-keyhead`}>
        <h3 className="ub-pn-h3" id={`${ids}-keyhead`}>
          <KeyRound size={13} aria-hidden /> Personal access key
        </h3>
        {p.usingSavedKey ? (
          <div className="ub-dp-saved">
            <span>Using the personal access key saved on this browser.</span>
            <span className="ub-pn-row">
              <button type="button" className="ub-pn-link" onClick={p.onUseOtherKey}>
                Use a different key
              </button>
              <button type="button" className="ub-pn-link" onClick={p.onForgetKey}>
                Forget saved key
              </button>
            </span>
          </div>
        ) : (
          <>
            <Field
              label="Paste your key"
              htmlFor={keyId}
              error={keyError ? <KeyErrorText error={keyError} keyUrl={keyUrl} /> : undefined}
              hint="It works like a password for HubSpot’s developer tools. It’s only used for this deploy unless you choose to remember it."
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
            <button
              type="button"
              className="ub-pn-link ub-dp-guide-toggle"
              aria-expanded={guideOpen}
              aria-controls={guideId}
              onClick={() => setGuideOpen((v) => !v)}
            >
              {guideOpen ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />} How do I get this?
            </button>
            {guideOpen && <KeyGuide id={guideId} url={keyUrl} />}
            <div className="ub-dp-remember">
              <Switch checked={p.remember && !!p.connected} disabled={!p.connected} onChange={p.onRememberChange} label="Remember on this browser" />
              <span className="ub-pn-muted">
                {p.connected ? 'Saved encrypted in this browser’s sign-in cookie, so next time you just click Deploy.' : 'Connect HubSpot to remember the key.'}
              </span>
            </div>
            {p.onUseSavedKey && (
              <button type="button" className="ub-pn-link" onClick={p.onUseSavedKey}>
                Use the saved key instead
              </button>
            )}
          </>
        )}
      </section>

      {mismatch && (
        <Callout tone="warning" icon={<TriangleAlert size={14} aria-hidden />} role="alert">
          <div className="ub-pn-strong">This key is for a different HubSpot account</div>
          <div>{mismatch.message}</div>
          <div className="ub-pn-row">
            {mismatch.portalId !== undefined && (
              <Button size="sm" onClick={() => p.onDeploy(mismatch.portalId)}>
                Deploy to account {mismatch.portalId} instead
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<X size={13} aria-hidden />} onClick={p.onDismissError}>
              Use a different key
            </Button>
          </div>
        </Callout>
      )}

      <div className="ub-pn-row ub-pn-row--between">
        {p.onShowCli ? (
          <button type="button" className="ub-pn-link" onClick={p.onShowCli}>
            Prefer the terminal? Use the HubSpot CLI
          </button>
        ) : (
          <span />
        )}
        <Button
          variant="primary"
          icon={p.preparing ? <Loader2 size={14} className="ub-dp-spin" aria-hidden /> : <UploadCloud size={14} aria-hidden />}
          disabled={!canDeploy}
          title={blocked ? 'Fix the problems or turn on “Deploy anyway”' : !hasKey ? 'Paste your personal access key first' : undefined}
          onClick={() => p.onDeploy()}
        >
          {p.preparing ? 'Preparing files…' : 'Deploy to HubSpot'}
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

function KeyGuide({ id, url }: { id: string; url: string }) {
  return (
    <div id={id} className="ub-dp-guide" role="region" aria-label="How to get a personal access key">
      <ol className="ub-pn-steps">
        {KEY_GUIDE_STEPS.map((s, i) => (
          <li key={s.title} className="ub-pn-step">
            <span className="ub-pn-step__num" aria-hidden>
              {i + 1}
            </span>
            <div className="ub-pn-step__body">
              <div className="ub-pn-strong">{s.title}</div>
              {s.body && <div className="ub-pn-muted">{s.body}</div>}
              {i === 0 && (
                <a className="ub-btn ub-btn--sm ub-dp-linkbtn" href={url} target="_blank" rel="noreferrer">
                  Open the personal access key page <ExternalLink size={12} aria-hidden />
                  <span className="ub-sr-only"> (opens in a new tab)</span>
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="ub-pn-muted ub-dp-p">{KEY_GUIDE_FALLBACK}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress, success, failure
// ---------------------------------------------------------------------------

const STATE_TEXT: Record<StepState, string> = { done: 'done', current: 'in progress', failed: 'failed', todo: 'not started' };

function Stepper({ current, failed = false }: { current: number; failed?: boolean }) {
  const states = stepStates(current, failed);
  return (
    <ol className="ub-dp-stepper" aria-label="Deploy progress">
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

function DeployLog({ lines, label = 'Deploy log' }: { lines: string[]; label?: string }) {
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
  return (
    <div className="ub-pn-form ub-dp">
      <Stepper current={current} />
      <p className="ub-dp-status" role="status" aria-live="polite">
        <Loader2 size={14} className="ub-dp-spin" aria-hidden />
        {status?.message ?? 'Uploading your project to HubSpot…'}
      </p>
      <DeployLog lines={status?.log ?? []} />
      <p className="ub-pn-muted ub-dp-p">This usually takes a minute or two. Closing this window only stops the progress view — HubSpot finishes the deploy either way.</p>
    </div>
  );
}

function HubSpotLink({ href, children, primary }: { href: string; children: ReactNode; primary?: boolean }) {
  return (
    <a className={cx('ub-btn', primary && 'ub-btn--primary', 'ub-dp-linkbtn')} href={href} target="_blank" rel="noreferrer">
      {children} <ExternalLink size={13} aria-hidden />
      <span className="ub-sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function SuccessView({ status, project, onAgain }: { status: DeployStatus; project: Project; onAgain: () => void }) {
  const steps = useMemo(() => nextSteps(project), [project]);
  const [showLog, setShowLog] = useState(false);
  const logId = useId();
  return (
    <div className="ub-pn-form ub-dp">
      <Stepper current={DEPLOY_STEPS.length - 1} />
      <Callout tone="success" icon={<CircleCheck size={14} aria-hidden />} role="status">
        <div className="ub-pn-strong">{status.message}</div>
        <div>
          Build #{status.buildId} of “{status.projectName}” is deployed to HubSpot account {status.portalId}.
        </div>
      </Callout>
      <div className="ub-pn-row">
        {status.projectUrl && (
          <HubSpotLink href={status.projectUrl} primary>
            Open project in HubSpot
          </HubSpotLink>
        )}
        {status.installUrl && <HubSpotLink href={status.installUrl}>Install the app</HubSpotLink>}
      </div>

      <section className="ub-pn-card" aria-labelledby={`${logId}-next`}>
        <h3 className="ub-pn-h3" id={`${logId}-next`}>
          Next steps
        </h3>
        <ol className="ub-pn-steps">
          <li className="ub-pn-step">
            <span className="ub-pn-step__num" aria-hidden>
              1
            </span>
            <div className="ub-pn-step__body">
              <div className="ub-pn-strong">Install the app in your account</div>
              <div className="ub-pn-muted">
                {status.installUrl
                  ? 'Click “Install the app” above and approve the access it asks for. You only need to do this once.'
                  : installHint(project)}
              </div>
            </div>
          </li>
          {steps.map((s, i) => (
            <li key={s.title} className="ub-pn-step">
              <span className="ub-pn-step__num" aria-hidden>
                {i + 2}
              </span>
              <div className="ub-pn-step__body">
                <div className="ub-pn-strong">{s.title}</div>
                {s.body && <div className="ub-pn-muted">{s.body}</div>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {status.log.length > 0 && (
        <div className="ub-dp-logwrap">
          <button type="button" className="ub-pn-link ub-dp-guide-toggle" aria-expanded={showLog} aria-controls={logId} onClick={() => setShowLog((v) => !v)}>
            {showLog ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />} Deploy log
            {status.log.some((l) => l.startsWith('Warning:')) && <Badge tone="warning">warnings</Badge>}
          </button>
          <div id={logId}>{showLog && <DeployLog lines={status.log} />}</div>
        </div>
      )}
      <div className="ub-pn-row ub-pn-row--end">
        <Button icon={<RotateCcw size={14} aria-hidden />} onClick={onAgain}>
          Deploy again
        </Button>
      </div>
    </div>
  );
}

function FailureView({
  message,
  code,
  log,
  failedStep,
  status,
  onRetry,
  onBack,
  onShowCli,
}: {
  message: string;
  code: string;
  log: string[];
  failedStep: number;
  status: DeployStatus | null;
  onRetry: () => void;
  onBack: () => void;
  onShowCli?: () => void;
}) {
  const offline = code === 'network' || code === 'connector_unavailable';
  return (
    <div className="ub-pn-form ub-dp">
      <Stepper current={failedStep} failed />
      <Callout tone="danger" icon={<TriangleAlert size={14} aria-hidden />} role="alert">
        <div className="ub-pn-strong">The deploy didn’t finish</div>
        <div>{message}</div>
      </Callout>
      <DeployLog lines={log} />
      <div className="ub-pn-row">
        <Button variant="primary" icon={<RotateCcw size={14} aria-hidden />} onClick={onRetry}>
          Try again
        </Button>
        <Button onClick={onBack}>Back</Button>
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
