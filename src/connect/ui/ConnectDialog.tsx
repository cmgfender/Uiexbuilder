/**
 * The consent explainer shown before the first "Connect HubSpot" (what the builder will see, what
 * it never does, how to revoke), and the result of a sign-in that did not work out:
 *  - the HubSpot window closed (or timed out) without a result → "What did HubSpot show?" with the
 *    fix for each case (SignInHelp);
 *  - the browser blocked the window → one click to continue in this tab;
 *  - anything else → what happened and Try again.
 */
import { useId, useState } from 'react';
import { Check, ChevronDown, ChevronRight, CircleAlert, ExternalLink, LogIn, ShieldCheck, X } from 'lucide-react';
import { Button, Dialog } from '../../ui';
import { describeAuthResult, scopeLabel } from '../describe';
import { signInFix, type SignInTrouble } from '../signInHelp';
import { useConnection } from '../store';
import { HubSpotMark } from './HubSpotMark';
import { SignInHelp, signInHelpContext } from './SignInHelp';

export type ConnectDialogMode = 'consent' | 'result';

const EXPLAINED_KEY = 'uiex-builder:hubspot-connect-explained';

/** Whether the consent explainer was shown in this browser before (not sensitive). */
export function connectExplained(): boolean {
  try {
    return window.localStorage.getItem(EXPLAINED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markConnectExplained(): void {
  try {
    window.localStorage.setItem(EXPLAINED_KEY, '1');
  } catch {
    /* storage unavailable: the explainer shows again next time */
  }
}

export interface ConnectDialogProps {
  open: boolean;
  mode: ConnectDialogMode;
  onClose: () => void;
  /** "Continue to HubSpot" / "Try again". Must open the sign-in window synchronously. */
  onContinue: () => void;
}

export function ConnectDialog({ open, mode, onClose, onContinue }: ConnectDialogProps) {
  const error = useConnection((s) => s.error);
  const errorCode = useConnection((s) => s.errorCode);
  const errorSource = useConnection((s) => s.errorSource);

  if (mode === 'result' && errorSource === 'sign-out') {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title="Couldn't disconnect HubSpot"
        footer={
          <>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={onContinue}>
              Try again
            </Button>
          </>
        }
      >
        <div className="ub-cn-dialog">
          <p className="ub-cn-dialog__result" role="alert">
            <CircleAlert size={16} aria-hidden className="ub-cn-dialog__result-icon" />
            <span>{error ?? 'Something went wrong while disconnecting. Please try again.'}</span>
          </p>
          <p className="ub-cn-dialog__muted">
            You're still connected. You can also remove the builder's access in HubSpot under Settings › Integrations › Connected apps.
          </p>
        </div>
      </Dialog>
    );
  }

  if (mode === 'result' && errorCode === 'popup_blocked') return <BlockedDialog open={open} onClose={onClose} onContinue={onContinue} />;
  if (mode === 'result' && (errorCode === 'popup_closed' || errorCode === 'timeout')) {
    return <TroubleDialog open={open} timedOut={errorCode === 'timeout'} onClose={onClose} onContinue={onContinue} />;
  }

  if (mode === 'result') {
    const d = describeAuthResult(errorCode ?? 'unknown_error', error ?? undefined);
    return (
      <Dialog
        open={open}
        onClose={onClose}
        title={d.title}
        footer={
          <>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" icon={<HubSpotMark />} onClick={onContinue}>
              Try again
            </Button>
          </>
        }
      >
        <div className="ub-cn-dialog">
          <p className="ub-cn-dialog__result" role="alert">
            <CircleAlert size={16} aria-hidden className="ub-cn-dialog__result-icon" />
            <span>{error ?? d.message}</span>
          </p>
          <p className="ub-cn-dialog__muted">Nothing in your HubSpot account was changed. You can keep building with mock data in the meantime.</p>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Connect your HubSpot account"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<HubSpotMark />} onClick={onContinue}>
            Continue to HubSpot
          </Button>
        </>
      }
    >
      <div className="ub-cn-dialog">
        <p>
          Connecting lets the builder preview your card with <strong>real records</strong> from your HubSpot account and list your own
          properties, pipelines and record types when you build.
        </p>
        <ConsentDetails />
        <p className="ub-cn-dialog__muted">
          <ExternalLink size={12} aria-hidden /> A HubSpot window opens. Choose your account and approve — then come back here.
        </p>
      </div>
    </Dialog>
  );
}

/** Leaves the dialog and signs in in this tab (full-page sign-in that comes back here). */
function continueInThisTab(onClose: () => void): void {
  onClose();
  void useConnection.getState().connectInThisTab();
}

/** The browser blocked the HubSpot window: nothing happened yet; one click continues in this tab. */
function BlockedDialog({ open, onClose, onContinue }: Pick<ConnectDialogProps, 'open' | 'onClose' | 'onContinue'>) {
  const host = typeof window !== 'undefined' ? window.location.host : 'this site';
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Your browser blocked the HubSpot window"
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button onClick={onContinue}>Try the window again</Button>
          <Button variant="primary" icon={<LogIn size={14} aria-hidden />} onClick={() => continueInThisTab(onClose)}>
            Continue in this tab
          </Button>
        </>
      }
    >
      <div className="ub-cn-dialog">
        <p>
          No problem — nothing happened yet. <strong>Continue in this tab</strong> instead: you go to HubSpot, approve, and come straight back here.
          Your work is saved.
        </p>
        <p className="ub-cn-dialog__hint">
          Prefer the window? Allow pop-ups for <strong>{host}</strong> (your browser shows a blocked pop-up icon at the end of the address bar),
          then click Try the window again.
        </p>
      </div>
    </Dialog>
  );
}

/**
 * The HubSpot window closed (or the wait timed out) without a result. HubSpot shows its refusals
 * inside that window and never comes back, so ask what it showed and give the fix.
 */
function TroubleDialog({ open, timedOut, onClose, onContinue }: Pick<ConnectDialogProps, 'open' | 'onClose' | 'onContinue'> & { timedOut: boolean }) {
  const [choice, setChoice] = useState<SignInTrouble | null>(null);
  const fix = choice ? signInFix(choice, signInHelpContext()) : null;
  // The fix decides the main button: continue in this tab, or try again (only worth it right away
  // when the person can fix it themselves).
  const inTab = !!fix?.continueInTab;
  const retryFirst = !fix || fix.who === 'you';
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={timedOut ? 'Connecting took too long' : 'HubSpot was not connected'}
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          {inTab ? (
            <>
              <Button onClick={onContinue}>Try the window again</Button>
              <Button variant="primary" icon={<LogIn size={14} aria-hidden />} onClick={() => continueInThisTab(onClose)}>
                Continue in this tab
              </Button>
            </>
          ) : (
            <Button variant={retryFirst ? 'primary' : 'default'} icon={<HubSpotMark />} onClick={onContinue}>
              Try again
            </Button>
          )}
        </>
      }
    >
      <div className="ub-cn-dialog ub-cn-dialog--full">
        <p className="ub-cn-dialog__lead">
          {timedOut ? 'We stopped waiting for HubSpot' : 'The HubSpot window closed before connecting finished'}, so nothing was shared or changed.
          HubSpot shows its messages inside that window, where the builder can’t see them — tell us what you saw and we’ll show you the fix.
        </p>
        <SignInHelp showContinue={false} onChoose={setChoice} />
      </div>
    </Dialog>
  );
}

/**
 * What connecting allows and never does, how to stay in control, the exact permissions and the
 * Super Admin note — shared by the consent dialog and the guided setup's Connect step.
 */
export function ConsentDetails({ compact = false }: { compact?: boolean }) {
  const health = useConnection((s) => s.health);
  const [showScopes, setShowScopes] = useState(false);
  const idBase = useId();
  const required = health?.scopes.required ?? [];
  const optional = health?.scopes.optional ?? [];
  return (
    <div className={compact ? 'ub-cn-consent ub-cn-consent--compact' : 'ub-cn-consent'}>
      <div className="ub-cn-consent__columns">
        <section className="ub-cn-dialog__section" aria-labelledby={`${idBase}-can`}>
          <h3 id={`${idBase}-can`} className="ub-cn-dialog__heading">
            The builder will be able to
          </h3>
          <ul className="ub-cn-dialog__list ub-cn-dialog__list--yes">
            <li>
              <Check size={14} aria-hidden /> <span>Read the records you pick as samples (contacts, companies, deals…) to show them in the preview</span>
            </li>
            <li>
              <Check size={14} aria-hidden /> <span>Read your property definitions, dropdown options, pipelines and record types, so you can choose them by name</span>
            </li>
          </ul>
        </section>

        <section className="ub-cn-dialog__section" aria-labelledby={`${idBase}-never`}>
          <h3 id={`${idBase}-never`} className="ub-cn-dialog__heading">
            It will never
          </h3>
          <ul className="ub-cn-dialog__list ub-cn-dialog__list--no">
            <li>
              <X size={14} aria-hidden /> <span>Create, change or delete anything in HubSpot — access is read-only</span>
            </li>
            <li>
              <X size={14} aria-hidden /> <span>Store your CRM data on a server — records are fetched when you preview and shown only in your browser</span>
            </li>
          </ul>
        </section>
      </div>

      <p className="ub-cn-dialog__note">
        <ShieldCheck size={15} aria-hidden />
        <span>
          You stay in control: disconnect any time from the account menu, or remove access in HubSpot under{' '}
          <strong>Settings › Integrations › Connected apps</strong>.
        </span>
      </p>

      {required.length + optional.length > 0 && (
        <div className="ub-cn-dialog__scopes">
          <button type="button" className="ub-cn-disclosure" aria-expanded={showScopes} onClick={() => setShowScopes((v) => !v)}>
            {showScopes ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
            Exact permissions HubSpot will ask for
          </button>
          {showScopes && (
            <div className="ub-cn-scope-groups">
              {required.length > 0 && (
                <div>
                  <div className="ub-cn-scope-groups__title">Needed</div>
                  <ul className="ub-cn-scope-list">
                    {required.map((s) => (
                      <li key={s} title={s}>
                        {scopeLabel(s)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {optional.length > 0 && (
                <div>
                  <div className="ub-cn-scope-groups__title">Only if your account has them</div>
                  <ul className="ub-cn-scope-list">
                    {optional.map((s) => (
                      <li key={s} title={s}>
                        {scopeLabel(s)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <p className="ub-cn-dialog__admins">
        <strong>First time your company connects?</strong> HubSpot only lets Super Admins (or users with App Marketplace access) approve a new
        app. If HubSpot says you can’t, ask one of them to connect once — after that everyone can.
      </p>
    </div>
  );
}
