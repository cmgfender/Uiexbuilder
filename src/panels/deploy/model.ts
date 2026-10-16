/**
 * Publish to HubSpot (beta; "deploy" in code): pure helpers for the panel — key page links, the
 * progress stepper, the "Finish in HubSpot" checklist and what to do after a failure.
 */
import type { DeployPhase } from '../../connect/types';
import { findStandardType } from '../../connect/objectTypes';
import type { Extension, Project } from '../../model/types';
import { deploySteps, type Step } from '../exportModel';

/** The HubSpot web app origin for links: the server's HUBSPOT_APP_BASE (EU, demo) or https://<appHost>. */
export function hubspotOrigin(appHost: string | undefined, appBase?: string): string {
  const host = appHost && /^[a-z0-9.-]+$/i.test(appHost) ? appHost : 'app.hubspot.com';
  return appBase && /^https?:\/\//.test(appBase) ? appBase.replace(/\/+$/, '') : `https://${host}`;
}

/**
 * Where HubSpot shows the personal access key — exactly the pages the HubSpot CLI opens
 * (@hubspot/cli 8.16 `personalAccessKeyPrompt`: `<website>/personal-access-key/<accountId>`, or
 * `<website>/l/personal-access-key` when the account isn't known, which asks which account).
 * `appBase` is the server's HUBSPOT_APP_BASE when it isn't the default (EU data centre, the demo's
 * fake HubSpot).
 */
export function personalAccessKeyUrl(appHost: string | undefined, portalId: number | undefined, appBase?: string): string {
  const origin = hubspotOrigin(appHost, appBase);
  return portalId ? `${origin}/personal-access-key/${portalId}` : `${origin}/l/personal-access-key`;
}

/** A private app access token ("pat-na1-…") pasted instead of a personal access key. */
export function looksLikePrivateAppToken(key: string): boolean {
  return /^pat-[a-z]{2}\d-/i.test(key.trim());
}

export const PRIVATE_APP_TOKEN_HINT =
  'This looks like a private app access token (it starts with “pat-”). Publishing needs your personal access key from the Personal access key page instead — a much longer code. Use the Copy button next to it.';

export interface GuideStep {
  title: string;
  body?: string;
}

/** Step 1 of publishing — plain-language steps for creating / copying a personal access key. */
export const KEY_GUIDE_STEPS: GuideStep[] = [
  {
    title: 'Open HubSpot’s personal access key page',
    body: 'Use the button above. If HubSpot asks which account to use, pick the one you want to publish to.',
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
    title: 'Paste it below',
    body: 'Then click Publish to HubSpot.',
  },
];

export const KEY_GUIDE_FALLBACK =
  'Can’t find the page? In HubSpot, go to Development → Keys → Personal access key, or search for “personal access key” in HubSpot’s search bar. You need permission to use developer tools (Super Admins have it).';

/** The three steps of the Publish to HubSpot wizard. */
export const WIZARD_STEPS = ['Get your key', 'Publish', 'Finish in HubSpot'] as const;

/** The progress stepper shown while publishing. */
export const DEPLOY_STEPS: Array<{ key: 'uploading' | 'building' | 'deploying' | 'success'; label: string; hint: string }> = [
  { key: 'uploading', label: 'Uploading', hint: 'Sending your project files to HubSpot' },
  { key: 'building', label: 'Building', hint: 'HubSpot checks and builds the project' },
  { key: 'deploying', label: 'Going live', hint: 'HubSpot makes the new version available' },
  { key: 'success', label: 'Published', hint: 'In HubSpot — finish with the checklist below' },
];

/** What is happening right now, in plain words, for each publish phase (the log has the details). */
export function phaseMessage(phase: DeployPhase | undefined): string {
  switch (phase) {
    case 'building':
      return 'HubSpot is checking and building your cards…';
    case 'deploying':
      return 'Making your cards live in your HubSpot account…';
    case 'success':
      return 'Published.';
    default:
      return 'Sending your cards to HubSpot…';
  }
}

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
/** Errors about who is deploying (shown on the form too): sign in first / account not allowed. */
export const ACCOUNT_ERROR_CODES = new Set(['not_connected', 'portal_not_allowed']);

/** The HubSpot sign-in app of this builder (public/hubspot-connector-app.uiex.json). */
export function isConnectorApp(project: Project): boolean {
  return project.name === 'uiex-builder-connector' || project.app.uid === 'uiex_builder_connector';
}

/** What the person hosting the builder does after deploying the sign-in app. */
export function connectorAppNextSteps(setupUrl: string): Step[] {
  return [
    {
      title: 'Sign HubSpot’s Acceptable Use Policy',
      body: 'Open the project in HubSpot (button above) → click the app → Distribution → Begin publishing → sign the policy. No Marketplace listing is needed. Until it is signed, Connect HubSpot shows an error.',
    },
    {
      title: 'Copy the Client ID and Client secret',
      body: 'On the app’s Auth tab. Keep the secret private, like a password.',
    },
    {
      title: 'Add them to your host and redeploy',
      body: 'Render: your service → Environment. Vercel: Settings → Environment Variables (replace “later”), then Deployments → Redeploy. Set HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET.',
    },
    {
      title: 'Check that sign-in works',
      body: `Open ${setupUrl} and click Check again — it should say Ready.`,
    },
  ];
}

/**
 * The builder's names for the extensions a failed build mentions (the log names generated files
 * such as src/app/cards/DealCard.tsx, or component uids).
 */
export function failingExtensions(project: Project, log: readonly string[]): string[] {
  const text = log.join('\n');
  const names: string[] = [];
  for (const ext of project.extensions) {
    const file = ext.fileName ? new RegExp(`\\b${ext.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.tsx|-hsmeta\\.json)`) : null;
    const uid = ext.uid ? new RegExp(`\\b${ext.uid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(_card)?\\b`) : null;
    if ((file && file.test(text)) || (uid && uid.test(text))) names.push(ext.name);
  }
  return names;
}

// ---------------------------------------------------------------------------
// "Finish in HubSpot" checklist
// ---------------------------------------------------------------------------

export interface ChecklistItem {
  /** Stable key (remembered when ticked). */
  key: string;
  title: string;
  body: string;
  /** The clicks to make, one per line (shown as a numbered list under `body`). Additive. */
  steps?: string[];
  link?: { href: string; label: string };
}

export interface ChecklistContext {
  /** The HubSpot account the project went to. */
  portalId?: number;
  /** HubSpot web app origin (see hubspotOrigin). */
  origin: string;
  installUrl?: string;
  projectUrl?: string;
  /** Sample record picked for each card in the builder (opened as "a sample record"). */
  records?: Record<string, { id: string; objectTypeId: string } | null | undefined>;
  /** Labels and ids of the portal's object types (custom objects); standard ones are known. */
  types?: ReadonlyArray<{ objectType: string; objectTypeId: string; label: string; pluralLabel: string }>;
  /** The connector's setup checklist page (next steps after publishing the sign-in app itself). */
  setupUrl?: string;
}

function typeInfo(objectType: string, ctx: ChecklistContext): { id?: string; singular: string; plural: string } {
  const std = findStandardType(objectType);
  if (std) {
    const plural = std.label;
    const singular = plural.endsWith('ies') ? `${plural.slice(0, -3)}y` : plural.replace(/s$/, '');
    return { id: std.objectTypeId, singular, plural };
  }
  const custom = ctx.types?.find((t) => t.objectType === objectType || t.objectTypeId === objectType);
  if (custom) return { id: custom.objectTypeId, singular: custom.label, plural: custom.pluralLabel };
  const name = objectType.replace(/^p\d*_/, '').replace(/_/g, ' ');
  return { id: /^\d+-\d+$/.test(objectType) ? objectType : undefined, singular: name, plural: name };
}

/** The exact clicks that put a card on its record page, in plain words. */
export function placementInstructions(card: Pick<Extension, 'name' | 'location'>, plural: string): string {
  const name = `“${card.name}”`;
  const settings = `In HubSpot, click the Settings icon (top right) → Data Management → Objects → ${plural}.`;
  switch (card.location) {
    case 'crm.record.sidebar':
      return `${settings} Open the Record Customization tab and click Default view. In the right sidebar, click Add cards → Card library, set Card types to App and click Add card next to ${name}. Click Save and exit.`;
    case 'crm.preview':
      return `${settings} Open the Preview Customization tab and click Default view. Click Add cards → Card library, set Card types to App and click Add card next to ${name}. Click Save.`;
    case 'helpdesk.sidebar':
      return `Open any ticket in the help desk. In the right sidebar, click Customize → Add cards → Card library, set Card types to App and add ${name}. Click Save.`;
    default:
      return `${settings} Open the Record Customization tab and click Default view. Pick a tab in the middle column, click Add cards → Card library, set Card types to App and click Add card next to ${name}. Click Save and exit.`;
  }
}

/** placementInstructions as separate clicks, one per line (the checklist shows them numbered). */
export function placementSteps(card: Pick<Extension, 'name' | 'location'>, plural: string): string[] {
  const name = `“${card.name}”`;
  const settings = ['In HubSpot, click the Settings icon (top right).', `Go to Data Management → Objects → ${plural}.`];
  const add = `Set Card types to App and click Add card next to ${name}.`;
  switch (card.location) {
    case 'crm.record.sidebar':
      return [...settings, 'Open the Record Customization tab and click Default view.', 'In the right sidebar, click Add cards → Card library.', add, 'Click Save and exit.'];
    case 'crm.preview':
      return [...settings, 'Open the Preview Customization tab and click Default view.', 'Click Add cards → Card library.', add, 'Click Save.'];
    case 'helpdesk.sidebar':
      return ['Open any ticket in the help desk.', 'In the right sidebar, click Customize → Add cards → Card library.', `Set Card types to App and add ${name}.`, 'Click Save.'];
    default:
      return [
        ...settings,
        'Open the Record Customization tab and click Default view.',
        'Pick a tab in the middle column, then click Add cards → Card library.',
        add,
        'Click Save and exit.',
      ];
  }
}

/**
 * What to do in HubSpot after publishing: install the app (once), put each card on its record page
 * (or open the settings / app home page), then open a record to see it — each with a direct link.
 */
export function publishChecklist(project: Project, ctx: ChecklistContext): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  const portal = ctx.portalId;
  if (isConnectorApp(project)) {
    return connectorAppNextSteps(ctx.setupUrl ?? '/setup.html').map((s, i) => ({ key: `connector:${i}`, title: s.title, body: s.body ?? '' }));
  }
  items.push({
    key: 'install',
    title: 'Install the app in your account',
    body: ctx.installUrl ? 'Click Install the app and approve the access it asks for. You only do this once.' : installHint(project),
    link: ctx.installUrl
      ? { href: ctx.installUrl, label: 'Install the app' }
      : ctx.projectUrl
        ? { href: ctx.projectUrl, label: 'Open the project' }
        : undefined,
  });
  const cards = project.extensions.filter((e) => e.kind === 'card');
  for (const card of cards) {
    const type = typeInfo(card.objectTypes[0] ?? 'contacts', ctx);
    const where = card.location === 'helpdesk.sidebar' ? 'the help desk' : `${type.plural.toLowerCase()} records`;
    items.push({
      key: `card:${card.id}`,
      title: `Add “${card.name}” to ${where}`,
      body:
        card.location === 'helpdesk.sidebar'
          ? 'Once, in the help desk — then it shows on every ticket there:'
          : `Once, in your ${type.singular.toLowerCase()} settings — then it shows on every ${type.singular.toLowerCase()}:`,
      steps: placementSteps(card, type.plural),
      // The account's settings home (the address the HubSpot CLI opens for settings).
      link: portal !== undefined && card.location !== 'helpdesk.sidebar' ? { href: `${ctx.origin}/settings/${portal}`, label: 'Open HubSpot settings' } : undefined,
    });
  }
  const settings = project.extensions.find((e) => e.kind === 'settings');
  if (settings) items.push({ key: 'settings', title: 'Open the settings page', body: 'Settings → Integrations → Connected apps → your app → Settings tab.' });
  const home = project.extensions.find((e) => e.kind === 'home');
  if (home) items.push({ key: 'home', title: 'Open the app home page', body: 'Click the Marketplace icon in the top navigation → Connected apps → your app.' });
  const first = cards[0];
  if (first) {
    const type = typeInfo(first.objectTypes[0] ?? 'contacts', ctx);
    const sample = ctx.records?.[first.id];
    const singular = type.singular.toLowerCase();
    items.push({
      key: 'open',
      title: `Open a ${singular} to see your card`,
      body: sample
        ? `Your card shows on every ${singular} once it’s added. Refresh the page if HubSpot was already open.`
        : `Open any ${singular}: your card shows where you added it. Refresh the page if HubSpot was already open.`,
      link:
        portal !== undefined
          ? sample
            ? { href: `${ctx.origin}/contacts/${portal}/record/${encodeURIComponent(sample.objectTypeId)}/${encodeURIComponent(sample.id)}`, label: 'Open your sample record' }
            : type.id
              ? { href: `${ctx.origin}/contacts/${portal}/objects/${type.id}`, label: `Open your ${type.plural.toLowerCase()}` }
              : undefined
          : undefined,
    });
  }
  return items;
}

/** What to do after a failed publish, in plain words (the message says what happened). */
export function failureAdvice(code: string): string[] {
  switch (code) {
    case 'network':
    case 'connector_unavailable':
    case 'hubspot_unreachable':
    case 'hubspot_unavailable':
      return [
        'Check your internet connection, then click Try again.',
        'If the builder was asleep (free hosting), it may need a minute to wake up — wait a moment and try again.',
      ];
    case 'not_configured':
    case 'feature_disabled':
    case 'not_available':
      return ['Publishing from the builder isn’t set up on this server. Ask the person who set up the builder, or use the HubSpot CLI instead.'];
    case 'rate_limited':
      return ['HubSpot is busy right now. Wait a minute, then click Try again.'];
    case 'timeout':
    case 'expired':
      return ['HubSpot may still finish on its own: open the project in HubSpot to check.', 'If nothing changed there, click Try again.'];
    case 'build_failed':
      return [
        'This is usually a problem in the generated code, not something you did.',
        'Click Download builder file and send it, with the log below, to whoever looks after the builder.',
      ];
    case 'deploy_failed':
    case 'deploy_blocked':
    case 'autodeploy_missing':
      return [
        'HubSpot built your project but didn’t make it live. Open the project in HubSpot — it says what it needs (often approving new permissions or reinstalling the app).',
        'Then click Try again.',
      ];
    case 'project_locked':
      return ['Another publish of this project is still running. Wait a minute, then click Try again.'];
    case 'superseded':
      return ['A newer version was published in the meantime, so there’s nothing more to do.'];
    case 'invalid_project':
    case 'invalid_files':
    case 'hubspot_rejected':
    case 'unsupported_platform':
    case 'platform_unavailable':
      return ['HubSpot didn’t accept the project. Click Back, then Show problems (bottom of the editor) and fix any errors.', 'Then publish again.'];
    case 'key_expired':
    case 'invalid_key':
      return ['Create a new personal access key in HubSpot, paste it and publish again.'];
    default:
      return ['Click Try again.', 'If it keeps failing, download the builder file and send it to whoever looks after the builder.'];
  }
}
