/**
 * First-run experience state: the welcome screen, the guided setup (connect → where should the
 * card appear → sample record and starter) and the coach-mark tour.
 *
 * Shown once per browser: the welcome opens on a first visit and never again once the setup was
 * completed or skipped (`uiex-builder:first-run`). Returning users — someone who dismissed the old
 * welcome card or already has a saved project — never see it. Help › Getting started reopens it,
 * Help › Take the tour replays the tour, and `?welcome=1` in the address forces the welcome.
 *
 * Every storage access tolerates unavailable storage (private windows, tests): the experience then
 * simply shows again next time.
 */
import { create } from 'zustand';
import type { CardLocation } from '../model/types';
import type { CrmRecordSummary } from '../connect/types';
import { PREF_KEYS, readPref, removePref, writePref } from '../shell/prefs';

export const ONBOARDING_KEYS = {
  firstRun: 'uiex-builder:first-run',
  tour: 'uiex-builder:tour',
  /** Where the setup is (sessionStorage): a reload or a full-page sign-in comes back to the same step. */
  progress: 'uiex-builder:first-run-progress',
} as const;

/** Saved projects live under these keys (model/persistence). */
const LAST_PROJECT_KEY = 'uiex-builder:last-project';
const PROJECT_KEY_PREFIX = 'uiex-builder:project:';

export type SetupPath = 'hubspot' | 'sample';
export type SetupStepId = 'connect' | 'where' | 'start';
export type FirstRunView = 'welcome' | 'setup';
export type FirstRunOutcome = 'completed' | 'skipped';

/** The steps of each path: the sample path has no sign-in step. */
export const SETUP_STEPS: Record<SetupPath, SetupStepId[]> = {
  hubspot: ['connect', 'where', 'start'],
  sample: ['where', 'start'],
};

/** Plain-language step names (progress dots). */
export const STEP_LABELS: Record<SetupStepId, string> = {
  connect: 'Connect HubSpot',
  where: 'Where it appears',
  start: 'Preview and start',
};

export interface SetupChoices {
  /** Object type name used in card objectTypes ('contacts', 'p_projects' …). */
  objectType: string;
  /** e.g. '0-1' or '2-1234567' (when known). */
  objectTypeId?: string;
  location: CardLocation;
  /** Sample record to preview with (HubSpot path only); null = skipped. */
  record: CrmRecordSummary | null;
  /** Starter id: an ExtensionTemplate id, 'overview' or 'blank'. */
  starterId: string;
}

export const DEFAULT_CHOICES: SetupChoices = {
  objectType: 'contacts',
  objectTypeId: '0-1',
  location: 'crm.record.tab',
  record: null,
  starterId: '',
};

export const TOUR_STEP_COUNT = 4;

export interface TourState {
  active: boolean;
  step: number;
}

export interface OnboardingState {
  /** The full-window first-run screen is showing. */
  open: boolean;
  view: FirstRunView;
  path: SetupPath;
  /** Index into SETUP_STEPS[path]. */
  step: number;
  choices: SetupChoices;
  tour: TourState;
  /** Welcome → guided setup. */
  choosePath: (path: SetupPath) => void;
  setChoices: (patch: Partial<SetupChoices>) => void;
  next: () => void;
  back: () => void;
  goToStep: (step: number) => void;
  /** Leave the first-run screen for the editor (recorded so it doesn't show again). */
  close: (outcome: FirstRunOutcome) => void;
  /** Help › Getting started: shows the welcome again. */
  reopen: () => void;
  startTour: () => void;
  nextTourStep: () => void;
  prevTourStep: () => void;
  /** 'done' after the last step, 'skipped' when the person stops it early. */
  endTour: (how: 'done' | 'skipped') => void;
}

interface StoredFirstRun {
  v: 1;
  status: FirstRunOutcome;
  at: string;
}

/** What happened to the first run in this browser (null: nothing yet). */
export function readFirstRun(): FirstRunOutcome | null {
  const raw = readPref<unknown>(ONBOARDING_KEYS.firstRun, null);
  if (!raw || typeof raw !== 'object') return null;
  const status = (raw as { status?: unknown }).status;
  return status === 'completed' || status === 'skipped' ? status : null;
}

export function recordFirstRun(status: FirstRunOutcome): void {
  const value: StoredFirstRun = { v: 1, status, at: new Date().toISOString() };
  writePref(ONBOARDING_KEYS.firstRun, value);
}

/** Whether the tour was finished or skipped in this browser. */
export function tourSeen(): boolean {
  const raw = readPref<unknown>(ONBOARDING_KEYS.tour, null);
  return !!raw && typeof raw === 'object' && ((raw as { status?: unknown }).status === 'done' || (raw as { status?: unknown }).status === 'skipped');
}

function hasSavedProject(): boolean {
  try {
    const storage = window.localStorage;
    if (storage.getItem(LAST_PROJECT_KEY) !== null) return true;
    for (let i = 0; i < storage.length; i++) {
      if (storage.key(i)?.startsWith(PROJECT_KEY_PREFIX)) return true;
    }
  } catch {
    /* storage unavailable: treat as a first visit */
  }
  return false;
}

function forcedByAddress(search: string): boolean | null {
  const m = /(?:^|[?&])welcome=([^&]*)/i.exec(search);
  if (!m) return null;
  return !/^(0|false|no|off)$/i.test(decodeURIComponent(m[1]));
}

/**
 * Should the welcome screen open at startup? Yes on a first visit; never once the first run was
 * completed or skipped, for returning users (old welcome card dismissed, or a saved project), or
 * when the address says `?welcome=0`. `?welcome=1` always shows it.
 */
export function shouldShowFirstRun(search = typeof window !== 'undefined' ? window.location.search : ''): boolean {
  const forced = forcedByAddress(search);
  if (forced !== null) return forced;
  if (readFirstRun() !== null) return false;
  if (readPref<boolean>(PREF_KEYS.welcomeDismissed, false) === true) return false;
  return !hasSavedProject();
}

let initialized = false;

interface StoredProgress {
  view: FirstRunView;
  path: SetupPath;
  step: number;
  choices: SetupChoices;
}

const LOCATIONS: CardLocation[] = ['crm.record.tab', 'crm.record.sidebar', 'crm.preview', 'helpdesk.sidebar'];

function readProgress(): StoredProgress | null {
  try {
    const raw = window.sessionStorage.getItem(ONBOARDING_KEYS.progress);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<StoredProgress>;
    if (!d || (d.view !== 'welcome' && d.view !== 'setup') || (d.path !== 'hubspot' && d.path !== 'sample')) return null;
    const c = (d.choices ?? {}) as Partial<SetupChoices>;
    const r = c.record as Partial<CrmRecordSummary> | null | undefined;
    const record =
      r && typeof r.id === 'string' && /^\d{1,20}$/.test(r.id) && typeof r.objectType === 'string' && typeof r.objectTypeId === 'string'
        ? { id: r.id, objectType: r.objectType, objectTypeId: r.objectTypeId, label: typeof r.label === 'string' ? r.label : '', ...(typeof r.secondary === 'string' ? { secondary: r.secondary } : {}) }
        : null;
    return {
      view: d.view,
      path: d.path,
      step: typeof d.step === 'number' ? Math.max(0, Math.min(Math.floor(d.step), SETUP_STEPS[d.path].length - 1)) : 0,
      choices: {
        objectType: typeof c.objectType === 'string' && /^[\w-]{1,100}$/.test(c.objectType) ? c.objectType : DEFAULT_CHOICES.objectType,
        objectTypeId: typeof c.objectTypeId === 'string' ? c.objectTypeId : undefined,
        location: LOCATIONS.includes(c.location as CardLocation) ? (c.location as CardLocation) : DEFAULT_CHOICES.location,
        record,
        starterId: typeof c.starterId === 'string' ? c.starterId : '',
      },
    };
  } catch {
    return null;
  }
}

function writeProgress(s: Pick<OnboardingState, 'open' | 'view' | 'path' | 'step' | 'choices'>): void {
  try {
    if (!s.open) window.sessionStorage.removeItem(ONBOARDING_KEYS.progress);
    else window.sessionStorage.setItem(ONBOARDING_KEYS.progress, JSON.stringify({ view: s.view, path: s.path, step: s.step, choices: s.choices }));
  } catch {
    /* storage unavailable: a reload starts the setup again */
  }
}

/**
 * Decides once per page whether the first-run screen starts open (call before the first render so
 * the editor never flashes first). A setup in progress in this tab (reload, or the full-page
 * sign-in used when the HubSpot window was blocked) continues where it was. `force` re-evaluates
 * (tests).
 */
export function initFirstRun(opts: { force?: boolean; search?: string } = {}): boolean {
  if (initialized && !opts.force) return useOnboarding.getState().open;
  initialized = true;
  const open = shouldShowFirstRun(opts.search);
  const progress = open ? readProgress() : null;
  useOnboarding.setState(progress ? { open, ...progress } : { open, view: 'welcome', step: 0, choices: { ...DEFAULT_CHOICES } });
  return open;
}

/** The current setup step id. */
export function currentStep(s: Pick<OnboardingState, 'path' | 'step'>): SetupStepId {
  const steps = SETUP_STEPS[s.path];
  return steps[Math.max(0, Math.min(s.step, steps.length - 1))];
}

export const useOnboarding = create<OnboardingState>()((set, get) => ({
  open: false,
  view: 'welcome',
  path: 'hubspot',
  step: 0,
  choices: { ...DEFAULT_CHOICES },
  tour: { active: false, step: 0 },

  choosePath: (path) => set({ view: 'setup', path, step: 0, choices: { ...get().choices, record: path === 'sample' ? null : get().choices.record } }),
  setChoices: (patch) => set({ choices: { ...get().choices, ...patch } }),
  next: () => {
    const s = get();
    set({ step: Math.min(s.step + 1, SETUP_STEPS[s.path].length - 1) });
  },
  back: () => {
    const s = get();
    if (s.step === 0) set({ view: 'welcome' });
    else set({ step: s.step - 1 });
  },
  goToStep: (step) => {
    const s = get();
    set({ step: Math.max(0, Math.min(step, SETUP_STEPS[s.path].length - 1)) });
  },
  close: (outcome) => {
    recordFirstRun(outcome);
    set({ open: false, view: 'welcome', step: 0 });
  },
  reopen: () => {
    set({ open: true, view: 'welcome', step: 0, choices: { ...DEFAULT_CHOICES }, tour: { active: false, step: 0 } });
  },
  startTour: () => set({ tour: { active: true, step: 0 } }),
  nextTourStep: () => {
    const { tour } = get();
    if (tour.step >= TOUR_STEP_COUNT - 1) get().endTour('done');
    else set({ tour: { active: true, step: tour.step + 1 } });
  },
  prevTourStep: () => {
    const { tour } = get();
    set({ tour: { active: true, step: Math.max(0, tour.step - 1) } });
  },
  endTour: (how) => {
    writePref(ONBOARDING_KEYS.tour, { v: 1, status: how, at: new Date().toISOString() });
    set({ tour: { active: false, step: 0 } });
  },
}));

// Remember where the setup is for this tab (only while it is open).
useOnboarding.subscribe((s, prev) => {
  if (s.open === prev.open && s.view === prev.view && s.path === prev.path && s.step === prev.step && s.choices === prev.choices) return;
  writeProgress(s);
});

/** Test helper: forget the first run, the tour and the startup decision. */
/**
 * Record types whose sample record step 3 already picked by itself during this visit (it picks the
 * most recently updated record once per type; "Change" then leaves the choice to the admin).
 */
export const autoPickedRecordTypes = new Set<string>();

export function resetOnboardingForTests(): void {
  initialized = false;
  autoPickedRecordTypes.clear();
  removePref(ONBOARDING_KEYS.firstRun);
  removePref(ONBOARDING_KEYS.tour);
  try {
    window.sessionStorage.removeItem(ONBOARDING_KEYS.progress);
  } catch {
    /* ignore */
  }
  useOnboarding.setState({ open: false, view: 'welcome', path: 'hubspot', step: 0, choices: { ...DEFAULT_CHOICES }, tour: { active: false, step: 0 } });
}
