/**
 * Connector API contract — shared by the browser client (src/connect) and the hosted server
 * (server/). TYPES ONLY: this file must not import browser- or Vite-specific code because the
 * server compiles it too.
 *
 * The connector is a small backend that signs the user in with HubSpot (OAuth), keeps the tokens in
 * an encrypted HttpOnly cookie, and exposes read-only CRM endpoints so the builder can preview
 * extensions with REAL portal data. All routes live under `/api` on the same origin as the builder.
 *
 * Every request from the client sends `X-UIEX-Request: 1` (CSRF guard) and `credentials: 'include'`.
 * Errors are returned as `ConnectorErrorBody` with a non-2xx status.
 */

/** Route paths (relative to the connector base URL, normally same-origin ''). */
export const CONNECTOR_ROUTES = {
  health: '/api/health', // GET  -> ConnectorHealth (no auth)
  authStart: '/api/auth/start', // GET  (browser navigation, opened in a popup) ?returnTo=<origin>
  authCallback: '/api/auth/callback', // GET  (HubSpot redirects here) -> HTML that notifies the opener
  logout: '/api/auth/logout', // POST -> { ok: true }
  me: '/api/me', // GET  -> ConnectionInfo
  objectTypes: '/api/crm/object-types', // GET  -> CrmObjectTypeInfo[]
  properties: '/api/crm/properties/:objectType', // GET  -> CrmPropertyDef[]
  pipelines: '/api/crm/pipelines/:objectType', // GET  -> CrmPipeline[]
  owners: '/api/crm/owners', // GET  -> CrmOwner[]
  searchRecords: '/api/crm/records/:objectType/search', // GET ?q=&limit= -> CrmRecordSummary[] (record picker)
  record: '/api/crm/records/:objectType/:id', // GET ?properties=a,b&formatted=1 (or formatted=a,b: only those) -> CrmRecord
  associations: '/api/crm/records/:objectType/:id/associations/:toObjectType', // GET ?properties=&limit= -> AssociationResultDTO[]
  search: '/api/crm/search/:objectType', // POST CrmSearchRequestDTO -> CrmSearchResponseDTO
  proxyFetch: '/api/proxy/fetch', // POST ProxyFetchRequest -> ProxyFetchResponse (preview of hubspot.fetch)
  deployStart: '/api/deploy', // POST DeployRequest -> DeployStatus (beta)
  deployStatus: '/api/deploy/:deployId', // GET -> DeployStatus (older clients; prefer deployPoll)
  deployKey: '/api/deploy/key', // GET -> DeployKeyInfo (always { remembered: false }: keys are never stored); DELETE -> same
  deployPoll: '/api/deploy/status', // POST { deployId } -> DeployStatus (keeps the deployId out of URLs and access logs)
  deployCheckKey: '/api/deploy/check-key', // POST DeployKeyCheckRequest -> DeployKeyCheck (before uploading anything)
} as const;

export const CSRF_HEADER = 'X-UIEX-Request';

export interface ConnectorHealth {
  ok: true;
  /** Connector server version. */
  version: string;
  /** False when HUBSPOT_CLIENT_ID / HUBSPOT_CLIENT_SECRET / SESSION_SECRET are not configured. */
  oauthConfigured: boolean;
  features: {
    crm: boolean;
    fetchProxy: boolean;
    deploy: boolean;
    /**
     * Why `deploy` is false: 'disabled' (ENABLE_DEPLOY=false — the host turned it off) or
     * 'session_secret' (SESSION_SECRET is missing or too short — setup isn't finished).
     */
    deployUnavailableReason?: 'disabled' | 'session_secret';
    /** True when deploying needs a HubSpot sign-in (always, once sign-in is set up). */
    deployNeedsSignIn?: boolean;
  };
  /** Scopes the connector requests at sign-in (required + optional), for the consent explainer. */
  scopes: { required: string[]; optional: string[] };
  /** Names of the server settings that are still missing (never their values), e.g. ['HUBSPOT_CLIENT_ID']. */
  missingSettings?: string[];
  /**
   * HUBSPOT_APP_BASE when it is not https://app.hubspot.com (an EU data centre, or the fake HubSpot
   * of the demo): links into HubSpot (personal access key page, records, settings) use it.
   */
  appBase?: string;
}

export type ConnectionInfo =
  | {
      connected: true;
      portalId: number;
      /** e.g. "acme.com" or "app.hubspot.com" — informational. */
      hubDomain: string;
      user: { id?: number; email: string };
      /** Scopes actually granted. */
      scopes: string[];
      /** Epoch ms when the current access token expires (server refreshes automatically). */
      expiresAt: number;
      /** HubSpot region/app host for deep links, e.g. "app.hubspot.com" or "app-eu1.hubspot.com". */
      appHost: string;
    }
  | { connected: false; reason?: 'signed-out' | 'expired' | 'revoked' };

export interface CrmObjectTypeInfo {
  /** Name usable in card objectTypes and CRM API paths, e.g. "contacts", "p_projects". */
  objectType: string;
  /** e.g. "0-1" or "2-1234567". */
  objectTypeId: string;
  label: string;
  pluralLabel: string;
  primaryDisplayProperty: string;
  /** Extra properties worth showing in record pickers (e.g. email for contacts). */
  secondaryDisplayProperties: string[];
  custom: boolean;
}

export interface CrmPropertyOption {
  label: string;
  value: string;
  description?: string;
  displayOrder?: number;
  hidden?: boolean;
}

export interface CrmPropertyDef {
  name: string;
  label: string;
  /** HubSpot property type: string | number | date | datetime | enumeration | bool | phone_number ... */
  type: string;
  /** HubSpot field type: text | textarea | number | select | radio | checkbox | booleancheckbox | date | ... */
  fieldType: string;
  description?: string;
  groupName?: string;
  options?: CrmPropertyOption[];
  hidden?: boolean;
  calculated?: boolean;
  /** true for HubSpot's default properties, false for the portal's own (custom) ones. */
  hubspotDefined?: boolean;
  /** Read-only properties (calculated / system). */
  readOnlyValue?: boolean;
}

export interface CrmPipeline {
  id: string;
  label: string;
  displayOrder: number;
  stages: Array<{ id: string; label: string; displayOrder: number; metadata?: Record<string, string> }>;
}

export interface CrmOwner {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  userId?: number;
}

/** Lightweight record used by the record picker. */
export interface CrmRecordSummary {
  id: string;
  objectType: string;
  objectTypeId: string;
  /** Primary display value (e.g. "Ada Lovelace", "Acme Inc", "Big deal"). */
  label: string;
  /** Secondary line (e.g. email, domain, amount). */
  secondary?: string;
  /** Deep link to the record in HubSpot. */
  url?: string;
}

export interface CrmRecord {
  id: string;
  objectType: string;
  objectTypeId: string;
  properties: Record<string, string | null>;
}

/** Same shape as @hubspot/ui-extensions AssociationResult (what useAssociations returns). */
export interface AssociationResultDTO {
  toObjectId: number;
  associationTypes: Array<{ category: string; typeId: number; label: string }>;
  properties: Record<string, string | null>;
}

/** Mirrors @hubspot/ui-extensions FetchCrmSearchRequest (what useCrmSearch accepts). */
export interface CrmSearchRequestDTO {
  properties?: string[];
  query?: string;
  filterGroups?: Array<{
    filters: Array<{
      propertyName: string;
      operator: string;
      value?: string | number | boolean;
      values?: Array<string | number | boolean>;
      highValue?: string | number | boolean;
    }>;
  }>;
  sorts?: Array<{ propertyName: string; direction: 'ASCENDING' | 'DESCENDING' }>;
  pageLength?: number;
  after?: string;
  /** true: format every property; a list: only those (like propertiesToFormat). */
  formatted?: boolean | string[];
}

/** Mirrors @hubspot/ui-extensions CrmSearchResponse. */
export interface CrmSearchResponseDTO {
  results: Array<{ objectId: number; properties: Record<string, string | null> }>;
  total: number;
  hasMore: boolean;
  after?: string;
}

export interface ProxyFetchRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  /** JSON body (hubspot.fetch only sends JSON bodies). */
  body?: unknown;
  timeoutMs?: number;
}

export interface ProxyFetchResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  /** Response text (truncated to the connector's max size). */
  body: string;
  truncated: boolean;
}

/**
 * Terminal-free deploy (beta): upload an exported project with the admin's personal access key.
 * Once HubSpot sign-in is set up on the server, deploying needs a signed-in session and the key must
 * belong to the connected account (error 'not_connected' / 'portal_mismatch' otherwise).
 */
export interface DeployRequest {
  /** HubSpot personal access key (Settings → Integrations → Personal access key). Never stored. */
  personalAccessKey?: string;
  /**
   * @deprecated Keys are no longer remembered (any script on the page could have deployed with a
   * stored key). Sending it without a key answers 400 'no_remembered_key'.
   */
  useRememberedKey?: boolean;
  /** @deprecated Ignored: keys are never stored. */
  remember?: boolean;
  /** Target portal id: must be the connected portal when signed in (only used before sign-in is set up). */
  portalId?: number;
  projectName: string;
  platformVersion: string;
  /** Project files (same as generateProjectFiles output; text only). */
  files: Array<{ path: string; contents: string }>;
}

export type DeployPhase = 'queued' | 'authenticating' | 'uploading' | 'building' | 'deploying' | 'success' | 'failed';

export interface DeployStatus {
  deployId: string;
  phase: DeployPhase;
  message: string;
  /** Human-readable log lines (build/deploy warnings and errors). */
  log: string[];
  portalId?: number;
  projectName: string;
  buildId?: number;
  /** Deep link to the project in HubSpot once uploaded. */
  projectUrl?: string;
  error?: string;
  /**
   * Once deployed: a link that installs the app in the account (static-auth apps), when HubSpot
   * reported the app id. Otherwise install from the project page (Distribution).
   */
  installUrl?: string;
}

/** POST /api/deploy/check-key — what the builder learns about a key before it uploads anything. */
export interface DeployKeyCheckRequest {
  personalAccessKey: string;
  /** Target portal before HubSpot sign-in is set up (ignored when signed in: the target is the connected account). */
  portalId?: number;
}

/** The HubSpot account a personal access key belongs to, as HubSpot reported it when the key was exchanged. */
export interface DeployKeyAccount {
  portalId: number;
  /** HubSpot's name for the account ("hubName"), when it sent one. */
  name?: string;
  /** HubSpot's account type (STANDARD, DEVELOPER_TEST, APP_DEVELOPER, SANDBOX …), when it sent one. */
  accountType?: string;
  /**
   * Whether the key has the "Developer projects" permission, read from the scope groups HubSpot
   * returned: 'unknown' when HubSpot listed none.
   */
  developerProjects: 'yes' | 'no' | 'unknown';
  /** HubSpot's personal access key page of that account (where the key's permissions are changed). */
  keyPageUrl: string;
}

/** Problems a key check can find (the key itself works). */
export type DeployKeyProblem = 'missing_permission' | 'portal_mismatch' | 'portal_not_allowed';

export interface DeployKeyCheck {
  /** True when publishing with this key can go ahead. */
  ok: boolean;
  key: DeployKeyAccount;
  /** Where publishing goes: the connected account when signed in (else the requested account, if any). */
  target?: { portalId: number; name?: string };
  /** The first thing to fix when !ok. */
  problem?: DeployKeyProblem;
  /** Plain-language explanation of `problem`. */
  message?: string;
}

/** GET/DELETE /api/deploy/key — kept for older clients: keys are never remembered any more (always false). */
export interface DeployKeyInfo {
  remembered: boolean;
  /** Portal the remembered key belongs to. */
  portalId?: number;
}

export interface ConnectorErrorBody {
  error: {
    /** Stable machine code, e.g. 'not_connected', 'missing_scope', 'hubspot_error', 'bad_request', 'rate_limited'. */
    code: string;
    message: string;
    status: number;
    /** HubSpot correlation id when the error came from HubSpot. */
    correlationId?: string;
    /** For 'missing_scope': the scope(s) needed. */
    requiredScopes?: string[];
    /** For 'portal_mismatch' (deploy): the HubSpot account the personal access key belongs to. */
    portalId?: number;
    /**
     * Deploy errors about the key or its account (missing_scope, forbidden, not_available,
     * portal_mismatch, portal_not_allowed): the account the key belongs to, once HubSpot said.
     */
    key?: DeployKeyAccount;
  };
}
