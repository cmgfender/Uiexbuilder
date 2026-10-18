/**
 * Plain-language titles and "what it means / how to fix" for every status-page event, written for
 * the person who hosts the builder. The visitor-facing wording is reused from the builder itself:
 * sign-in results (src/connect/describe.ts describeAuthResult), connector errors (describeError),
 * what the HubSpot window showed (src/connect/signInHelp.ts signInFix) and publish problems
 * (src/panels/deploy/model.ts keyProblemCopy, failureAdvice). Pure: no React, no requests.
 */
import { describeAuthResult, describeError } from '../connect/describe';
import { signInFix, signInTroubleChoices, type SignInHelpContext, type SignInTrouble } from '../connect/signInHelp';
import { failureAdvice, keyProblemCopy, keyProblemKind, type KeyProblemKind } from '../panels/deploy/model';
import type { DiagnosticEvent, PublishStage, SignInFeedbackKind } from './types';

export type ExplanationTone = 'ok' | 'info' | 'warning' | 'danger' | 'pending';

/** Who can fix it. */
export type FixOwner = 'you' | 'visitor' | 'super_admin' | 'hubspot' | 'nobody';

export interface Explanation {
  /** One line for the timeline row. */
  title: string;
  /** What happened and what it means, in plain words. */
  meaning: string;
  who: FixOwner;
  /** What to do, one step per line (empty: nothing to do). */
  steps: string[];
  links: Array<{ label: string; href: string }>;
  /** The message the visitor saw in the builder, when there was one. */
  visitorSaw?: { title: string; message: string };
  tone: ExplanationTone;
}

export interface ExplainContext extends Pick<SignInHelpContext, 'builderUrl' | 'setupUrl' | 'docsUrl'> {
  /** Build of this page (to say a browser error came from an older version). */
  currentBuild?: string;
}

export const FIX_OWNER_LABEL: Record<FixOwner, string> = {
  you: 'You can fix this',
  visitor: 'The person using the builder can fix this',
  super_admin: 'A Super Admin of their HubSpot account can fix this',
  hubspot: 'On HubSpot’s side',
  nobody: 'Nothing to fix',
};

const STAGE_TEXT: Record<PublishStage, string> = {
  key_check: 'while checking the key',
  upload: 'before anything was uploaded',
  build: 'while HubSpot was building it',
  deploy: 'while HubSpot was making it live',
};

/** "12 s", "1 min 5 s", "2 h 3 min". */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return 'under 1 s';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

function account(portalId: number | undefined): string {
  return portalId ? `HubSpot account ${portalId}` : 'HubSpot';
}

/** What the visitor told the builder, in their words. */
export function feedbackLabel(kind: SignInFeedbackKind): string {
  const choice = signInTroubleChoices().find((c) => c.kind === kind);
  if (choice) return choice.label;
  switch (kind) {
    case 'popup_closed':
      return 'The HubSpot window closed without connecting';
    case 'popup_blocked':
      return 'The browser blocked the HubSpot window';
    case 'timeout':
      return 'They gave up waiting for HubSpot';
    default:
      return kind;
  }
}

/** The visitor's answer as a sentence for the host. */
export function feedbackSentence(kind: SignInFeedbackKind): string {
  switch (kind) {
    case 'aup':
      return 'They said HubSpot showed a message about the “acceptable use policy”.';
    case 'install_permission':
      return 'They said HubSpot didn’t let them install apps.';
    case 'cancelled':
      return 'They said they closed it, or chose not to connect.';
    case 'nothing':
      return 'They said the window closed by itself, or showed nothing.';
    case 'other':
      return 'They said HubSpot showed something else.';
    case 'popup_closed':
      return 'Their browser saw the HubSpot window close without connecting.';
    case 'popup_blocked':
      return 'Their browser blocked the HubSpot window.';
    case 'timeout':
      return 'They gave up waiting for HubSpot.';
    default:
      return '';
  }
}

const TROUBLE_KINDS = new Set<SignInFeedbackKind>(['aup', 'install_permission', 'cancelled', 'nothing', 'other']);

function fixFor(kind: SignInTrouble, ctx: ExplainContext) {
  return signInFix(kind, { builderUrl: ctx.builderUrl, setupUrl: ctx.setupUrl, docsUrl: ctx.docsUrl });
}

/** The usual reasons a sign-in never comes back, most likely first (HubSpot shows them in its window). */
function neverCameBack(ctx: ExplainContext, e: DiagnosticEvent): Explanation {
  const aup = fixFor('aup', ctx);
  const install = fixFor('install_permission', ctx);
  const specific = e.feedback && TROUBLE_KINDS.has(e.feedback) && e.feedback !== 'nothing' ? e.feedback : null;
  const said = e.feedback ? ` ${feedbackSentence(e.feedback)}` : '';
  const label = e.feedback ? feedbackLabel(e.feedback) : '';
  const base = {
    title: label ? `Sign-in never came back — ${label.charAt(0).toLowerCase()}${label.slice(1)}` : 'Sign-in never came back',
    tone: 'warning' as const,
  };
  if (specific === 'aup') {
    return {
      ...base,
      title: 'Sign-in blocked: HubSpot wants the app’s Acceptable Use Policy signed',
      meaning: `HubSpot refused to install the builder’s app for this visitor and showed its message in the sign-in window instead of sending them back.${said} Nobody can connect until the policy is signed — it takes about a minute and needs no Marketplace listing.`,
      who: 'you',
      steps: [...aup.steps.slice(0, 2), 'Then ask the visitor to click Connect HubSpot again.'],
      links: aup.links,
    };
  }
  if (specific === 'install_permission') {
    return {
      ...base,
      title: 'Sign-in blocked: only a Super Admin can install the app in their HubSpot account',
      meaning: `The visitor opened HubSpot’s sign-in window, but HubSpot only lets Super Admins (or users with App Marketplace access) install the builder’s app the first time.${said}`,
      who: 'super_admin',
      steps: install.steps,
      links: install.links,
    };
  }
  if (specific === 'cancelled') {
    return { ...base, tone: 'info', meaning: `The visitor closed HubSpot’s sign-in window on purpose.${said}`, who: 'nobody', steps: [], links: [] };
  }
  if (specific === 'other') {
    const other = fixFor('other', ctx);
    return { ...base, meaning: `HubSpot showed the visitor a message in its window instead of sending them back.${said} ${other.summary}`, who: 'you', steps: other.steps, links: other.links };
  }
  return {
    ...base,
    meaning: `The visitor opened HubSpot’s sign-in window, but HubSpot never sent them back to the builder.${said} HubSpot shows install problems inside its own window, so the builder can’t see why. The usual reasons, most likely first:`,
    who: 'you',
    steps: [
      `Most often: HubSpot’s Acceptable Use Policy for the builder’s app isn’t signed yet. ${aup.steps[0]} ${aup.steps[1]}`,
      'Or the visitor isn’t allowed to install apps: the first person to connect from each HubSpot account must be a Super Admin (or have App Marketplace access).',
      'An app that isn’t listed on the HubSpot Marketplace can be installed in at most 25 HubSpot accounts.',
      'Or they simply closed the window — nothing to fix then.',
    ],
    links: aup.links,
  };
}

/** Host-side meaning of a sign-in result code. */
function signInFailure(e: DiagnosticEvent, ctx: ExplainContext): Explanation {
  const code = e.code ?? 'oauth_error';
  const visitorSaw = describeAuthResult(code);
  const base = { title: `Sign-in failed: ${visitorSaw.title}`, visitorSaw, tone: 'danger' as const, links: [] as Explanation['links'] };
  const setup = { label: 'Setup checklist', href: ctx.setupUrl };
  switch (code) {
    case 'access_denied':
      return { ...base, tone: 'info', meaning: 'The visitor chose not to give the builder access on HubSpot’s consent page.', who: 'nobody', steps: [] };
    case 'state_mismatch':
    case 'state_missing':
      return {
        ...base,
        tone: 'warning',
        meaning: 'The sign-in took longer than 10 minutes, was started in another tab, or the browser didn’t keep the builder’s cookies.',
        who: 'visitor',
        steps: ['Usually trying again works.', 'If it keeps happening for someone, ask them to allow cookies for this site.'],
      };
    case 'invalid_scope':
      return {
        ...base,
        meaning: 'HubSpot refused the permissions the builder asked for: the scopes of your HubSpot app don’t match the server’s settings.',
        who: 'you',
        steps: [
          'Compare the scopes on your HubSpot app’s Auth page with the builder’s (the setup checklist lists them).',
          'Don’t list retired scopes such as “tickets” or “e-commerce”: use the crm.objects.….read scopes instead.',
          'Then deploy the app again, or change HUBSPOT_SCOPES / HUBSPOT_OPTIONAL_SCOPES on your host.',
        ],
        links: [setup],
      };
    case 'token_exchange_failed':
      return {
        ...base,
        meaning: 'HubSpot didn’t accept the sign-in. Most often the client secret doesn’t belong to the client ID, or the app’s redirect URL isn’t exactly this builder’s address.',
        who: 'you',
        steps: [
          'Check HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET on your host against your HubSpot app’s Auth page.',
          `Check that the app’s redirect URL is exactly ${ctx.builderUrl}/api/auth/callback.`,
        ],
        links: [setup],
      };
    case 'hubspot_unreachable':
      return { ...base, tone: 'warning', meaning: 'HubSpot didn’t answer when the builder finished the sign-in.', who: 'hubspot', steps: ['It usually passes. If it lasts, check status.hubspot.com.'] };
    case 'not_configured':
      return { ...base, meaning: 'Sign in with HubSpot isn’t set up on the server.', who: 'you', steps: ['Open the setup checklist: it says which settings are missing.'], links: [setup] };
    case 'portal_not_allowed':
      return {
        ...base,
        meaning: 'Someone signed in with a HubSpot account that isn’t in ALLOWED_PORTALS, so the builder gave the access back.',
        who: 'you',
        steps: ['If they should use the builder, add their account id to ALLOWED_PORTALS in your host’s settings and redeploy.'],
      };
    case 'rate_limited':
      return { ...base, tone: 'warning', meaning: 'Too many sign-in attempts came from one place in a short time.', who: 'nobody', steps: ['It clears itself after a minute.'] };
    case 'bad_return_to':
      return { ...base, tone: 'info', meaning: 'Someone opened the sign-in address from outside the builder (an old bookmark or another site).', who: 'nobody', steps: [] };
    default:
      return {
        ...base,
        meaning: `HubSpot reported a problem (${code}) instead of connecting.`,
        who: 'you',
        steps: ['If it repeats, check your HubSpot app’s settings with the setup checklist.'],
        links: [setup],
      };
  }
}

/** Key problems as the host should read them: what it means, who fixes it, the steps. */
const KEY_PROBLEM_FOR_HOST: Record<KeyProblemKind, (e: DiagnosticEvent, ctx: ExplainContext) => Pick<Explanation, 'meaning' | 'who' | 'steps'>> = {
  missing_permission: () => ({
    meaning: 'The personal access key works, but it doesn’t have HubSpot’s “Developer projects” permission — and HubSpot only accepts projects from keys that have it.',
    who: 'visitor',
    steps: [
      'The person publishing opens HubSpot’s personal access key page (Publish → Get your key links straight to it).',
      'They add the Developer projects permission to their key and save — or create a new key with Developer projects ticked.',
      'Then they paste the key again and publish. Tip: tell people to tick Developer projects when they create their key.',
    ],
  }),
  portal_mismatch: () => ({
    meaning: 'The personal access key belongs to a different HubSpot account than the one they are connected to, and cards always go to the connected account.',
    who: 'visitor',
    steps: ['They use a key from the account they are connected to, or switch the HubSpot account they are connected to.'],
  }),
  portal_not_allowed: (e) => ({
    meaning: 'The key belongs to a HubSpot account that isn’t in ALLOWED_PORTALS, so the builder won’t publish there.',
    who: 'you',
    steps: [`If this account should publish, add ${e.portalId ?? 'its account id'} to ALLOWED_PORTALS in your host’s settings and redeploy.`],
  }),
  not_available: () => ({
    meaning: 'HubSpot doesn’t allow developer projects in that account, whatever key is used.',
    who: 'visitor',
    steps: ['They publish to an account that shows Development in HubSpot’s main menu, for example a developer test account.'],
  }),
  forbidden: () => ({
    meaning: 'HubSpot accepted the key but refused the upload. Usually the key’s user isn’t allowed to use developer tools in that account.',
    who: 'super_admin',
    steps: ['A Super Admin of that HubSpot account lets the user use developer tools (Settings → Users & Teams), or publishes with their own key.'],
  }),
  origin: (_e, ctx) => ({
    meaning: 'The request came from another address than the one the builder was set up for (APP_URL).',
    who: 'you',
    steps: [`Check that APP_URL is the address people open (this page is on ${ctx.builderUrl}), or add the other address to ALLOWED_ORIGINS, and redeploy.`],
  }),
};

/** Codes the host (not the person publishing) fixes. */
const HOST_PUBLISH_CODES = new Set(['not_configured', 'feature_disabled', 'portal_not_allowed', 'forbidden_origin', 'csrf']);

const PUBLISH_FAILURE_TITLES: Record<string, string> = {
  build_failed: 'HubSpot couldn’t build the project',
  deploy_failed: 'HubSpot built it but didn’t make it live',
  deploy_blocked: 'HubSpot built it but didn’t make it live',
  autodeploy_missing: 'HubSpot built it but didn’t make it live',
  project_locked: 'Another publish of this project was still running',
  superseded: 'A newer version was published meanwhile',
  invalid_key: 'The personal access key wasn’t accepted',
  key_expired: 'The personal access key wasn’t accepted',
  not_connected: 'Their HubSpot sign-in had expired',
  rate_limited: 'HubSpot was busy',
  timeout: 'HubSpot took too long',
  expired: 'HubSpot took too long',
  hubspot_unreachable: 'HubSpot didn’t answer',
  hubspot_unavailable: 'HubSpot didn’t answer',
  invalid_project: 'HubSpot didn’t accept the project',
  invalid_files: 'HubSpot didn’t accept the project',
  hubspot_rejected: 'HubSpot didn’t accept the project',
  feature_disabled: 'Publishing is turned off on this server',
  not_configured: 'Publishing isn’t set up on this server',
};

function publishProblem(e: DiagnosticEvent, ctx: ExplainContext, keyCheck: boolean): Explanation {
  const code = e.code ?? 'deploy_failed';
  const where = e.stage && !keyCheck ? ` ${STAGE_TEXT[e.stage]}` : '';
  const kind = keyProblemKind(code);
  if (kind) {
    // The builder's own title; what it means and the steps are told to the host (the builder's own
    // copy talks to the person publishing, about buttons on their screen).
    const copy = keyProblemCopy(kind, { key: e.portalId ? { portalId: e.portalId } : undefined, connected: null, builderUrl: ctx.builderUrl, setupUrl: ctx.setupUrl });
    const repeated = e.count > 1 ? ` It happened ${e.count} times in a row — the person publishing may not know what to change.` : '';
    const host = KEY_PROBLEM_FOR_HOST[kind](e, ctx);
    return {
      title: keyCheck ? `Key check: ${copy.title}` : `Publish refused: ${copy.title}`,
      meaning: `${host.meaning}${repeated}`,
      who: host.who,
      steps: host.steps,
      links: [],
      tone: 'danger',
    };
  }
  const described = describeError({ code, status: e.status });
  const title = PUBLISH_FAILURE_TITLES[code] ?? described.title;
  return {
    title: keyCheck ? `Key check: ${title}` : `Publish failed${where}: ${title}`,
    meaning: keyCheck ? 'The personal access key couldn’t be checked.' : `The publish stopped${where || ''} (${code}).`,
    who: HOST_PUBLISH_CODES.has(code) ? 'you' : code === 'hubspot_unreachable' || code === 'hubspot_unavailable' || code === 'rate_limited' ? 'hubspot' : 'visitor',
    steps: failureAdvice(code),
    links: [],
    tone: code === 'superseded' ? 'info' : 'danger',
  };
}

/** Host-side meaning of a refused API request. */
function apiProblem(e: DiagnosticEvent, ctx: ExplainContext): Explanation {
  const code = e.code ?? `http_${e.status ?? 0}`;
  const described = describeError({ code, status: e.status, message: '' });
  const route = e.route ?? '';
  const base = { title: `${described.title}`, visitorSaw: undefined, links: [] as Explanation['links'], tone: (e.status ?? 0) >= 500 ? ('danger' as const) : ('warning' as const) };
  switch (code) {
    case 'internal_error':
      return {
        ...base,
        title: 'Server error',
        meaning: `A bug in the builder’s server${e.errorName ? ` (${e.errorName})` : ''} while answering ${route || 'a request'}.`,
        who: 'you',
        steps: ['Your host’s logs have the details: search them for “[uiex-connector]” around this time.', 'If it keeps happening, report it to whoever maintains the builder.'],
      };
    case 'csrf':
    case 'forbidden_origin':
      return {
        ...base,
        title: 'Request from another address refused',
        meaning: 'A request came from another website, an old tab, or a different address than the one the builder was set up for (APP_URL). Nothing was answered.',
        who: 'you',
        steps: [
          `If people open the builder at a second address (for example a custom domain), set APP_URL to the one they use (now: ${ctx.builderUrl}) or add the other one to ALLOWED_ORIGINS.`,
          'Otherwise there is nothing to do: the builder refused it on purpose.',
        ],
      };
    case 'not_connected':
      return {
        ...base,
        tone: 'info',
        title: 'A visitor’s HubSpot sign-in had expired',
        meaning: 'Their sign-in expired or was removed (after 30 days, after Disconnect, or after SESSION_SECRET changed). The builder asks them to reconnect.',
        who: 'nobody',
        steps: [],
      };
    case 'not_admin':
      return {
        ...base,
        title: 'Someone who isn’t an admin tried to open this page',
        meaning: 'They were signed in with HubSpot but aren’t in ADMIN_EMAILS or ADMIN_PORTALS, so they saw nothing.',
        who: 'nobody',
        steps: ['If they should see it, add their HubSpot login email to ADMIN_EMAILS.'],
      };
    case 'admin_not_configured':
      return { ...base, title: 'The status page isn’t set up yet', meaning: 'Nobody is in ADMIN_EMAILS or ADMIN_PORTALS.', who: 'you', steps: ['Add your HubSpot login email to ADMIN_EMAILS on your host.'] };
    case 'portal_not_allowed':
      return { ...base, meaning: 'A HubSpot account that isn’t in ALLOWED_PORTALS was used.', who: 'you', steps: ['If it should be allowed, add its account id to ALLOWED_PORTALS and redeploy.'] };
    case 'not_found':
      if (route.includes('(unknown address)')) {
        return {
          ...base,
          tone: 'info',
          title: 'Request for an address the builder doesn’t have',
          meaning: 'Usually robots probing websites, or an old version of the builder still open in someone’s tab.',
          who: 'nobody',
          steps: [],
        };
      }
      return { ...base, tone: 'info', meaning: 'HubSpot couldn’t find what the preview asked for (a deleted record, or one in another account).', who: 'nobody', steps: [] };
    case 'missing_scope':
      return { ...base, meaning: described.message, who: 'super_admin', steps: [] };
    case 'feature_disabled':
      return { ...base, title: 'Publishing is turned off', meaning: 'Someone tried to publish, but ENABLE_DEPLOY is false on this server.', who: 'you', steps: ['Remove ENABLE_DEPLOY (or set it to true) if people should publish from the builder.'] };
    case 'rate_limited':
      return { ...base, meaning: 'Too many requests came from one person in a short time. It clears itself.', who: 'nobody', steps: [] };
    case 'payload_too_large':
      return { ...base, title: 'Something sent was too large', meaning: 'A request was larger than the server accepts (for example a very large project).', who: 'visitor', steps: [] };
    case 'hubspot_error':
    case 'hubspot_unreachable':
    case 'timeout':
      return { ...base, meaning: described.message, who: 'hubspot', steps: ['It usually passes. If it lasts, check status.hubspot.com.'] };
    default:
      return { ...base, meaning: described.message, who: (e.status ?? 0) >= 500 ? 'you' : 'nobody', steps: [] };
  }
}

/** "/" → "in the editor", "/status" → "on the status page". */
function pageName(path: string): string {
  if (path === '/' || path === '/index.html') return 'in the editor';
  if (path === '/status' || path.startsWith('/status/')) return 'on the status page';
  return `on ${path}`;
}

const CLIENT_SOURCE_TEXT = {
  error: 'an error nobody caught',
  unhandledrejection: 'a failed background task',
  react: 'the editor crashed and showed its recovery screen',
} as const;

/** Plain-language title and explanation of an event for the host. */
export function explainEvent(e: DiagnosticEvent, ctx: ExplainContext): Explanation {
  const none = { who: 'nobody' as const, steps: [] as string[], links: [] as Explanation['links'] };
  switch (e.kind) {
    case 'server.started':
      return {
        ...none,
        title: 'Server started — this page’s history begins here',
        meaning: `The builder’s server started (after a deploy, a restart or waking up from sleep)${e.version ? `, version ${e.version}` : ''}. Anything earlier is only in your host’s logs: search them for “[event]”.`,
        tone: 'info',
      };
    case 'signin.started':
      if (e.outcome === 'pending') {
        return { ...none, title: 'Sign-in in progress', meaning: 'A visitor opened HubSpot’s sign-in window. If HubSpot doesn’t send them back within 10 minutes, it shows here as “never came back”.', tone: 'pending' };
      }
      return { ...none, title: 'Sign-in started', meaning: 'A visitor opened HubSpot’s sign-in window.', tone: 'info' };
    case 'signin.completed':
      return {
        ...none,
        title: `Signed in to ${account(e.portalId)}`,
        meaning: e.durationMs !== undefined ? `Connecting took ${formatDuration(e.durationMs)}.` : 'A visitor connected their HubSpot account.',
        tone: 'ok',
      };
    case 'signin.failed':
      return signInFailure(e, ctx);
    case 'signin.abandoned':
      return neverCameBack(ctx, e);
    case 'signin.feedback': {
      const kind = e.feedback ?? 'nothing';
      if (TROUBLE_KINDS.has(kind)) {
        const fix = fixFor(kind as SignInTrouble, ctx);
        return {
          title: `Visitor reported: ${feedbackLabel(kind)}`,
          meaning: fix.summary,
          who: fix.who === 'host' ? 'you' : fix.who === 'super_admin' ? 'super_admin' : 'visitor',
          steps: fix.steps,
          links: fix.links,
          tone: kind === 'cancelled' ? 'info' : 'warning',
        };
      }
      const saw = describeAuthResult(kind);
      return { title: `Visitor reported: ${feedbackLabel(kind)}`, meaning: saw.message, who: 'visitor', steps: [], links: [], tone: 'warning', visitorSaw: saw };
    }
    case 'publish.key_check':
      if (e.outcome === 'ok') {
        return {
          ...none,
          title: `Key checked: ready to publish to ${account(e.portalId)}`,
          meaning: e.developerProjects === 'yes' ? 'The personal access key has the “Developer projects” permission.' : 'The personal access key works.',
          tone: 'ok',
        };
      }
      return publishProblem(e, ctx, true);
    case 'publish.started':
      if (e.outcome === 'pending') {
        return { ...none, title: `Publishing to ${account(e.portalId)}…`, meaning: 'The project was uploaded and HubSpot is building it.', tone: 'pending' };
      }
      return {
        title: 'Publish not followed to the end',
        meaning: 'The builder uploaded the project, then stopped hearing from the browser (the Publish window or the tab was closed). HubSpot may well have finished it.',
        who: 'nobody',
        steps: ['To be sure, open the project in HubSpot (Development → Projects) and look at its latest build.'],
        links: [],
        tone: 'info',
      };
    case 'publish.succeeded':
      return {
        ...none,
        title: `Published to ${account(e.portalId)}${e.buildId ? ` (build #${e.buildId})` : ''}`,
        meaning: e.durationMs !== undefined ? `From upload to live took ${formatDuration(e.durationMs)}.` : 'The project is live in HubSpot.',
        tone: 'ok',
      };
    case 'publish.failed':
      return publishProblem(e, ctx, false);
    case 'api.error':
      return apiProblem(e, ctx);
    case 'client.error': {
      const c = e.client;
      const older = c?.build && ctx.currentBuild && c.build !== 'dev' && ctx.currentBuild !== 'dev' && c.build !== ctx.currentBuild;
      return {
        title: `Browser error: ${c?.message ?? 'unknown'}`,
        meaning: `Something went wrong in a visitor’s browser${c ? ` (${CLIENT_SOURCE_TEXT[c.source]})` : ''}${c?.path ? ` ${pageName(c.path)}` : ''}.${older ? ` It came from an older version of the builder (build ${c?.build}; this page is build ${ctx.currentBuild}): reloading the page may be all they need.` : ''}`,
        who: 'you',
        steps: ['If it keeps happening, send the message and the details below to whoever maintains the builder.'],
        links: [],
        tone: 'danger',
      };
    }
    default:
      return { ...none, title: e.kind, meaning: '', tone: 'info' };
  }
}
