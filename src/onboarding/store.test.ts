import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ONBOARDING_KEYS,
  SETUP_STEPS,
  TOUR_STEP_COUNT,
  currentStep,
  initFirstRun,
  readFirstRun,
  resetOnboardingForTests,
  shouldShowFirstRun,
  tourSeen,
  useOnboarding,
} from './store';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetOnboardingForTests();
});
afterEach(() => {
  localStorage.clear();
  resetOnboardingForTests();
});

describe('when the welcome shows', () => {
  it('shows on a first visit', () => {
    expect(shouldShowFirstRun('')).toBe(true);
  });

  it('never shows again once completed or skipped', () => {
    useOnboarding.getState().close('skipped');
    expect(readFirstRun()).toBe('skipped');
    expect(shouldShowFirstRun('')).toBe(false);
    useOnboarding.getState().close('completed');
    expect(readFirstRun()).toBe('completed');
    expect(shouldShowFirstRun('')).toBe(false);
  });

  it('does not show for returning users (old welcome card dismissed, or a saved project)', () => {
    localStorage.setItem('uiex-builder:welcome-dismissed', 'true');
    expect(shouldShowFirstRun('')).toBe(false);
    localStorage.clear();
    localStorage.setItem('uiex-builder:project:p_1', '{}');
    expect(shouldShowFirstRun('')).toBe(false);
    localStorage.clear();
    localStorage.setItem('uiex-builder:last-project', 'p_1');
    expect(shouldShowFirstRun('')).toBe(false);
  });

  it('can be forced on or off from the address', () => {
    useOnboarding.getState().close('completed');
    expect(shouldShowFirstRun('?welcome=1')).toBe(true);
    localStorage.clear();
    expect(shouldShowFirstRun('?a=b&welcome=0')).toBe(false);
  });

  it('ignores a damaged stored value (treated as a first visit)', () => {
    localStorage.setItem(ONBOARDING_KEYS.firstRun, '"nonsense"');
    expect(readFirstRun()).toBeNull();
    expect(shouldShowFirstRun('')).toBe(true);
  });

  it('is decided once per page (initFirstRun) and reopened from Help', () => {
    expect(initFirstRun({ search: '' })).toBe(true);
    expect(useOnboarding.getState().open).toBe(true);
    useOnboarding.getState().close('skipped');
    // A second call keeps the current decision (not re-evaluated mid-session).
    expect(initFirstRun()).toBe(false);
    useOnboarding.getState().reopen();
    expect(useOnboarding.getState()).toMatchObject({ open: true, view: 'welcome', step: 0 });
  });
});

describe('setup in progress', () => {
  it('continues at the same step after a reload or a full-page sign-in (this tab only)', () => {
    initFirstRun({ search: '' });
    const s = useOnboarding.getState();
    s.choosePath('hubspot');
    s.next();
    s.setChoices({ objectType: 'deals', objectTypeId: '0-3', location: 'crm.record.sidebar' });
    expect(sessionStorage.getItem(ONBOARDING_KEYS.progress)).toContain('deals');
    // A new page in the same tab (the store starts over; the progress is read back).
    expect(initFirstRun({ force: true, search: '' })).toBe(true);
    expect(useOnboarding.getState()).toMatchObject({ view: 'setup', path: 'hubspot', step: 1, choices: { objectType: 'deals', location: 'crm.record.sidebar' } });
    // Finishing (or skipping) forgets it.
    useOnboarding.getState().close('completed');
    expect(sessionStorage.getItem(ONBOARDING_KEYS.progress)).toBeNull();
  });

  it('ignores damaged progress', () => {
    sessionStorage.setItem(ONBOARDING_KEYS.progress, '{"view":"setup","path":"nope"}');
    initFirstRun({ force: true, search: '' });
    expect(useOnboarding.getState()).toMatchObject({ open: true, view: 'welcome', step: 0 });
    sessionStorage.setItem(ONBOARDING_KEYS.progress, '{"view":"setup","path":"sample","step":99,"choices":{"location":"evil","objectType":"<x>","record":{"id":"1; drop"}}}');
    initFirstRun({ force: true, search: '' });
    expect(useOnboarding.getState()).toMatchObject({ view: 'setup', path: 'sample', step: 1, choices: { location: 'crm.record.tab', objectType: 'contacts', record: null } });
  });
});

describe('guided setup navigation', () => {
  it('has three steps with HubSpot and two with sample data', () => {
    expect(SETUP_STEPS.hubspot).toEqual(['connect', 'where', 'start']);
    expect(SETUP_STEPS.sample).toEqual(['where', 'start']);
  });

  it('moves forward and back, and Back from the first step returns to the welcome', () => {
    const s = useOnboarding.getState();
    s.choosePath('hubspot');
    expect(useOnboarding.getState().view).toBe('setup');
    expect(currentStep(useOnboarding.getState())).toBe('connect');
    s.next();
    s.next();
    s.next();
    expect(currentStep(useOnboarding.getState())).toBe('start');
    s.back();
    expect(currentStep(useOnboarding.getState())).toBe('where');
    s.back();
    s.back();
    expect(useOnboarding.getState().view).toBe('welcome');
    s.choosePath('sample');
    expect(currentStep(useOnboarding.getState())).toBe('where');
  });

  it('the sample path never keeps a picked record', () => {
    const s = useOnboarding.getState();
    s.setChoices({ record: { id: '1', objectType: 'contacts', objectTypeId: '0-1', label: 'Ada' } });
    s.choosePath('sample');
    expect(useOnboarding.getState().choices.record).toBeNull();
  });
});

describe('tour', () => {
  it('walks four steps and remembers that it was seen', () => {
    const s = useOnboarding.getState();
    s.startTour();
    for (let i = 1; i < TOUR_STEP_COUNT; i++) {
      s.nextTourStep();
      expect(useOnboarding.getState().tour).toEqual({ active: true, step: i });
    }
    s.prevTourStep();
    expect(useOnboarding.getState().tour.step).toBe(TOUR_STEP_COUNT - 2);
    s.nextTourStep();
    s.nextTourStep();
    expect(useOnboarding.getState().tour.active).toBe(false);
    expect(tourSeen()).toBe(true);
    expect(JSON.parse(localStorage.getItem(ONBOARDING_KEYS.tour)!).status).toBe('done');
  });

  it('can be skipped and replayed', () => {
    const s = useOnboarding.getState();
    s.startTour();
    s.endTour('skipped');
    expect(useOnboarding.getState().tour.active).toBe(false);
    expect(JSON.parse(localStorage.getItem(ONBOARDING_KEYS.tour)!).status).toBe('skipped');
    s.startTour();
    expect(useOnboarding.getState().tour).toEqual({ active: true, step: 0 });
  });
});
