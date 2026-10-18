/**
 * The first-run screen (full window, over the editor): the welcome with its two choices, then the
 * guided setup —
 *   1. Connect HubSpot (the consent explainer in place, then the HubSpot sign-in window)
 *   2. Where should your card appear? (record type, place on the page)
 *   3. Pick a real record to preview with (optional) and what to start from
 * Finishing creates the card, previews it with the picked record and opens the editor (the tour
 * starts). The sample-data path skips step 1.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Building2,
  Check,
  CircleAlert,
  ExternalLink,
  FlaskConical,
  Handshake,
  LoaderCircle,
  LogIn,
  MousePointerClick,
  PartyPopper,
  Play,
  Rocket,
  Ticket,
  UserRound,
  X,
} from 'lucide-react';
import type { CardLocation } from '../model/types';
import { Badge, Button, cx, useToast } from '../ui';
import { CONNECT_TIMINGS, useConnection } from '../connect/store';
import { useObjectTypes, usePropertyCatalog } from '../connect/catalog';
import { describeAuthResult } from '../connect/describe';
import { findObjectTypeInfo } from '../connect/objectTypes';
import { ConsentDetails, markConnectExplained } from '../connect/ui/ConnectDialog';
import { useWaitingLong } from '../connect/ui/ConnectButton';
import { HubSpotMark } from '../connect/ui/HubSpotMark';
import { SignInHelp } from '../connect/ui/SignInHelp';
import { RecordSearch } from '../connect/ui/RecordPicker';
import { getConnectorClient } from '../connect/client';
import { setConnectResultsInline } from '../connect/ui/host';
import { setupPageUrl } from '../connect/ui/links';
import { LogoMark } from '../shell/TopBar';
import { Wireframe } from '../templates/Wireframe';
import { finishSetup } from './finish';
import { LocationIllustration } from './illustrations';
import {
  SETUP_STEPS,
  STEP_LABELS,
  autoPickedRecordTypes,
  currentStep,
  useOnboarding,
  type SetupChoices,
} from './store';
import {
  STANDARD_SETUP_TYPES,
  locationAllowed,
  setupRecordTypes,
  startersFor,
  type RecordTypeChoice,
  type StarterOption,
} from './starters';
import '../templates/templates.css';
import './onboarding.css';

const TITLE_ID = 'ub-ob-title';

/** Moves focus to the screen's heading whenever `key` changes (new screen or step). */
function useFocusHeading(key: string) {
  const ref = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [key]);
  return ref;
}

export function FirstRun() {
  const open = useOnboarding((s) => s.open);
  const view = useOnboarding((s) => s.view);
  // While this screen is up it reports sign-in results itself (not the top-bar button).
  useEffect(() => {
    setConnectResultsInline(open);
    return () => setConnectResultsInline(false);
  }, [open]);
  if (!open) return null;
  return (
    // data-uiex-exclusive: the editor's shortcuts (and the command palette) stay off while it is up.
    <div className="ub-ob" role="dialog" aria-modal="true" aria-labelledby={TITLE_ID} data-testid="first-run" data-uiex-exclusive="">
      {view === 'welcome' ? <WelcomeScreen /> : <SetupScreen />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Welcome
// ---------------------------------------------------------------------------

interface Availability {
  enabled: boolean;
  busy?: boolean;
  reason?: ReactNode;
}

/** Can the admin connect HubSpot here? (One plain line when not.) */
function useConnectAvailability(): Availability {
  const status = useConnection((s) => s.status);
  switch (status) {
    case 'checking':
      return { enabled: false, busy: true, reason: 'Checking whether HubSpot sign-in is available…' };
    case 'unavailable':
      return { enabled: false, reason: 'Not available in this copy of the builder — it runs without the HubSpot connection.' };
    case 'not-configured':
      return {
        enabled: false,
        reason: (
          <>
            HubSpot sign-in isn’t switched on here yet — whoever set up this builder needs to finish the{' '}
            <a href={setupPageUrl()} target="_blank" rel="noopener noreferrer">
              setup checklist
            </a>
            .
          </>
        ),
      };
    case 'error':
      return {
        enabled: false,
        reason: (
          <>
            Couldn’t reach the builder’s server.{' '}
            <button type="button" className="ub-ob-inline-link" onClick={() => void useConnection.getState().init()}>
              Check again
            </button>
          </>
        ),
      };
    default:
      return { enabled: true };
  }
}

function WelcomeScreen() {
  const heading = useFocusHeading('welcome');
  const availability = useConnectAvailability();
  const reasonId = useId();
  const choose = useOnboarding((s) => s.choosePath);
  const close = useOnboarding((s) => s.close);
  return (
    <div className="ub-ob-welcome">
      <header className="ub-ob-brand">
        <LogoMark size={28} />
        <span>UI Extension Builder for HubSpot</span>
      </header>
      <main className="ub-ob-welcome__main">
        <div className="ub-ob-hero" aria-hidden>
          <LocationIllustration location="crm.record.tab" />
        </div>
        <h1 id={TITLE_ID} ref={heading} tabIndex={-1} className="ub-ob-welcome__title">
          Build your own HubSpot cards
        </h1>
        <p className="ub-ob-welcome__promise">Design a card for your CRM records, see it with your real data, and publish it to HubSpot — no code, no terminal.</p>

        <div className="ub-ob-choices" role="group" aria-label="How do you want to start?">
          <button
            type="button"
            className={cx('ub-ob-bigchoice', 'ub-ob-bigchoice--primary', !availability.enabled && 'ub-ob-bigchoice--disabled')}
            aria-disabled={!availability.enabled || undefined}
            aria-describedby={availability.reason ? reasonId : undefined}
            onClick={() => availability.enabled && choose('hubspot')}
          >
            <span className="ub-ob-bigchoice__icon ub-ob-bigchoice__icon--hubspot" aria-hidden>
              {availability.busy ? <LoaderCircle size={22} className="ub-ob-spin" /> : <HubSpotMark size={22} />}
            </span>
            <span className="ub-ob-bigchoice__text">
              <span className="ub-ob-bigchoice__title">
                Connect my HubSpot <Badge tone="accent">Recommended</Badge>
              </span>
              <span className="ub-ob-bigchoice__body">See your card with your real records and properties. Read-only — nothing in HubSpot changes.</span>
            </span>
            <ArrowRight size={18} aria-hidden className="ub-ob-bigchoice__arrow" />
          </button>
          <button type="button" className="ub-ob-bigchoice" onClick={() => choose('sample')}>
            <span className="ub-ob-bigchoice__icon" aria-hidden>
              <FlaskConical size={22} />
            </span>
            <span className="ub-ob-bigchoice__text">
              <span className="ub-ob-bigchoice__title">Try it with sample data</span>
              <span className="ub-ob-bigchoice__body">Explore with made-up records. You can connect HubSpot any time later.</span>
            </span>
            <ArrowRight size={18} aria-hidden className="ub-ob-bigchoice__arrow" />
          </button>
        </div>
        {availability.reason && (
          <p id={reasonId} className="ub-ob-welcome__reason" role="status">
            {availability.busy ? null : <CircleAlert size={14} aria-hidden />}
            <span>{availability.reason}</span>
          </p>
        )}

        <button type="button" className="ub-ob-skip-link" onClick={() => close('skipped')}>
          I know what I’m doing <ArrowRight size={13} aria-hidden /> open the editor
        </button>
      </main>
      <footer className="ub-ob-how" aria-label="How it works">
        <ol>
          <li>
            <span className="ub-ob-how__num">1</span>
            <MousePointerClick size={15} aria-hidden /> Design your card
          </li>
          <li>
            <span className="ub-ob-how__num">2</span>
            <Play size={15} aria-hidden /> Preview it with real data
          </li>
          <li>
            <span className="ub-ob-how__num">3</span>
            <Rocket size={15} aria-hidden /> Publish to HubSpot
          </li>
        </ol>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guided setup
// ---------------------------------------------------------------------------

/** The record type the choices point at (label from the portal when known). */
function useChosenType(choices: SetupChoices): RecordTypeChoice {
  const { objectTypes } = useObjectTypes();
  return useMemo(() => {
    const all = setupRecordTypes(objectTypes);
    return all.find((t) => t.objectType === choices.objectType) ?? STANDARD_SETUP_TYPES[0];
  }, [objectTypes, choices.objectType]);
}

/** Starters for the chosen type and place, from the portal's real properties when connected. */
function useStarters(choices: SetupChoices, live: boolean): { starters: StarterOption[]; loadingProperties: boolean } {
  const type = useChosenType(choices);
  const { objectTypes } = useObjectTypes();
  const catalog = usePropertyCatalog(live ? choices.objectType : null);
  const info = live ? findObjectTypeInfo(choices.objectType, objectTypes) : undefined;
  const properties = live && catalog.connected ? catalog.properties : null;
  const starters = useMemo(
    () => startersFor({ type, location: choices.location, info, properties }),
    [type, choices.location, info, properties],
  );
  return { starters, loadingProperties: live && catalog.loading };
}

function SetupScreen() {
  const path = useOnboarding((s) => s.path);
  const step = useOnboarding((s) => s.step);
  const choices = useOnboarding((s) => s.choices);
  const stepId = currentStep({ path, step });
  const steps = SETUP_STEPS[path];
  const heading = useFocusHeading(`${path}-${stepId}`);
  const toast = useToast();
  const connected = useConnection((s) => s.status === 'connected' && s.info.connected);
  const info = useConnection((s) => s.info);
  const live = path === 'hubspot' && connected;
  const { starters, loadingProperties } = useStarters(choices, live);
  const selectedStarter = starters.find((s) => s.id === choices.starterId) ?? starters[0];

  const canContinue = stepId === 'connect' ? connected : stepId === 'where' ? locationAllowed(choices.location, choices.objectType) : !!selectedStarter;

  const finish = () => {
    if (!selectedStarter) return;
    const portalId = live && info.connected ? info.portalId : null;
    const result = finishSetup({ starter: selectedStarter, portalId, record: portalId !== null ? choices.record : null });
    if (!result.ok) {
      toast(result.message);
      return;
    }
    if (path === 'hubspot') markConnectExplained();
    const onboarding = useOnboarding.getState();
    onboarding.close('completed');
    onboarding.startTour();
    const record = portalId !== null ? choices.record : null;
    toast(
      `${record ? `Your card is ready — previewing with ${record.label || `record ${record.id}`}.` : 'Your card is ready.'}${
        result.keptPrevious ? ' Your previous project is in Project › Open….' : ''
      }`,
      { durationMs: 6000 },
    );
  };

  const onNext = () => {
    if (!canContinue) return;
    if (stepId === 'start') finish();
    else useOnboarding.getState().next();
  };

  const titles: Record<typeof stepId, string> = {
    connect: connected ? 'You’re connected' : 'Connect your HubSpot account',
    where: 'Where should your card appear?',
    start: live ? 'Pick a real record and a starting point' : 'Choose a starting point',
  };

  return (
    <div className="ub-ob-setup">
      <header className="ub-ob-setup__head">
        <div className="ub-ob-brand">
          <LogoMark size={24} />
          <span>Set up your first card</span>
        </div>
        <ol className="ub-ob-progress" aria-label={`Setup progress: step ${step + 1} of ${steps.length}`}>
          {steps.map((id, i) => (
            <li
              key={id}
              className={cx('ub-ob-progress__step', i < step && 'ub-ob-progress__step--done', i === step && 'ub-ob-progress__step--current')}
              aria-current={i === step ? 'step' : undefined}
            >
              <span className="ub-ob-progress__dot" aria-hidden>
                {i < step ? <Check size={11} /> : i + 1}
              </span>
              <span className="ub-ob-progress__label">{STEP_LABELS[id]}</span>
              <span className="ub-sr-only">{i < step ? ' (done)' : i === step ? ' (current step)' : ''}</span>
            </li>
          ))}
        </ol>
        <Button variant="ghost" size="sm" icon={<X size={14} aria-hidden />} onClick={() => useOnboarding.getState().close('skipped')} title="Skip the setup and open the editor">
          Skip setup
        </Button>
      </header>

      <main className="ub-ob-setup__body">
        <div className={cx('ub-ob-setup__content', stepId === 'start' && live && 'ub-ob-setup__content--wide')}>
          <p className="ub-ob-setup__count">
            Step {step + 1} of {steps.length}
          </p>
          <h1 id={TITLE_ID} ref={heading} tabIndex={-1} className="ub-ob-setup__title">
            {titles[stepId]}
          </h1>
          {stepId === 'connect' && <ConnectStep />}
          {stepId === 'where' && <WhereStep live={live} />}
          {stepId === 'start' && <StartStep live={live} starters={starters} selectedId={selectedStarter?.id ?? ''} loadingProperties={loadingProperties} />}
        </div>
      </main>

      <footer className="ub-ob-setup__foot">
        <Button icon={<ArrowLeft size={14} aria-hidden />} onClick={() => useOnboarding.getState().back()}>
          Back
        </Button>
        <span className="ub-ob-setup__foot-note" aria-live="polite">
          {stepId === 'connect' && !connected ? 'Connect HubSpot to continue' : ''}
        </span>
        <Button variant="primary" disabled={!canContinue} onClick={onNext}>
          {stepId === 'start' ? (
            <>
              <PartyPopper size={14} aria-hidden /> Create my card
            </>
          ) : (
            <>
              Next <ArrowRight size={14} aria-hidden />
            </>
          )}
        </Button>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1: Connect
// ---------------------------------------------------------------------------

function ConnectStep() {
  const status = useConnection((s) => s.status);
  const info = useConnection((s) => s.info);
  const error = useConnection((s) => s.error);
  const errorCode = useConnection((s) => s.errorCode);
  const errorSource = useConnection((s) => s.errorSource);
  const choose = useOnboarding((s) => s.choosePath);
  const stillWaiting = useWaitingLong(status === 'connecting', CONNECT_TIMINGS.stillWaitingMs);

  const connect = () => {
    markConnectExplained();
    useConnection.getState().clearError();
    // Opens the HubSpot window synchronously (inside the click), so it isn't blocked.
    void useConnection.getState().connect();
  };

  if (status === 'connected' && info.connected) {
    const name = info.hubDomain || `HubSpot account ${info.portalId}`;
    return (
      <div className="ub-ob-connected" role="status">
        <span className="ub-ob-connected__icon" aria-hidden>
          <Check size={20} />
        </span>
        <div>
          <div className="ub-ob-connected__title">Connected to {name}</div>
          <div className="ub-ob-connected__meta">
            Account {info.portalId}
            {info.user.email ? ` · signed in as ${info.user.email}` : ''}
          </div>
          <p className="ub-ob-connected__next">Next, tell us where your card should appear.</p>
          <button type="button" className="ub-ob-inline-link" onClick={() => void useConnection.getState().switchPortal()}>
            Use a different HubSpot account
          </button>
        </div>
      </div>
    );
  }

  if (status === 'unavailable' || status === 'not-configured') {
    return (
      <div className="ub-ob-panel">
        <p>
          {status === 'unavailable'
            ? 'This copy of the builder runs without its HubSpot connection, so it can’t sign in to HubSpot.'
            : 'HubSpot sign-in isn’t switched on for this builder yet. The person who set it up needs to finish the setup checklist.'}
        </p>
        <Button variant="primary" icon={<FlaskConical size={14} aria-hidden />} onClick={() => choose('sample')}>
          Use sample data instead
        </Button>
      </div>
    );
  }

  const failed = !!error && errorSource === 'sign-in' && status !== 'connecting';
  const failure = failed ? describeAuthResult(errorCode ?? 'unknown_error', error ?? undefined) : null;
  // The window closed or timed out: HubSpot showed its reason inside it, so ask what it showed.
  const trouble = failed && (errorCode === 'popup_closed' || errorCode === 'timeout');
  const blocked = failed && errorCode === 'popup_blocked';

  return (
    <div className="ub-ob-connect">
      <p className="ub-ob-lead">
        Connecting lets the builder show your card with <strong>real records</strong> from your HubSpot account, and offer your own properties
        and record types by name.
      </p>
      <ConsentDetails compact />

      <div className="ub-ob-connect__action">
        {status === 'connecting' ? (
          <div className="ub-ob-waiting" role="status">
            <div className="ub-ob-waiting__title">
              <LoaderCircle size={16} className="ub-ob-spin" aria-hidden /> {stillWaiting ? 'Still waiting for HubSpot…' : 'Waiting for HubSpot…'}
            </div>
            <p>A HubSpot window is open. Choose your account there and approve — then come back here.</p>
            <div className="ub-ob-row">
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
            {stillWaiting && <SignInHelp waiting question="What does the HubSpot window show?" className="ub-ob-signin-help" />}
          </div>
        ) : (
          <>
            {failure && (
              <div className="ub-ob-alert" role="alert">
                <CircleAlert size={16} aria-hidden />
                <div>
                  <strong>{failure.title}</strong>
                  {!trouble && <span>{error ?? failure.message}</span>}
                </div>
              </div>
            )}
            {trouble && <SignInHelp className="ub-ob-signin-help" />}
            {blocked ? (
              <div className="ub-ob-row">
                <Button variant="primary" className="ub-ob-connect__btn" icon={<LogIn size={16} aria-hidden />} onClick={() => void useConnection.getState().connectInThisTab()}>
                  Continue in this tab
                </Button>
                <Button className="ub-ob-connect__btn" onClick={connect}>
                  Try the window again
                </Button>
              </div>
            ) : (
              <Button variant="primary" className="ub-ob-connect__btn" icon={<HubSpotMark size={16} />} onClick={connect}>
                {failure ? 'Try again' : 'Connect HubSpot'}
              </Button>
            )}
            <p className="ub-ob-muted">
              <ExternalLink size={12} aria-hidden /> A HubSpot window opens. Choose your account and approve — then come back here.
            </p>
          </>
        )}
      </div>
      <p className="ub-ob-muted">
        Can’t connect right now?{' '}
        <button type="button" className="ub-ob-inline-link" onClick={() => choose('sample')}>
          Continue with sample data
        </button>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Where should your card appear?
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<string, ReactNode> = {
  '0-1': <UserRound size={20} aria-hidden />,
  '0-2': <Building2 size={20} aria-hidden />,
  '0-3': <Handshake size={20} aria-hidden />,
  '0-5': <Ticket size={20} aria-hidden />,
};

export const LOCATION_CHOICES: Array<{ value: CardLocation; title: string; body: string }> = [
  { value: 'crm.record.tab', title: 'Middle of the record page', body: 'A card in the main column. The most room — best for details, tables and forms.' },
  { value: 'crm.record.sidebar', title: 'Right sidebar', body: 'A narrow card next to the record — good for quick facts and actions.' },
  { value: 'crm.preview', title: 'Preview panel', body: 'The side panel that opens when you click a record’s name in a list.' },
  { value: 'helpdesk.sidebar', title: 'Help desk', body: 'Next to the conversation when you work on a ticket in the help desk.' },
];

function WhereStep({ live }: { live: boolean }) {
  const choices = useOnboarding((s) => s.choices);
  const setChoices = useOnboarding((s) => s.setChoices);
  const { objectTypes, loading, error } = useObjectTypes();
  const types = live ? setupRecordTypes(objectTypes) : STANDARD_SETUP_TYPES;
  const ids = useId();

  const pickType = (t: RecordTypeChoice) => {
    const patch: Partial<SetupChoices> = { objectType: t.objectType, objectTypeId: t.objectTypeId, record: null, starterId: '' };
    if (!locationAllowed(choices.location, t.objectType)) patch.location = 'crm.record.tab';
    setChoices(patch);
  };

  return (
    <div className="ub-ob-where">
      <fieldset className="ub-ob-fieldset">
        <legend className="ub-ob-legend">Which records is it for?</legend>
        <p className="ub-ob-hint" id={`${ids}-types-hint`}>
          {live ? 'Your card shows up on records of this type. Custom objects from your account are listed too.' : 'Your card shows up on records of this type.'}
        </p>
        <div className="ub-ob-grid ub-ob-grid--types">
          {types.map((t) => (
            <label key={t.objectType} className="ub-ob-choice ub-ob-choice--type">
              <input
                type="radio"
                name={`${ids}-type`}
                className="ub-ob-choice__input"
                checked={choices.objectType === t.objectType}
                onChange={() => pickType(t)}
              />
              <span className="ub-ob-choice__body">
                <span className="ub-ob-choice__icon">{TYPE_ICONS[t.objectTypeId ?? ''] ?? <Boxes size={20} aria-hidden />}</span>
                <span className="ub-ob-choice__label">
                  <span className="ub-ob-choice__title">{t.plural}</span>
                  {!TYPE_ICONS[t.objectTypeId ?? ''] && <span className="ub-ob-choice__note">Custom object</span>}
                </span>
              </span>
            </label>
          ))}
        </div>
        {live && loading && (
          <p className="ub-ob-hint" role="status">
            <LoaderCircle size={12} className="ub-ob-spin" aria-hidden /> Looking for your custom objects…
          </p>
        )}
        {live && error && <p className="ub-ob-hint">Your custom objects couldn’t be listed ({error}) — the standard ones work.</p>}
      </fieldset>

      <fieldset className="ub-ob-fieldset">
        <legend className="ub-ob-legend">Where on the page?</legend>
        <div className="ub-ob-grid ub-ob-grid--places">
          {LOCATION_CHOICES.map((loc) => {
            const allowed = locationAllowed(loc.value, choices.objectType);
            return (
              <label key={loc.value} className={cx('ub-ob-choice', 'ub-ob-choice--place', !allowed && 'ub-ob-choice--disabled')}>
                <input
                  type="radio"
                  name={`${ids}-place`}
                  className="ub-ob-choice__input"
                  checked={choices.location === loc.value}
                  disabled={!allowed}
                  aria-labelledby={`${ids}-${loc.value}-title`}
                  aria-describedby={`${ids}-${loc.value}-body`}
                  onChange={() => setChoices({ location: loc.value, starterId: '' })}
                />
                <span className="ub-ob-choice__body">
                  <LocationIllustration location={loc.value} />
                  <span className="ub-ob-choice__title" id={`${ids}-${loc.value}-title`}>
                    {loc.title}
                  </span>
                  <span className="ub-ob-choice__text" id={`${ids}-${loc.value}-body`}>
                    {allowed ? loc.body : 'Only for tickets — choose Tickets above to use the help desk.'}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="ub-ob-hint">You can change both later in the card’s settings.</p>
      </fieldset>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: sample record + starting point
// ---------------------------------------------------------------------------

/**
 * Real data by default: once per record type, the most recently updated record is picked as the
 * sample (the admin can change it). Nothing is picked when the account has no such records.
 */
function useDefaultSampleRecord(live: boolean, objectType: string): void {
  useEffect(() => {
    if (!live || autoPickedRecordTypes.has(objectType) || useOnboarding.getState().choices.record) return;
    const controller = new AbortController();
    getConnectorClient()
      .searchRecords(objectType, '', { limit: 1, signal: controller.signal })
      .then(
        (list) => {
          const first = Array.isArray(list) ? list[0] : undefined;
          const now = useOnboarding.getState().choices;
          autoPickedRecordTypes.add(objectType);
          if (first && !now.record && now.objectType === objectType) useOnboarding.getState().setChoices({ record: first });
        },
        () => {
          /* the search below shows what went wrong */
        },
      );
    return () => controller.abort();
  }, [live, objectType]);
}

function StartStep({ live, starters, selectedId, loadingProperties }: { live: boolean; starters: StarterOption[]; selectedId: string; loadingProperties: boolean }) {
  const choices = useOnboarding((s) => s.choices);
  const setChoices = useOnboarding((s) => s.setChoices);
  const type = useChosenType(choices);
  const { objectTypes } = useObjectTypes();
  const ids = useId();
  const singular = type.singular.toLowerCase();
  useDefaultSampleRecord(live, choices.objectType);

  return (
    <div className={cx('ub-ob-start', live && 'ub-ob-start--split')}>
      {live ? (
        <section className="ub-ob-section" aria-labelledby={`${ids}-record`}>
          <h2 className="ub-ob-legend" id={`${ids}-record`}>
            {choices.record ? (
              `Previewing with a real ${singular}`
            ) : (
              <>
                Pick a real {singular} to preview with <span className="ub-ob-optional">optional</span>
              </>
            )}
          </h2>
          <p className="ub-ob-hint">Your card will show this {singular}’s real data while you build. Nothing in HubSpot changes.</p>
          {choices.record ? (
            <div className="ub-ob-picked" aria-label={`Previewing with ${choices.record.label || `record ${choices.record.id}`}`}>
              <span className="ub-ob-picked__dot" aria-hidden />
              <span className="ub-ob-picked__text">
                <strong>{choices.record.label || `Record ${choices.record.id}`}</strong>
                {choices.record.secondary && <span>{choices.record.secondary}</span>}
              </span>
              <Button size="sm" onClick={() => setChoices({ record: null })}>
                Change
              </Button>
            </div>
          ) : (
            <div className="ub-ob-record-search">
              <RecordSearch
                objectType={choices.objectType}
                known={objectTypes}
                inputId={`${ids}-search`}
                offerMock={false}
                onPick={(record) => setChoices({ record })}
              />
              <p className="ub-ob-hint">Skip this and your card shows sample values until you pick a record above the card.</p>
            </div>
          )}
        </section>
      ) : (
        <p className="ub-ob-lead">
          Your card will show made-up {type.plural.toLowerCase()} so you can see how it looks. Connect HubSpot later to see your real records.
        </p>
      )}

      <fieldset className="ub-ob-fieldset">
        <legend className="ub-ob-legend">Start from…</legend>
        <p className="ub-ob-hint">
          {loadingProperties ? (
            <>
              <LoaderCircle size={12} className="ub-ob-spin" aria-hidden /> Reading your {singular} properties…
            </>
          ) : (
            `Ready-made cards for ${type.plural.toLowerCase()} that fit where you chose. You can change everything afterwards.`
          )}
        </p>
        <div className="ub-ob-grid ub-ob-grid--starters">
          {starters.map((s) => (
            <label key={s.id} className="ub-ob-choice ub-ob-choice--starter" data-starter={s.id}>
              <input
                type="radio"
                name={`${ids}-starter`}
                className="ub-ob-choice__input"
                checked={selectedId === s.id}
                aria-labelledby={`${ids}-${s.id}-title`}
                aria-describedby={`${ids}-${s.id}-text`}
                onChange={() => setChoices({ starterId: s.id })}
              />
              <span className="ub-ob-choice__body">
                <span className="ub-ob-choice__thumb" aria-hidden>
                  {s.preview.length ? <Wireframe nodes={s.preview} size="sm" /> : <span className="ub-ob-choice__blank">+</span>}
                </span>
                <span className="ub-ob-choice__title" id={`${ids}-${s.id}-title`}>
                  {s.name} {s.badge && <Badge tone={s.badge === 'Your real properties' ? 'success' : undefined}>{s.badge}</Badge>}
                </span>
                <span className="ub-ob-choice__text" id={`${ids}-${s.id}-text`}>
                  {s.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
