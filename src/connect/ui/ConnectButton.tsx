/**
 * Top-bar "Connect HubSpot" control. One button whose look follows the connection status:
 *  checking / unavailable – muted; explains that connecting needs the hosted version
 *  not-configured          – muted; explains what whoever hosts the builder must set up
 *  disconnected            – outlined "Connect HubSpot" (consent explainer before the first time)
 *  connecting              – spinner (click brings the HubSpot window forward) + Cancel
 *  connected               – account chip "acme.com · 12345678" opening the account menu
 *  error                   – "Connect HubSpot" with a warning; click retries
 */
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { IconButton, cx } from '../../ui';
import { useConnection, type ConnectionStatus } from '../store';
import { AccountMenu, accountInitial } from './AccountMenu';
import { ConnectDialog, connectExplained, markConnectExplained, type ConnectDialogMode } from './ConnectDialog';
import { HubSpotMark } from './HubSpotMark';
import { HOSTING_DOCS_URL, setupPageUrl } from './links';
import { Popover } from './Popover';
import './connect.css';

const TOOLTIP: Partial<Record<ConnectionStatus, string>> = {
  checking: 'Checking for a HubSpot connection…',
  unavailable: 'Available on the hosted version',
  'not-configured': 'Sign in with HubSpot is not set up on this server yet — click for details',
  disconnected: 'Connect your HubSpot account to preview with real data (read-only)',
  connecting: 'Waiting for you to finish in the HubSpot window — click to show it',
};

export function ConnectButton() {
  const status = useConnection((s) => s.status);
  const info = useConnection((s) => s.info);
  const health = useConnection((s) => s.health);
  const error = useConnection((s) => s.error);
  const errorCode = useConnection((s) => s.errorCode);
  const [dialog, setDialog] = useState<ConnectDialogMode | null>(null);
  const [panel, setPanel] = useState<'account' | 'info' | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // A sign-in that did not work out (popup or full-page): explain it and offer to try again.
  useEffect(() => {
    if (error && errorCode && (status === 'disconnected' || status === 'connected') && panel !== 'account') setDialog('result');
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
    markConnectExplained();
    setDialog(null);
    useConnection.getState().clearError();
    connectNow();
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
        <span className="ub-cn-btn__text">Connect HubSpot</span>
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
        aria-disabled={muted || undefined}
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
        <IconButton size="sm" label="Cancel connecting" onClick={() => useConnection.getState().cancelConnect()}>
          <X size={13} />
        </IconButton>
      )}
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
        <Info size={15} aria-hidden /> Sign in with HubSpot isn't set up yet
      </div>
      <p>
        The builder's server is running, but whoever hosts it still needs to create a HubSpot app and add its settings to the server (
        <code>HUBSPOT_CLIENT_ID</code>, <code>HUBSPOT_CLIENT_SECRET</code>, <code>SESSION_SECRET</code> and <code>APP_URL</code>). It takes about
        30 minutes and no coding.
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
