/**
 * "What did HubSpot show?" — a short chooser for a sign-in that ended without a result (the HubSpot
 * window closed, or is still open and stuck). HubSpot shows install refusals inside its own window
 * and never comes back, so the person picks what they saw and gets the exact fix: the steps, the
 * right links, "Continue in this tab", and — when someone else has to fix it — a note to send them
 * (Copy a note for whoever set up this builder / for your Super Admin). Content: ../signInHelp.ts.
 *
 * Used by the result dialog of the top-bar Connect button, the "Still waiting for HubSpot…" panel,
 * and anywhere else a sign-in result is shown (the guided setup).
 */
import { useEffect, useId, useRef, useState } from 'react';
import { ExternalLink, LogIn, RotateCcw } from 'lucide-react';
import { Button, TextArea, cx } from '../../ui';
import { signInFix, signInTroubleChoices, type SignInFix, type SignInTrouble } from '../signInHelp';
import { useConnection } from '../store';
import { reportSignInFeedback } from '../../status/reporter';
import { CopyNote } from './CopyNote';
import { HOSTING_DOCS_URL, setupPageUrl } from './links';

export interface SignInHelpProps {
  /** The HubSpot window is still open (the waiting panel): no "I closed it" choice. */
  waiting?: boolean;
  /** The choice selected at first (none by default). */
  initial?: SignInTrouble | null;
  /** Called whenever the choice changes (a dialog can adapt its footer). */
  onChoose?: (kind: SignInTrouble) => void;
  /** Show a "Try again" button with the fix (when the surrounding UI has none). */
  onTryAgain?: () => void;
  tryAgainLabel?: string;
  /** Show "Continue in this tab" with the fix when it helps (default true). */
  showContinue?: boolean;
  /** The question (default "What did HubSpot show?"). */
  question?: string;
  className?: string;
}

/** The context the help text needs (addresses of this builder and its setup page). */
export function signInHelpContext(details?: string) {
  return {
    builderUrl: typeof window !== 'undefined' ? window.location.origin : '',
    setupUrl: absolute(setupPageUrl()),
    docsUrl: HOSTING_DOCS_URL,
    details,
  };
}

function absolute(url: string): string {
  try {
    return new URL(url, window.location.href).toString();
  } catch {
    return url;
  }
}

const WHO_NOTE: Record<SignInFix['who'], string> = {
  you: '',
  host: 'Copy a note for whoever set up this builder',
  super_admin: 'Copy a note for your Super Admin',
};

const WHO_BADGE: Record<SignInFix['who'], string> = {
  you: 'You can fix this',
  host: 'Fixed by whoever set up this builder',
  super_admin: 'Fixed by a Super Admin of your HubSpot account',
};

export function SignInHelp({ waiting = false, initial = null, onChoose, onTryAgain, tryAgainLabel = 'Try again', showContinue = true, question = 'What did HubSpot show?', className }: SignInHelpProps) {
  const ids = useId();
  const [kind, setKind] = useState<SignInTrouble | null>(initial);
  const [details, setDetails] = useState('');
  const choices = signInTroubleChoices(waiting);
  const fix = kind ? signInFix(kind, signInHelpContext(details)) : null;

  const choose = (k: SignInTrouble) => {
    setKind(k);
    onChoose?.(k);
    // Lets the host's status page name the cause instead of only "never came back".
    reportSignInFeedback(k);
  };

  return (
    <div className={cx('ub-cn-help', kind && 'ub-cn-help--chosen', className)}>
      <fieldset className="ub-cn-help__choices">
        <legend className="ub-cn-help__question">{question}</legend>
        {choices.map((c) => (
          <label key={c.kind} className={cx('ub-cn-help__choice', kind === c.kind && 'ub-cn-help__choice--on')}>
            <input type="radio" name={`${ids}-trouble`} value={c.kind} checked={kind === c.kind} onChange={() => choose(c.kind)} />
            <span className="ub-cn-help__choice-text">
              <span className="ub-cn-help__choice-label">{c.label}</span>
              {c.hint && <span className="ub-cn-help__choice-hint">{c.hint}</span>}
            </span>
          </label>
        ))}
      </fieldset>
      <div aria-live="polite">
        {fix && kind && (
          <FixPanel
            key={kind}
            kind={kind}
            fix={fix}
            details={details}
            onDetails={setDetails}
            onTryAgain={onTryAgain}
            tryAgainLabel={tryAgainLabel}
            showContinue={showContinue}
          />
        )}
      </div>
    </div>
  );
}

function FixPanel({
  kind,
  fix,
  details,
  onDetails,
  onTryAgain,
  tryAgainLabel,
  showContinue,
}: {
  kind: SignInTrouble;
  fix: SignInFix;
  details: string;
  onDetails: (v: string) => void;
  onTryAgain?: () => void;
  tryAgainLabel: string;
  showContinue: boolean;
}) {
  const ids = useId();
  const panelRef = useRef<HTMLElement>(null);

  // Bring the fix into view when it appears (dialogs and the waiting panel scroll).
  useEffect(() => {
    panelRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, []);

  const inTab = fix.continueInTab && showContinue;
  return (
    <section ref={panelRef} className={cx('ub-cn-fix', `ub-cn-fix--${fix.who}`)} aria-labelledby={`${ids}-title`}>
      <div className="ub-cn-fix__who">{WHO_BADGE[fix.who]}</div>
      <h3 className="ub-cn-fix__title" id={`${ids}-title`}>
        {fix.title}
      </h3>
      <p className="ub-cn-fix__summary">{fix.summary}</p>
      {fix.steps.length > 0 &&
        (kind === 'other' ? (
          <ul className="ub-cn-fix__steps ub-cn-fix__steps--bullets">
            {fix.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        ) : (
          <ol className="ub-cn-fix__steps">
            {fix.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        ))}
      {kind === 'other' && (
        <label className="ub-cn-fix__details">
          <span>What did HubSpot say? (optional — it goes into the note)</span>
          <TextArea rows={2} value={details} onChange={onDetails} placeholder="Type or paste HubSpot’s message" />
        </label>
      )}
      {fix.note && <CopyNote note={fix.note} label={WHO_NOTE[fix.who]} recipient={fix.who === 'super_admin' ? 'a Super Admin of your HubSpot account' : 'whoever set up this builder'} />}
      {(inTab || onTryAgain) && (
        <div className="ub-cn-fix__actions">
          {inTab && (
            <Button size="sm" variant="primary" icon={<LogIn size={13} aria-hidden />} onClick={() => void useConnection.getState().connectInThisTab()}>
              Continue in this tab
            </Button>
          )}
          {onTryAgain && (
            <Button size="sm" icon={<RotateCcw size={13} aria-hidden />} onClick={onTryAgain}>
              {tryAgainLabel}
            </Button>
          )}
        </div>
      )}
      {fix.links.length > 0 && (
        <p className="ub-cn-fix__links">
          {fix.links.map((l) => (
            <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer">
              {l.label} <ExternalLink size={11} aria-hidden />
              <span className="ub-sr-only"> (opens in a new tab)</span>
            </a>
          ))}
        </p>
      )}
    </section>
  );
}
