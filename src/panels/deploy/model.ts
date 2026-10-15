/** Deploy to HubSpot (beta): pure helpers for the panel — key page links, stepper, next steps. */
import type { DeployPhase } from '../../connect/types';
import type { Project } from '../../model/types';
import { deploySteps, type Step } from '../exportModel';

/** Where HubSpot shows the personal access key (the page `hs account auth` opens). */
export function personalAccessKeyUrl(appHost: string | undefined, portalId: number | undefined): string {
  const host = appHost && /^[a-z0-9.-]+$/i.test(appHost) ? appHost : 'app.hubspot.com';
  return portalId ? `https://${host}/personal-access-key/${portalId}` : `https://${host}/l/personal-access-key`;
}

export interface GuideStep {
  title: string;
  body?: string;
}

/** "How do I get this?" — plain-language steps for creating / copying a personal access key. */
export const KEY_GUIDE_STEPS: GuideStep[] = [
  {
    title: 'Open the personal access key page in HubSpot',
    body: 'Use the button below. If HubSpot asks which account to use, pick the one you want to deploy to.',
  },
  {
    title: 'Create a key if you don’t have one yet',
    body: 'Click “Generate personal access key”. Make sure the “Developer projects” permission is ticked — it lets the key upload projects.',
  },
  {
    title: 'Copy the key',
    body: 'Click “Show”, then “Copy” next to your key.',
  },
  {
    title: 'Paste it here',
    body: 'Paste the key into the box above and click Deploy.',
  },
];

export const KEY_GUIDE_FALLBACK =
  'Can’t find the page? In HubSpot, go to Development → Keys → Personal access key, or search for “personal access key” in HubSpot’s search bar. You need permission to use developer tools (Super Admins have it).';

/** The progress stepper shown while deploying. */
export const DEPLOY_STEPS: Array<{ key: 'uploading' | 'building' | 'deploying' | 'success'; label: string; hint: string }> = [
  { key: 'uploading', label: 'Uploading', hint: 'Sending your project files to HubSpot' },
  { key: 'building', label: 'Building', hint: 'HubSpot checks and builds the project' },
  { key: 'deploying', label: 'Deploying', hint: 'HubSpot makes the new version live' },
  { key: 'success', label: 'Done', hint: 'Your cards are ready to use' },
];

export type StepState = 'done' | 'current' | 'failed' | 'todo';

/** Index of the stepper step for a phase (queued / authenticating / uploading = 0). */
export function stepIndex(phase: DeployPhase | 'uploading'): number {
  switch (phase) {
    case 'building':
      return 1;
    case 'deploying':
      return 2;
    case 'success':
      return 3;
    default:
      return 0;
  }
}

/** State of each stepper step. `failedAt` is the step that was running when the deploy failed. */
export function stepStates(current: number, failed: boolean): StepState[] {
  return DEPLOY_STEPS.map((_, i) => {
    if (failed) return i < current ? 'done' : i === current ? 'failed' : 'todo';
    if (current === DEPLOY_STEPS.length - 1) return 'done';
    return i < current ? 'done' : i === current ? 'current' : 'todo';
  });
}

/**
 * What to do after a successful deploy: the tailored steps of the Export dialog's deploy guide that
 * follow "Install the app" (add each card to its record view / sidebar / preview, open settings and
 * app home pages).
 */
export function nextSteps(project: Project): Step[] {
  const steps = deploySteps(project);
  const install = steps.findIndex((s) => s.title.startsWith('Install the app'));
  return install >= 0 ? steps.slice(install + 1) : [];
}

/** How to install, when there is no one-click install link. */
export function installHint(project: Project): string {
  return project.app.distribution === 'marketplace'
    ? 'Install it through its OAuth install link: on the project page open your app, then Distribution.'
    : 'On the project page, open your app, go to Distribution and click Install now.';
}

/** Error codes that are about the key (shown on the key field, the admin stays on the form). */
export const KEY_ERROR_CODES = new Set(['invalid_key', 'missing_key', 'no_remembered_key', 'missing_scope']);
