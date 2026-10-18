/**
 * Status page (diagnostics) contract — shared by the connector (server/core/diagnostics) and the
 * private Status page (src/status). TYPES AND CONSTANTS ONLY: the server compiles this file too, so
 * it must not import browser- or Vite-specific code.
 *
 * What is recorded (in the server's memory only, see server/core/diagnostics/log.ts): sign-ins,
 * publishes, refused API requests and errors reported by browsers. Never tokens, keys, cookies,
 * CRM record data, email addresses or messages that may echo what someone typed. Visitors are an
 * anonymous id (a salted hash of their IP address; the salt changes every day) plus the HubSpot
 * account id they signed in to.
 */

export const DIAGNOSTICS_ROUTES = {
  /** GET → AdminAccess: who is asking and whether they may see the status page (never any events). */
  access: '/api/admin/access',
  /** GET → DiagnosticsSnapshot (admins only: signed in with HubSpot + ADMIN_EMAILS / ADMIN_PORTALS). */
  diagnostics: '/api/admin/diagnostics',
  /** POST ClientReport → 204. Browsers report errors and what the HubSpot sign-in window showed. */
  report: '/api/diagnostics/report',
} as const;

/** Where the Status page lives in the builder (served by the SPA fallback on every host). */
export const STATUS_PAGE_PATH = '/status';

/** Largest report body the connector accepts (bytes). */
export const CLIENT_REPORT_MAX_BYTES = 8 * 1024;

export type DiagnosticKind =
  /** The connector (re)started: the log begins here. */
  | 'server.started'
  /** Sign-in window opened (HubSpot's consent page). Updated in place when it ends. */
  | 'signin.started'
  | 'signin.completed'
  | 'signin.failed'
  /** Started, but HubSpot never sent the visitor back within 10 minutes (inferred). */
  | 'signin.abandoned'
  /** The visitor told the builder what the HubSpot window showed (it never came back). */
  | 'signin.feedback'
  /** A personal access key was checked before publishing. */
  | 'publish.key_check'
  /** The project was uploaded and HubSpot is building it. Updated in place when it ends. */
  | 'publish.started'
  | 'publish.succeeded'
  | 'publish.failed'
  /** Any other refused or failed /api request. */
  | 'api.error'
  /** An error in a visitor's browser (the builder itself, never the visitor's own card code). */
  | 'client.error';

export type DiagnosticOutcome = 'ok' | 'failed' | 'warning' | 'info' | 'pending';

/** Where a publish was when it ended. */
export type PublishStage = 'key_check' | 'upload' | 'build' | 'deploy';

export interface DiagnosticEvent {
  /** Increasing number (unique while the server runs). */
  id: number;
  kind: DiagnosticKind;
  outcome: DiagnosticOutcome;
  /** First occurrence (epoch ms). */
  at: number;
  /** Latest occurrence or update (epoch ms); equals `at` when it happened once. */
  lastAt: number;
  /** How many times it happened (identical problems from the same visitor are merged). */
  count: number;
  /** Anonymous visitor id (6 hex characters; changes every day). */
  visitor?: string;
  /** HubSpot account (portal) id. */
  portalId?: number;
  /** Machine code: an error code ('missing_scope'), a key-check problem or a sign-in result code. */
  code?: string;
  /** HTTP status of the answer. */
  status?: number;
  /** Route pattern, e.g. "POST /api/deploy" (never the raw address: it can hold record ids). */
  route?: string;
  /** Publishing: where it ended. */
  stage?: PublishStage;
  /** How long it took (sign-in: window opened → came back; publish: upload → live). */
  durationMs?: number;
  /** Sign-in: 'popup' or 'redirect' (full page). */
  mode?: 'popup' | 'redirect';
  /** Publish: HubSpot's build number. */
  buildId?: number;
  /** Key check: whether the key has the "Developer projects" permission. */
  developerProjects?: 'yes' | 'no' | 'unknown';
  /** signin.feedback / signin.abandoned: what the visitor said the HubSpot window showed. */
  feedback?: SignInFeedbackKind;
  /** client.error: sanitised details. */
  client?: ClientErrorDetails;
  /** api.error with code internal_error: the JavaScript error type (e.g. "TypeError"), never its message. */
  errorName?: string;
  /** server.started: connector version and build. */
  version?: string;
}

export interface ClientErrorDetails {
  source: ClientErrorSource;
  /** Error type ("TypeError"). */
  name?: string;
  /** Sanitised message (URLs without query strings, no email addresses or tokens, ≤ 300 characters). */
  message: string;
  /** Sanitised stack (≤ 12 lines). */
  stack?: string;
  /** Builder page path (no query string). */
  path?: string;
  /** Build of the builder that reported it (hash of its main script; "dev" in development). */
  build?: string;
}

export type ClientErrorSource = 'error' | 'unhandledrejection' | 'react';

/** What a visitor said the HubSpot sign-in window showed (src/connect/signInHelp.ts) or how it ended. */
export type SignInFeedbackKind = 'aup' | 'install_permission' | 'cancelled' | 'nothing' | 'other' | 'popup_closed' | 'popup_blocked' | 'timeout';

export const SIGN_IN_FEEDBACK_KINDS: readonly SignInFeedbackKind[] = ['aup', 'install_permission', 'cancelled', 'nothing', 'other', 'popup_closed', 'popup_blocked', 'timeout'];

export interface ClientErrorReport {
  type: 'client_error';
  source: ClientErrorSource;
  name?: string;
  message: string;
  stack?: string;
  path?: string;
  build?: string;
}

export interface SignInFeedbackReport {
  type: 'signin_feedback';
  kind: SignInFeedbackKind;
}

export type ClientReport = ClientErrorReport | SignInFeedbackReport;

export interface DiagnosticCounters {
  signInStarted: number;
  signInCompleted: number;
  signInFailed: number;
  signInAbandoned: number;
  publishStarted: number;
  publishSucceeded: number;
  publishFailed: number;
  /** Key checks that found a problem (missing permission, wrong account …). */
  keyCheckProblems: number;
  /** Refused or failed /api requests (outside sign-in and publishing). */
  apiErrors: number;
  /** Of those, server errors (5xx). */
  serverErrors: number;
  /** Errors reported by browsers. */
  clientErrors: number;
}

export interface DiagnosticsServerInfo {
  /** When this server process (or edge instance) started: the log begins here. */
  startedAt: number;
  /** Connector version. */
  version: string;
  /** Git commit the server was built from, when the host reports it (Render, Vercel, Cloudflare). */
  commit?: string;
  /**
   * True on the Node server (Render, Docker, npm start): one process keeps the whole log. False on
   * edge hosts (Vercel, Cloudflare), where each instance keeps its own and this page shows one of them.
   */
  singleProcess: boolean;
  signInConfigured: boolean;
  /** Settings sign-in still needs (names only). */
  missingSettings: string[];
  deployEnabled: boolean;
  /** ALLOWED_PORTALS (empty: any account). */
  allowedPortals: number[];
  /** How many emails ADMIN_EMAILS lists, and ADMIN_PORTALS. */
  adminEmailCount: number;
  adminPortals: number[];
}

export interface DiagnosticsSnapshot {
  /** Server clock when the snapshot was taken (epoch ms). */
  now: number;
  server: DiagnosticsServerInfo;
  /** Ring buffer size, events kept and events dropped because it was full. */
  capacity: { max: number; kept: number; dropped: number };
  /** Abandoned sign-ins are inferred after this long without a callback. */
  abandonAfterMs: number;
  summary: { lastHour: DiagnosticCounters; lastDay: DiagnosticCounters };
  /** Sign-ins and publishes still in progress. */
  inProgress: { signIns: number; publishes: number };
  /** The anonymous visitor id of the person asking (to mark "you"). */
  you?: string;
  /** Newest first (by lastAt). */
  events: DiagnosticEvent[];
}

export interface AdminAccess {
  /** Sign in with HubSpot is set up on this server (admins must sign in). */
  signInConfigured: boolean;
  /** Settings sign-in still needs (names only), when it isn't set up. */
  missingSettings?: string[];
  signedIn: boolean;
  /** May see the status page. */
  admin: boolean;
  /** ADMIN_EMAILS or ADMIN_PORTALS is set. */
  adminConfigured: boolean;
  /** The signed-in HubSpot user (their own details, to copy into ADMIN_EMAILS). */
  account?: { portalId: number; hubDomain?: string; email?: string };
}
