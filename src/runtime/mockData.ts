/**
 * Mock data for the designer preview.
 *
 * Data sources resolve to the mock the user entered in `Extension.mock` when present; otherwise
 * plausible rows are generated, shaped exactly like the values the HubSpot hooks expose:
 *   - crmProperties -> Record<string, string | null>          (useCrmProperties `properties`)
 *   - associations  -> AssociationResult[]                     (useAssociations `results`)
 *                      { toObjectId, associationTypes: [{ category, typeId, label }], properties }
 *   - crmSearch     -> CrmSearchResultItem[]                   (useCrmSearch `results`)
 *                      { objectId, properties }
 *   - fetch/function-> the mocked response (null when none is configured)
 *
 * Generation is deterministic (same definition -> same rows) so the design canvas stays stable
 * across re-renders. CRM property values are strings, as HubSpot returns them.
 */
import { CRM_OBJECT_TYPES } from '../registry/constants';
import type {
  AssociationsSource,
  CrmSearchSource,
  DataSource,
  Extension,
  JsonValue,
} from '../model/types';

/** Number of generated rows for associations / CRM search sources (capped by pageLength). */
export const MOCK_ROW_COUNT = 3;

/** Shape of one useAssociations result. */
export interface MockAssociationResult {
  toObjectId: number;
  associationTypes: Array<{ category: string; typeId: number; label: string }>;
  properties: Record<string, string | null>;
}

/** Shape of one useCrmSearch result. */
export interface MockCrmSearchResult {
  objectId: number;
  properties: Record<string, string | null>;
}

// ---------------------------------------------------------------------------
// Sample records
// ---------------------------------------------------------------------------

interface Person {
  first: string;
  last: string;
  title: string;
  company: string;
  city: string;
  state: string;
  country: string;
}

const PEOPLE: Person[] = [
  { first: 'Grace', last: 'Hopper', title: 'VP of Engineering', company: 'Globex Corporation', city: 'Arlington', state: 'VA', country: 'United States' },
  { first: 'Alan', last: 'Turing', title: 'Head of Research', company: 'Initech', city: 'Manchester', state: 'England', country: 'United Kingdom' },
  { first: 'Katherine', last: 'Johnson', title: 'Operations Manager', company: 'Umbrella Labs', city: 'Hampton', state: 'VA', country: 'United States' },
  { first: 'Margaret', last: 'Hamilton', title: 'Director of Software', company: 'Stark Industries', city: 'Boston', state: 'MA', country: 'United States' },
  { first: 'Edsger', last: 'Dijkstra', title: 'Chief Architect', company: 'Wayne Enterprises', city: 'Rotterdam', state: 'South Holland', country: 'Netherlands' },
];

interface Company {
  name: string;
  domain: string;
  industry: string;
  employees: string;
  revenue: string;
  city: string;
  country: string;
}

const COMPANIES: Company[] = [
  { name: 'Globex Corporation', domain: 'globex.example', industry: 'COMPUTER_SOFTWARE', employees: '250', revenue: '12000000', city: 'Springfield', country: 'United States' },
  { name: 'Initech', domain: 'initech.example', industry: 'INFORMATION_TECHNOLOGY_AND_SERVICES', employees: '80', revenue: '4500000', city: 'Austin', country: 'United States' },
  { name: 'Umbrella Labs', domain: 'umbrella.example', industry: 'BIOTECHNOLOGY', employees: '1200', revenue: '98000000', city: 'Raccoon City', country: 'United States' },
  { name: 'Stark Industries', domain: 'stark.example', industry: 'DEFENSE_SPACE', employees: '5400', revenue: '310000000', city: 'Malibu', country: 'United States' },
  { name: 'Wayne Enterprises', domain: 'wayne.example', industry: 'FINANCIAL_SERVICES', employees: '3100', revenue: '205000000', city: 'Gotham', country: 'United States' },
];

const DEALS = [
  { name: 'Enterprise renewal 2027', amount: '48000', stage: 'contractsent' },
  { name: 'Starter plan upgrade', amount: '12500', stage: 'qualifiedtobuy' },
  { name: 'Professional services add-on', amount: '7800', stage: 'closedwon' },
  { name: 'Multi-year platform deal', amount: '156000', stage: 'presentationscheduled' },
  { name: 'Pilot expansion', amount: '23000', stage: 'appointmentscheduled' },
];

const TICKETS = [
  { subject: 'Cannot log in to the customer portal', priority: 'HIGH', stage: '1' },
  { subject: 'Invoice shows the wrong VAT rate', priority: 'MEDIUM', stage: '2' },
  { subject: 'Feature request: CSV export', priority: 'LOW', stage: '3' },
  { subject: 'Integration sync is delayed', priority: 'HIGH', stage: '1' },
  { subject: 'Question about seat pricing', priority: 'LOW', stage: '4' },
];

const PRODUCTS = [
  { name: 'Analytics Pro license', price: '1200', sku: 'AN-PRO-01' },
  { name: 'Onboarding package', price: '3500', sku: 'SRV-ONB-02' },
  { name: 'Premium support (annual)', price: '2400', sku: 'SUP-PRM-12' },
  { name: 'Data connector add-on', price: '600', sku: 'ADD-CON-05' },
  { name: 'Training workshop', price: '1800', sku: 'SRV-TRN-03' },
];

const LIFECYCLE_STAGES = ['lead', 'marketingqualifiedlead', 'salesqualifiedlead', 'opportunity', 'customer'];
const LEAD_STATUSES = ['NEW', 'OPEN', 'IN_PROGRESS', 'CONNECTED', 'ATTEMPTED_TO_CONTACT'];
const TASK_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'WAITING', 'DEFERRED'];

/** Base record ids per object type, so ids look stable and distinct between object types. */
const ID_BASE: Record<string, number> = {
  contacts: 1101,
  companies: 2201,
  deals: 3301,
  tickets: 4401,
  products: 5501,
  line_items: 6601,
};

/**
 * HubSpot-defined association type ids for common pairs (`from->to`). Unlisted pairs use 1.
 * Index 0 is the primary association where HubSpot has one.
 */
const ASSOCIATION_TYPE_IDS: Record<string, number> = {
  'contacts->companies': 279,
  'companies->contacts': 280,
  'deals->contacts': 3,
  'contacts->deals': 4,
  'deals->companies': 341,
  'companies->deals': 342,
  'tickets->contacts': 16,
  'contacts->tickets': 15,
  'tickets->companies': 339,
  'companies->tickets': 340,
  'deals->line_items': 19,
  'line_items->deals': 20,
  'tickets->deals': 28,
  'deals->tickets': 27,
};

const PRIMARY_TYPE_IDS: Record<string, number> = {
  'contacts->companies': 1,
  'companies->contacts': 2,
  'deals->companies': 5,
  'companies->deals': 6,
  'tickets->companies': 26,
  'companies->tickets': 25,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalises an object type id or name ('0-1', 'contact', 'CONTACTS') to a plural type name. */
export function objectTypeName(objectType: string | undefined): string {
  const raw = (objectType ?? '').trim();
  if (!raw) return 'contacts';
  const lower = raw.toLowerCase();
  // Accept type ids ('0-1'), plural names ('contacts') and singular names ('contact', 'company').
  const plurals = [lower, `${lower}s`, lower.endsWith('y') ? `${lower.slice(0, -1)}ies` : lower];
  const known = CRM_OBJECT_TYPES.find((t) => t.typeId === raw || plurals.includes(t.value));
  return known ? known.value : lower;
}

function pick<T>(list: readonly T[], index: number): T {
  return list[((index % list.length) + list.length) % list.length];
}

/** Deterministic ISO timestamp spread over 2026, newer for lower indexes. */
function sampleDate(index: number, offsetDays = 0): string {
  const day = Date.UTC(2026, 8, 30) - (index * 17 + offsetDays) * 86_400_000;
  return new Date(day).toISOString();
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Pre-computed sample values for a record of the given object type at the given index. */
interface SampleContext {
  objectType: string;
  index: number;
  objectId: number;
}

/**
 * A plausible string value for a CRM property name. Known HubSpot properties get realistic values;
 * other names are guessed from common patterns (date, amount, email, ...).
 */
export function sampleValue(property: string, ctx: SampleContext): string | null {
  const { objectType, index, objectId } = ctx;
  const person = pick(PEOPLE, index);
  const company = pick(COMPANIES, index);
  const deal = pick(DEALS, index);
  const ticket = pick(TICKETS, index);
  const product = pick(PRODUCTS, index);
  const p = property.toLowerCase();

  switch (p) {
    case 'hs_object_id':
      return String(objectId);
    case 'firstname':
      return person.first;
    case 'lastname':
      return person.last;
    case 'email':
    case 'hs_email':
      return `${slug(person.first)}.${slug(person.last)}@${company.domain}`;
    case 'phone':
    case 'mobilephone':
    case 'hs_phone_number':
      return `+1 (555) 01${index}-${String(2030 + index * 111).slice(-4)}`;
    case 'jobtitle':
      return person.title;
    case 'company':
      return person.company;
    case 'city':
      return objectType === 'companies' ? company.city : person.city;
    case 'state':
      return person.state;
    case 'country':
      return objectType === 'companies' ? company.country : person.country;
    case 'zip':
      return String(10001 + index * 1234);
    case 'address':
      return `${100 + index * 25} Main Street`;
    case 'website':
      return `https://www.${company.domain}`;
    case 'domain':
      return company.domain;
    case 'industry':
      return company.industry;
    case 'numberofemployees':
      return company.employees;
    case 'annualrevenue':
      return company.revenue;
    case 'lifecyclestage':
      return pick(LIFECYCLE_STAGES, index + 2);
    case 'hs_lead_status':
      return pick(LEAD_STATUSES, index);
    case 'dealname':
      return deal.name;
    case 'amount':
    case 'hs_acv':
    case 'hs_arr':
      return deal.amount;
    case 'dealstage':
      return deal.stage;
    case 'pipeline':
    case 'hs_pipeline':
      return objectType === 'tickets' ? '0' : 'default';
    case 'subject':
    case 'hs_ticket_subject':
      return ticket.subject;
    case 'content':
      return `Customer reported: ${ticket.subject.toLowerCase()}.`;
    case 'hs_ticket_priority':
      return ticket.priority;
    case 'hs_pipeline_stage':
      return ticket.stage;
    case 'price':
      return product.price;
    case 'quantity':
      return String(index + 1);
    case 'hs_sku':
      return product.sku;
    case 'hs_task_subject':
      return `Follow up with ${person.first}`;
    case 'hs_task_status':
      return pick(TASK_STATUSES, index);
    case 'hs_task_priority':
      return pick(['HIGH', 'MEDIUM', 'LOW'], index);
    case 'hubspot_owner_id':
    case 'hs_created_by_user_id':
      return String(2_000_000 + index * 13);
    case 'name':
      if (objectType === 'companies') return company.name;
      if (objectType === 'products' || objectType === 'line_items') return product.name;
      if (objectType === 'deals') return deal.name;
      return `${person.first} ${person.last}`;
    case 'description':
      if (objectType === 'products' || objectType === 'line_items') return `${product.name} (${product.sku})`;
      return `Sample ${objectType.replace(/s$/, '')} description ${index + 1}`;
    default:
      break;
  }

  // Pattern-based guesses for custom / less common properties.
  if (/(date|time|timestamp|_at$|lastmodified|last_updated)/.test(p)) return sampleDate(index, p.length);
  if (/(email)/.test(p)) return `${slug(person.first)}@${company.domain}`;
  if (/(phone|mobile|fax)/.test(p)) return `+1 (555) 01${index}-${String(4000 + index * 77)}`;
  if (/(url|website|link)/.test(p)) return `https://www.${company.domain}`;
  if (/(domain)/.test(p)) return company.domain;
  if (/(amount|price|revenue|value|cost|total|budget|arr|mrr)/.test(p)) return String((index + 1) * 2500);
  if (/(count|number|num_|qty|quantity|score|seats)/.test(p)) return String((index + 1) * 3);
  if (/^(is_|has_)|(enabled|active|flag)$/.test(p)) return index % 2 === 0 ? 'true' : 'false';
  if (/(status|stage)/.test(p)) return pick(['Active', 'Pending', 'Closed'], index);
  if (/(firstname|first_name)/.test(p)) return person.first;
  if (/(lastname|last_name)/.test(p)) return person.last;
  if (/(company)/.test(p)) return company.name;
  if (/(name|title)/.test(p)) {
    if (objectType === 'companies') return company.name;
    if (objectType === 'deals') return deal.name;
    if (objectType === 'products' || objectType === 'line_items') return product.name;
    return `${person.first} ${person.last}`;
  }
  return `${humanize(property)} ${index + 1}`;
}

function humanize(name: string): string {
  const words = name
    .replace(/^hs_/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Value';
}

function rowCount(pageLength: number | undefined): number {
  const n = typeof pageLength === 'number' && Number.isFinite(pageLength) && pageLength > 0 ? Math.floor(pageLength) : MOCK_ROW_COUNT;
  return Math.max(1, Math.min(MOCK_ROW_COUNT, n));
}

function sampleProperties(properties: string[], ctx: SampleContext): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const prop of properties) {
    if (prop) out[prop] = sampleValue(prop, ctx);
  }
  return out;
}

/** The object type of the record the extension is shown on (from the mock context). */
function currentObjectType(ext: Extension): string {
  const typeId = ext.mock?.context?.crm?.objectTypeId;
  return objectTypeName(typeId ?? ext.objectTypes?.[0]);
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Generated useAssociations results for a source (used when no mock is configured). */
export function generateAssociationRows(ds: AssociationsSource, ext: Extension): MockAssociationResult[] {
  const toType = objectTypeName(ds.toObjectType);
  const pair = `${currentObjectType(ext)}->${toType}`;
  const base = ID_BASE[toType] ?? 9901;
  return Array.from({ length: rowCount(ds.pageLength) }, (_, index) => {
    const objectId = base + index;
    const primary = index === 0 ? PRIMARY_TYPE_IDS[pair] : undefined;
    const associationTypes =
      primary !== undefined
        ? [
            { category: 'HUBSPOT_DEFINED', typeId: primary, label: 'Primary' },
            { category: 'HUBSPOT_DEFINED', typeId: ASSOCIATION_TYPE_IDS[pair] ?? 1, label: '' },
          ]
        : [{ category: 'HUBSPOT_DEFINED', typeId: ASSOCIATION_TYPE_IDS[pair] ?? 1, label: '' }];
    return {
      toObjectId: objectId,
      associationTypes,
      properties: sampleProperties(ds.properties ?? [], { objectType: toType, index, objectId }),
    };
  });
}

/** Generated useCrmSearch results for a source (used when no mock is configured). */
export function generateSearchRows(ds: CrmSearchSource): MockCrmSearchResult[] {
  const type = objectTypeName(ds.objectType);
  const base = ID_BASE[type] ?? 9901;
  return Array.from({ length: rowCount(ds.pageLength) }, (_, index) => {
    const objectId = base + index;
    return { objectId, properties: sampleProperties(ds.properties ?? [], { objectType: type, index, objectId }) };
  });
}

// ---------------------------------------------------------------------------
// Formatted values (propertiesToFormat: 'all')
// ---------------------------------------------------------------------------

const ENUM_LABELS: Record<string, Record<string, string>> = {
  dealstage: {
    appointmentscheduled: 'Appointment scheduled',
    qualifiedtobuy: 'Qualified to buy',
    presentationscheduled: 'Presentation scheduled',
    decisionmakerboughtin: 'Decision maker bought-in',
    contractsent: 'Contract sent',
    closedwon: 'Closed won',
    closedlost: 'Closed lost',
  },
  lifecyclestage: {
    subscriber: 'Subscriber',
    lead: 'Lead',
    marketingqualifiedlead: 'Marketing qualified lead',
    salesqualifiedlead: 'Sales qualified lead',
    opportunity: 'Opportunity',
    customer: 'Customer',
    evangelist: 'Evangelist',
    other: 'Other',
  },
  hs_pipeline_stage: { '1': 'New', '2': 'Waiting on contact', '3': 'Waiting on us', '4': 'Closed' },
  pipeline: { default: 'Sales Pipeline', '0': 'Support Pipeline' },
  hs_pipeline: { default: 'Sales Pipeline', '0': 'Support Pipeline' },
};

/** Enumeration properties whose internal values are UPPER_SNAKE_CASE words (labels are derived). */
const WORD_ENUMS = new Set(['hs_lead_status', 'hs_ticket_priority', 'industry', 'hs_task_status', 'hs_task_priority']);
const CURRENCY_PROPS = new Set(['amount', 'hs_acv', 'hs_arr', 'hs_mrr', 'hs_tcv', 'price', 'annualrevenue', 'amount_in_home_currency', 'hs_amount_paid']);
const NUMBER_PROPS = new Set(['numberofemployees', 'quantity', 'hs_num_open_deals', 'num_associated_contacts']);

function titleWords(value: string): string {
  const words = value.toLowerCase().split(/_+/).filter(Boolean);
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

/**
 * A CRM property value as HubSpot returns it with `propertiesToFormat: 'all'`: currency amounts
 * ($48,000.00), grouped numbers, dates (1/14/2026) and option labels (contractsent -> Contract
 * sent). Values that do not look like the property's raw format are returned unchanged.
 */
export function formatPropertyValue(property: string, value: string | null): string | null {
  if (value === null || value === undefined) return value;
  const p = property.toLowerCase();
  const raw = String(value);
  const labels = ENUM_LABELS[p];
  if (labels) return labels[raw] ?? raw;
  if (WORD_ENUMS.has(p)) return /^[A-Z0-9_]+$/.test(raw) ? titleWords(raw) : raw;
  const num = raw.trim() !== '' && /^-?\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : NaN;
  if (CURRENCY_PROPS.has(p) && Number.isFinite(num)) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
  }
  if (NUMBER_PROPS.has(p) && Number.isFinite(num)) return new Intl.NumberFormat('en-US').format(num);
  if (/(date|_at$|lastmodified|timestamp)/.test(p) && /^\d{4}-\d{2}-\d{2}/.test(raw) && !Number.isNaN(Date.parse(raw))) {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(raw));
  }
  return raw;
}

function formatProperties(props: unknown): unknown {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return props;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props as Record<string, unknown>)) out[k] = typeof v === 'string' ? formatPropertyValue(k, v) : v;
  return out;
}

/** Applies formatPropertyValue to `properties` of association / search result rows. */
function formatRows(rows: unknown): unknown {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) =>
    row && typeof row === 'object' && !Array.isArray(row) && 'properties' in row
      ? { ...(row as Record<string, unknown>), properties: formatProperties((row as { properties: unknown }).properties) }
      : row,
  );
}

/** Deep copy of a JSON mock so previews / custom code can never mutate the (frozen) document. */
function cloneJson<T extends JsonValue | undefined>(value: T): T {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

/** True when the user configured a mock value for this data source. */
export function hasConfiguredMock(ext: Extension, dataSourceId: string): boolean {
  return ext.mock?.dataSources?.[dataSourceId] !== undefined;
}

/**
 * The value a data source exposes in scope (`<name>`) once loaded.
 *  - crmProperties: each listed property from mock.properties (missing -> null)
 *  - associations / crmSearch: mock.dataSources[id] if present, else generated rows
 *  - fetch: mock.dataSources[id] ?? null
 *  - function: mock.dataSources[id] ?? the function's mock return (mock.functions) ?? null
 * CRM sources with `formatted` get formatted property values (see formatPropertyValue).
 */
export function mockDataForSource(ext: Extension, ds: DataSource): unknown {
  const mock = ext.mock;
  const configured = mock?.dataSources?.[ds.id];
  switch (ds.kind) {
    case 'crmProperties': {
      const out: Record<string, string | null> = {};
      for (const prop of ds.properties ?? []) {
        if (!prop) continue;
        const v = mock?.properties?.[prop];
        out[prop] = v === undefined || v === null ? null : String(v);
        if (ds.formatted) out[prop] = formatPropertyValue(prop, out[prop]);
      }
      return out;
    }
    case 'associations': {
      const rows = configured !== undefined ? cloneJson(configured) : generateAssociationRows(ds, ext);
      return ds.formatted ? formatRows(rows) : rows;
    }
    case 'crmSearch': {
      const rows = configured !== undefined ? cloneJson(configured) : generateSearchRows(ds);
      return ds.formatted ? formatRows(rows) : rows;
    }
    case 'fetch':
      return configured !== undefined ? cloneJson(configured) : null;
    case 'function': {
      if (configured !== undefined) return cloneJson(configured);
      const fnMock = mock?.functions?.[ds.functionId];
      return fnMock !== undefined ? cloneJson(fnMock) : null;
    }
    default:
      return null;
  }
}

/** Fetch / function sources that do not run on mount stay `null` until they are run. */
export function isDeferredSource(ds: DataSource): boolean {
  return (ds.kind === 'fetch' || ds.kind === 'function') && !ds.runOnMount;
}

/** The mocked return value of an app function (hubspot.serverless) in the preview. */
export function mockFunctionResult(ext: Extension, functionId: string): unknown {
  const v = ext.mock?.functions?.[functionId];
  return v !== undefined && v !== null ? cloneJson(v) : { ok: true };
}

/** The mocked CRM properties of the current record, for actions.fetchCrmObjectProperties. */
export function mockRecordProperties(ext: Extension, properties: string[] | '*'): Record<string, string | null> {
  const all = ext.mock?.properties ?? {};
  if (properties === '*') return { ...all };
  const out: Record<string, string | null> = {};
  for (const prop of properties) out[prop] = all[prop] ?? null;
  return out;
}
