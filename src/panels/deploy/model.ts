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

/** Error codes that are about the key itself (shown on the key field, the admin stays on the form). */
export const KEY_ERROR_CODES = new Set(['invalid_key', 'missing_key', 'no_remembered_key', 'key_expired']);
/**
 * Refusals about the key's permissions or account (a fix-it callout on the form, see keyProblemCopy):
 * every 403 variant of a publish — the key lacks Developer projects (missing_scope), developer
 * projects aren't available in the account (not_available), HubSpot refused for another reason
 * (forbidden), the builder only publishes to some accounts (portal_not_allowed), this address may
 * not use the connector (forbidden_origin / csrf) — and a key from another account (portal_mismatch).
 */
export const KEY_PROBLEM_CODES = new Set(['missing_scope', 'not_available', 'forbidden', 'portal_not_allowed', 'portal_mismatch', 'forbidden_origin', 'csrf']);
/** Errors about who is publishing (shown on the form too): sign in first. */
export const ACCOUNT_ERROR_CODES = new Set(['not_connected']);

/** Errors shown on the form (the key and the project stay as they are) instead of the failure screen. */
export function isFormErrorCode(code: string): boolean {
  return KEY_ERROR_CODES.has(code) || KEY_PROBLEM_CODES.has(code) || ACCOUNT_ERROR_CODES.has(code);
}

/** "Acme (account 123)" / "account 123". */
export function accountName(account: { portalId: number; name?: string; hubDomain?: string } | null | undefined): string {
  if (!account) return 'your HubSpot account';
  const name = account.name || account.hubDomain;
  return name ? `${name} (account ${account.portalId})` : `account ${account.portalId}`;
}

export type KeyProblemKind = 'missing_permission' | 'portal_mismatch' | 'portal_not_allowed' | 'not_available' | 'forbidden' | 'origin';

/** The callout kind for a key-check problem or a form error code. */
export function keyProblemKind(code: string): KeyProblemKind | null {
  switch (code) {
    case 'missing_permission':
    case 'missing_scope':
      return 'missing_permission';
    case 'portal_mismatch':
    case 'portal_not_allowed':
    case 'not_available':
    case 'forbidden':
      return code;
    case 'forbidden_origin':
    case 'csrf':
      return 'origin';
    default:
      return null;
  }
}

export interface KeyProblemCopy {
  title: string;
  /** What it means (the server's message adds the details). */
  intro: string;
  steps: string[];
  /** Who fixes it, for the note button: undefined = the admin themselves. */
  noteFor?: 'host' | 'super_admin';
  /** The text of that note. */
  note?: string;
}

export interface KeyProblemContext {
  /** The account the key belongs to, when HubSpot said. */
  key?: { portalId: number; name?: string };
  /** The connected account (publishing goes there). */
  connected?: { portalId: number; hubDomain?: string } | null;
  /** The builder's address and setup page, for notes. */
  builderUrl: string;
  setupUrl: string;
}

/** Plain-language title, steps and (when someone else fixes it) a note to send, for each key problem. */
export function keyProblemCopy(kind: KeyProblemKind, ctx: KeyProblemContext): KeyProblemCopy {
  const keyAccount = ctx.key ? accountName(ctx.key) : 'the account the key belongs to';
  switch (kind) {
    case 'missing_permission':
      return {
        title: 'This key can’t publish yet: it’s missing the “Developer projects” permission',
        intro: 'The key works, but HubSpot only takes projects from keys that have the Developer projects permission. It’s a one-time change on HubSpot’s key page:',
        steps: [
          `Open the key page for ${keyAccount} (button below).`,
          'Add the Developer projects permission to your key and save. If HubSpot doesn’t let you change it, create a new key with Developer projects ticked and paste the new key above.',
          'Come back here and click Check again.',
        ],
      };
    case 'portal_mismatch':
      return {
        title: 'This key is for a different HubSpot account',
        intro: ctx.connected
          ? 'Your cards go to the account you’re connected to, so the key has to come from that account too. Either:'
          : 'The key decides which HubSpot account your cards go to. Either:',
        steps: ctx.connected
          ? [
              `Get a key for ${accountName(ctx.connected)}: open its key page, copy the key and paste it above, or`,
              `publish to ${keyAccount} instead: switch the HubSpot account you’re connected to.`,
            ]
          : [`Paste a key from the account you want, or publish to ${keyAccount} instead.`],
      };
    case 'portal_not_allowed': {
      const id = ctx.key?.portalId;
      return {
        title: id ? `This builder doesn’t publish to account ${id}` : 'This builder doesn’t publish to this account',
        intro: 'Whoever set up this builder limited it to specific HubSpot accounts. They can add this one — or use a key from an account that is allowed.',
        steps: [],
        noteFor: 'host',
        note: [
          `Hi! I'd like to publish cards from the UI Extension Builder (${ctx.builderUrl}) to our HubSpot account ${ctx.key ? accountName(ctx.key) : ''}, but the builder only publishes to the accounts in its ALLOWED_PORTALS setting.`,
          '',
          `Could you add ${id ?? 'that account id'} to ALLOWED_PORTALS in the builder's hosting settings and redeploy?`,
          `Setup checklist: ${ctx.setupUrl}`,
        ].join('\n'),
      };
    }
    case 'not_available':
      return {
        title: 'HubSpot doesn’t allow developer projects in this account',
        intro: 'HubSpot refused to take projects into this account, whatever key is used:',
        steps: [
          'Check that the account shows Development in HubSpot’s main menu (developer projects).',
          'Or publish to an account that has it, for example a developer test account: connect to it and use its key.',
        ],
      };
    case 'forbidden':
      return {
        title: 'HubSpot refused to take the project',
        intro: 'HubSpot accepted the key but not the upload. Usually the key’s user isn’t allowed to use developer tools in that account:',
        steps: [
          `Ask a Super Admin of ${keyAccount} to let your user use developer tools (Settings → Users & Teams → your user → permissions), then publish again.`,
          'Or ask them to publish with their own key.',
        ],
        noteFor: 'super_admin',
        note: [
          `Hi! I'm publishing HubSpot cards from the UI Extension Builder (${ctx.builderUrl}) to ${keyAccount}, and HubSpot refused the upload with my personal access key.`,
          '',
          'Could you give my user permission to use developer tools in this account (Settings → Users & Teams → my user → permissions)? Or publish it with your own key.',
        ].join('\n'),
      };
    case 'origin':
      return {
        title: 'This address can’t publish',
        intro: 'The builder’s server only accepts the address it was set up for (APP_URL). Open the builder on that address — or ask whoever set it up to add this one.',
        steps: [],
        noteFor: 'host',
        note: [
          `Hi! Publishing from the UI Extension Builder at ${ctx.builderUrl} fails with "This website is not allowed to use the HubSpot connector".`,
          '',
          `Could you check that APP_URL is ${ctx.builderUrl} (or add it to ALLOWED_ORIGINS) in the builder's hosting settings and redeploy?`,
          `Setup checklist: ${ctx.setupUrl}`,
        ].join('\n'),
      };
  }
}

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
    case 'missing_scope':
      return [
        'Your personal access key needs the “Developer projects” permission. Add it on HubSpot’s personal access key page (or create a new key with it).',
        'Then click Back, paste the key and publish again.',
      ];
    case 'not_available':
      return ['HubSpot doesn’t allow developer projects in this account. Publish to an account that shows Development in HubSpot’s main menu, such as a developer test account.'];
    case 'forbidden':
      return [
        'HubSpot refused. Usually your user isn’t allowed to use developer tools in this account: ask a Super Admin to allow it (Settings → Users & Teams), or to publish with their own key.',
        'Then click Try again.',
      ];
    case 'portal_not_allowed':
      return ['This builder only publishes to specific HubSpot accounts. Ask whoever set it up to add yours (ALLOWED_PORTALS).'];
    case 'not_connected':
      return ['Your HubSpot sign-in expired. Click Back, connect HubSpot again (top right), then publish again.'];
    case 'forbidden_origin':
    case 'csrf':
      return ['Open the builder on the address it was set up for (APP_URL), or ask whoever set it up to allow this address.'];
    case 'deploy_not_found':
      return ['The builder lost track of this publish (after an hour, or in another browser). Open the project in HubSpot to see how it went, or publish again.'];
    default:
      return ['Click Try again.', 'If it keeps failing, download the builder file and send it to whoever looks after the builder.'];
  }
}
