/**
 * Core document model for the UI Extension Builder.
 *
 * A builder `Project` maps 1:1 onto a HubSpot developer project (platformVersion 2026.03):
 *   hsproject.json
 *   src/app/app-hsmeta.json            <- Project.app
 *   src/app/cards/<File>.tsx + -hsmeta <- Project.extensions (kind 'card')
 *   src/app/settings/...               <- Project.extensions (kind 'settings')
 *   src/app/pages/...                  <- Project.extensions (kind 'home')
 *   src/app/functions/...              <- Project.functions
 *
 * Every extension owns a flat node map (`nodes`) plus a synthetic root node (`rootId`) whose
 * children are the top-level JSX elements returned by the extension component.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * A dynamic value: a JavaScript expression evaluated in the extension's scope.
 * Scope identifiers available to expressions:
 *   - every state variable by name                          e.g. `count`
 *   - every data source by name, plus `<name>Loading` and `<name>Error`
 *   - `context` (the HubSpot extension context: user, portal, crm.objectId, ...)
 *   - inside `repeat`: the item / index names declared on the repeating node (and ancestors)
 *   - inside event handlers: the event's declared params (e.g. `value` for onChange)
 */
export interface Expr {
  $expr: string;
}

/**
 * A prop value is either a literal JSON value or an expression.
 * Literal strings may contain `{{ expression }}` interpolation segments.
 */
export type PropValue = JsonValue | Expr;

export function isExpr(value: unknown): value is Expr {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { $expr?: unknown }).$expr === 'string' &&
    Object.keys(value as object).length === 1
  );
}

export type NodeId = string;

/** Root node type: a fragment that holds the top-level elements of an extension. */
export const ROOT_TYPE = '__root__';

export interface RepeatConfig {
  /** Expression that evaluates to an array, e.g. `contacts` or `record.tags.split(';')`. */
  items: string;
  /** Identifier bound to the current item, e.g. `item`. Must be a valid JS identifier. */
  itemName: string;
  /** Identifier bound to the current index, e.g. `index`. Must be a valid JS identifier. */
  indexName: string;
  /** Optional expression used as React key; defaults to the index. */
  key?: string;
}

export interface UINode {
  id: NodeId;
  /** Registry key, e.g. "Button", "CrmPropertyList". `__root__` for the extension root. */
  type: string;
  /** Optional layer name shown in the layers tree. */
  name?: string;
  /** Component props. Only props that differ from HubSpot defaults should be stored. */
  props: Record<string, PropValue>;
  /**
   * Text content for components whose children mode is 'text' (Text, Heading, Button, Link...).
   * Supports `{{ expression }}` interpolation.
   */
  text?: string;
  /** Child node ids for components whose children mode is 'nodes'. */
  children: NodeId[];
  /** ReactNode-valued props (e.g. `overlay` on Button holds a Modal or Panel node). */
  slots?: Record<string, NodeId[]>;
  /** Event handlers, keyed by event prop name (e.g. onClick). Executed in order. */
  events?: Record<string, ActionStep[]>;
  /** Two-way binding of an input's value to a state variable (by state variable name). */
  binding?: { state: string };
  /** Render only when this expression is truthy. */
  condition?: string;
  /** Render once per item of an array. */
  repeat?: RepeatConfig;
  /** Designer-only flags (never affect generated code). */
  locked?: boolean;
  hiddenInDesigner?: boolean;
}

/** A detached node subtree used for templates, defaults, paste and insertion. */
export interface NodeTemplate {
  type: string;
  name?: string;
  props?: Record<string, PropValue>;
  text?: string;
  children?: NodeTemplate[];
  slots?: Record<string, NodeTemplate[]>;
  events?: Record<string, ActionStep[]>;
  binding?: { state: string };
  condition?: string;
  repeat?: RepeatConfig;
}

// ---------------------------------------------------------------------------
// Actions (event handler steps)
// ---------------------------------------------------------------------------

export type AlertType = 'info' | 'warning' | 'success' | 'danger' | 'tip';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface ActionBase {
  id: string;
}

/** Set a state variable to the value of an expression. */
export interface SetStateAction extends ActionBase {
  type: 'setState';
  state: string;
  /** Expression, e.g. `count + 1`, `value`, `'hello'`. */
  value: string;
}

/** actions.addAlert({ type, title, message }). title/message are template strings ({{ }}). */
export interface AddAlertAction extends ActionBase {
  type: 'addAlert';
  alertType: AlertType;
  /**
   * Optional expression that picks the type (Rules, e.g. `(score) >= 80 ? "success" : "warning"`).
   * When set it replaces `alertType`, which keeps the fallback shown when rules are switched off.
   */
  alertTypeExpr?: string;
  title: string;
  message: string;
}

/** actions.refreshObjectProperties() — CRM locations only. */
export interface RefreshPropertiesAction extends ActionBase {
  type: 'refreshObjectProperties';
}

/** actions.reloadPage() */
export interface ReloadPageAction extends ActionBase {
  type: 'reloadPage';
}

/** actions.openIframeModal({ uri, title, width, height, flush }). uri/title are template strings. */
export interface OpenIframeModalAction extends ActionBase {
  type: 'openIframeModal';
  uri: string;
  title: string;
  width: number;
  height: number;
  flush?: boolean;
}

/** actions.closeOverlay(id) where id is the `id` prop of a Modal/Panel node. */
export interface CloseOverlayAction extends ActionBase {
  type: 'closeOverlay';
  /** Node id of the Modal/Panel to close. Codegen resolves it to that node's `id` prop. */
  overlayNodeId: string;
}

/** actions.copyTextToClipboard(text). text is a template string. */
export interface CopyToClipboardAction extends ActionBase {
  type: 'copyToClipboard';
  text: string;
}

/** Re-run / refetch a data source (refetch for hooks, re-request for fetch/function sources). */
export interface RunDataSourceAction extends ActionBase {
  type: 'runDataSource';
  dataSourceId: string;
}

/** One request header. `value` is a template string (`Bearer {{ token }}`). */
export interface RequestHeader {
  key: string;
  value: string;
}

/** Inline hubspot.fetch call. url is a template string; body is an expression (object). */
export interface FetchAction extends ActionBase {
  type: 'fetch';
  url: string;
  method: HttpMethod;
  /** Expression producing the JSON body object, e.g. `{ email, note }`. Optional; never sent with GET. */
  body?: string;
  /** Request headers (hubspot.fetch `headers`). Entries with an empty key are ignored. */
  headers?: RequestHeader[];
  /** Request timeout in milliseconds (hubspot.fetch `timeout`). */
  timeout?: number;
  /** Store parsed JSON response in this state variable. */
  resultState?: string;
  /** Steps executed after success / failure. `response` and `error` are in scope respectively. */
  onSuccess?: ActionStep[];
  onError?: ActionStep[];
}

/** hubspot.serverless(functionUid, { parameters, propertiesToSend }). */
export interface RunFunctionAction extends ActionBase {
  type: 'runFunction';
  /** Id of an AppFunction in Project.functions. */
  functionId: string;
  /** Expression producing the parameters object, e.g. `{ email, amount: Number(amount) }`. */
  parameters?: string;
  /** CRM properties of the current record to send to the function. */
  propertiesToSend?: string[];
  resultState?: string;
  onSuccess?: ActionStep[];
  onError?: ActionStep[];
}

/** logger.<level>(message). message is a template string. */
export interface LogAction extends ActionBase {
  type: 'log';
  level: LogLevel;
  message: string;
}

/** Conditional branch. */
export interface IfAction extends ActionBase {
  type: 'if';
  condition: string;
  then: ActionStep[];
  else: ActionStep[];
}

/** Raw JavaScript statements (power users). Everything in scope plus `actions`, `hubspot`. */
export interface CustomCodeAction extends ActionBase {
  type: 'custom';
  code: string;
}

export type ActionStep =
  | SetStateAction
  | AddAlertAction
  | RefreshPropertiesAction
  | ReloadPageAction
  | OpenIframeModalAction
  | CloseOverlayAction
  | CopyToClipboardAction
  | RunDataSourceAction
  | FetchAction
  | RunFunctionAction
  | LogAction
  | IfAction
  | CustomCodeAction;

export type ActionType = ActionStep['type'];

// ---------------------------------------------------------------------------
// State & data
// ---------------------------------------------------------------------------

export type StateVarType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'any';

export interface StateVar {
  id: string;
  /** Valid JS identifier. Generated as `const [name, setName] = useState(initial)`. */
  name: string;
  type: StateVarType;
  initial: JsonValue;
  description?: string;
}

interface DataSourceBase {
  id: string;
  /** Valid JS identifier. Exposes `<name>`, `<name>Loading`, `<name>Error` in scope. */
  name: string;
}

/** `propertiesToFormat` of a CRM data source: 'all' (true), none (false / absent) or a list of properties. */
export type FormattedSetting = boolean | string[];

/** Whether a property's value is formatted under a FormattedSetting. */
export function isFormatted(setting: FormattedSetting | undefined, property: string): boolean {
  return setting === true || (Array.isArray(setting) && setting.includes(property));
}

/**
 * useCrmProperties([...]) — properties of the current CRM record.
 * Scope: `<name>` is Record<string, string | null>.
 */
export interface CrmPropertiesSource extends DataSourceBase {
  kind: 'crmProperties';
  properties: string[];
  /**
   * Formatted values: true → { propertiesToFormat: 'all' }; a list → only those properties
   * (e.g. ['dealstage'] for stage labels while amounts stay numbers).
   */
  formatted?: FormattedSetting;
}

/**
 * useAssociations({ toObjectType, properties, pageLength }).
 * Scope: `<name>` is AssociationResult[] ({ toObjectId, associationTypes, properties }).
 */
export interface AssociationsSource extends DataSourceBase {
  kind: 'associations';
  /** Object type id or name, e.g. '0-1' (contacts), '0-2' (companies), '0-3' (deals). */
  toObjectType: string;
  properties: string[];
  pageLength: number;
  formatted?: FormattedSetting;
}

/**
 * useCrmSearch({ objectType, properties, query, filterGroups, sorts, pageLength }).
 * Scope: `<name>` is CrmSearchResultItem[] ({ objectId, properties }).
 */
export interface CrmSearchSource extends DataSourceBase {
  kind: 'crmSearch';
  objectType: string;
  properties: string[];
  /** Template string for the free-text query (optional). */
  query?: string;
  filters: Array<{ propertyName: string; operator: string; value: string }>;
  sorts: Array<{ propertyName: string; direction: 'ASCENDING' | 'DESCENDING' }>;
  pageLength: number;
  formatted?: FormattedSetting;
}

/**
 * hubspot.fetch(url, { method, body }) executed on mount and/or on demand.
 * Scope: `<name>` is the parsed JSON response (null until loaded).
 */
export interface FetchSource extends DataSourceBase {
  kind: 'fetch';
  /** Template string. Its origin must be listed in app permittedUrls.fetch (codegen adds it). */
  url: string;
  method: HttpMethod;
  /** Expression producing the JSON body object. Never sent with GET. */
  body?: string;
  /** Request headers (hubspot.fetch `headers`). Entries with an empty key are ignored. */
  headers?: RequestHeader[];
  /** Request timeout in milliseconds (hubspot.fetch `timeout`). */
  timeout?: number;
  /**
   * Run automatically when the extension opens — once the CRM data its request uses (record
   * properties, associations, searches, other on-open sources) has loaded.
   */
  runOnMount: boolean;
}

/**
 * hubspot.serverless(functionUid, { parameters, propertiesToSend }) executed on mount and/or on demand.
 * Scope: `<name>` is the function's return value (null until loaded).
 */
export interface FunctionSource extends DataSourceBase {
  kind: 'function';
  functionId: string;
  parameters?: string;
  propertiesToSend?: string[];
  runOnMount: boolean;
}

export type DataSource =
  | CrmPropertiesSource
  | AssociationsSource
  | CrmSearchSource
  | FetchSource
  | FunctionSource;

export type DataSourceKind = DataSource['kind'];

// ---------------------------------------------------------------------------
// Extensions, functions, app, project
// ---------------------------------------------------------------------------

export type CardLocation = 'crm.record.tab' | 'crm.record.sidebar' | 'crm.preview' | 'helpdesk.sidebar';
export type ExtensionKind = 'card' | 'settings' | 'home';
/** The hubspot.extend<'...'> location generated for an extension. */
export type ExtensionLocation = CardLocation | 'settings' | 'home';

export interface PreviewMockData {
  /** Mock extension context used by the designer preview. */
  context: {
    user: { id: number; email: string; firstName: string; lastName: string; locale: string };
    portal: { id: number; timezone: string };
    crm: { objectId: number; objectTypeId: string };
  };
  /** Mock CRM property values of the current record (used by crmProperties sources). */
  properties: Record<string, string>;
  /** Mock results per data source id (associations/crmSearch/fetch/function). */
  dataSources: Record<string, JsonValue>;
  /** Mock return values per app function id (used by runFunction actions in preview). */
  functions: Record<string, JsonValue>;
  /**
   * Preview simulation per data source id (optional): 'ok' (default: loading, then the mock data),
   * 'loading' (stays loading), 'empty' (no records / null) or 'error' (fails with an error).
   */
  simulate?: Record<string, DataSourceSimulation>;
}

/** How the preview simulates a data source (see PreviewMockData.simulate). */
export type DataSourceSimulation = 'ok' | 'loading' | 'empty' | 'error';

/**
 * A derived value recomputed on every render: `const <name> = (<expr>);` placed after state and
 * data hooks. Computed values may reference state, data sources, context, helpers and computed
 * values declared before them.
 */
export interface ComputedValue {
  id: string;
  /** Valid JS identifier. */
  name: string;
  /** JavaScript expression. */
  expr: string;
  description?: string;
}

export interface Extension {
  id: string;
  kind: ExtensionKind;
  /** hsmeta uid. Lowercase letters, digits, '_' and '-'. Unique across the project. */
  uid: string;
  /** Card title shown in HubSpot (config.name). */
  name: string;
  description?: string;
  /** Component file base name (PascalCase), e.g. "ContactSummaryCard" -> ContactSummaryCard.tsx */
  fileName: string;
  /** For kind 'card': where the card renders. Ignored for settings/home. */
  location: CardLocation;
  /** For kind 'card': CRM object types, e.g. ["contacts", "deals", "p_my_custom_object"]. */
  objectTypes: string[];
  state: StateVar[];
  dataSources: DataSource[];
  /** Derived values (power feature). Optional for backwards compatibility. */
  computed?: ComputedValue[];
  /**
   * Module-level helper code (power feature): plain JavaScript/TypeScript function declarations
   * (e.g. `function formatMoney(v) { ... }`) emitted above the component and callable from any
   * expression. Must not reference component state (pass values as arguments).
   */
  helpers?: string;
  rootId: NodeId;
  nodes: Record<NodeId, UINode>;
  mock: PreviewMockData;
}

export interface AppFunction {
  id: string;
  /** hsmeta uid; also the name passed to hubspot.serverless(). */
  uid: string;
  /** File base name, e.g. "getDeals" -> src/app/functions/getDeals.js */
  fileName: string;
  /** Full JavaScript (CommonJS) source of the function; must export `main`. */
  code: string;
  /** Optional public endpoint. */
  endpoint?: { path: string; methods: HttpMethod[] };
  secretKeys: string[];
}

export interface AppConfig {
  uid: string;
  name: string;
  description: string;
  distribution: 'private' | 'marketplace';
  authType: 'static' | 'oauth';
  redirectUrls: string[];
  requiredScopes: string[];
  optionalScopes: string[];
  conditionallyRequiredScopes: string[];
  permittedUrls: { fetch: string[]; iframe: string[]; img: string[] };
  support: { supportEmail: string; documentationUrl: string; supportUrl: string; supportPhone: string };
}

export type PlatformVersion = '2025.2' | '2026.03' | '2026.09';

export interface Project {
  /** Schema version of the builder document format. */
  schemaVersion: 1;
  id: string;
  /** hsproject.json name. */
  name: string;
  platformVersion: PlatformVersion;
  app: AppConfig;
  extensions: Extension[];
  functions: AppFunction[];
  createdAt: string;
  updatedAt: string;
}
