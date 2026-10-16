/**
 * "Start from…" choices of the guided setup: starters that fit the chosen record type and place on
 * the page, plus a "Key details" card built from the portal's real properties (or the standard
 * ones with sample data) and a blank card. Every choice builds an extension whose object type and
 * location are the ones the admin picked.
 *
 * Starters that need setup outside HubSpot (an external API, app functions with secrets) are left
 * out here: they stay in the Templates panel for later.
 */
import { createProject } from '../model/factory';
import { isAvailableIn } from '../model/rules';
import { ROOT_TYPE, type ActionStep, type CardLocation, type Extension, type NodeTemplate, type Project, type UINode } from '../model/types';
import { getComponent } from '../registry';
import { PROJECT_TEMPLATES, instantiateExtensionTemplate, type ExtensionTemplate, type InstantiatedTemplate } from '../templates/catalog';
import { dataSource, makeExtension, mockRecord, t } from '../templates/builders';
import { extensionTemplates } from '../templates/Wireframe';
import { findStandardType } from '../connect/objectTypes';
import type { CrmObjectTypeInfo, CrmPropertyDef } from '../connect/types';

/** Name of the app created by the guided setup (shown in HubSpot as the app's name). */
export const FIRST_RUN_APP_NAME = 'My HubSpot Cards';

export const OVERVIEW_STARTER_ID = 'overview';
export const BLANK_STARTER_ID = 'blank';

export interface StarterOption {
  id: string;
  name: string;
  description: string;
  /** Short highlight, e.g. "Your real properties". */
  badge?: string;
  /** Top-level node templates for the wireframe thumbnail. */
  preview: NodeTemplate[];
  /** Builds the card (fresh ids) next to the given project's extensions and functions. */
  create: (project: Pick<Project, 'extensions' | 'functions' | 'app'>) => InstantiatedTemplate;
}

export interface RecordTypeChoice {
  objectType: string;
  objectTypeId?: string;
  /** Singular / plural labels, e.g. "Contact" / "Contacts". */
  singular: string;
  plural: string;
}

// ---------------------------------------------------------------------------
// Record types
// ---------------------------------------------------------------------------

/** The standard record types offered by the setup (cards for these are the most common). */
export const STANDARD_SETUP_TYPES: RecordTypeChoice[] = [
  { objectType: 'contacts', objectTypeId: '0-1', singular: 'Contact', plural: 'Contacts' },
  { objectType: 'companies', objectTypeId: '0-2', singular: 'Company', plural: 'Companies' },
  { objectType: 'deals', objectTypeId: '0-3', singular: 'Deal', plural: 'Deals' },
  { objectType: 'tickets', objectTypeId: '0-5', singular: 'Ticket', plural: 'Tickets' },
];

/** The standard four plus the portal's custom objects (by label), when the portal is known. */
export function setupRecordTypes(portalTypes: readonly CrmObjectTypeInfo[] | null | undefined): RecordTypeChoice[] {
  const custom = (portalTypes ?? [])
    .filter((t) => t.custom)
    .map<RecordTypeChoice>((t) => ({ objectType: t.objectType, objectTypeId: t.objectTypeId, singular: t.label || t.objectType, plural: t.pluralLabel || t.label || t.objectType }));
  return [...STANDARD_SETUP_TYPES, ...custom];
}

/** Help desk sidebar cards only appear on tickets. */
export function locationAllowed(location: CardLocation, objectType: string): boolean {
  if (location !== 'helpdesk.sidebar') return true;
  return findStandardType(objectType)?.objectTypeId === '0-5';
}

// ---------------------------------------------------------------------------
// "Key details": a card of the record's most useful properties
// ---------------------------------------------------------------------------

export interface OverviewField {
  name: string;
  label: string;
  /** Value shown with sample data (formatted like HubSpot shows it). */
  mock: string;
}

export interface OverviewSpec {
  type: RecordTypeChoice;
  /** Properties that make up the title (contacts: first and last name). */
  primary: string[];
  fields: OverviewField[];
  /** The fields come from the connected portal's schema (custom properties included). */
  fromPortal: boolean;
}

type Preset = { primary: string[]; primaryMock: string[]; fields: OverviewField[] };

const f = (name: string, label: string, mock: string): OverviewField => ({ name, label, mock });

/** Standard properties for the standard four (sample data, or when the portal schema can't be read). */
const PRESETS: Record<string, Preset> = {
  '0-1': {
    primary: ['firstname', 'lastname'],
    primaryMock: ['Ada', 'Lovelace'],
    fields: [
      f('email', 'Email', 'ada@analytical.example'),
      f('phone', 'Phone number', '+1 (555) 010-2030'),
      f('jobtitle', 'Job title', 'Head of Computation'),
      f('company', 'Company name', 'Analytical Engines Ltd'),
      f('lifecyclestage', 'Lifecycle stage', 'Customer'),
      f('city', 'City', 'London'),
    ],
  },
  '0-2': {
    primary: ['name'],
    primaryMock: ['Analytical Engines Ltd'],
    fields: [
      f('domain', 'Company domain name', 'analytical.example'),
      f('industry', 'Industry', 'Computer Software'),
      f('numberofemployees', 'Number of employees', '120'),
      f('city', 'City', 'London'),
      f('phone', 'Phone number', '+44 20 7946 0000'),
    ],
  },
  '0-3': {
    primary: ['dealname'],
    primaryMock: ['Difference Engine Expansion'],
    fields: [
      f('amount', 'Amount', '$125,000.00'),
      f('dealstage', 'Deal stage', 'Contract sent'),
      f('closedate', 'Close date', '12/1/2026'),
      f('pipeline', 'Pipeline', 'Sales Pipeline'),
      f('hubspot_owner_id', 'Deal owner', 'Jordan Lee'),
    ],
  },
  '0-5': {
    primary: ['subject'],
    primaryMock: ['Calibration issue on unit #12'],
    fields: [
      f('hs_pipeline_stage', 'Ticket status', 'Waiting on us'),
      f('hs_ticket_priority', 'Priority', 'High'),
      f('hs_pipeline', 'Pipeline', 'Support Pipeline'),
      f('createdate', 'Create date', '1/14/2026'),
      f('hubspot_owner_id', 'Ticket owner', 'Jordan Lee'),
    ],
  },
};

const MAX_FIELDS = 6;

function mockFor(def: CrmPropertyDef): string {
  const option = def.options?.find((o) => !o.hidden);
  if (option) return option.label || option.value;
  switch (def.type) {
    case 'number':
      return '42';
    case 'date':
    case 'datetime':
      return '1/14/2026';
    case 'bool':
      return 'Yes';
    default:
      return `Sample ${def.label.toLowerCase()}`;
  }
}

function usable(def: CrmPropertyDef): boolean {
  return !def.hidden && !!def.name && !/^hs_object_id$|^hs_lastmodifieddate$|^createdate$/.test(def.name) && def.fieldType !== 'file';
}

/**
 * What the "Key details" card shows: the title property and up to six properties — the usual
 * standard ones that exist in the portal, then the portal's own (custom) properties. Without a
 * portal schema the standard presets are used (custom objects then show their primary property).
 */
export function overviewSpec(type: RecordTypeChoice, info?: CrmObjectTypeInfo | null, properties?: readonly CrmPropertyDef[] | null): OverviewSpec {
  const typeId = type.objectTypeId ?? findStandardType(type.objectType)?.objectTypeId ?? '';
  const preset = PRESETS[typeId];
  const schema = properties && properties.length ? properties : null;
  if (!schema) {
    if (preset) return { type, primary: preset.primary, fields: preset.fields, fromPortal: false };
    const primary = info?.primaryDisplayProperty || 'hs_object_id';
    return { type, primary: [primary], fields: [f('hs_object_id', 'Record ID', '51')].filter((x) => x.name !== primary), fromPortal: false };
  }
  const byName = new Map(schema.map((p) => [p.name, p]));
  const primary = preset ? preset.primary.filter((n) => byName.has(n)) : [];
  if (primary.length === 0) {
    const name = info?.primaryDisplayProperty && byName.has(info.primaryDisplayProperty) ? info.primaryDisplayProperty : schema.find(usable)?.name;
    if (name) primary.push(name);
  }
  const fields: OverviewField[] = [];
  const add = (def: CrmPropertyDef | undefined, mock?: string) => {
    if (!def || fields.length >= MAX_FIELDS || primary.includes(def.name) || fields.some((x) => x.name === def.name)) return;
    fields.push({ name: def.name, label: def.label || def.name, mock: mock ?? mockFor(def) });
  };
  for (const p of preset?.fields ?? []) add(byName.get(p.name), p.mock);
  for (const name of info?.secondaryDisplayProperties ?? []) add(byName.get(name));
  // The portal's own properties make the card feel like theirs: show a couple even after the presets.
  const custom = schema.filter((p) => p.hubspotDefined === false && usable(p));
  const reserve = Math.min(2, custom.length);
  if (fields.length > MAX_FIELDS - reserve) fields.length = MAX_FIELDS - reserve;
  for (const p of custom) add(p);
  for (const p of schema) if (usable(p) && !p.calculated) add(p);
  return { type, primary, fields, fromPortal: true };
}

function access(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? `record.${name}` : `record[${JSON.stringify(name)}]`;
}

function overviewContent(spec: OverviewSpec, location: CardLocation): NodeTemplate[] {
  // A plain template ("{{ record.firstname }} {{ record.lastname }}") reads well in the inspector.
  const title = (spec.primary.length ? spec.primary : ['hs_object_id']).map((name) => `{{ ${access(name)} }}`).join(' ');
  const narrow = location === 'crm.record.sidebar' || location === 'crm.preview' || location === 'helpdesk.sidebar';
  return [
    t.column(
      [
        t.heading(title, { name: 'Record name' }),
        {
          type: 'DescriptionList',
          name: 'Key details',
          props: { direction: narrow ? 'column' : 'row' },
          children: spec.fields.map((field) => t.item(field.label, `{{ ${access(field.name)} || '—' }}`)),
        },
      ],
      'medium',
    ),
  ];
}

/** Builds the "Key details" card for a record type at a location. */
export function buildOverviewExtension(spec: OverviewSpec, location: CardLocation, existing: Extension[]): Extension {
  const typeId = spec.type.objectTypeId ?? findStandardType(spec.type.objectType)?.objectTypeId ?? '0-1';
  const preset = PRESETS[typeId];
  const mockProps: Record<string, string> = {};
  spec.primary.forEach((name, i) => {
    mockProps[name] = preset && preset.primary[i] === name ? preset.primaryMock[i] : `Sample ${spec.type.singular.toLowerCase()}`;
  });
  for (const field of spec.fields) mockProps[field.name] = field.mock;
  const record = dataSource({ kind: 'crmProperties', name: 'record', properties: [...spec.primary, ...spec.fields.map((x) => x.name)], formatted: true });
  return makeExtension({
    existing,
    name: `${spec.type.singular} Details`,
    description: `Key details of the current ${spec.type.singular.toLowerCase()}.`,
    location,
    objectTypes: [spec.type.objectType],
    dataSources: [record],
    content: overviewContent(spec, location),
    mock: (mock) => mockRecord(mock, typeId, 51, mockProps),
  });
}

// ---------------------------------------------------------------------------
// Starter gallery
// ---------------------------------------------------------------------------

function stepsOf(node: UINode): ActionStep[] {
  const out: ActionStep[] = [];
  const walk = (list: ActionStep[] | undefined) => {
    for (const s of list ?? []) {
      out.push(s);
      const nested = s as { then?: ActionStep[]; else?: ActionStep[]; onSuccess?: ActionStep[]; onError?: ActionStep[] };
      walk(nested.then);
      walk(nested.else);
      walk(nested.onSuccess);
      walk(nested.onError);
    }
  };
  for (const list of Object.values(node.events ?? {})) walk(list);
  return out;
}

/** Needs setup outside HubSpot (an external API or server code), so it isn't a first-run starter. */
export function needsExternalSetup(tpl: ExtensionTemplate, ext: Extension): boolean {
  if (tpl.functions?.().length) return true;
  if (ext.dataSources.some((d) => d.kind === 'fetch' || d.kind === 'function')) return true;
  return Object.values(ext.nodes).some((n) => stepsOf(n).some((s) => s.type === 'fetch' || s.type === 'runFunction'));
}

/** Every component of the card can be used at its location (e.g. the record sidebar allows fewer). */
export function fitsLocation(ext: Extension): boolean {
  return Object.values(ext.nodes).every((n) => {
    if (n.type === ROOT_TYPE) return true;
    const def = getComponent(n.type);
    return !def || isAvailableIn(def, ext);
  });
}

function relocate(inst: InstantiatedTemplate, location: CardLocation, objectType: string): InstantiatedTemplate {
  inst.extension.location = location;
  inst.extension.objectTypes = [objectType];
  return inst;
}

/** Plain-language descriptions of the ready-made cards offered by the setup. */
const FRIENDLY_DESCRIPTIONS: Record<string, string> = {
  'contact-summary': 'The contact’s name, lifecycle stage and key details, with buttons to email them or copy their address.',
  'deal-calculator': 'Work out a discount on the deal: seats, price and discount with live totals and an approval warning.',
  'associated-deals': 'The company’s deals in a table, with their stage, close date, amount and totals.',
  'onboarding-checklist': 'A checklist your team ticks off for each customer, with a progress bar.',
  'ticket-triage': 'The ticket’s priority at a glance, with an Escalate button that asks before it acts.',
  'sidebar-actions': 'One-click buttons to email, add a note, book a meeting or create a task.',
  'crm-showcase': 'HubSpot’s ready-made pieces: highlights, a stage tracker, properties and associated records.',
};

function forType(tpl: ExtensionTemplate, typeId: string | undefined): boolean {
  if (!typeId) return false;
  return (tpl.objectTypes ?? []).some((t) => findStandardType(t)?.objectTypeId === typeId);
}

const EMPTY_PROJECT = (): Pick<Project, 'extensions' | 'functions' | 'app'> => {
  const p = createProject(FIRST_RUN_APP_NAME, []);
  return { extensions: p.extensions, functions: p.functions, app: p.app };
};

export interface StarterInput {
  type: RecordTypeChoice;
  location: CardLocation;
  /** The portal's info for the type and its properties (when connected and loaded). */
  info?: CrmObjectTypeInfo | null;
  properties?: readonly CrmPropertyDef[] | null;
}

/**
 * The starters offered for a record type and location: "Key details" first, then the matching
 * ready-made cards (no external setup, every component available there), then a blank card.
 */
export function startersFor(input: StarterInput): StarterOption[] {
  const { type, location } = input;
  const typeId = type.objectTypeId ?? findStandardType(type.objectType)?.objectTypeId;
  const spec = overviewSpec(type, input.info, input.properties);
  const lower = type.singular.toLowerCase();
  const overview: StarterOption = {
    id: OVERVIEW_STARTER_ID,
    name: `${type.singular} details`,
    description: spec.fromPortal
      ? `The ${lower}’s name and ${spec.fields.length} of your properties, with your labels — including your own custom properties.`
      : `The ${lower}’s name and its most useful details in a tidy list.`,
    badge: spec.fromPortal ? 'Your real properties' : 'Simple',
    preview: overviewContent(spec, location),
    create: (project) => ({ extension: buildOverviewExtension(spec, location, project.extensions), functions: [] }),
  };

  const matching: StarterOption[] = [];
  for (const tpl of PROJECT_TEMPLATES) {
    if (tpl.kind !== 'card' || tpl.id === 'blank-card' || !forType(tpl, typeId)) continue;
    let sample: Extension;
    try {
      sample = relocate(instantiateExtensionTemplate(tpl, EMPTY_PROJECT()), location, type.objectType).extension;
    } catch {
      continue;
    }
    if (needsExternalSetup(tpl, sample) || !fitsLocation(sample)) continue;
    matching.push({
      id: tpl.id,
      name: tpl.name,
      description: FRIENDLY_DESCRIPTIONS[tpl.id] ?? tpl.description,
      preview: extensionTemplates(sample),
      create: (project) => relocate(instantiateExtensionTemplate(tpl, project), location, type.objectType),
    });
  }

  const blank: StarterOption = {
    id: BLANK_STARTER_ID,
    name: 'Blank card',
    description: 'Start from scratch and add components yourself.',
    preview: [],
    create: (project) => ({
      extension: makeExtension({ existing: project.extensions, name: `${type.singular} Card`, location, objectTypes: [type.objectType], content: [] }),
      functions: [],
    }),
  };
  return [overview, ...matching, blank];
}
