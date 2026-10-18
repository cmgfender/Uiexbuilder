/**
 * "What did HubSpot show?" — plain-language help for a sign-in that ended without a result.
 *
 * The HubSpot sign-in window is on HubSpot's own site, so the builder can't read what HubSpot
 * showed there. When HubSpot refuses to install the builder's app (its developer hasn't signed the
 * Acceptable Use Policy, the person may not install apps, the app reached its install limit …) it
 * shows the message INSIDE that window and never returns to the builder: all the builder sees is the
 * window closing. So the person picks what they saw, and gets the exact fix — and, when the fix is
 * someone else's job, a note to send them.
 *
 * Pure data and text: the UI is ui/SignInHelp.tsx.
 */

export type SignInTrouble = 'aup' | 'install_permission' | 'cancelled' | 'nothing' | 'other';

export interface SignInTroubleChoice {
  kind: SignInTrouble;
  /** What the person saw, in their words. */
  label: string;
  /** A second line: HubSpot's wording, to recognise it. */
  hint?: string;
}

/** The choices, most common first. `waiting`: the HubSpot window is still open (no "I closed it"). */
export function signInTroubleChoices(waiting = false): SignInTroubleChoice[] {
  const all: SignInTroubleChoice[] = [
    {
      kind: 'aup',
      label: 'A message about the “acceptable use policy”',
      hint: '“The app could not be installed because the app developer has not signed the acceptable use policy”',
    },
    {
      kind: 'install_permission',
      label: 'I’m not allowed to install apps',
      hint: 'For example “You don’t have permission to install this app”, or a message asking for a Super Admin',
    },
    { kind: 'cancelled', label: 'I closed it, or chose not to connect' },
    {
      kind: 'nothing',
      label: waiting ? 'The window is blank or stuck' : 'It closed by itself, or showed nothing',
    },
    { kind: 'other', label: 'Something else', hint: 'For example an install limit, a redirect URL or a scope error' },
  ];
  return waiting ? all.filter((c) => c.kind !== 'cancelled') : all;
}

export interface SignInHelpContext {
  /** The builder's address (what people open). */
  builderUrl: string;
  /** The connector's setup checklist (/setup.html). */
  setupUrl: string;
  /** The hosting guide. */
  docsUrl: string;
  /** "Something else": what HubSpot said, typed by the person (put into the note). */
  details?: string;
}

export interface SignInFix {
  /** Who fixes it: the person themselves, whoever set up the builder, or a Super Admin of their HubSpot account. */
  who: 'you' | 'host' | 'super_admin';
  title: string;
  /** What it means, in one or two sentences. */
  summary: string;
  /** What to do (or ask for), one step per line. */
  steps: string[];
  links: Array<{ label: string; href: string }>;
  /** A message to copy and send to whoever can fix it (`who` ≠ 'you'). */
  note?: string;
  /** Offer "Continue in this tab" (full-page sign-in instead of the window). */
  continueInTab?: boolean;
}

/** Where in HubSpot the app's developer signs the policy (the connector app's project name). */
const AUP_PATH = 'Development → Projects → uiex-builder-connector → the app → Distribution';

export function signInFix(kind: SignInTrouble, ctx: SignInHelpContext): SignInFix {
  const host = hostName(ctx.builderUrl);
  switch (kind) {
    case 'aup':
      return {
        who: 'host',
        title: 'Whoever set up this builder needs to sign HubSpot’s Acceptable Use Policy',
        summary:
          'This isn’t something you did, and it can’t be fixed from your HubSpot account. HubSpot won’t install the builder’s app anywhere until the app’s developer — whoever set up this builder — accepts HubSpot’s Acceptable Use Policy. It takes them about a minute, and no Marketplace listing is needed.',
        steps: [
          `In the HubSpot account that owns the builder’s app: ${AUP_PATH}.`,
          'Click Begin publishing, read the Acceptable Use Policy and sign it.',
          'Then click Connect HubSpot here again.',
        ],
        links: [
          { label: 'Setup checklist', href: ctx.setupUrl },
          { label: 'Guide: sign the Acceptable Use Policy', href: `${ctx.docsUrl}#accept-hubspots-acceptable-use-policy-once` },
        ],
        note: [
          `Hi! I tried to connect HubSpot in the UI Extension Builder (${ctx.builderUrl}), and HubSpot said the app couldn't be installed because the app developer has not signed the acceptable use policy.`,
          '',
          'To fix it (about a minute, no Marketplace listing needed):',
          `1. In the HubSpot account that owns the builder's app, go to ${AUP_PATH}.`,
          '2. Click Begin publishing and sign the Acceptable Use Policy.',
          "3. Let me know, and I'll connect again.",
          '',
          `Setup checklist: ${ctx.setupUrl}`,
          `Guide: ${ctx.docsUrl}#accept-hubspots-acceptable-use-policy-once`,
        ].join('\n'),
      };
    case 'install_permission':
      return {
        who: 'super_admin',
        title: 'A Super Admin of your HubSpot account needs to connect first',
        summary:
          'The first person to connect from a HubSpot account installs the builder’s app for that account, and HubSpot only lets Super Admins (or users with App Marketplace access) install apps. Once one of them has connected, everyone in your account can.',
        steps: [
          'Ask a Super Admin of your HubSpot account to open this builder, click Connect HubSpot and approve — once.',
          'Or ask them to give you App Marketplace access: in Settings → Users & Teams they open your user and turn on App Marketplace access (one of the Account permissions).',
          'Then click Connect HubSpot here again.',
        ],
        links: [{ label: 'Guide: who can connect', href: `${ctx.docsUrl}#who-can-connect` }],
        note: [
          `Hi! I'd like to connect our HubSpot account to the UI Extension Builder (${ctx.builderUrl}) to design HubSpot cards with our real data. It only reads data.`,
          '',
          "HubSpot says only a Super Admin (or someone with App Marketplace access) can install the builder's app the first time. Could you either:",
          `- open ${ctx.builderUrl}, click Connect HubSpot and approve once (after that everyone in our account can connect), or`,
          '- give me App Marketplace access (Settings → Users & Teams → my user → Account permissions → App Marketplace access)?',
          '',
          'Thank you!',
        ].join('\n'),
      };
    case 'cancelled':
      return {
        who: 'you',
        title: 'No problem — nothing was shared',
        summary: 'Connect whenever you’re ready. Until then you can keep building with sample data.',
        steps: [],
        links: [],
      };
    case 'nothing':
      return {
        who: 'you',
        title: 'Try signing in in this tab instead',
        summary:
          'Some browsers and privacy extensions stop the HubSpot window from reporting back to the builder, or block its cookies. Signing in in this tab avoids that: you go to HubSpot and come straight back here. Your work is saved.',
        steps: [
          'Click Continue in this tab.',
          `If that doesn’t work either, allow pop-ups and cookies for ${host} in your browser’s site settings, then try again.`,
        ],
        links: [],
        continueInTab: true,
      };
    case 'other': {
      const said = ctx.details?.trim();
      return {
        who: 'host',
        title: 'Tell whoever set up this builder what HubSpot said',
        summary:
          'HubSpot shows these messages in its own window, so the builder can’t see them. Whoever set up the builder can fix the HubSpot app’s settings. Messages they often see:',
        steps: [
          'An install limit: an app that isn’t listed on the HubSpot Marketplace can be installed in up to 25 HubSpot accounts.',
          'A redirect URL (redirect_uri) error: the app’s redirect URL doesn’t match this builder’s address exactly.',
          'A scope error: the app and the builder ask for different permissions.',
        ],
        links: [
          { label: 'Setup checklist', href: ctx.setupUrl },
          { label: 'Guide: troubleshooting', href: `${ctx.docsUrl}#troubleshooting` },
        ],
        note: [
          `Hi! I tried to connect HubSpot in the UI Extension Builder (${ctx.builderUrl}), but HubSpot showed a message instead of connecting${said ? `: “${said.slice(0, 500)}”` : '.'}`,
          '',
          'Could you check the HubSpot app behind the builder? The setup checklist and the troubleshooting guide list the usual causes (install limit of 25 accounts for unlisted apps, redirect URL, scopes):',
          `Setup checklist: ${ctx.setupUrl}`,
          `Guide: ${ctx.docsUrl}#troubleshooting`,
        ].join('\n'),
        continueInTab: false,
      };
    }
  }
}

function hostName(url: string): string {
  try {
    return new URL(url).host || 'this site';
  } catch {
    return 'this site';
  }
}
