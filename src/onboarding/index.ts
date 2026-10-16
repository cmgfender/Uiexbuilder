/**
 * First-run experience: the welcome screen and guided setup (FirstRun), the coach-mark tour (Tour)
 * and their state (useOnboarding). See store.ts for when the welcome shows.
 */
export { FirstRun, LOCATION_CHOICES } from './FirstRun';
export { Tour, TOUR_STEPS, placeTour } from './Tour';
export {
  useOnboarding,
  initFirstRun,
  shouldShowFirstRun,
  readFirstRun,
  recordFirstRun,
  tourSeen,
  currentStep,
  resetOnboardingForTests,
  ONBOARDING_KEYS,
  SETUP_STEPS,
  STEP_LABELS,
  DEFAULT_CHOICES,
  TOUR_STEP_COUNT,
} from './store';
export type { SetupPath, SetupStepId, SetupChoices, FirstRunOutcome, OnboardingState } from './store';
export {
  startersFor,
  overviewSpec,
  buildOverviewExtension,
  setupRecordTypes,
  locationAllowed,
  needsExternalSetup,
  fitsLocation,
  STANDARD_SETUP_TYPES,
  FIRST_RUN_APP_NAME,
  OVERVIEW_STARTER_ID,
  BLANK_STARTER_ID,
} from './starters';
export type { StarterOption, RecordTypeChoice, OverviewSpec, OverviewField } from './starters';
export { finishSetup, openProjectIsPristine } from './finish';
export type { FinishSetupInput, FinishSetupResult } from './finish';

