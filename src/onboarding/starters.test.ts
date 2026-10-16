/**
 * The guided setup's starters: only cards that fit the chosen record type and place (no external
 * setup), "Key details" built from the portal's real properties, and every choice validates and
 * generates code that type-checks.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateProjectFiles } from '../codegen';
import { createProject } from '../model/factory';
import type { CardLocation, Project } from '../model/types';
import { validateProject } from '../model/validate';
import type { CrmObjectTypeInfo, CrmPropertyDef } from '../connect/types';
import { formatDiagnostics, scratchDir, typecheck, writeFiles } from '../test/typecheck';
import {
  BLANK_STARTER_ID,
  FIRST_RUN_APP_NAME,
  OVERVIEW_STARTER_ID,
  STANDARD_SETUP_TYPES,
  buildOverviewExtension,
  fitsLocation,
  locationAllowed,
  overviewSpec,
  setupRecordTypes,
  startersFor,
  type RecordTypeChoice,
  type StarterOption,
} from './starters';

const prop = (name: string, label: string, extra: Partial<CrmPropertyDef> = {}): CrmPropertyDef => ({
  name,
  label,
  type: 'string',
  fieldType: 'text',
  hubspotDefined: true,
  ...extra,
});

const CONTACT_PROPERTIES: CrmPropertyDef[] = [
  prop('firstname', 'First name'),
  prop('lastname', 'Last name'),
  prop('email', 'Email'),
  prop('phone', 'Phone number'),
  prop('jobtitle', 'Job title'),
  prop('company', 'Company name'),
  prop('lifecyclestage', 'Lifecycle stage', { type: 'enumeration', options: [{ label: 'Customer', value: 'customer' }] }),
  prop('city', 'City'),
  prop('hs_object_id', 'Record ID', { type: 'number' }),
  prop('favorite_product', 'Favorite product', { type: 'enumeration', hubspotDefined: false, options: [{ label: 'Enterprise', value: 'enterprise' }] }),
  prop('loyalty_points', 'Loyalty points', { type: 'number', hubspotDefined: false }),
  prop('secret_notes', 'Secret notes', { hubspotDefined: false, hidden: true }),
];

const PROJECTS: CrmObjectTypeInfo = {
  objectType: 'p_projects',
  objectTypeId: '2-555',
  label: 'Project',
  pluralLabel: 'Projects',
  primaryDisplayProperty: 'project_name',
  secondaryDisplayProperties: ['status'],
  custom: true,
};
const PROJECT_PROPERTIES: CrmPropertyDef[] = [
  prop('project_name', 'Project name', { hubspotDefined: false }),
  prop('status', 'Status', { type: 'enumeration', hubspotDefined: false, options: [{ label: 'Active', value: 'active' }] }),
  prop('budget', 'Budget', { type: 'number', hubspotDefined: false }),
];

const contacts = STANDARD_SETUP_TYPES[0];
const deals = STANDARD_SETUP_TYPES[2];
const tickets = STANDARD_SETUP_TYPES[3];
const projectsType: RecordTypeChoice = { objectType: 'p_projects', objectTypeId: '2-555', singular: 'Project', plural: 'Projects' };

function projectFor(starter: StarterOption): Project {
  const project = createProject(FIRST_RUN_APP_NAME, []);
  const { extension, functions } = starter.create(project);
  project.extensions = [extension];
  project.functions = functions;
  return project;
}

const problems = (project: Project) =>
  validateProject(project)
    .filter((i) => i.severity === 'error' || i.severity === 'warning')
    .map((i) => `${i.severity} ${i.rule} ${i.message}`);

describe('record types and places', () => {
  it('offers the standard four plus the portal’s custom objects by label', () => {
    const types = setupRecordTypes([PROJECTS, { ...PROJECTS, objectType: 'products', objectTypeId: '0-7', label: 'Product', pluralLabel: 'Products', custom: false }]);
    expect(types.map((t) => t.plural)).toEqual(['Contacts', 'Companies', 'Deals', 'Tickets', 'Projects']);
    expect(setupRecordTypes(null)).toHaveLength(4);
  });

  it('allows the help desk only for tickets', () => {
    expect(locationAllowed('helpdesk.sidebar', 'tickets')).toBe(true);
    expect(locationAllowed('helpdesk.sidebar', '0-5')).toBe(true);
    expect(locationAllowed('helpdesk.sidebar', 'contacts')).toBe(false);
    expect(locationAllowed('crm.record.sidebar', 'contacts')).toBe(true);
  });
});

describe('"Key details" card', () => {
  it('uses the standard properties with sample data', () => {
    const spec = overviewSpec(contacts);
    expect(spec.fromPortal).toBe(false);
    expect(spec.primary).toEqual(['firstname', 'lastname']);
    expect(spec.fields.map((f) => f.name)).toContain('email');
  });

  it('uses the portal’s real labels and includes its own custom properties (never hidden ones)', () => {
    const spec = overviewSpec(contacts, null, CONTACT_PROPERTIES);
    expect(spec.fromPortal).toBe(true);
    expect(spec.fields.length).toBeLessThanOrEqual(6);
    const names = spec.fields.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(['email', 'favorite_product', 'loyalty_points']));
    expect(names).not.toContain('secret_notes');
    expect(names).not.toContain('firstname');
    expect(spec.fields.find((f) => f.name === 'favorite_product')).toMatchObject({ label: 'Favorite product', mock: 'Enterprise' });
  });

  it('works for custom objects (primary display property, then their properties)', () => {
    const spec = overviewSpec(projectsType, PROJECTS, PROJECT_PROPERTIES);
    expect(spec.primary).toEqual(['project_name']);
    expect(spec.fields.map((f) => f.name)).toEqual(['status', 'budget']);
    const ext = buildOverviewExtension(spec, 'crm.record.tab', []);
    expect(ext.objectTypes).toEqual(['p_projects']);
    expect(ext.name).toBe('Project Details');
    expect(ext.mock.context.crm.objectTypeId).toBe('2-555');
    const ds = ext.dataSources[0];
    expect(ds).toMatchObject({ kind: 'crmProperties', name: 'record', properties: ['project_name', 'status', 'budget'], formatted: true });
  });

  it('shows label / value pairs stacked in narrow places', () => {
    const tab = buildOverviewExtension(overviewSpec(contacts), 'crm.record.tab', []);
    const side = buildOverviewExtension(overviewSpec(contacts), 'crm.record.sidebar', []);
    const dir = (e: typeof tab) => Object.values(e.nodes).find((n) => n.type === 'DescriptionList')!.props.direction;
    expect(dir(tab)).toBe('row');
    expect(dir(side)).toBe('column');
  });
});

describe('starter gallery', () => {
  it('puts "Key details" first and Blank last, with only cards for the chosen type', () => {
    const ids = startersFor({ type: contacts, location: 'crm.record.tab' }).map((s) => s.id);
    expect(ids[0]).toBe(OVERVIEW_STARTER_ID);
    expect(ids[ids.length - 1]).toBe(BLANK_STARTER_ID);
    expect(ids).toContain('contact-summary');
    // Deal / company cards are not offered for contacts.
    expect(ids).not.toContain('deal-calculator');
    expect(ids).not.toContain('associated-deals');
    // Starters that need an external API or server code wait for later (Templates panel).
    expect(ids).not.toContain('feedback-form');
    expect(ids).not.toContain('enrichment-lookup');
    expect(startersFor({ type: deals, location: 'crm.record.tab' }).map((s) => s.id)).not.toContain('server-quote');
  });

  it('only offers cards whose components work in the chosen place', () => {
    const tab = startersFor({ type: deals, location: 'crm.record.tab' }).map((s) => s.id);
    const side = startersFor({ type: deals, location: 'crm.record.sidebar' }).map((s) => s.id);
    expect(tab).toContain('crm-showcase');
    // HubSpot's CRM data components aren't available in the record sidebar.
    expect(side).not.toContain('crm-showcase');
    for (const s of startersFor({ type: deals, location: 'crm.record.sidebar' })) {
      expect(fitsLocation(s.create(createProject('x', [])).extension), s.id).toBe(true);
    }
  });

  it('gives custom objects "Key details" and Blank', () => {
    const ids = startersFor({ type: projectsType, location: 'crm.record.tab', info: PROJECTS, properties: PROJECT_PROPERTIES }).map((s) => s.id);
    expect(ids).toEqual([OVERVIEW_STARTER_ID, BLANK_STARTER_ID]);
  });

  it('labels the "Key details" card by where its fields came from', () => {
    expect(startersFor({ type: contacts, location: 'crm.record.tab' })[0].badge).toBe('Simple');
    expect(startersFor({ type: contacts, location: 'crm.record.tab', properties: CONTACT_PROPERTIES })[0].badge).toBe('Your real properties');
  });
});

/** Every choice the setup can make: types × places (help desk only for tickets). */
function allChoices(): Array<{ label: string; starter: StarterOption; location: CardLocation; objectType: string }> {
  const out: Array<{ label: string; starter: StarterOption; location: CardLocation; objectType: string }> = [];
  const places: CardLocation[] = ['crm.record.tab', 'crm.record.sidebar', 'crm.preview', 'helpdesk.sidebar'];
  const cases: Array<{ type: RecordTypeChoice; info?: CrmObjectTypeInfo; properties?: CrmPropertyDef[] }> = [
    ...STANDARD_SETUP_TYPES.map((type) => ({ type })),
    { type: contacts, properties: CONTACT_PROPERTIES },
    { type: projectsType, info: PROJECTS, properties: PROJECT_PROPERTIES },
  ];
  for (const c of cases) {
    for (const location of places) {
      if (!locationAllowed(location, c.type.objectType)) continue;
      for (const starter of startersFor({ type: c.type, location, info: c.info, properties: c.properties })) {
        out.push({ label: `${c.type.objectType}${c.properties ? '+portal' : ''} ${location} ${starter.id}`, starter, location, objectType: c.type.objectType });
      }
    }
  }
  return out;
}

describe('every setup choice', () => {
  const choices = allChoices();

  it('covers tickets in the help desk', () => {
    expect(choices.some((c) => c.objectType === tickets.objectType && c.location === 'helpdesk.sidebar' && c.starter.id === 'ticket-triage')).toBe(true);
  });

  it.each(choices.map((c) => [c.label, c] as const))('%s: right place and record type, no problems', (_label, c) => {
    const project = projectFor(c.starter);
    const ext = project.extensions[0];
    expect(ext.location).toBe(c.location);
    expect(ext.objectTypes).toEqual([c.objectType]);
    expect(problems(project)).toEqual([]);
  });

  it('generates code that type-checks (strict)', () => {
    const dir = scratchDir('first-run-starters');
    const roots: string[] = [];
    choices.forEach((c, i) => {
      const files = generateProjectFiles(projectFor(c.starter));
      const sub = path.join(dir, `choice-${i}`);
      writeFiles(sub, files);
      roots.push(...files.filter((f) => f.path.endsWith('.tsx')).map((f) => path.join(sub, f.path)));
    });
    expect(formatDiagnostics(typecheck(roots))).toBe('');
  });
});
