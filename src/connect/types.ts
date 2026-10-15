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
  record: '/api/crm/records/:objectType/:id', // GET ?properties=a,b&formatted=1 -> CrmRecord
  associations: '/api/crm/records/:objectType/:id/associations/:toObjectType', // GET ?properties=&limit= -> AssociationResultDTO[]
  search: '/api/crm/search/:objectType', // POST CrmSearchRequestDTO -> CrmSearchResponseDTO
  proxyFetch: '/api/proxy/fetch', // POST ProxyFetchRequest -> ProxyFetchResponse (preview of hubspot.fetch)
  deployStart: '/api/deploy', // POST DeployRequest -> DeployStatus (beta)
  deployStatus: '/api/deploy/:deployId', // GET -> DeployStatus
  deployKey: '/api/deploy/key', // GET -> DeployKeyInfo; DELETE -> forget the remembered key -> DeployKeyInfo
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
  };
  /** Scopes the connector requests at sign-in (required + optional), for the consent explainer. */
  scopes: { required: string[]; optional: string[] };
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
  formatted?: boolean;
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

/** Terminal-free deploy (beta): upload an exported project with the admin's personal access key. */
export interface DeployRequest {
  /** HubSpot personal access key (Settings → Integrations → Personal access key). Never stored unless `remember`. */
  personalAccessKey?: string;
  /** Use the key remembered in the encrypted session cookie from a previous deploy. */
  useRememberedKey?: boolean;
  remember?: boolean;
  /** Target portal id (defaults to the connected portal). */
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

/** GET/DELETE /api/deploy/key — whether a personal access key is remembered in this browser's session. */
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
  };
}
