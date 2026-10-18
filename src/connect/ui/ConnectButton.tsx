/**
 * Top-bar "Connect HubSpot" control. One button whose look follows the connection status:
 *  checking / unavailable – muted; explains that connecting needs the hosted version
 *  not-configured          – muted; explains what whoever hosts the builder must set up
 *  disconnected            – outlined "Connect HubSpot" (consent explainer before the first time)
 *  connecting              – spinner (click brings the HubSpot window forward) + Cancel; after a few
 *                            seconds a visible "Waiting for HubSpot…" panel (show window / start
 *                            again / cancel / "Having trouble?"); after half a minute it says "Still
 *                            waiting for HubSpot…" and opens "What does HubSpot show?" (SignInHelp)
 *  connected               – account chip "acme.com · 12345678" opening the account menu
 *  error                   – "Connect HubSpot" with a warning; click retries
 * It also turns connection notices (connected / disconnected / sign-in expired) into toasts.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, ExternalLink, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { Button, cx, useToast } from '../../ui';
import { CONNECT_TIMINGS, useConnection, type ConnectionNotice, type ConnectionStatus } from '../store';
import { AccountMenu, accountInitial } from './AccountMenu';
import { ConnectDialog, connectExplained, markConnectExplained, type ConnectDialogMode } from './ConnectDialog';
import { HubSpotMark } from './HubSpotMark';
import { useConnectUiHost } from './host';
import { HOSTING_DOCS_URL, setupPageUrl } from './links';
import { Popover } from './Popover';
import { SignInHelp } from './SignInHelp';
import { reportSignInFeedback } from '../../status/reporter';
import './connect.css';

const TOOLTIP: Partial<Record<ConnectionStatus, string>> = {
  checking: 'Checking for a HubSpot connection…',
  unavailable: 'Available on the hosted version',
  'not-configured': 'Sign in with HubSpot is not set up on this server yet — click for details',
  disconnected: 'Connect your HubSpot account to preview with real data (read-only)',
  connecting: 'Waiting for you to finish in the HubSpot window — click to show it',
};

/** Toast text for a connection notice. */
export function noticeText(notice: ConnectionNotice): string {
  switch (notice.kind) {
    case 'connected':
      return `Connected to ${notice.account ?? 'HubSpot'}. Pick a sample record above the card to see real data.`;
    case 'disconnected':
      return 'Disconnected from HubSpot. Previews use mock data again; your sample records are kept for next time.';
    case 'expired':
      return 'Your HubSpot sign-in expired, so the preview is back to mock data.';
  }
}

/** Shows connection notices as toasts (once each). */
function useConnectionToasts(): void {
  const toast = useToast();
  const notice = useConnection((s) => s.notice);
  const shown = useRef<number | null>(notice?.id ?? null);
  useEffect(() => {
    if (!notice || shown.current === notice.id) return;
    shown.current = notice.id;
    // The guided setup shows "Connected to …" in place.
    if (notice.kind === 'connected' && useConnectUiHost.getState().inline) return;
    if (notice.kind === 'expired') {
      toast(noticeText(notice), { action: { label: 'Reconnect', onClick: () => void useConnection.getState().connect() } });
    } else {
      toast(noticeText(notice), { durationMs: 6000 });
    }
  }, [notice, toast]);
}

/** True once the sign-in has been waiting for `afterMs` (default `waitingHintMs`). */
export function useWaitingLong(connecting: boolean, afterMs: number = CONNECT_TIMINGS.waitingHintMs): boolean {
  const since = useConnection((s) => s.connectingSince);
  const [long, setLong] = useState(false);
  useEffect(() => {
    setLong(false);
    if (!connecting || since === null) return;
    const left = since + afterMs - Date.now();
    if (left <= 0) {
      setLong(true);
      return;
    }
    const t = setTimeout(() => setLong(true), left);
    return () => clearTimeout(t);
  }, [connecting, since, afterMs]);
  return connecting && long;
}

export function ConnectButton() {
  useConnectionToasts();
  const status = useConnection((s) => s.status);
  const info = useConnection((s) => s.info);
  const health = useConnection((s) => s.health);
  const error = useConnection((s) => s.error);
  const errorCode = useConnection((s) => s.errorCode);
  const errorSource = useConnection((s) => s.errorSource);
  const [dialog, setDialog] = useState<ConnectDialogMode | null>(null);
  const [panel, setPanel] = useState<'account' | 'info' | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const waitingLong = useWaitingLong(status === 'connecting');
  // The guided setup shows its own waiting help while it runs the sign-in.
  const inline = useConnectUiHost((s) => s.inline);

  // A sign-in (popup or full-page) or sign-out that did not work out: explain it and offer to try
  // again. Startup problems show on the button itself.
  useEffect(() => {
    if (!error || !errorCode || (errorSource !== 'sign-in' && errorSource !== 'sign-out')) return;
    // A window that closed, timed out or was blocked leaves no trace on the server: tell the host's
    // status page (also for the guided setup's inline sign-in).
    if (errorSource === 'sign-in' && (errorCode === 'popup_closed' || errorCode === 'timeout' || errorCode === 'popup_blocked')) reportSignInFeedback(errorCode);
    // The guided setup explains a failed sign-in in place.
    if (errorSource === 'sign-in' && useConnectUiHost.getState().inline) return;
    if ((status === 'disconnected' || status === 'connected') && panel !== 'account') setDialog('result');
    // Only when a new problem is reported (status / panel are read at that moment).
  }, [error]);

  const connectNow = () => {
    // Opens the HubSpot window synchronously (inside the click), so browsers don't block it.
    void useConnection.getState().connect();
  };

  const onClick = () => {
    switch (status) {
      case 'checking':
        return;
      case 'unavailable':
      case 'not-configured':
        setPanel((p) => (p === 'info' ? null : 'info'));
        return;
      case 'connecting':
        useConnection.getState().focusPopup();
        return;
      case 'connected':
        setPanel((p) => (p === 'account' ? null : 'account'));
        return;
      case 'error':
        if (!health) {
          void useConnection.getState().init();
          return;
        }
        connectNow();
        return;
      case 'disconnected':
        if (!connectExplained()) {
          setDialog('consent');
          return;
        }
        connectNow();
    }
  };

  const closeDialog = () => {
    setDialog(null);
    useConnection.getState().clearError();
  };
  const continueToHubSpot = () => {
    const retrySignOut = dialog === 'result' && useConnection.getState().errorSource === 'sign-out';
    markConnectExplained();
    setDialog(null);
    useConnection.getState().clearError();
    if (retrySignOut) void useConnection.getState().disconnect();
    else connectNow();
  };

  const expired = status === 'disconnected' && !info.connected && (info.reason === 'expired' || info.reason === 'revoked');
  const muted = status === 'checking' || status === 'unavailable' || status === 'not-configured';

  let content;
  let label: string;
  let title = TOOLTIP[status] ?? '';
  if (status === 'connected' && info.connected) {
    const name = info.hubDomain || `Account ${info.portalId}`;
    label = `Connected to HubSpot: ${name}, account ${info.portalId}${info.user.email ? `, signed in as ${info.user.email}` : ''}. Account menu`;
    title = `Connected to ${name} (${info.portalId}) — account menu`;
    content = (
      <>
        <span className="ub-cn-avatar" aria-hidden>
          {accountInitial(info)}
        </span>
        <span className="ub-cn-btn__text">
          <span className="ub-cn-btn__domain">{name}</span>
          <span className="ub-cn-btn__sep" aria-hidden>
            {' · '}
          </span>
          <span className="ub-cn-btn__portal">{info.portalId}</span>
        </span>
      </>
    );
  } else if (status === 'connecting') {
    label = 'Connecting to HubSpot… Show the HubSpot window';
    content = (
      <>
        <LoaderCircle size={14} className="ub-cn-spin" aria-hidden />
        <span className="ub-cn-btn__text">Connecting…</span>
      </>
    );
  } else {
    label = 'Connect HubSpot';
    if (status === 'error') title = error ? `${error} Click to try again.` : 'Something went wrong — click to try again.';
    if (expired) title = 'Your HubSpot sign-in expired — connect again to keep using real data';
    content = (
      <>
        {status === 'error' || expired ? <TriangleAlert size={14} aria-hidden className="ub-cn-btn__warn" /> : <HubSpotMark size={15} />}
        <span className="ub-cn-btn__text">
          Connect<span className="ub-cn-btn__long"> HubSpot</span>
        </span>
      </>
    );
  }

  return (
    <span className="ub-cn-connect">
      <button
        ref={btnRef}
        type="button"
        className={cx(
          'ub-cn-btn',
          `ub-cn-btn--${status}`,
          muted && 'ub-cn-btn--muted',
          status === 'connected' && 'ub-cn-btn--chip',
          (status === 'error' || expired) && 'ub-cn-btn--attention',
        )}
        aria-label={label}
        // Only "checking" does nothing on click. Unavailable / not-configured stay operable: they
        // open the explanation, so they must not be announced as disabled (the title describes why).
        aria-disabled={status === 'checking' || undefined}
        aria-busy={status === 'checking' || status === 'connecting' || undefined}
        aria-haspopup={status === 'connected' || muted ? 'dialog' : undefined}
        aria-expanded={status === 'connected' || muted ? panel !== null : undefined}
        title={title}
        onClick={onClick}
        data-status={status}
      >
        {content}
      </button>
      {status === 'connecting' && (
        <Button size="sm" variant="ghost" icon={<X size={13} aria-hidden />} aria-label="Cancel connecting" onClick={() => useConnection.getState().cancelConnect()}>
          <span className="ub-cn-cancel-label">Cancel</span>
        </Button>
      )}
      {waitingLong && !inline && <WaitingPanel anchor={btnRef.current} />}
      {panel === 'account' && status === 'connected' && info.connected && (
        <Popover anchor={btnRef.current} label="HubSpot account" align="end" width={320} onClose={() => setPanel(null)}>
          <AccountMenu info={info} onDone={() => setPanel(null)} />
        </Popover>
      )}
      {panel === 'info' && (status === 'unavailable' || status === 'not-configured') && (
        <Popover anchor={btnRef.current} label="About Connect HubSpot" align="end" width={330} onClose={() => setPanel(null)}>
          <AvailabilityNote status={status} />
        </Popover>
      )}
      <ConnectDialog open={dialog !== null} mode={dialog ?? 'consent'} onClose={closeDialog} onContinue={continueToHubSpot} />
    </span>
  );
}

function AvailabilityNote({ status }: { status: 'unavailable' | 'not-configured' }) {
  if (status === 'unavailable') {
    return (
      <div className="ub-cn-note">
        <div className="ub-cn-note__title">
          <Info size={15} aria-hidden /> Connect HubSpot isn't available here
        </div>
        <p>
          This copy of the builder runs without its HubSpot connector (for example on a plain static website), so previews use mock data.
          Connecting to HubSpot is available on the hosted version.
        </p>
        <a href={HOSTING_DOCS_URL} target="_blank" rel="noopener noreferrer">
          How to host the builder with HubSpot sign-in <ExternalLink size={11} aria-hidden />
        </a>
      </div>
    );
  }
  return (
    <div className="ub-cn-note">
      <div className="ub-cn-note__title">
        <Info size={15} aria-hidden /> HubSpot sign-in isn't switched on yet
      </div>
      <p>
        The person who set up this builder needs to finish one step. Send them this link: <strong>the setup checklist</strong>. You can keep
        building with mock data in the meantime.
      </p>
      <p className="ub-cn-note__links">
        <a href={setupPageUrl()} target="_blank" rel="noopener noreferrer">
          Open the setup checklist <ExternalLink size={11} aria-hidden />
        </a>
        <a href={HOSTING_DOCS_URL} target="_blank" rel="noopener noreferrer">
          Read the hosting guide <ExternalLink size={11} aria-hidden />
        </a>
      </p>
    </div>
  );
}

/**
 * Shown under the button once the HubSpot window has been open for a while: where to finish, and a
 * way out when the window was closed or got stuck. After `stillWaitingMs` it says so and opens
 * "What does HubSpot show?" — HubSpot shows install refusals (Acceptable Use Policy not signed, no
 * permission to install apps …) inside its window and never comes back. Doesn't take focus (the
 * person may still be busy in the HubSpot window).
 */
export function WaitingPanel({ anchor }: { anchor: HTMLElement | null }) {
  const stillWaiting = useWaitingLong(true, CONNECT_TIMINGS.stillWaitingMs);
  // null: follow the timing (closed, then open once still waiting); a boolean once toggled by hand.
  const [helpOpen, setHelpOpen] = useState<boolean | null>(null);
  const showHelp = helpOpen ?? stillWaiting;
  const helpId = useId();
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const width = Math.min(showHelp ? 400 : 320, window.innerWidth - 16);
      const top = r.bottom + 6;
      setPos({ top, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)), width, maxHeight: Math.max(160, window.innerHeight - top - 12) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchor, showHelp]);
  return createPortal(
    <div
      className={cx('ub-cn-waiting', showHelp && 'ub-cn-waiting--help')}
      role="region"
      aria-label="Waiting for HubSpot"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: pos?.width, maxHeight: pos?.maxHeight }}
    >
      <div className="ub-cn-waiting__title" role="status">
        <LoaderCircle size={14} className="ub-cn-spin" aria-hidden /> {stillWaiting ? 'Still waiting for HubSpot…' : 'Waiting for HubSpot…'}
      </div>
      <p>Finish in the HubSpot window: sign in, choose your account and click Connect app.</p>
      <div className="ub-cn-waiting__actions">
        <Button size="sm" onClick={() => useConnection.getState().focusPopup()}>
          Show HubSpot window
        </Button>
        <Button size="sm" onClick={() => void useConnection.getState().restartConnect()}>
          Start again
        </Button>
        <Button size="sm" variant="ghost" onClick={() => useConnection.getState().cancelConnect()}>
          Cancel
        </Button>
      </div>
      <button type="button" className="ub-cn-disclosure ub-cn-waiting__toggle" aria-expanded={showHelp} aria-controls={helpId} onClick={() => setHelpOpen(!showHelp)}>
        {showHelp ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        {stillWaiting ? 'Having trouble? Tell us what HubSpot shows' : 'Having trouble?'}
      </button>
      <div id={helpId}>
        {showHelp && <SignInHelp waiting question="What does the HubSpot window show?" />}
      </div>
    </div>,
    document.body,
  );
}
