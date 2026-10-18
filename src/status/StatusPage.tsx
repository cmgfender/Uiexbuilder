/**
 * The private Status page (/status) for the person who hosts the builder: what happened with
 * sign-ins, publishes and errors, in plain words, without digging through the host's logs.
 *
 * Who sees what:
 * - no server (static hosting)          → why there is nothing to show
 * - sign-in not set up                  → the setup checklist (admins must sign in with HubSpot)
 * - signed out                          → Sign in with HubSpot (+ help when sign-in itself fails)
 * - signed in, no admins configured     → exactly how to set ADMIN_EMAILS on their host
 * - signed in, not an admin             → nothing about events; how to become one if it's theirs
 * - admin                               → the dashboard (./Dashboard.tsx)
 *
 * Mounted by src/main.tsx instead of the editor when the address is /status. Light and dark follow
 * the system (tokens in status.css; the builder itself stays light).
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Copy, ExternalLink, LoaderCircle, LockKeyhole, RefreshCw, ServerOff, ShieldCheck, UserRoundX } from 'lucide-react';
import { Button, ToastProvider, cx } from '../ui';
import { ConnectButton } from '../connect/ui';
import { HOSTING_DOCS_URL } from '../connect/ui/links';
import { getConnectorClient, isAbortError, isConnectorError } from '../connect/client';
import { describeError } from '../connect/describe';
import { signInFix } from '../connect/signInHelp';
import { useConnection } from '../connect/store';
import { LogoMark } from '../shell/TopBar';
import { fetchAdminAccess } from './api';
import { statusContext } from './context';
import { Dashboard } from './Dashboard';
import type { AdminAccess } from './types';
import './status.css';

type Gate =
  | { kind: 'loading' }
  | { kind: 'no-server' }
  | { kind: 'error'; message: string }
  | { kind: 'access'; access: AdminAccess };

/** Marks the document for the status page's theme and title while it is shown. */
function useStatusDocument(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('ub-st-root');
    const previous = document.title;
    document.title = 'Builder status';
    return () => {
      root.classList.remove('ub-st-root');
      document.title = previous;
    };
  }, []);
}

export function StatusPage() {
  useStatusDocument();
  return (
    <ToastProvider>
      <StatusPageBody />
    </ToastProvider>
  );
}

function StatusPageBody() {
  const status = useConnection((s) => s.status);
  const info = useConnection((s) => s.info);
  const [gate, setGate] = useState<Gate>(() => (getConnectorClient().disabled ? { kind: 'no-server' } : { kind: 'loading' }));
  const [attempt, setAttempt] = useState(0);
  const disabled = getConnectorClient().disabled;

  useEffect(() => {
    if (!disabled) void useConnection.getState().init();
  }, [disabled]);

  // Who is asking: again whenever the sign-in changes.
  const who = info.connected ? `${info.portalId}:${info.user.email}` : 'signed-out';
  useEffect(() => {
    if (disabled) return;
    if (status === 'checking' || status === 'connecting') return;
    if (status === 'unavailable') {
      setGate({ kind: 'no-server' });
      return;
    }
    const controller = new AbortController();
    fetchAdminAccess(controller.signal)
      .then((access) => setGate({ kind: 'access', access }))
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        if (isConnectorError(err) && err.code === 'unavailable') setGate({ kind: 'no-server' });
        else setGate({ kind: 'error', message: describeError(err).message });
      });
    return () => controller.abort();
  }, [disabled, status, who, attempt]);

  const retry = useCallback(() => {
    setGate({ kind: 'loading' });
    if (useConnection.getState().status === 'error') void useConnection.getState().init();
    setAttempt((n) => n + 1);
  }, []);

  const admin = gate.kind === 'access' && gate.access.admin;
  return (
    <div className="ub-st">
      <a className="ub-st-skip" href="#ub-st-main">
        Skip to content
      </a>
      <header className="ub-st-bar">
        <a className="ub-st-brand" href="/" title="Back to the builder">
          <LogoMark size={26} />
          <span className="ub-st-brand__name">UI Extension Builder</span>
          <span className="ub-st-brand__sep" aria-hidden>
            /
          </span>
          <span className="ub-st-brand__page">Status</span>
        </a>
        <span className="ub-st-private" title="Only the admins listed on the server can see this page">
          <LockKeyhole size={12} aria-hidden /> Private
        </span>
        <div className="ub-st-bar__right">
          <a className="ub-st-back" href="/">
            <ArrowLeft size={14} aria-hidden /> Back to the builder
          </a>
          {/* The account menu (switch account, disconnect) once signed in; signed out, the page itself offers sign-in. */}
          {status === 'connected' && <ConnectButton />}
        </div>
      </header>
      <main id="ub-st-main" className={cx('ub-st-main', !admin && 'ub-st-main--gate')} tabIndex={-1}>
        {gate.kind === 'loading' && <Checking />}
        {gate.kind === 'no-server' && <NoServer />}
        {gate.kind === 'error' && <ServerError message={gate.message} onRetry={retry} />}
        {gate.kind === 'access' && <AccessView access={gate.access} onRecheck={retry} />}
      </main>
    </div>
  );
}

function AccessView({ access, onRecheck }: { access: AdminAccess; onRecheck: () => void }) {
  if (!access.signInConfigured) return <SignInNotSetUp missing={access.missingSettings ?? []} />;
  if (!access.signedIn) return <SignedOut />;
  if (access.admin) return <Dashboard />;
  if (!access.adminConfigured) return <MakeAdmin access={access} onRecheck={onRecheck} />;
  return <NotAdmin access={access} onRecheck={onRecheck} />;
}

// ------------------------------------------------------------------ gate screens

function GateCard({ icon, title, children, tone = 'neutral' }: { icon: ReactNode; title: string; children: ReactNode; tone?: 'neutral' | 'warning' }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <section className={cx('ub-st-gate', `ub-st-gate--${tone}`)} aria-labelledby="ub-st-gate-title">
      <div className="ub-st-gate__icon" aria-hidden>
        {icon}
      </div>
      <h1 id="ub-st-gate-title" ref={heading} tabIndex={-1} className="ub-st-gate__title">
        {title}
      </h1>
      {children}
    </section>
  );
}

function Checking() {
  return (
    <div className="ub-st-checking" role="status">
      <LoaderCircle size={18} className="ub-st-spin" aria-hidden /> Checking who you are…
    </div>
  );
}

function NoServer() {
  return (
    <GateCard icon={<ServerOff size={26} />} title="The status page needs the builder’s server">
      <p className="ub-st-gate__lead">
        This copy of the builder runs without its server (for example on plain static hosting, or with <code>npm run dev:vite</code>), so there are no sign-ins,
        publishes or errors to show.
      </p>
      <p className="ub-st-gate__text">Host the builder with its server (Render, Docker, or any Node.js host with <code>npm start</code>) to get a status page.</p>
      <div className="ub-st-gate__actions">
        <a className="ub-btn ub-btn--primary" href={HOSTING_DOCS_URL} target="_blank" rel="noreferrer">
          Hosting guide <ExternalLink size={13} aria-hidden />
        </a>
        <a className="ub-btn" href="/">
          Back to the builder
        </a>
      </div>
    </GateCard>
  );
}

function ServerError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <GateCard icon={<ServerOff size={26} />} title="Couldn’t reach the builder’s server" tone="warning">
      <p className="ub-st-gate__lead" role="alert">
        {message}
      </p>
      <p className="ub-st-gate__text">On free hosting the server may be waking up — that can take a minute.</p>
      <div className="ub-st-gate__actions">
        <Button variant="primary" icon={<RefreshCw size={14} aria-hidden />} onClick={onRetry}>
          Try again
        </Button>
      </div>
    </GateCard>
  );
}

function SignInNotSetUp({ missing }: { missing: string[] }) {
  const ctx = statusContext();
  return (
    <GateCard icon={<LockKeyhole size={26} />} title="Set up Sign in with HubSpot first">
      <p className="ub-st-gate__lead">Only people signed in with HubSpot can open the status page, and sign-in isn’t set up on this server yet.</p>
      {missing.length > 0 && (
        <p className="ub-st-gate__text">
          Still missing: {missing.map((m, i) => (
            <span key={m}>
              {i > 0 && ', '}
              <code>{m}</code>
            </span>
          ))}
          .
        </p>
      )}
      <p className="ub-st-gate__text">
        Meanwhile your host’s logs list every sign-in, publish and error: search them for <code>[event]</code>.
      </p>
      <div className="ub-st-gate__actions">
        <a className="ub-btn ub-btn--primary" href={ctx.setupUrl}>
          Open the setup checklist
        </a>
      </div>
    </GateCard>
  );
}

function SignedOut() {
  const status = useConnection((s) => s.status);
  const [help, setHelp] = useState(false);
  const helpId = useId();
  const ctx = statusContext();
  const aup = signInFix('aup', ctx);
  const connecting = status === 'connecting';
  return (
    <GateCard icon={<ShieldCheck size={26} />} title="Sign in to see what’s happening">
      <p className="ub-st-gate__lead">
        The status page shows how sign-ins and publishes went for the people using this builder, and any errors — in plain words. Only the people who host the
        builder can see it.
      </p>
      <div className="ub-st-gate__actions">
        <Button
          variant="primary"
          icon={connecting ? <LoaderCircle size={14} className="ub-st-spin" aria-hidden /> : undefined}
          disabled={connecting}
          onClick={() => void useConnection.getState().connect()}
        >
          {connecting ? 'Waiting for HubSpot…' : 'Sign in with HubSpot'}
        </Button>
        {connecting && (
          <Button variant="ghost" onClick={() => void useConnection.getState().connectInThisTab()}>
            Sign in in this tab instead
          </Button>
        )}
      </div>
      <button type="button" className="ub-st-disclosure" aria-expanded={help} aria-controls={helpId} onClick={() => setHelp((v) => !v)}>
        {help ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        Can’t sign in?
      </button>
      <div id={helpId} hidden={!help} className="ub-st-gate__help">
        <p>HubSpot shows sign-in problems inside its own window. The two most common ones:</p>
        <ul>
          <li>
            <strong>“The app developer has not signed the acceptable use policy”</strong> — {aup.steps[0]} {aup.steps[1]}
          </li>
          <li>
            <strong>“You don’t have permission to install this app”</strong> — the first person to connect from a HubSpot account must be a Super Admin (or have
            App Marketplace access).
          </li>
        </ul>
        <p>
          Your host’s logs also list every sign-in attempt: search them for <code>[event]</code>. <a href={ctx.setupUrl}>Setup checklist</a>
        </p>
      </div>
    </GateCard>
  );
}

function NotAdmin({ access, onRecheck }: { access: AdminAccess; onRecheck: () => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const who = access.account?.email ? `${access.account.email} (HubSpot account ${access.account.portalId})` : `HubSpot account ${access.account?.portalId ?? ''}`;
  return (
    <GateCard icon={<UserRoundX size={26} />} title="This page is for the people who host this builder">
      <p className="ub-st-gate__lead">
        You’re signed in as <strong>{who}</strong>, which isn’t on this builder’s list of admins. Nothing about other people’s activity is shown here.
      </p>
      <div className="ub-st-gate__actions">
        <Button onClick={() => void useConnection.getState().switchPortal()}>Switch HubSpot account</Button>
        <Button variant="ghost" icon={<RefreshCw size={14} aria-hidden />} onClick={onRecheck}>
          Check again
        </Button>
      </div>
      <button type="button" className="ub-st-disclosure" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        I host this builder — add me
      </button>
      <div id={id} hidden={!open}>
        <AdminSteps access={access} />
      </div>
    </GateCard>
  );
}

function MakeAdmin({ access, onRecheck }: { access: AdminAccess; onRecheck: () => void }) {
  return (
    <GateCard icon={<ShieldCheck size={26} />} title="One setting to go: make yourself an admin">
      <p className="ub-st-gate__lead">
        Nobody can see the status page until the server knows who its admins are. Add your HubSpot login email as the setting <code>ADMIN_EMAILS</code> on
        your host — it takes about two minutes.
      </p>
      <AdminSteps access={access} />
      <div className="ub-st-gate__actions">
        <Button variant="primary" icon={<RefreshCw size={14} aria-hidden />} onClick={onRecheck}>
          I’ve added it — check again
        </Button>
      </div>
    </GateCard>
  );
}

// ------------------------------------------------------------------ "add ADMIN_EMAILS on your host"

export type HostKind = 'render' | 'vercel' | 'cloudflare' | 'docker' | 'local';

const HOSTS: Array<{ kind: HostKind; label: string }> = [
  { kind: 'render', label: 'Render' },
  { kind: 'vercel', label: 'Vercel' },
  { kind: 'cloudflare', label: 'Cloudflare' },
  { kind: 'docker', label: 'Docker / Node.js' },
  { kind: 'local', label: 'This computer' },
];

/** The host this builder most likely runs on, from its address. */
export function guessHost(hostname: string): HostKind {
  if (/\.onrender\.com$/i.test(hostname)) return 'render';
  if (/\.vercel\.app$/i.test(hostname)) return 'vercel';
  if (/\.workers\.dev$|\.pages\.dev$/i.test(hostname)) return 'cloudflare';
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(hostname) || hostname.endsWith('.localhost')) return 'local';
  return 'render';
}

/** Where to add a setting on each host, step by step (the value is shown and copied separately). */
export function hostSteps(kind: HostKind, setting: string): string[] {
  switch (kind) {
    case 'render':
      return [
        'Open dashboard.render.com and click your builder’s service.',
        'Click Environment in the menu on the left, then Add Environment Variable (or Edit).',
        `Key: ${setting.split('=')[0]} — Value: the value below. Click Save, rebuild, and deploy.`,
        'Render restarts the builder in a minute or two. Then come back here and click Check again.',
      ];
    case 'vercel':
      return [
        'Open your project on vercel.com → Settings → Environment Variables.',
        `Add Key ${setting.split('=')[0]} with the value below (Production), and save.`,
        'Open Deployments, click ⋯ next to the latest one and choose Redeploy. Then click Check again here.',
      ];
    case 'cloudflare':
      return [
        'In the Cloudflare dashboard open Workers & Pages → your builder → Settings → Variables and Secrets.',
        `Add a variable named ${setting.split('=')[0]} (type Text) with the value below, and deploy.`,
        'Then click Check again here.',
      ];
    case 'docker':
      return [
        `Add ${setting} to the builder’s environment: docker run -e …, your compose file, or the .env file your service reads.`,
        'Restart the builder, then click Check again here.',
      ];
    case 'local':
      return [
        `Add the line ${setting} to the file .env.local in the builder’s folder (or start it with ${setting} npm run dev).`,
        'Stop the builder (Ctrl+C) and start it again, then click Check again here.',
      ];
  }
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="ub-st-copy">
      <span className="ub-st-copy__label">{label}</span>
      <code className="ub-st-copy__value">{value}</code>
      <Button size="sm" icon={copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />} onClick={() => void copy()} aria-label={`Copy ${label}`}>
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

function AdminSteps({ access }: { access: AdminAccess }) {
  const [host, setHost] = useState<HostKind>(() => guessHost(typeof window !== 'undefined' ? window.location.hostname : ''));
  const email = access.account?.email;
  const portal = access.account?.portalId;
  const setting = email ? `ADMIN_EMAILS=${email}` : `ADMIN_PORTALS=${portal ?? ''}`;
  const tabsId = useId();
  return (
    <div className="ub-st-admin">
      <div className="ub-st-admin__values">
        {email && <CopyValue label="ADMIN_EMAILS" value={email} />}
        {!email && portal !== undefined && <CopyValue label="ADMIN_PORTALS" value={String(portal)} />}
      </div>
      <div className="ub-st-hosts" role="tablist" aria-label="Where the builder is hosted">
        {HOSTS.map((h) => (
          <button
            key={h.kind}
            type="button"
            role="tab"
            id={`${tabsId}-${h.kind}`}
            aria-selected={h.kind === host}
            aria-controls={`${tabsId}-panel`}
            tabIndex={h.kind === host ? 0 : -1}
            className="ub-st-hosts__tab"
            onClick={() => setHost(h.kind)}
            onKeyDown={(e) => {
              const i = HOSTS.findIndex((x) => x.kind === host);
              const next = e.key === 'ArrowRight' ? (i + 1) % HOSTS.length : e.key === 'ArrowLeft' ? (i - 1 + HOSTS.length) % HOSTS.length : -1;
              if (next < 0) return;
              e.preventDefault();
              setHost(HOSTS[next].kind);
              document.getElementById(`${tabsId}-${HOSTS[next].kind}`)?.focus();
            }}
          >
            {h.label}
          </button>
        ))}
      </div>
      <ol className="ub-st-admin__steps" id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${host}`}>
        {hostSteps(host, setting).map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {email && portal !== undefined && (
        <p className="ub-st-admin__alt">
          Several admins? Separate emails with commas. Or let everyone signed in to HubSpot account {portal} in with <code>ADMIN_PORTALS={portal}</code>.
        </p>
      )}
    </div>
  );
}
