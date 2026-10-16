/**
 * Plain-language copy for the connection UI: what each HubSpot permission (scope) means, and what
 * an error means for the person using the builder (and what they can do about it).
 */
import { findStandardType } from './objectTypes';

const SCOPE_LABELS: Record<string, string> = {
  oauth: 'Confirm who you are',
  tickets: 'See tickets',
  'crm.objects.custom.read': 'See custom object records',
  'crm.schemas.custom.read': 'See custom object definitions',
  'crm.objects.owners.read': 'See record owners (names of users)',
  'crm.objects.users.read': 'See users',
  'crm.lists.read': 'See lists',
  'crm.export': 'Export records',
};

/** "crm.objects.contacts.read" → "See contacts"; unknown scopes are returned as-is. */
export function scopeLabel(scope: string): string {
  const known = SCOPE_LABELS[scope];
  if (known) return known;
  const m = /^crm\.(objects|schemas)\.([a-z0-9_]+)\.(read|write)$/.exec(scope);
  if (m) {
    const [, kind, object, access] = m;
    const std = findStandardType(object);
    const noun = (std?.label ?? object.replace(/_/g, ' ')).toLowerCase();
    const verb = access === 'read' ? 'See' : 'Change';
    if (kind === 'schemas') return `${verb} ${singular(noun)} properties`;
    return `${verb} ${noun}`;
  }
  return scope;
}

function singular(noun: string): string {
  if (noun.endsWith('ies')) return `${noun.slice(0, -3)}y`;
  if (noun.endsWith('s')) return noun.slice(0, -1);
  return noun;
}

/** "See tickets", "See deals and See deal properties" for a list of scopes. */
export function scopeList(scopes: readonly string[]): string {
  const labels = [...new Set(scopes.map(scopeLabel))].map((l, i) => (i === 0 ? l : l.charAt(0).toLowerCase() + l.slice(1)));
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

export interface FriendlyError {
  /** Short headline. */
  title: string;
  /** What happened and what to do, in plain language. */
  message: string;
  /** Suggested fix the UI can offer as a button. */
  action?: 'reconnect' | 'retry' | 'none';
  /** Label of that button when it needs saying more precisely ("Reconnect to grant access"). */
  actionLabel?: string;
  /** For missing permissions: the scopes needed. */
  requiredScopes?: string[];
  /** 'warning' (amber: not broken, just not included) or 'error' (default). */
  tone?: 'warning' | 'error';
  /** One line for compact places (e.g. under a field in the Data panel). */
  short?: string;
  /** The person can keep going with mock data (the UI offers "Use mock data"). */
  offerMock?: boolean;
}

/**
 * Whether a one-line message (FriendlyError.short, as catalog hooks report it) is about a
 * permission the connection doesn't include — the fix is "Reconnect to grant access".
 */
export function isMissingAccessMessage(text: string | null | undefined): boolean {
  return !!text && /included in (this|your) HubSpot connection/.test(text);
}

/** "crm.objects.tickets.read" → "tickets"; "crm.schemas.deals.read" → "deal properties". */
export function scopeNoun(scope: string): string {
  const label = scopeLabel(scope);
  if (label === scope) return scope;
  const noun = label.replace(/^(See|Change) /, '').replace(/\s*\(.*\)$/, '');
  return noun.charAt(0).toLowerCase() + noun.slice(1);
}

function nounList(scopes: readonly string[]): string {
  const nouns = [...new Set(scopes.map(scopeNoun))];
  if (nouns.length <= 1) return nouns[0] ?? '';
  return `${nouns.slice(0, -1).join(', ')} and ${nouns[nouns.length - 1]}`;
}

interface ErrorLike {
  code?: string;
  message?: string;
  status?: number;
  requiredScopes?: string[];
  retryAfter?: number;
}

/** Explains a connector error (or anything thrown) for people who never open a terminal. */
export function describeError(err: unknown): FriendlyError {
  const e: ErrorLike = err && typeof err === 'object' ? (err as ErrorLike) : {};
  const code = typeof e.code === 'string' ? e.code : '';
  const serverMessage = typeof e.message === 'string' && e.message ? e.message : '';
  switch (code) {
    case 'missing_scope': {
      const scopes = e.requiredScopes?.filter(Boolean) ?? [];
      const noun = nounList(scopes);
      const What = noun ? noun.charAt(0).toUpperCase() + noun.slice(1) : '';
      return {
        title: noun ? `${What} aren’t available in this connection` : 'Not available in this connection',
        message: noun
          ? `The builder can’t see ${noun} in your HubSpot account yet. Usually the connection was made before ${noun} were included, or your HubSpot plan or user doesn’t include them. Click Reconnect to grant access and approve in HubSpot. If you still see this, ask a HubSpot Super Admin to check your user’s permissions — or keep designing with mock data.`
          : 'Your HubSpot connection doesn’t include this yet. Click Reconnect to grant access and approve in HubSpot. If you still see this, ask a HubSpot Super Admin to check your user’s permissions — or keep designing with mock data.',
        short: noun ? `${What} aren’t included in this HubSpot connection.` : 'This isn’t included in your HubSpot connection.',
        action: 'reconnect',
        actionLabel: 'Reconnect to grant access',
        tone: 'warning',
        offerMock: true,
        requiredScopes: scopes,
      };
    }
    case 'not_connected':
      return {
        title: 'Your HubSpot sign-in expired',
        message: 'Your HubSpot sign-in has expired or was removed. Reconnect to keep using real data — nothing you built is lost.',
        action: 'reconnect',
        actionLabel: 'Reconnect',
      };
    case 'rate_limited': {
      const secs = typeof e.retryAfter === 'number' && e.retryAfter > 0 ? Math.ceil(e.retryAfter) : null;
      return {
        title: 'HubSpot is busy',
        message: `HubSpot is receiving too many requests right now. ${secs ? `Wait ${secs} second${secs === 1 ? '' : 's'} and try again.` : 'Wait a moment and try again.'}`,
        action: 'retry',
      };
    }
    case 'network_error':
      return { title: "Couldn't reach the builder's server", message: 'Check your internet connection and try again.', action: 'retry' };
    case 'unavailable':
    case 'connector_offline':
      return { title: 'HubSpot connection unavailable', message: 'This copy of the builder has no HubSpot connector, so it can only show mock data.', action: 'none' };
    case 'not_configured':
      return { title: 'Sign in with HubSpot is not set up', message: serverMessage || "This server isn't configured for HubSpot sign-in yet.", action: 'none' };
    case 'not_found':
      return { title: 'Not found in HubSpot', message: serverMessage || "HubSpot couldn't find that — it may have been deleted, or it isn't in this account.", action: 'none' };
    case 'forbidden':
      return { title: 'No access', message: serverMessage || "HubSpot says your user doesn't have access to this.", action: 'none' };
    case 'timeout':
      return { title: 'HubSpot took too long', message: serverMessage || 'HubSpot took too long to answer. Please try again.', action: 'retry' };
    default:
      return {
        title: 'Something went wrong',
        message: serverMessage || 'Something went wrong while talking to HubSpot. Please try again.',
        action: 'retry',
      };
  }
}

/** Messages for the `uiex_auth` / popup result codes produced by the connector's sign-in pages. */
export function describeAuthResult(code: string, serverMessage?: string): { title: string; message: string } {
  switch (code) {
    case 'access_denied':
      return { title: 'HubSpot was not connected', message: 'You chose not to give the builder access. Nothing was shared. You can try again whenever you like.' };
    case 'state_mismatch':
    case 'state_missing':
      return { title: 'Sign-in expired', message: 'The sign-in took too long or was started in another window. Please try again.' };
    case 'invalid_scope':
      return { title: 'HubSpot refused the requested access', message: "The builder asked for permissions this HubSpot app isn't set up for. Ask whoever hosts the builder to check the app's scopes." };
    case 'popup_closed':
      return {
        title: 'HubSpot was not connected',
        message:
          'The HubSpot window closed before connecting finished, so nothing was shared. If HubSpot showed an error first: “acceptable use policy” means whoever hosts this builder must sign it in HubSpot (the app’s Distribution page); “not allowed to install” means a HubSpot Super Admin needs to connect first. Otherwise, just try again.',
      };
    case 'timeout':
      return { title: 'Connecting took too long', message: 'We stopped waiting for HubSpot. Please try again.' };
    case 'session_not_kept':
      return {
        title: "Couldn't keep you signed in",
        message: 'HubSpot approved the connection, but your browser did not keep the sign-in. Allow cookies for this site and try again.',
      };
    case 'hubspot_unreachable':
      return { title: "Couldn't reach HubSpot", message: 'HubSpot did not respond. Check your internet connection and try again.' };
    case 'network_error':
      return { title: "Couldn't reach the builder's server", message: 'The sign-in finished, but the builder could not check it. Check your internet connection and try again.' };
    case 'token_exchange_failed':
      return { title: "Couldn't finish connecting", message: "HubSpot didn't accept the sign-in. Please try again. If it keeps happening, ask whoever hosts the builder to check the app settings." };
    case 'not_configured':
      return { title: 'Sign in with HubSpot is not set up', message: "HubSpot sign-in isn't switched on for this builder yet. Ask the person who set it up to finish the setup checklist." };
    case 'portal_not_allowed':
      return {
        title: 'This HubSpot account can’t be used here',
        message: 'This builder only works with specific HubSpot accounts. Ask the person who set up the builder to add your account, or connect a different one.',
      };
    case 'rate_limited':
      return { title: 'Too many sign-in attempts', message: 'Please wait a minute and try again.' };
    default:
      return { title: "Couldn't connect HubSpot", message: serverMessage || 'Something went wrong while connecting. Please try again.' };
  }
}
