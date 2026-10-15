/**
 * CRM data & action components, imported from `@hubspot/ui-extensions/crm`:
 *   CRM data:    CrmPropertyList, CrmAssociationTable, CrmDataHighlight, CrmReport,
 *                CrmAssociationPivot, CrmAssociationPropertyList, CrmAssociationStageTracker,
 *                CrmSimpleDeadline, CrmStageTracker, CrmStatistics
 *   CRM actions: CrmActionButton, CrmActionLink, CrmCardActions
 * See text.tsx for the reference conventions (exact prop names, inspector metadata, previews that
 * spread `rootProps` on their outermost element).
 *
 * Source of truth: @hubspot/ui-extensions/dist/shared.synced/types/crm.synced.d.ts (props) and
 * extension-points.synced.d.ts (availability: every component in crm.record.tab, crm.preview and
 * helpdesk.sidebar; only CrmActionButton / CrmActionLink in crm.record.sidebar).
 *
 * Previews cannot read real CRM data. They render HubSpot-looking blocks filled with plausible
 * sample values derived from the configured props (property names, object type, labels, ...), so a
 * card can be laid out realistically. In preview mode the action components simulate the click:
 * they validate `actionContext` for the chosen `actionType` (firing `onError(errors)` like HubSpot
 * does for missing context values) and show what the action would do inside HubSpot.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileChartColumn,
  Gauge,
  Hourglass,
  LayoutPanelTop,
  Link2,
  ListTree,
  Milestone,
  Network,
  Pencil,
  Route,
  Search,
  Sigma,
  Table2,
  TableProperties,
  Zap,
} from 'lucide-react';
import type { ExtensionLocation, JsonValue } from '../../model/types';
import type { ComponentDef, EnumOption, EventDef, PreviewProps, PropDef } from '../types';
import { CRM_ACTION_DOCS, CRM_DOCS, CRM_OBJECT_TYPES } from '../constants';
import { cx, normalizeSize, str } from '../../preview/util';
import '../../preview/styles/crm.css';

// ---------------------------------------------------------------------------
// Defensive prop readers (props may come from arbitrary user expressions)
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Boolean prop with a HubSpot default; accepts the strings produced by text templates. */
function flag(v: unknown, fallback: boolean): boolean {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return fallback;
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/** Positive integer (numbers or numeric strings); anything else -> undefined. */
function positiveInt(v: unknown): number | undefined {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

/** A `string[]` prop. Tolerates a comma-separated string and drops non-text entries. */
function stringList(v: unknown): string[] {
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' || typeof x === 'number' ? String(x).trim() : ''))
    .filter(Boolean);
}

/** The object entries of an array prop (filters, statistics, action configs, ...). */
function objectList(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? v.filter(isRecord) : [];
}

/** Own-property lookup so names like "constructor" never resolve to Object.prototype members. */
function lookup<V>(table: Record<string, V>, key: string): V | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** Small deterministic string hash (FNV-1a) used to vary sample numbers per configuration. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Sample CRM data
// ---------------------------------------------------------------------------

interface PropertySample {
  label: string;
  /** One value per sample record (rows of association tables, associated records, ...). */
  values: readonly [string, string, string];
}

const sampleOf = (label: string, a: string, b: string, c: string): PropertySample => ({ label, values: [a, b, c] });

/**
 * HubSpot default property labels with plausible values for the most common properties of
 * contacts, companies, deals, tickets, quotes and products. Unknown properties fall back to
 * `fallbackSample` (label humanized from the internal name, value guessed from the name).
 */
const PROPERTY_SAMPLES: Record<string, PropertySample> = {
  // Contacts
  firstname: sampleOf('First name', 'Ada', 'Charles', 'Grace'),
  lastname: sampleOf('Last name', 'Lovelace', 'Babbage', 'Hopper'),
  email: sampleOf('Email', 'ada@analytical.example', 'charles@difference.example', 'grace@compilerlabs.example'),
  phone: sampleOf('Phone number', '+1 (555) 010-2030', '+44 20 7946 0958', '+1 (555) 013-7788'),
  mobilephone: sampleOf('Mobile phone number', '+1 (555) 010-4455', '+44 7700 900123', '+1 (555) 019-2211'),
  jobtitle: sampleOf('Job title', 'Head of Computation', 'Chief Engineer', 'Director of Programming'),
  company: sampleOf('Company name', 'Analytical Engines Ltd', 'Difference Works', 'Compiler Labs'),
  lifecyclestage: sampleOf('Lifecycle stage', 'Customer', 'Opportunity', 'Lead'),
  hs_lead_status: sampleOf('Lead status', 'Open deal', 'In progress', 'Connected'),
  hubspot_owner_id: sampleOf('Owner', 'Jordan Lee', 'Sam Rivera', 'Priya Patel'),
  address: sampleOf('Street address', '12 St James’s Square', '1 Main Street', '200 Crystal Drive'),
  city: sampleOf('City', 'London', 'Boston', 'Arlington'),
  state: sampleOf('State/Region', 'Greater London', 'Massachusetts', 'Virginia'),
  zip: sampleOf('Postal code', 'SW1Y 4JH', '02110', '22202'),
  country: sampleOf('Country/Region', 'United Kingdom', 'United States', 'United States'),
  website: sampleOf('Website URL', 'analytical.example', 'difference.example', 'compilerlabs.example'),
  createdate: sampleOf('Create date', 'Jan 14, 2026', 'Mar 2, 2026', 'May 27, 2026'),
  lastmodifieddate: sampleOf('Last modified date', 'Oct 12, 2026', 'Oct 9, 2026', 'Sep 30, 2026'),
  hs_lastmodifieddate: sampleOf('Last modified date', 'Oct 12, 2026', 'Oct 9, 2026', 'Sep 30, 2026'),
  notes_last_contacted: sampleOf('Last contacted', 'Oct 2, 2026', 'Sep 18, 2026', 'Aug 30, 2026'),
  notes_last_updated: sampleOf('Last activity date', 'Oct 10, 2026', 'Sep 25, 2026', 'Sep 3, 2026'),
  notes_next_activity_date: sampleOf('Next activity date', 'Oct 20, 2026', 'Oct 28, 2026', 'Nov 4, 2026'),
  hs_analytics_source: sampleOf('Original source', 'Organic search', 'Referrals', 'Direct traffic'),
  num_associated_deals: sampleOf('Number of associated deals', '3', '1', '2'),
  num_associated_contacts: sampleOf('Number of associated contacts', '4', '2', '7'),
  num_notes: sampleOf('Number of sales activities', '18', '7', '11'),
  hs_object_id: sampleOf('Record ID', '51', '52', '53'),
  // Companies
  name: sampleOf('Company name', 'Analytical Engines Ltd', 'Difference Works', 'Compiler Labs'),
  domain: sampleOf('Company domain name', 'analytical.example', 'difference.example', 'compilerlabs.example'),
  industry: sampleOf('Industry', 'Computer Software', 'Mechanical Engineering', 'Information Technology'),
  numberofemployees: sampleOf('Number of employees', '120', '45', '1,200'),
  annualrevenue: sampleOf('Annual revenue', '$12,500,000', '$3,200,000', '$48,000,000'),
  total_revenue: sampleOf('Total revenue', '$186,500.00', '$48,500.00', '$12,000.00'),
  description: sampleOf('Description', 'General-purpose computing engines.', 'Precision calculating machinery.', 'Compilers and developer tools.'),
  // Deals
  dealname: sampleOf('Deal name', 'Difference Engine Expansion', 'Analytical Engine Renewal', 'Compiler Pilot'),
  amount: sampleOf('Amount', '$125,000.00', '$48,500.00', '$12,000.00'),
  dealstage: sampleOf('Deal stage', 'Contract sent', 'Presentation scheduled', 'Qualified to buy'),
  pipeline: sampleOf('Pipeline', 'Sales Pipeline', 'Sales Pipeline', 'Renewals Pipeline'),
  closedate: sampleOf('Close date', 'Dec 1, 2026', 'Nov 15, 2026', 'Jan 30, 2027'),
  dealtype: sampleOf('Deal type', 'New business', 'Existing business', 'New business'),
  hs_priority: sampleOf('Priority', 'High', 'Medium', 'Low'),
  hs_deal_stage_probability: sampleOf('Deal probability', '90%', '60%', '40%'),
  hs_forecast_amount: sampleOf('Forecast amount', '$112,500.00', '$29,100.00', '$4,800.00'),
  hs_acv: sampleOf('Annual contract value', '$125,000.00', '$48,500.00', '$12,000.00'),
  hs_arr: sampleOf('Annual recurring revenue', '$125,000.00', '$48,500.00', '$12,000.00'),
  hs_mrr: sampleOf('Monthly recurring revenue', '$10,416.67', '$4,041.67', '$1,000.00'),
  hs_tcv: sampleOf('Total contract value', '$375,000.00', '$97,000.00', '$12,000.00'),
  closed_won_reason: sampleOf('Closed won reason', 'Best technical fit', 'Existing relationship', 'Pricing'),
  closed_lost_reason: sampleOf('Closed lost reason', 'Went with a competitor', 'No budget', 'Timing'),
  engagements_last_meeting_booked: sampleOf('Date of last meeting booked', 'Sep 29, 2026', 'Sep 12, 2026', 'Aug 21, 2026'),
  // Tickets
  subject: sampleOf('Ticket name', 'Calibration issue on unit #12', 'Invoice question', 'Onboarding request'),
  content: sampleOf('Ticket description', 'Gear train drifts after two hours.', 'Customer asks about invoice INV-2041.', 'Kick-off call requested.'),
  hs_pipeline: sampleOf('Pipeline', 'Support Pipeline', 'Support Pipeline', 'Support Pipeline'),
  hs_pipeline_stage: sampleOf('Ticket status', 'New', 'Waiting on contact', 'Closed'),
  hs_ticket_priority: sampleOf('Priority', 'High', 'Medium', 'Low'),
  hs_ticket_category: sampleOf('Category', 'Product issue', 'Billing issue', 'General inquiry'),
  // Quotes, products, line items
  hs_title: sampleOf('Quote name', 'Difference Engine Expansion – Q1', 'Analytical Engine Renewal', 'Compiler Pilot'),
  hs_quote_amount: sampleOf('Quote amount', '$125,000.00', '$48,500.00', '$12,000.00'),
  hs_createdate: sampleOf('Create date', 'Jan 14, 2026', 'Mar 2, 2026', 'May 27, 2026'),
  hs_expiration_date: sampleOf('Expiration date', 'Dec 31, 2026', 'Nov 30, 2026', 'Oct 31, 2026'),
  price: sampleOf('Unit price', '$1,200.00', '$450.00', '$99.00'),
  quantity: sampleOf('Quantity', '10', '4', '25'),
  hs_sku: sampleOf('SKU', 'AE-1000', 'DW-220', 'CL-PILOT'),
};

/** `hs_lead_status` -> "Lead status", `numberOfSeats` -> "Number of seats". */
export function humanizePropertyName(name: string): string {
  const words = name
    .replace(/^hs_/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_\-.]+/)
    .filter(Boolean);
  if (words.length === 0) return name;
  const text = words.join(' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Guesses a plausible sample value from an unknown property's internal name. */
function fallbackSample(name: string): PropertySample {
  const label = humanizePropertyName(name);
  const n = name.toLowerCase();
  const pick = (a: string, b: string, c: string) => sampleOf(label, a, b, c);
  if (/date|time|_at$|^at_/.test(n)) return pick('Oct 2, 2026', 'Sep 18, 2026', 'Aug 30, 2026');
  if (/amount|revenue|price|cost|budget|value|spend|arr|mrr/.test(n)) return pick('$24,000.00', '$8,750.00', '$3,200.00');
  if (/percent|probability|rate|score/.test(n)) return pick('75%', '50%', '20%');
  if (/^num|count|number|quantity|total|seats/.test(n)) return pick('12', '7', '3');
  if (/email/.test(n)) return pick('ada@analytical.example', 'charles@difference.example', 'grace@compilerlabs.example');
  if (/phone|mobile/.test(n)) return pick('+1 (555) 010-2030', '+44 20 7946 0958', '+1 (555) 013-7788');
  if (/owner|user|rep|manager/.test(n)) return pick('Jordan Lee', 'Sam Rivera', 'Priya Patel');
  if (/status|stage|state/.test(n)) return pick('Active', 'Pending', 'Closed');
  if (/url|website|domain|link/.test(n)) return pick('analytical.example', 'difference.example', 'compilerlabs.example');
  if (/^is_|^has_|enabled|flag|opt/.test(n)) return pick('Yes', 'No', 'Yes');
  const noun = label.toLowerCase();
  return pick(`Sample ${noun}`, `Another ${noun}`, `Third ${noun}`);
}

/** Label and sample value of a property for sample record `row` (0..2). */
function sampleProperty(name: string, row = 0): { label: string; value: string } {
  const s = lookup(PROPERTY_SAMPLES, name) ?? fallbackSample(name);
  return { label: s.label, value: s.values[((row % 3) + 3) % 3] };
}

const DEAL_STAGES = ['Appointment scheduled', 'Qualified to buy', 'Presentation scheduled', 'Decision maker bought in', 'Contract sent', 'Closed won'];
const LIFECYCLE_STAGES = ['Subscriber', 'Lead', 'Marketing qualified lead', 'Sales qualified lead', 'Opportunity', 'Customer'];
const TICKET_STAGES = ['New', 'Waiting on contact', 'Waiting on us', 'Closed'];
const GENERIC_STAGES = ['New', 'In progress', 'In review', 'Done'];

interface ObjectSample {
  singular: string;
  plural: string;
  /** Three sample records: display name and a secondary line. */
  records: ReadonlyArray<{ name: string; meta: string }>;
  /** Sample association labels (used when `associationLabels` is not set). */
  labels: readonly [string, string];
  /** Pipeline / lifecycle stages and the current stage index of each sample record. */
  stages: readonly string[];
  stageIndex: readonly [number, number, number];
}

const OBJECT_SAMPLES: Record<string, ObjectSample> = {
  '0-1': {
    singular: 'contact',
    plural: 'contacts',
    records: [
      { name: 'Ada Lovelace', meta: 'Head of Computation · ada@analytical.example' },
      { name: 'Charles Babbage', meta: 'Chief Engineer · charles@difference.example' },
      { name: 'Grace Hopper', meta: 'Director of Programming · grace@compilerlabs.example' },
    ],
    labels: ['Decision maker', 'Billing contact'],
    stages: LIFECYCLE_STAGES,
    stageIndex: [5, 4, 1],
  },
  '0-2': {
    singular: 'company',
    plural: 'companies',
    records: [
      { name: 'Analytical Engines Ltd', meta: 'analytical.example · London' },
      { name: 'Difference Works', meta: 'difference.example · Boston' },
      { name: 'Compiler Labs', meta: 'compilerlabs.example · Arlington' },
    ],
    labels: ['Primary', 'Partner'],
    stages: LIFECYCLE_STAGES,
    stageIndex: [5, 4, 1],
  },
  '0-3': {
    singular: 'deal',
    plural: 'deals',
    records: [
      { name: 'Difference Engine Expansion', meta: '$125,000.00 · Contract sent' },
      { name: 'Analytical Engine Renewal', meta: '$48,500.00 · Presentation scheduled' },
      { name: 'Compiler Pilot', meta: '$12,000.00 · Qualified to buy' },
    ],
    labels: ['Primary', 'Renewal'],
    stages: DEAL_STAGES,
    stageIndex: [4, 2, 1],
  },
  '0-5': {
    singular: 'ticket',
    plural: 'tickets',
    records: [
      { name: 'Calibration issue on unit #12', meta: 'High priority · New' },
      { name: 'Invoice question', meta: 'Medium priority · Waiting on contact' },
      { name: 'Onboarding request', meta: 'Low priority · Closed' },
    ],
    labels: ['Primary', 'Escalation'],
    stages: TICKET_STAGES,
    stageIndex: [0, 1, 3],
  },
};

/**
 * Sample data for an object type. Accepts type ids ('0-3') and object names ('deals'); custom or
 * unknown object types get generic records named after the type when it is a known standard type.
 */
function objectSample(objectTypeId: unknown): ObjectSample {
  const raw = str(objectTypeId).trim();
  const known = CRM_OBJECT_TYPES.find((t) => t.typeId === raw || t.value === raw.toLowerCase());
  const typeId = known?.typeId ?? raw;
  const exact = lookup(OBJECT_SAMPLES, typeId);
  if (exact) return exact;
  const plural = known ? known.label.toLowerCase() : 'records';
  const singular = known ? plural.replace(/ies$/, 'y').replace(/s$/, '') : 'record';
  const title = singular.charAt(0).toUpperCase() + singular.slice(1);
  return {
    singular,
    plural,
    records: [
      { name: `${title} 1001`, meta: `Sample ${singular}` },
      { name: `${title} 1002`, meta: `Sample ${singular}` },
      { name: `${title} 1003`, meta: `Sample ${singular}` },
    ],
    labels: ['Primary', 'Unlabeled'],
    stages: GENERIC_STAGES,
    stageIndex: [1, 2, 0],
  };
}

// ---------------------------------------------------------------------------
// Shared definitions
// ---------------------------------------------------------------------------

/** extension-points.synced.d.ts: StandardCrmExtensionPoint locations get every CRM component. */
const CRM_DATA_LOCATIONS: ExtensionLocation[] = ['crm.record.tab', 'crm.preview', 'helpdesk.sidebar'];
/** CrmSidebarExtensionPoint (crm.record.sidebar) additionally exposes CrmActionButton / CrmActionLink. */
const CRM_ACTION_LOCATIONS: ExtensionLocation[] = ['crm.record.tab', 'crm.record.sidebar', 'crm.preview', 'helpdesk.sidebar'];

const TEST_ID_PROP: PropDef = {
  name: 'testId',
  label: 'Test ID',
  type: { kind: 'string' },
  group: 'Advanced',
  description: 'Used by findByTestId() to locate this component in tests.',
};

const OBJECT_TYPE_HELP = 'e.g. 0-1 (contacts), 0-2 (companies), 0-3 (deals), 0-5 (tickets), or 2-… for custom objects.';

function objectTypeIdProp(description: string, required: boolean): PropDef {
  return {
    name: 'objectTypeId',
    label: 'Object type ID',
    type: { kind: 'string', placeholder: '0-1' },
    group: 'Data',
    required: required || undefined,
    description: `${description} ${OBJECT_TYPE_HELP}`,
  };
}

const RECORD_OBJECT_TYPE_ID_PROP = objectTypeIdProp(
  'Object type of a specific record to display instead of the current record (use together with Record ID).',
  false,
);
const RECORD_OBJECT_ID_PROP: PropDef = {
  name: 'objectId',
  label: 'Record ID',
  type: { kind: 'number', min: 1, step: 1, integer: true },
  group: 'Data',
  description: 'ID of a specific CRM record to display instead of the current record (use together with Object type ID).',
};

function propertiesProp(description: string, label = 'Properties', name = 'properties'): PropDef {
  return {
    name,
    label,
    type: { kind: 'stringList', placeholder: 'Internal property name, e.g. firstname' },
    group: 'Data',
    required: true,
    description,
  };
}

const associationLabelsProp = (description: string): PropDef => ({
  name: 'associationLabels',
  label: 'Association labels',
  type: { kind: 'stringList', placeholder: 'e.g. Decision maker' },
  group: 'Data',
  description,
});

const showPropertiesProp = (description: string): PropDef => ({
  name: 'showProperties',
  label: 'Show properties',
  type: { kind: 'boolean' },
  defaultValue: true,
  group: 'Appearance',
  description,
});

const FILTER_HINT =
  'Array of { property, operator, value }. Operators: EQ, NEQ, LT, LTE, GT, GTE, BETWEEN (value + highValue), ' +
  'IN / NOT_IN (values), HAS_PROPERTY, NOT_HAS_PROPERTY. Values are strings or numbers.';

/** `template` is the example inserted when the filter prop is first enabled (fits the default object type). */
function filtersProp(name: 'preFilters' | 'filters', description: string, template: JsonValue[]): PropDef {
  return {
    name,
    label: name === 'preFilters' ? 'Pre-filters' : 'Filters',
    type: { kind: 'json', template, hint: FILTER_HINT },
    group: 'Data',
    description,
  };
}

const sortProp = (description: string): PropDef => ({
  name: 'sort',
  label: 'Sort',
  type: {
    kind: 'json',
    template: [{ columnName: 'createdate', direction: -1 }],
    hint: 'Array of { columnName, direction }: direction 1 sorts ascending, -1 descending.',
  },
  group: 'Data',
  description,
});

const ON_ERROR_EVENT: EventDef = {
  name: 'onError',
  label: 'On error',
  description: 'Receives the error messages of a failed action, e.g. missing context values or insufficient permissions.',
  params: [{ name: 'errors', description: 'string[] of error messages' }],
};

/** CrmActionButton / CrmActionLink `onClick: () => void` — HubSpot passes no arguments. */
const ACTION_ON_CLICK_EVENT: EventDef = {
  name: 'onClick',
  label: 'On click',
  description: 'Runs when clicked, in addition to the CRM action. Receives no arguments.',
  params: [],
};

// ---------------------------------------------------------------------------
// CRM actions vocabulary (ActionType / ArgsFor in crm.synced.d.ts)
// ---------------------------------------------------------------------------

export const CRM_ACTION_TYPES = [
  'PREVIEW_OBJECT',
  'ADD_NOTE',
  'ADD_TASK',
  'SEND_EMAIL',
  'SCHEDULE_MEETING',
  'OPEN_RECORD_CREATOR_FORM',
  'OPEN_RECORD_ASSOCIATION_FORM',
  'ENGAGEMENT_APP_LINK',
  'RECORD_APP_LINK',
  'PAGE_APP_LINK',
  'EXTERNAL_URL',
  'OPEN_WORKFLOW_ENROLLMENT_MODAL',
] as const;
export type CrmActionType = (typeof CRM_ACTION_TYPES)[number];

interface ActionMeta {
  label: string;
  /** Required `actionContext` keys (nested keys use dots). */
  required: string[];
  /** What the action does inside HubSpot (used for the preview-mode simulation). */
  effect: (ctx: Record<string, unknown>) => string;
}

const recordRef = (ctx: Record<string, unknown>) => {
  const id = str(ctx.objectId);
  return `${objectSample(ctx.objectTypeId).singular}${id ? ` ${id}` : ''}`;
};

const ACTION_META: Record<CrmActionType, ActionMeta> = {
  PREVIEW_OBJECT: {
    label: 'Preview record',
    required: ['objectTypeId', 'objectId'],
    effect: (c) => `Opens the preview panel for ${recordRef(c)}.`,
  },
  ADD_NOTE: { label: 'Add note', required: ['objectTypeId', 'objectId'], effect: (c) => `Opens the note editor for ${recordRef(c)}.` },
  ADD_TASK: { label: 'Add task', required: ['objectTypeId', 'objectId'], effect: (c) => `Opens the task editor for ${recordRef(c)}.` },
  SEND_EMAIL: {
    label: 'Send email',
    required: ['objectTypeId', 'objectId'],
    effect: (c) => `Opens the email composer for ${recordRef(c)}.`,
  },
  SCHEDULE_MEETING: {
    label: 'Schedule meeting',
    required: ['objectTypeId', 'objectId'],
    effect: (c) => `Opens the meeting scheduler for ${recordRef(c)}.`,
  },
  OPEN_RECORD_CREATOR_FORM: {
    label: 'Create record',
    required: ['objectTypeId'],
    effect: (c) => `Opens the form to create a ${objectSample(c.objectTypeId).singular}.`,
  },
  OPEN_RECORD_ASSOCIATION_FORM: {
    label: 'Create & associate record',
    required: ['objectTypeId', 'association.objectTypeId', 'association.objectId'],
    effect: (c) =>
      `Opens the form to create a ${objectSample(c.objectTypeId).singular} associated with ${
        isRecord(c.association) ? recordRef(c.association) : 'the record'
      }.`,
  },
  ENGAGEMENT_APP_LINK: {
    label: 'Open engagement',
    required: ['objectTypeId', 'objectId', 'engagementId'],
    effect: (c) => `Opens engagement ${str(c.engagementId)} on ${recordRef(c)}.`,
  },
  RECORD_APP_LINK: { label: 'Open record page', required: ['objectTypeId', 'objectId'], effect: (c) => `Opens the record page of ${recordRef(c)}.` },
  PAGE_APP_LINK: { label: 'Open HubSpot page', required: ['path'], effect: (c) => `Opens the HubSpot page ${str(c.path)}.` },
  EXTERNAL_URL: { label: 'Open external URL', required: ['href'], effect: (c) => `Opens ${str(c.href)} in a new tab.` },
  OPEN_WORKFLOW_ENROLLMENT_MODAL: {
    label: 'Enroll in workflow',
    required: ['objectTypeId', 'objectId'],
    effect: (c) => `Opens the workflow enrollment dialog for ${recordRef(c)}.`,
  },
};

const ACTION_TYPE_OPTIONS: EnumOption[] = CRM_ACTION_TYPES.map((value) => ({ value, label: ACTION_META[value].label }));

function isActionType(v: unknown): v is CrmActionType {
  return typeof v === 'string' && (CRM_ACTION_TYPES as readonly string[]).includes(v);
}

function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}

/**
 * Problems with an `actionContext` for an `actionType` (empty when valid). Mirrors the errors
 * HubSpot reports through `onError` when required context values are missing; usable by
 * validation code as well as by the previews.
 */
export function actionContextIssues(actionType: unknown, actionContext: unknown): string[] {
  if (!isActionType(actionType)) {
    return [hasValue(actionType) ? `Unknown actionType "${str(actionType)}".` : 'actionType is required.'];
  }
  if (!isRecord(actionContext)) return [`actionContext must be an object for ${actionType}.`];
  const issues: string[] = [];
  for (const path of ACTION_META[actionType].required) {
    let value: unknown = actionContext;
    for (const key of path.split('.')) value = isRecord(value) ? value[key] : undefined;
    if (!hasValue(value)) issues.push(`actionContext.${path} is required for ${actionType}.`);
  }
  return issues;
}

/** actionContext for the record the card is shown on (resolved from the extension context). */
function currentRecordContext(): { [key: string]: JsonValue } {
  return { objectTypeId: '{{ context.crm.objectTypeId }}', objectId: '{{ context.crm.objectId }}' };
}

const ACTION_CONTEXT_HINT =
  'Shape depends on actionType. objectTypeId + objectId: PREVIEW_OBJECT, ADD_NOTE, ADD_TASK, SEND_EMAIL ' +
  '(optional initialEmailSubject, initialEmailBody, windowVariant), SCHEDULE_MEETING, RECORD_APP_LINK ' +
  '(optional includeEschref, external), OPEN_WORKFLOW_ENROLLMENT_MODAL. objectTypeId + objectId + engagementId: ' +
  'ENGAGEMENT_APP_LINK. objectTypeId: OPEN_RECORD_CREATOR_FORM. objectTypeId + association { objectTypeId, objectId }: ' +
  'OPEN_RECORD_ASSOCIATION_FORM. path: PAGE_APP_LINK. href: EXTERNAL_URL. ' +
  'Use {{ context.crm.objectTypeId }} / {{ context.crm.objectId }} for the current record.';

function actionTypeProp(): PropDef {
  return {
    name: 'actionType',
    label: 'Action',
    type: { kind: 'enum', options: ACTION_TYPE_OPTIONS },
    group: 'Behavior',
    required: true,
    description: 'The CRM action to perform when clicked.',
  };
}

function actionContextProp(): PropDef {
  return {
    name: 'actionContext',
    label: 'Action context',
    type: { kind: 'json', template: currentRecordContext(), hint: ACTION_CONTEXT_HINT },
    group: 'Behavior',
    required: true,
    description: 'The CRM object and record the action applies to. The required values depend on the action.',
  };
}

// ---------------------------------------------------------------------------
// Shared preview building blocks
// ---------------------------------------------------------------------------

/** Placeholder shown when a component lacks the configuration it needs to render. */
function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="hsp-crm-empty">
      <Icon size={18} strokeWidth={1.75} aria-hidden="true" className="hsp-crm-empty-icon" />
      <div>
        <div className="hsp-crm-empty-title">{title}</div>
        {hint && <div className="hsp-crm-empty-hint">{hint}</div>}
      </div>
    </div>
  );
}

/** Design-mode remark about a HubSpot limit (e.g. "up to four properties"). */
function DesignNote({ mode, children }: { mode: 'design' | 'preview'; children: ReactNode }) {
  return mode === 'design' ? <div className="hsp-crm-note">{children}</div> : null;
}

/** HubSpot record name link (not navigable in the builder). */
function RecordLink({ children }: { children: ReactNode }) {
  return <span className="hsp-crm-record-link">{children}</span>;
}

/**
 * A property value that can be edited inline in preview mode (HubSpot property lists support
 * inline editing). Edits are local to the preview; nothing is written anywhere.
 */
function PropertyValue({ value, label, editable }: { value: string; label: string; editable: boolean }) {
  const [current, setCurrent] = useState(value);
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setCurrent(value), [value]);
  const shown = current === '' ? '--' : current;
  if (!editable) return <span className="hsp-crm-prop-value">{shown}</span>;
  if (draft !== null) {
    const commit = () => {
      setCurrent(draft);
      setDraft(null);
    };
    return (
      <input
        className="hsp-crm-prop-input"
        aria-label={label}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(null);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="hsp-crm-prop-value hsp-crm-prop-value--editable"
      aria-label={`Edit ${label}`}
      onClick={() => setDraft(current)}
    >
      <span>{shown}</span>
      <Pencil size={12} aria-hidden="true" className="hsp-crm-prop-pencil" />
    </button>
  );
}

/** Label/value pairs of a record (CrmPropertyList, CrmAssociationPropertyList). */
function PropertyItems({
  names,
  row,
  direction,
  editable,
}: {
  names: string[];
  row: number;
  direction: 'row' | 'column';
  editable: boolean;
}) {
  return (
    <dl className={cx('hsp-crm-proplist', `hsp-crm-proplist--${direction}`)}>
      {names.map((name, i) => {
        const { label, value } = sampleProperty(name, row);
        return (
          <div className="hsp-crm-prop" key={`${i}-${name}`}>
            <dt className="hsp-crm-prop-label">{label}</dt>
            <dd className="hsp-crm-prop-cell">
              <PropertyValue value={value} label={label} editable={editable} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Compact property summary shown below stage trackers and deadlines. */
function PropertySummary({ names, row }: { names: string[]; row: number }) {
  if (names.length === 0) return null;
  return (
    <dl className="hsp-crm-summary">
      {names.map((name, i) => {
        const { label, value } = sampleProperty(name, row);
        return (
          <div className="hsp-crm-summary-item" key={`${i}-${name}`}>
            <dt className="hsp-crm-summary-label">{label}</dt>
            <dd className="hsp-crm-summary-value">{value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Pipeline / lifecycle stage progress (CrmStageTracker, CrmAssociationStageTracker). */
function StageTrack({ stages, current }: { stages: readonly string[]; current: number }) {
  const index = Math.min(Math.max(current, 0), stages.length - 1);
  return (
    <div className="hsp-crm-stages">
      <div className="hsp-crm-stage-summary">
        <span className="hsp-crm-stage-current">{stages[index]}</span>
        <span className="hsp-crm-stage-count">
          Stage {index + 1} of {stages.length}
        </span>
      </div>
      <ol className="hsp-crm-stage-bar" aria-label="Stages">
        {stages.map((stage, i) => (
          <li
            key={`${i}-${stage}`}
            title={stage}
            aria-current={i === index ? 'step' : undefined}
            className={cx('hsp-crm-stage', i < index && 'hsp-crm-stage--done', i === index && 'hsp-crm-stage--current')}
          >
            <span className="hsp-crm-stage-seg" />
            <span className="hsp-crm-stage-label">{stage}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Closes an open popup on outside mousedown or Escape. */
function useDismiss(active: boolean, ref: RefObject<HTMLElement | null>, onDismiss: () => void) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (!active) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) dismissRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissRef.current();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [active, ref]);
}

// ---------------------------------------------------------------------------
// CrmPropertyList
// ---------------------------------------------------------------------------

const MAX_PROPERTY_LIST = 24;

function CrmPropertyListPreview({ props, rootProps, mode }: PreviewProps) {
  const names = stringList(props.properties);
  const direction = props.direction === 'row' ? 'row' : 'column';
  // A specific record (objectId) gets its own sample values so it is visibly "another record".
  const row = positiveInt(props.objectId) ?? 0;
  return (
    <div {...rootProps} className={cx('hsp-crm-block', rootProps.className)}>
      {names.length === 0 ? (
        <EmptyState icon={TableProperties} title="No properties selected" hint="Add CRM property names to display." />
      ) : (
        <>
          <PropertyItems names={names.slice(0, MAX_PROPERTY_LIST)} row={row} direction={direction} editable={mode === 'preview'} />
          {names.length > MAX_PROPERTY_LIST && (
            <DesignNote mode={mode}>HubSpot displays up to {MAX_PROPERTY_LIST} properties; the rest are ignored.</DesignNote>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CrmDataHighlight
// ---------------------------------------------------------------------------

const MAX_HIGHLIGHTS = 4;

function CrmDataHighlightPreview({ props, rootProps, mode }: PreviewProps) {
  const names = stringList(props.properties);
  const row = positiveInt(props.objectId) ?? 0;
  return (
    <div {...rootProps} className={cx('hsp-crm-block', rootProps.className)}>
      {names.length === 0 ? (
        <EmptyState icon={Gauge} title="No properties selected" hint="Add up to four CRM property names to highlight." />
      ) : (
        <>
          <dl className="hsp-crm-highlight">
            {names.slice(0, MAX_HIGHLIGHTS).map((name, i) => {
              const { label, value } = sampleProperty(name, row);
              return (
                <div className="hsp-crm-highlight-item" key={`${i}-${name}`}>
                  <dt className="hsp-crm-highlight-label">{label}</dt>
                  <dd className="hsp-crm-highlight-value">{value}</dd>
                </div>
              );
            })}
          </dl>
          {names.length > MAX_HIGHLIGHTS && (
            <DesignNote mode={mode}>Data highlights show up to {MAX_HIGHLIGHTS} properties; the rest are ignored.</DesignNote>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CrmAssociationTable
// ---------------------------------------------------------------------------

/** Sort key for sample values: numbers (currency, %, counts), then dates, then text. */
function sortKey(value: string): number | string {
  const numeric = value.replace(/[$,%\s]/g, '');
  if (numeric !== '' && Number.isFinite(Number(numeric))) return Number(numeric);
  const time = Date.parse(value);
  return Number.isNaN(time) ? value.toLowerCase() : time;
}

/** First valid sort descriptor ({ columnName, direction: 1 | -1 }) among the shown columns. */
function firstSort(v: unknown, columns: string[]): { column: number; direction: 1 | -1 } | null {
  for (const s of objectList(v)) {
    const column = columns.indexOf(str(s.columnName));
    if (column !== -1) return { column, direction: Number(s.direction) === -1 ? -1 : 1 };
  }
  return null;
}

function CrmAssociationTablePreview({ props, rootProps, mode }: PreviewProps) {
  const live = mode === 'preview';
  const object = objectSample(props.objectTypeId);
  const columns = stringList(props.propertyColumns);
  const quickFilters = stringList(props.quickFilterProperties);
  const searchable = flag(props.searchable, true);
  const paginated = flag(props.pagination, true);
  // The "Association label" quick filter shows with quick filters unless explicitly hidden.
  const labelFilter = flag(props.associationLabelFilter, quickFilters.length > 0);
  const pageSize = positiveInt(props.pageSize);
  const sort = firstSort(props.sort, columns);

  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  let rows = [0, 1, 2].map((row) => columns.map((c) => sampleProperty(c, row).value));
  const q = query.trim().toLowerCase();
  if (q) rows = rows.filter((cells) => cells.some((cell) => cell.toLowerCase().includes(q)));
  if (sort) {
    rows = [...rows].sort((a, b) => {
      const ka = sortKey(a[sort.column]);
      const kb = sortKey(b[sort.column]);
      const cmp = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : String(ka).localeCompare(String(kb));
      return cmp * sort.direction;
    });
  }
  const perPage = paginated && pageSize ? pageSize : rows.length || 1;
  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
  const currentPage = Math.min(page, pageCount);
  const visible = rows.slice((currentPage - 1) * perPage, currentPage * perPage);

  return (
    <div {...rootProps} className={cx('hsp-crm-block', 'hsp-crm-assoc-table', rootProps.className)}>
      {(searchable || labelFilter || quickFilters.length > 0) && (
        <div className="hsp-crm-toolbar">
          {searchable && (
            <label className="hsp-crm-search">
              <Search size={14} aria-hidden="true" className="hsp-crm-search-icon" />
              <input
                className="hsp-crm-search-input"
                placeholder="Search"
                aria-label={`Search ${object.plural}`}
                value={query}
                readOnly={!live}
                tabIndex={live ? undefined : -1}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
              />
            </label>
          )}
          {(labelFilter || quickFilters.length > 0) && (
            <div className="hsp-crm-filters">
              {labelFilter && (
                <span className="hsp-crm-filter">
                  Association label <ChevronDown size={12} aria-hidden="true" />
                </span>
              )}
              {quickFilters.map((name, i) => (
                <span className="hsp-crm-filter" key={`${i}-${name}`}>
                  {sampleProperty(name).label} <ChevronDown size={12} aria-hidden="true" />
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {columns.length === 0 ? (
        <EmptyState icon={Table2} title="No columns selected" hint={`Add property columns to list associated ${object.plural}.`} />
      ) : (
        <div className="hsp-crm-table-scroll">
          <table className="hsp-crm-table">
            <thead>
              <tr>
                {columns.map((name, i) => (
                  <th key={`${i}-${name}`} className="hsp-crm-th" aria-sort={sort?.column === i ? (sort.direction === 1 ? 'ascending' : 'descending') : undefined}>
                    <span className="hsp-crm-th-inner">
                      {sampleProperty(name).label}
                      {sort?.column === i &&
                        (sort.direction === 1 ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td className="hsp-crm-td hsp-crm-td--empty" colSpan={columns.length}>
                    No associated {object.plural} match your search.
                  </td>
                </tr>
              ) : (
                visible.map((cells, r) => (
                  <tr key={r}>
                    {cells.map((cell, c) => (
                      <td key={c} className="hsp-crm-td">
                        {c === 0 ? <RecordLink>{cell}</RecordLink> : cell}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {paginated && columns.length > 0 && (
        <nav className="hsp-crm-pagination" aria-label="Pagination">
          <button type="button" className="hsp-crm-page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
            <ChevronLeft size={14} aria-hidden="true" /> Prev
          </button>
          {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              className={cx('hsp-crm-page', n === currentPage && 'hsp-crm-page--current')}
              aria-current={n === currentPage ? 'page' : undefined}
              onClick={() => setPage(n)}
            >
              {n}
            </button>
          ))}
          <button type="button" className="hsp-crm-page" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>
            Next <ChevronRight size={14} aria-hidden="true" />
          </button>
        </nav>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CrmReport
// ---------------------------------------------------------------------------

const REPORT_USE_LABELS: Record<string, string> = {
  associations: 'Records associated with this record',
  subject: 'This record only',
  unfiltered: 'All records',
};

function CrmReportPreview({ props, rootProps }: PreviewProps) {
  const reportId = str(props.reportId).trim();
  const use = oneOf(props.use, ['associations', 'subject', 'unfiltered'] as const, 'associations');
  // Bar heights vary with the report id so different reports look different.
  const seed = hash(reportId || 'report');
  const bars = Array.from({ length: 6 }, (_, i) => 28 + ((seed >>> (i * 4)) % 16) * 5);
  const months = ['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
  return (
    <div {...rootProps} className={cx('hsp-crm-block', 'hsp-crm-report', rootProps.className)}>
      {reportId === '' ? (
        <EmptyState icon={FileChartColumn} title="No report selected" hint="Set the ID of a single object report (found in the report URL)." />
      ) : (
        <>
          <div className="hsp-crm-report-head">
            <span className="hsp-crm-report-title">Report {reportId}</span>
            <RecordLink>View report</RecordLink>
          </div>
          <svg className="hsp-crm-report-chart" viewBox="0 0 320 132" role="img" aria-label={`Chart of report ${reportId}`}>
            {[0, 1, 2, 3].map((i) => (
              <line key={i} className="hsp-crm-report-grid" x1="28" x2="316" y1={12 + i * 30} y2={12 + i * 30} />
            ))}
            <line className="hsp-crm-report-axis" x1="28" x2="316" y1="102" y2="102" />
            {bars.map((h, i) => (
              <rect key={i} className="hsp-crm-report-bar" x={42 + i * 46} y={102 - h} width="26" height={h} rx="2" />
            ))}
            {months.map((m, i) => (
              <text key={m} className="hsp-crm-report-tick" x={55 + i * 46} y="120" textAnchor="middle">
                {m}
              </text>
            ))}
          </svg>
          <div className="hsp-crm-report-foot">Data: {REPORT_USE_LABELS[use]}</div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CrmAssociationPivot
// ---------------------------------------------------------------------------

function CrmAssociationPivotPreview({ props, rootProps, mode }: PreviewProps) {
  const live = mode === 'preview';
  const object = objectSample(props.objectTypeId);
  const configured = stringList(props.associationLabels);
  const labels = configured.length > 0 ? configured : [...object.labels];
  const max = positiveInt(props.maxAssociations);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  return (
    <div {...rootProps} className={cx('hsp-crm-block', 'hsp-crm-pivot', rootProps.className)}>
      {labels.map((label, g) => {
        // First group gets all three sample records, the others one each (rotating).
        const records = g === 0 ? object.records : [object.records[g % object.records.length]];
        const limit = max && !expanded[g] ? max : records.length;
        const open = !collapsed[g];
        return (
          <section className="hsp-crm-pivot-group" key={`${g}-${label}`}>
            <button
              type="button"
              className="hsp-crm-pivot-header"
              aria-expanded={open}
              onClick={() => live && setCollapsed((c) => ({ ...c, [g]: open }))}
            >
              <ChevronRight size={14} aria-hidden="true" className={cx('hsp-crm-pivot-caret', open && 'hsp-crm-pivot-caret--open')} />
              <span className="hsp-crm-pivot-label">{label}</span>
              <span className="hsp-crm-pivot-count">({records.length})</span>
            </button>
            {open && (
              <ul className="hsp-crm-pivot-list">
                {records.slice(0, limit).map((record, i) => (
                  <li className="hsp-crm-pivot-item" key={i}>
                    <RecordLink>{record.name}</RecordLink>
                    <span className="hsp-crm-pivot-meta">{record.meta}</span>
                  </li>
                ))}
                {records.length > limit && (
                  <li className="hsp-crm-pivot-more-row">
                    <button type="button" className="hsp-crm-pivot-more" onClick={() => live && setExpanded((x) => ({ ...x, [g]: true }))}>
                      Show more
                    </button>
                  </li>
                )}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CrmAssociationPropertyList
// ---------------------------------------------------------------------------

function CrmAssociationPropertyListPreview({ props, rootProps, mode }: PreviewProps) {
  const object = objectSample(props.objectTypeId);
  const names = stringList(props.properties);
  const labels = stringList(props.associationLabels);
  return (
    <div {...rootProps} className={cx('hsp-crm-block', rootProps.className)}>
      <div className="hsp-crm-assoc-head">
        <span className="hsp-crm-assoc-kind">Associated {object.singular}</span>
        <RecordLink>{object.records[0].name}</RecordLink>
        {labels.map((label, i) => (
          <span className="hsp-crm-label-tag" key={`${i}-${label}`}>
            {label}
          </span>
        ))}
      </div>
      {names.length === 0 ? (
        <EmptyState icon={ListTree} title="No properties selected" hint={`Add properties of the associated ${object.singular} to display.`} />
      ) : (
        <>
          <PropertyItems names={names.slice(0, MAX_PROPERTY_LIST)} row={0} direction="column" editable={mode === 'preview'} />
          {names.length > MAX_PROPERTY_LIST && (
            <DesignNote mode={mode}>HubSpot displays up to {MAX_PROPERTY_LIST} properties; the rest are ignored.</DesignNote>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CrmStageTracker & CrmAssociationStageTracker
// ---------------------------------------------------------------------------

const MAX_TRACKER_PROPERTIES = 4;

function CrmStageTrackerPreview({ props, rootProps, mode }: PreviewProps) {
  // Without an object type the tracker follows the current record; deals are the typical case.
  const object = objectSample(hasValue(props.objectTypeId) ? props.objectTypeId : '0-3');
  const row = (positiveInt(props.objectId) ?? 0) % 3;
  const names = stringList(props.properties);
  const showProperties = flag(props.showProperties, true);
  return (
    <div {...rootProps} className={cx('hsp-crm-block', 'hsp-crm-tracker', rootProps.className)}>
      <StageTrack stages={object.stages} current={object.stageIndex[row]} />
      {showProperties && <PropertySummary names={names.slice(0, MAX_TRACKER_PROPERTIES)} row={row} />}
      {showProperties && names.length > MAX_TRACKER_PROPERTIES && (
        <DesignNote mode={mode}>Stage trackers show up to {MAX_TRACKER_PROPERTIES} properties.</DesignNote>
      )}
    </div>
  );
}

function CrmAssociationStageTrackerPreview({ props, rootProps, mode }: PreviewProps) {
  const live = mode === 'preview';
  const object = objectSample(props.objectTypeId);
  const names = stringList(props.properties);
  const labels = stringList(props.associationLabels);
  const showProperties = flag(props.showProperties, true);
  const [index, setIndex] = useState(0);
  const count = object.records.length;
  const record = object.records[index % count];
  return (
    <div {...rootProps} className={cx('hsp-crm-block', 'hsp-crm-tracker', rootProps.className)}>
      <div className="hsp-crm-assoc-head">
        <span className="hsp-crm-assoc-kind">Associated {object.singular}</span>
        <RecordLink>{record.name}</RecordLink>
        {labels.map((label, i) => (
          <span className="hsp-crm-label-tag" key={`${i}-${label}`}>
            {label}
          </span>
        ))}
        <span className="hsp-crm-pager">
          <button
            type="button"
            className="hsp-crm-pager-btn"
            aria-label={`Previous ${object.singular}`}
            disabled={!live || index === 0}
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
          >
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          <span className="hsp-crm-pager-text">
            {index + 1} of {count}
          </span>
          <button
            type="button"
            className="hsp-crm-pager-btn"
            aria-label={`Next ${object.singular}`}
            disabled={!live || index >= count - 1}
            onClick={() => setIndex((i) => Math.min(count - 1, i + 1))}
          >
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </span>
      </div>
      <StageTrack stages={object.stages} current={object.stageIndex[index % 3]} />
      {showProperties && <PropertySummary names={names.slice(0, MAX_TRACKER_PROPERTIES)} row={index} />}
      {showProperties && names.length > MAX_TRACKER_PROPERTIES && (
        <DesignNote mode={mode}>Stage trackers show up to {MAX_TRACKER_PROPERTIES} properties.</DesignNote>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CrmSimpleDeadline
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const formatDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** CSS length from a ProgressTheme `height` / `borderRadius` (string | number). */
function cssLength(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return `${v}px`;
  if (typeof v === 'string' && v.trim() !== '') return /^\d+(\.\d+)?$/.test(v.trim()) ? `${v.trim()}px` : v.trim();
  return undefined;
}

/** CSS color or `linear-gradient` from a ProgressTheme color + optional Gradient. */
function themeFill(color: unknown, gradient: unknown): string | undefined {
  if (isRecord(gradient)) {
    const start = str(gradient.startColor).trim();
    const end = str(gradient.endColor).trim();
    if (start && end) return `linear-gradient(90deg, ${start}, ${end})`;
  }
  const c = str(color).trim();
  return c || undefined;
}

function CrmSimpleDeadlinePreview({ props, rootProps, mode }: PreviewProps) {
  const startName = str(props.startDatePropertyName).trim();
  const endName = str(props.endDatePropertyName).trim();
  const names = stringList(props.properties);
  const showProperties = flag(props.showProperties, true);
  const theme = isRecord(props.progressTheme) ? props.progressTheme : {};

  // Sample timeline relative to today: started 90 days ago, due in 30 days (75% elapsed).
  const now = Date.now();
  const start = new Date(now - 90 * DAY_MS);
  const end = new Date(now + 30 * DAY_MS);
  const percent = 75;

  const height = cssLength(theme.height);
  const radius = cssLength(theme.borderRadius);
  const background = str(theme.backgroundColor).trim();
  const track: CSSProperties = { height, borderRadius: radius, background: themeFill(theme.upcomingColor, theme.upcomingGradient) };
  const fill: CSSProperties = { width: `${percent}%`, borderRadius: radius, background: themeFill(theme.completedColor, theme.completedGradient) };

  return (
    <div {...rootProps} className={cx('hsp-crm-block', 'hsp-crm-deadline', rootProps.className)}>
      <div className={cx('hsp-crm-deadline-frame', background && 'hsp-crm-deadline-frame--filled')} style={background ? { background } : undefined}>
        <div className="hsp-crm-deadline-head">
          <span className="hsp-crm-deadline-date">
            <span className="hsp-crm-deadline-caption">{startName ? sampleProperty(startName).label : 'Start date'}</span>
            {formatDate(start)}
          </span>
          <span className="hsp-crm-deadline-left">30 days left</span>
          <span className="hsp-crm-deadline-date hsp-crm-deadline-date--end">
            <span className="hsp-crm-deadline-caption">{endName ? sampleProperty(endName).label : 'Deadline'}</span>
            {formatDate(end)}
          </span>
        </div>
        <div
          className="hsp-crm-deadline-track"
          style={track}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Time elapsed"
        >
          <div className="hsp-crm-deadline-fill" style={fill} />
        </div>
      </div>
      {(!startName || !endName) && <DesignNote mode={mode}>Set both the start and end date property names.</DesignNote>}
      {showProperties && <PropertySummary names={names} row={0} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CrmStatistics
// ---------------------------------------------------------------------------

const STATISTIC_TYPES = ['SUM', 'AVG', 'MIN', 'MAX', 'DISTINCT_APPROX', 'COUNT', 'PERCENTILES'] as const;
type StatisticType = (typeof STATISTIC_TYPES)[number];
const MONEY_RE = /amount|revenue|price|cost|budget|value|spend|arr|mrr|acv|tcv/i;

/** Plausible, deterministic statistic value for a configuration (MIN < AVG < MAX, SUM = AVG × count). */
function statisticValue(type: StatisticType, propertyName: string, label: string, percentile: unknown): string {
  const money = MONEY_RE.test(propertyName);
  const seed = hash(`${propertyName}|${label}`);
  const count = 8 + (seed % 40);
  const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  if (type === 'COUNT') return integer.format(count);
  if (type === 'DISTINCT_APPROX') return integer.format(3 + (seed % 12));
  const base = money ? 5000 + (seed % 45) * 1000 : 10 + (seed % 90);
  const p = typeof percentile === 'number' || typeof percentile === 'string' ? Number(percentile) : NaN;
  const pct = Number.isFinite(p) ? Math.min(Math.max(p, 0), 100) : 50;
  const factor: Record<StatisticType, number> = {
    SUM: count,
    AVG: 1,
    MIN: 0.2,
    MAX: 3.2,
    PERCENTILES: 0.2 + (3 * pct) / 100,
    COUNT: 1,
    DISTINCT_APPROX: 1,
  };
  const value = base * factor[type];
  return money
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value);
}

function CrmStatisticsPreview({ props, rootProps }: PreviewProps) {
  const items = objectList(props.statistics);
  return (
    <div {...rootProps} className={cx('hsp-crm-block', rootProps.className)}>
      {items.length === 0 ? (
        <EmptyState icon={Sigma} title="No statistics defined" hint="Add statistics such as { label, statisticType: 'SUM', propertyName: 'amount' }." />
      ) : (
        <dl className="hsp-crm-stats">
          {items.map((item, i) => {
            const propertyName = str(item.propertyName);
            const type = oneOf(item.statisticType, STATISTIC_TYPES, 'COUNT');
            const label = str(item.label) || (propertyName ? sampleProperty(propertyName).label : `Statistic ${i + 1}`);
            return (
              <div className="hsp-crm-stat" key={i}>
                <dt className="hsp-crm-stat-label">{label}</dt>
                <dd className="hsp-crm-stat-number">{statisticValue(type, propertyName, label, item.percentile)}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CRM action components
// ---------------------------------------------------------------------------

interface Feedback {
  tone: 'info' | 'error';
  text: string;
}

const FEEDBACK_MS = 3500;

/** Transient "what would happen in HubSpot" message shown after a simulated action. */
function useActionFeedback(): [Feedback | null, (f: Feedback | null) => void] {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [feedback]);
  return [feedback, setFeedback];
}

/**
 * Simulates a CRM action: reports missing context through `onError(errors)` (as HubSpot does) or
 * describes the action's effect.
 */
function simulateAction(
  actionType: unknown,
  actionContext: unknown,
  trigger: PreviewProps['trigger'],
  show: (f: Feedback) => void,
) {
  const issues = actionContextIssues(actionType, actionContext);
  if (issues.length > 0) {
    trigger('onError', issues);
    show({ tone: 'error', text: issues.join(' ') });
    return;
  }
  const effect = ACTION_META[actionType as CrmActionType].effect(actionContext as Record<string, unknown>);
  show({ tone: 'info', text: `In HubSpot: ${effect}` });
}

function FeedbackBubble({ feedback }: { feedback: Feedback | null }) {
  if (!feedback) return null;
  return (
    <span role="status" className={cx('hsp-crm-feedback', feedback.tone === 'error' && 'hsp-crm-feedback--error')}>
      {feedback.text}
    </span>
  );
}

/** http(s) URL of an EXTERNAL_URL action (opened in a new tab by the preview), else undefined. */
function externalHref(actionType: unknown, actionContext: unknown): string | undefined {
  if (actionType !== 'EXTERNAL_URL' || !isRecord(actionContext)) return undefined;
  const href = str(actionContext.href).trim();
  return /^https?:\/\//i.test(href) ? href : undefined;
}

const ACTION_BUTTON_VARIANTS = ['primary', 'secondary', 'destructive'] as const;
const ACTION_BUTTON_TYPES = ['button', 'reset', 'submit'] as const;
const ACTION_LINK_VARIANTS = ['primary', 'light', 'dark', 'destructive'] as const;

/** CrmActionButton `size` accepts both aliases ('xs' | 'extra-small', ...); default medium. */
function actionButtonSize(v: unknown): 'extra-small' | 'small' | 'medium' {
  const size = normalizeSize(v, 'medium');
  return size === 'extra-small' || size === 'small' ? size : 'medium';
}

function CrmActionButtonPreview({ props, text, rootProps, mode, trigger }: PreviewProps) {
  const live = mode === 'preview';
  const variant = oneOf(props.variant, ACTION_BUTTON_VARIANTS, 'secondary');
  const size = actionButtonSize(props.size);
  const htmlType = oneOf(props.type, ACTION_BUTTON_TYPES, 'button');
  const disabled = flag(props.disabled, false);
  const [feedback, setFeedback] = useActionFeedback();
  const href = externalHref(props.actionType, props.actionContext);
  const className = cx(
    'hsp-crm-btn',
    `hsp-crm-btn--${variant}`,
    `hsp-crm-btn--${size}`,
    disabled && 'hsp-crm-btn--disabled',
    live && !disabled && 'hsp-crm-btn--interactive',
  );
  const onClick = (e: { preventDefault: () => void }) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    trigger('onClick');
    simulateAction(props.actionType, props.actionContext, trigger, setFeedback);
  };

  let face: ReactNode;
  if (!live) {
    face = (
      <span className={className} aria-disabled={disabled || undefined}>
        {text}
      </span>
    );
  } else if (href && !disabled) {
    face = (
      <a className={className} href={href} target="_blank" rel="noopener noreferrer" onClick={onClick}>
        {text}
      </a>
    );
  } else {
    face = (
      <button type={htmlType} className={className} aria-disabled={disabled || undefined} onClick={onClick}>
        {text}
      </button>
    );
  }
  return (
    <span {...rootProps} className={cx('hsp-crm-action', rootProps.className)}>
      {face}
      <FeedbackBubble feedback={feedback} />
    </span>
  );
}

function CrmActionLinkPreview({ props, text, rootProps, mode, trigger }: PreviewProps) {
  const live = mode === 'preview';
  const variant = oneOf(props.variant, ACTION_LINK_VARIANTS, 'primary');
  const [feedback, setFeedback] = useActionFeedback();
  const href = externalHref(props.actionType, props.actionContext);
  const className = cx('hsp-crm-link', `hsp-crm-link--${variant}`, live && 'hsp-crm-link--interactive');
  const content = (
    <>
      {text}
      {props.actionType === 'EXTERNAL_URL' && <ExternalLink size={12} strokeWidth={2.25} aria-hidden="true" className="hsp-crm-link-external" />}
    </>
  );
  const onClick = () => {
    trigger('onClick');
    simulateAction(props.actionType, props.actionContext, trigger, setFeedback);
  };

  let face: ReactNode;
  if (!live) face = <span className={className}>{content}</span>;
  else if (href) {
    face = (
      <a className={className} href={href} target="_blank" rel="noopener noreferrer" onClick={onClick}>
        {content}
      </a>
    );
  } else {
    face = (
      <button type="button" className={className} onClick={onClick}>
        {content}
      </button>
    );
  }
  return (
    <span {...rootProps} className={cx('hsp-crm-action', rootProps.className)}>
      {face}
      <FeedbackBubble feedback={feedback} />
    </span>
  );
}

/** Label of an action config: its `label`, else the action's name. */
function configLabel(config: Record<string, unknown>, fallback: string): string {
  const label = str(config.label).trim();
  if (label) return label;
  return isActionType(config.actionType) ? ACTION_META[config.actionType].label : fallback;
}

function CrmCardActionsPreview({ props, rootProps, mode, trigger }: PreviewProps) {
  const live = mode === 'preview';
  const configs = objectList(props.actionConfigs);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [feedback, setFeedback] = useActionFeedback();
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(openIndex !== null, ref, () => setOpenIndex(null));

  const run = (config: Record<string, unknown>) => {
    setOpenIndex(null);
    simulateAction(config.actionType, config.actionContext, trigger, setFeedback);
  };

  return (
    <div {...rootProps} ref={ref} className={cx('hsp-crm-card-actions', rootProps.className)}>
      {configs.length === 0 ? (
        <EmptyState icon={LayoutPanelTop} title="No card actions" hint="Add action configs (buttons or dropdowns of CRM actions)." />
      ) : (
        configs.map((config, i) => {
          const dropdown = config.type === 'dropdown';
          const disabled = flag(config.disabled, false);
          const tooltip = str(config.tooltipText) || undefined;
          const label = configLabel(config, dropdown ? 'More' : 'Action');
          const className = cx(
            'hsp-crm-btn',
            'hsp-crm-btn--secondary',
            'hsp-crm-btn--small',
            disabled && 'hsp-crm-btn--disabled',
            live && !disabled && 'hsp-crm-btn--interactive',
          );
          const options = dropdown ? objectList(config.options) : [];
          const open = openIndex === i;
          return (
            <span className="hsp-crm-card-action" key={i}>
              {live ? (
                <button
                  type="button"
                  className={className}
                  title={tooltip}
                  aria-disabled={disabled || undefined}
                  aria-haspopup={dropdown ? 'menu' : undefined}
                  aria-expanded={dropdown ? open : undefined}
                  onClick={() => {
                    if (disabled) return;
                    if (dropdown) setOpenIndex(open ? null : i);
                    else run(config);
                  }}
                >
                  {label}
                  {dropdown && <ChevronDown size={12} aria-hidden="true" />}
                </button>
              ) : (
                <span className={className} title={tooltip} aria-disabled={disabled || undefined}>
                  {label}
                  {dropdown && <ChevronDown size={12} aria-hidden="true" />}
                </span>
              )}
              {open && (
                <span className="hsp-crm-menu" role="menu">
                  {options.length === 0 && <span className="hsp-crm-menu-empty">No options</span>}
                  {options.map((option, j) => {
                    const optionDisabled = flag(option.disabled, false);
                    return (
                      <button
                        key={j}
                        type="button"
                        role="menuitem"
                        className={cx('hsp-crm-menu-item', optionDisabled && 'hsp-crm-menu-item--disabled')}
                        title={str(option.tooltipText) || undefined}
                        aria-disabled={optionDisabled || undefined}
                        onClick={() => !optionDisabled && run(option)}
                      >
                        {configLabel(option, `Option ${j + 1}`)}
                      </button>
                    );
                  })}
                </span>
              )}
            </span>
          );
        })
      )}
      <FeedbackBubble feedback={feedback} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default templates
// ---------------------------------------------------------------------------

function actionConfig(label: string, actionType: CrmActionType): { [key: string]: JsonValue } {
  return { type: 'action-library-button', label, actionType, actionContext: currentRecordContext() };
}

function defaultActionConfigs(): JsonValue[] {
  return [
    actionConfig('Add note', 'ADD_NOTE'),
    {
      type: 'dropdown',
      label: 'More actions',
      options: [
        actionConfig('Send email', 'SEND_EMAIL'),
        actionConfig('Create task', 'ADD_TASK'),
        actionConfig('Schedule meeting', 'SCHEDULE_MEETING'),
      ],
    },
  ];
}

function defaultStatistics(): JsonValue[] {
  return [
    { label: 'Total pipeline', statisticType: 'SUM', propertyName: 'amount' },
    { label: 'Average deal size', statisticType: 'AVG', propertyName: 'amount' },
    {
      label: 'Open deals',
      statisticType: 'COUNT',
      propertyName: 'hs_object_id',
      filterGroups: [
        {
          filters: [
            { property: 'dealstage', operator: 'NEQ', value: 'closedwon' },
            { property: 'dealstage', operator: 'NEQ', value: 'closedlost' },
          ],
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

export const crmComponents: ComponentDef[] = [
  {
    type: 'CrmPropertyList',
    label: 'Property list',
    category: 'CRM data',
    description: 'Lists up to 24 properties of the current record (or a specific record) with inline editing.',
    icon: TableProperties,
    docsUrl: `${CRM_DOCS}/crm-property-list`,
    importFrom: '@hubspot/ui-extensions/crm',
    locations: CRM_DATA_LOCATIONS,
    keywords: ['crm', 'properties', 'fields', 'record', 'details', 'about', 'editable'],
    children: { mode: 'none' },
    create: () => ({
      type: 'CrmPropertyList',
      props: { properties: ['firstname', 'lastname', 'email', 'phone', 'lifecyclestage', 'hubspot_owner_id'] },
    }),
    props: [
      propertiesProp('Internal names of the properties to display, up to 24. Shows the current record unless Object type ID and Record ID are set.'),
      {
        // TS type is `string`; HubSpot documents "column" (default) and "row".
        name: 'direction',
        label: 'Direction',
        type: {
          kind: 'enum',
          options: [
            { value: 'column', label: 'Column (stacked)' },
            { value: 'row', label: 'Row (side by side)' },
          ],
        },
        defaultValue: 'column',
        group: 'Appearance',
        description: 'The layout direction of the list.',
      },
      RECORD_OBJECT_TYPE_ID_PROP,
      RECORD_OBJECT_ID_PROP,
      TEST_ID_PROP,
    ],
    preview: CrmPropertyListPreview,
  },
  {
    type: 'CrmAssociationTable',
    label: 'Association table',
    category: 'CRM data',
    description: 'A searchable, paginated table of records associated with the current record.',
    icon: Table2,
    docsUrl: `${CRM_DOCS}/crm-association-table`,
    importFrom: '@hubspot/ui-extensions/crm',
    locations: CRM_DATA_LOCATIONS,
    keywords: ['crm', 'associations', 'associated records', 'table', 'deals', 'contacts', 'companies', 'list'],
    children: { mode: 'none' },
    create: () => ({
      type: 'CrmAssociationTable',
      props: {
        objectTypeId: '0-3',
        propertyColumns: ['dealname', 'dealstage', 'amount', 'closedate'],
        quickFilterProperties: ['dealstage'],
        pageSize: 5,
      },
    }),
    props: [
      objectTypeIdProp('Object type of the associated records to list.', true),
      propertiesProp('Internal names of the properties to show as table columns.', 'Property columns', 'propertyColumns'),
      {
        name: 'quickFilterProperties',
        label: 'Quick filter properties',
        type: { kind: 'stringList', placeholder: 'e.g. dealstage' },
        group: 'Data',
        description: 'Properties offered as quick filters above the table. When set, the "Association label" filter also shows.',
      },
      {
        name: 'searchable',
        label: 'Searchable',
        type: { kind: 'boolean' },
        defaultValue: true,
        group: 'Behavior',
        description: 'Show the search bar above the table.',
      },
      {
        name: 'pagination',
        label: 'Pagination',
        type: { kind: 'boolean' },
        defaultValue: true,
        group: 'Behavior',
        description: 'Show the pagination navigation below the table.',
      },
      {
        name: 'associationLabelFilter',
        label: 'Association label filter',
        type: { kind: 'boolean' },
        group: 'Behavior',
        description: 'Set to false to hide the "Association label" quick filter above the table.',
      },
      {
        name: 'pageSize',
        label: 'Page size',
        type: { kind: 'number', min: 1, step: 1, integer: true },
        group: 'Behavior',
        description: 'Number of rows per page of results.',
      },
      filtersProp('preFilters', 'Only list associated records whose property values match these filters.', [
        { property: 'dealstage', operator: 'NEQ', value: 'closedlost' },
        { property: 'amount', operator: 'GT', value: 1000 },
      ]),
      sortProp('Default sorting of the table.'),
      TEST_ID_PROP,
    ],
    preview: CrmAssociationTablePreview,
  },
  {
    type: 'CrmDataHighlight',
    label: 'Data highlight',
    category: 'CRM data',
    description: 'Highlights up to four property values of the current record (or a specific record) side by side.',
    icon: Gauge,
    docsUrl: `${CRM_DOCS}/crm-data-highlight`,
    importFrom: '@hubspot/ui-extensions/crm',
    locations: CRM_DATA_LOCATIONS,
    keywords: ['crm', 'kpi', 'metrics', 'highlight', 'summary', 'numbers', 'properties'],
    children: { mode: 'none' },
    create: () => ({
      type: 'CrmDataHighlight',
      props: { properties: ['lifecyclestage', 'hs_lead_status', 'notes_last_contacted', 'num_associated_deals'] },
    }),
    props: [
      propertiesProp('Internal names of the properties to display, up to four. Shows the current record unless Object type ID and Record ID are set.'),
      RECORD_OBJECT_TYPE_ID_PROP,
      RECORD_OBJECT_ID_PROP,
      TEST_ID_PROP,
    ],
    preview: CrmDataHighlightPreview,
  },
  {
    type: 'CrmReport',
    label: 'Report',
    category: 'CRM data',
    description: 'Embeds an existing single object report, optionally filtered to the current record.',
    icon: FileChartColumn,
    docsUrl: `${CRM_DOCS}/crm-report`,
    importFrom: '@hubspot/ui-extensions/crm',
    locations: CRM_DATA_LOCATIONS,
    keywords: ['crm', 'report', 'chart', 'analytics', 'dashboard', 'graph'],
    children: { mode: 'none' },
    create: () => ({ type: 'CrmReport', props: { reportId: '123456789' } }),
    props: [
      {
        name: 'reportId',
        label: 'Report ID',
        type: { kind: 'string', placeholder: '123456789' },
        group: 'Data',
        required: true,
        description: 'ID of the single object report; find it in the report URL in HubSpot.',
      },
      {
        name: 'use',
        label: 'Filter by record',
        type: {
          kind: 'enum',
          options: [
            { value: 'associations', label: 'Associated records' },
            { value: 'subject', label: 'This record only' },
            { value: 'unfiltered', label: 'Unfiltered' },
          ],
        },
        defaultValue: 'associations',
        group: 'Data',
        description:
          'How the report relates to the current record: data from associated records, from this record only, or all data.',
      },
      TEST_ID_PROP,
    ],
    preview: CrmReportPreview,
  },
  {
    type: 'CrmAssociationPivot',
    label: 'Association pivot',
    category: 'CRM data',
    description: 'Lists associated records grouped by association label.',
    icon: Network,
    docsUrl: `${CRM_DOCS}/crm-association-pivot`,
    importFrom: '@hubspot/ui-extensions/crm',
    locations: CRM_DATA_LOCATIONS,
    keywords: ['crm', 'associations', 'labels', 'group', 'related records', 'pivot'],
    children: { mode: 'none' },
    create: () => ({ type: 'CrmAssociationPivot', props: { objectTypeId: '0-1', maxAssociations: 5 } }),
    props: [
      objectTypeIdProp('Object type of the associated records to list.', true),
      associationLabelsProp('Only show these association labels. By default all labels appear.'),
      {
        name: 'maxAssociations',
        label: 'Max per label',
        type: { kind: 'number', min: 1, step: 1, integer: true },
        group: 'Appearance',
        description: 'Number of records shown in each label group before a "Show more" button.',
      },
      filtersProp('preFilters', 'Only list associated records whose property values match these filters.', [
        { property: 'lifecyclestage', operator: 'EQ', value: 'customer' },
      ]),
      sortProp('Default sorting of the records.'),
      TEST_ID_PROP,
    ],
    preview: CrmAssociationPivotPreview,
  },
  {
    type: 'CrmAssociationPropertyList',
    label: 'Association property list',
    category: 'CRM data',
    description: 'Lists up to 24 properties of a record associated with the current record.',
    icon: ListTree,
    docsUrl: `${CRM_DOCS}/crm-association-property-list`,
    importFrom: '@hubspot/ui-extensions/crm',
    locations: CRM_DATA_LOCATIONS,
    keywords: ['crm', 'associations', 'associated record', 'properties', 'company', 'primary'],
    children: { mode: 'none' },
    create: () => ({
      type: 'CrmAssociationPropertyList',
      props: { objectTypeId: '0-2', properties: ['name', 'domain', 'industry', 'numberofemployees'] },
    }),
    props: [
      objectTypeIdProp('Object type of the associated record.', true),
      propertiesProp('Internal names of the associated record’s properties to display, up to 24.'),
      associationLabelsProp('Only use an associated record that has all of these labels.'),
      filtersProp('filters', 'Only use an associated record whose property values match these filters.', [
        { property: 'domain', operator: 'HAS_PROPERTY' },
      ]),
      sortProp('Sorting used to pick the associated record.'),
      TEST_ID_PROP,
    ],
    preview: CrmAssociationPropertyListPreview,
  },
  {
    type: 'CrmAssociationStageTracker',
    label: 'Association stage tracker',
    category: 'CRM data',
    description: 'Shows the pipeline or lifecycle stage progress of associated records, with up to four properties.',
    icon: Route,
    docsUrl: `${CRM_DOCS}/crm-association-stage-tracker`,
    importFrom: '@hubspot/ui-extensions/crm',
    locations: CRM_DATA_LOCATIONS,
    keywords: ['crm', 'associations', 'pipeline', 'stage', 'progress', 'lifecycle', 'deals'],
    children: { mode: 'none' },
    create: () => ({
      type: 'CrmAssociationStageTracker',
      props: { objectTypeId: '0-3', properties: ['dealname', 'amount', 'closedate'] },
    }),
    props: [
      objectTypeIdProp('Object type of the associated records.', true),
      propertiesProp('Internal names of the associated records’ properties to display, up to four.'),
      associationLabelsProp('Only include associated records with these labels (case sensitive).'),
      filtersProp('filters', 'Only include associated records whose property values match these filters.', [
        { property: 'dealstage', operator: 'NEQ', value: 'closedlost' },
      ]),
      showPropertiesProp('Show the properties below the progress indicator.'),
      sortProp('Overrides the default sorting of associated records.'),
      TEST_ID_PROP,
    ],
    preview: CrmAssociationStageTrackerPreview,
  },
  {
    type: 'CrmSimpleDeadline',
    label: 'Simple deadline',
    category: 'CRM data',
    description: 'A progress bar from a start date property to a deadline date property, with optional properties below.',
    icon: Hourglass,
    docsUrl: `${CRM_DOCS}/overview`,
    importFrom: '@hubspot/ui-extensions/crm',
    locations: CRM_DATA_LOCATIONS,
    keywords: ['crm', 'deadline', 'due date', 'timeline', 'progress', 'countdown', 'dates'],
    children: { mode: 'none' },
    create: () => ({
      type: 'CrmSimpleDeadline',
      props: { startDatePropertyName: 'createdate', endDatePropertyName: 'closedate', properties: ['dealname', 'amount'] },
    }),
    props: [
      {
        name: 'startDatePropertyName',
        label: 'Start date property',
        type: { kind: 'string', placeholder: 'createdate' },
        group: 'Data',
        required: true,
        description: 'Internal name of the property holding the start date.',
      },
      {
        name: 'endDatePropertyName',
        label: 'Deadline property',
        type: { kind: 'string', placeholder: 'closedate' },
        group: 'Data',
        required: true,
        description: 'Internal name of the property holding the deadline date.',
      },
      propertiesProp('Internal names of the properties to display below the progress bar.'),
      showPropertiesProp('Show the properties below the progress bar.'),
      {
        name: 'progressTheme',
        label: 'Progress theme',
        group: 'Appearance',
        description: 'Colors, gradients and shape of the progress bar.',
        type: {
          kind: 'object',
          fields: [
            { name: 'backgroundColor', label: 'Background color', type: { kind: 'string', placeholder: '#f5f8fa' } },
            { name: 'completedColor', label: 'Completed color', type: { kind: 'string', placeholder: '#00a4bd' } },
            { name: 'upcomingColor', label: 'Upcoming color', type: { kind: 'string', placeholder: '#eaf0f6' } },
            { name: 'borderRadius', label: 'Border radius', type: { kind: 'string', placeholder: '4px' } },
            { name: 'height', label: 'Height', type: { kind: 'string', placeholder: '8px' } },
            {
              name: 'completedGradient',
              label: 'Completed gradient',
              type: {
                kind: 'object',
                fields: [
                  { name: 'startColor', label: 'Start color', type: { kind: 'string', placeholder: '#00a4bd' }, required: true },
                  { name: 'endColor', label: 'End color', type: { kind: 'string', placeholder: '#00bda5' }, required: true },
                ],
              },
            },
            {
              name: 'upcomingGradient',
              label: 'Upcoming gradient',
              type: {
                kind: 'object',
                fields: [
                  { name: 'startColor', label: 'Start color', type: { kind: 'string', placeholder: '#eaf0f6' }, required: true },
                  { name: 'endColor', label: 'End color', type: { kind: 'string', placeholder: '#cbd6e2' }, required: true },
                ],
              },
            },
          ],
        },
      },
      TEST_ID_PROP,
    ],
    preview: CrmSimpleDeadlinePreview,
  },
  {
    type: 'CrmStageTracker',
    label: 'Stage tracker',
    category: 'CRM data',
    description: 'Shows the pipeline or lifecycle stage progress of the current record (or a specific record), with up to four properties.',
    icon: Milestone,
    docsUrl: `${CRM_DOCS}/crm-stage-tracker`,
    importFrom: '@hubspot/ui-extensions/crm',
    locations: CRM_DATA_LOCATIONS,
    keywords: ['crm', 'pipeline', 'stage', 'progress', 'lifecycle', 'deal stage', 'status'],
    children: { mode: 'none' },
    create: () => ({
      type: 'CrmStageTracker',
      props: { properties: ['dealname', 'amount', 'closedate', 'hubspot_owner_id'] },
    }),
    props: [
      propertiesProp('Internal names of the properties to display, up to four.'),
      showPropertiesProp('Show the properties below the progress indicator.'),
      RECORD_OBJECT_TYPE_ID_PROP,
      RECORD_OBJECT_ID_PROP,
      TEST_ID_PROP,
    ],
    preview: CrmStageTrackerPreview,
  },
  {
    type: 'CrmStatistics',
    label: 'CRM statistics',
    category: 'CRM data',
    description: 'Calculates statistics (sum, average, min, max, count, percentiles) over CRM records.',
    icon: Sigma,
    docsUrl: `${CRM_DOCS}/crm-statistics`,
    importFrom: '@hubspot/ui-extensions/crm',
    locations: CRM_DATA_LOCATIONS,
    keywords: ['crm', 'statistics', 'kpi', 'sum', 'average', 'count', 'metrics', 'aggregate'],
    children: { mode: 'none' },
    create: () => ({ type: 'CrmStatistics', props: { objectTypeId: '0-3', statistics: defaultStatistics() } }),
    props: [
      objectTypeIdProp('Object type of the records to calculate statistics about.', true),
      {
        name: 'statistics',
        label: 'Statistics',
        type: {
          kind: 'json',
          template: defaultStatistics(),
          hint:
            'Array of { label, statisticType, propertyName, filterGroups? }. statisticType: SUM, AVG, MIN, MAX, ' +
            'DISTINCT_APPROX, COUNT, or PERCENTILES (add percentile: 0-100). filterGroups: [{ filters: [{ property, operator, value }] }].',
        },
        group: 'Data',
        required: true,
        description: 'The statistics to calculate and display.',
      },
      TEST_ID_PROP,
    ],
    preview: CrmStatisticsPreview,
  },
  {
    type: 'CrmActionButton',
    label: 'CRM action button',
    category: 'CRM actions',
    description: 'A button that runs a built-in CRM action: send email, add note or task, preview or open a record, and more.',
    icon: Zap,
    docsUrl: `${CRM_ACTION_DOCS}/crm-action-button`,
    importFrom: '@hubspot/ui-extensions/crm',
    locations: CRM_ACTION_LOCATIONS,
    keywords: ['crm', 'action', 'button', 'email', 'note', 'task', 'meeting', 'preview', 'workflow'],
    children: { mode: 'text', defaultText: 'Send email' },
    events: [ACTION_ON_CLICK_EVENT, ON_ERROR_EVENT],
    create: () => ({
      type: 'CrmActionButton',
      props: { actionType: 'SEND_EMAIL', actionContext: currentRecordContext() },
      text: 'Send email',
    }),
    props: [
      actionTypeProp(),
      actionContextProp(),
      {
        name: 'variant',
        label: 'Variant',
        type: {
          kind: 'enum',
          options: [
            { value: 'primary', label: 'Primary' },
            { value: 'secondary', label: 'Secondary' },
            { value: 'destructive', label: 'Destructive' },
          ],
        },
        defaultValue: 'secondary',
        group: 'Appearance',
        description: 'The color variation of the button.',
      },
      {
        name: 'size',
        label: 'Size',
        type: {
          kind: 'enum',
          options: [
            { value: 'extra-small', label: 'Extra small' },
            { value: 'small', label: 'Small' },
            { value: 'medium', label: 'Medium' },
          ],
        },
        defaultValue: 'medium',
        group: 'Appearance',
        description: 'The size of the button.',
      },
      {
        name: 'type',
        label: 'HTML type',
        type: { kind: 'enum', options: [{ value: 'button' }, { value: 'reset' }, { value: 'submit' }] },
        defaultValue: 'button',
        group: 'Behavior',
        description: 'The button’s HTML type attribute.',
      },
      {
        name: 'disabled',
        label: 'Disabled',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Behavior',
        description: 'Render the button greyed out so it cannot be clicked.',
      },
      TEST_ID_PROP,
    ],
    preview: CrmActionButtonPreview,
  },
  {
    type: 'CrmActionLink',
    label: 'CRM action link',
    category: 'CRM actions',
    description: 'A link that runs a built-in CRM action: add a note, preview or open a record, open a URL, and more.',
    icon: Link2,
    docsUrl: `${CRM_ACTION_DOCS}/crm-action-link`,
    importFrom: '@hubspot/ui-extensions/crm',
    locations: CRM_ACTION_LOCATIONS,
    keywords: ['crm', 'action', 'link', 'note', 'preview', 'record', 'url'],
    children: { mode: 'text', defaultText: 'Add a note' },
    events: [ACTION_ON_CLICK_EVENT, ON_ERROR_EVENT],
    create: () => ({
      type: 'CrmActionLink',
      props: { actionType: 'ADD_NOTE', actionContext: currentRecordContext() },
      text: 'Add a note',
    }),
    props: [
      actionTypeProp(),
      actionContextProp(),
      {
        name: 'variant',
        label: 'Variant',
        type: {
          kind: 'enum',
          options: [
            { value: 'primary', label: 'Primary' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'destructive', label: 'Destructive' },
          ],
        },
        defaultValue: 'primary',
        group: 'Appearance',
        description: 'The color variation of the link.',
      },
      TEST_ID_PROP,
    ],
    preview: CrmActionLinkPreview,
  },
  {
    type: 'CrmCardActions',
    label: 'Card actions',
    category: 'CRM actions',
    description: 'A row of CRM action buttons and dropdown menus, configured as data.',
    icon: LayoutPanelTop,
    docsUrl: `${CRM_ACTION_DOCS}/crm-card-actions`,
    importFrom: '@hubspot/ui-extensions/crm',
    locations: CRM_DATA_LOCATIONS,
    keywords: ['crm', 'actions', 'toolbar', 'buttons', 'dropdown', 'menu', 'quick actions'],
    children: { mode: 'none' },
    events: [ON_ERROR_EVENT],
    create: () => ({ type: 'CrmCardActions', props: { actionConfigs: defaultActionConfigs() } }),
    props: [
      {
        name: 'actionConfigs',
        label: 'Action configs',
        type: {
          kind: 'json',
          template: defaultActionConfigs(),
          hint:
            "Array of buttons { type: 'action-library-button', label, actionType, actionContext, disabled?, tooltipText? } " +
            "and dropdowns { type: 'dropdown', label, options: [button, ...], disabled?, tooltipText? }. " +
            'actionContext follows the action type (see CRM action button).',
        },
        group: 'Behavior',
        required: true,
        description: 'The buttons and dropdown menus to render, each running a CRM action.',
      },
      TEST_ID_PROP,
    ],
    preview: CrmCardActionsPreview,
  },
];
