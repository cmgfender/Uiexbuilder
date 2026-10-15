/**
 * Seed data for the fake HubSpot portal ("Acme Demo", portal 12345678 by default): object type
 * definitions with standard + custom properties, records, associations, pipelines and owners.
 * Values follow the CRM v3 API conventions (every property value is a string; dates are
 * "YYYY-MM-DD", datetimes ISO-8601).
 */

export interface FakePropertyOption {
  label: string;
  value: string;
  description?: string;
  displayOrder: number;
  hidden: boolean;
}

export interface FakeProperty {
  name: string;
  label: string;
  type: 'string' | 'number' | 'date' | 'datetime' | 'enumeration' | 'bool' | 'phone_number';
  fieldType: string;
  groupName: string;
  description?: string;
  options?: FakePropertyOption[];
  hubspotDefined?: boolean;
  calculated?: boolean;
  hidden?: boolean;
  readOnlyValue?: boolean;
}

export interface FakeObjectType {
  /** Canonical API name ("contacts", or the custom object's short name "projects"). */
  name: string;
  objectTypeId: string;
  singular: string;
  plural: string;
  /** Path spellings accepted by the fake API ("contact", "0-1", "p_projects" …). */
  aliases: string[];
  /** Scopes that allow reading records (any of). */
  readScopes: string[];
  /** Scopes that allow reading the property definitions (any of). */
  schemaScopes: string[];
  properties: FakeProperty[];
  /** Properties matched by the free-text `query` of CRM search. */
  searchable: string[];
  /** Returned by GET / search when no properties are requested. */
  defaultProperties: string[];
  /** "lastmodifieddate" for contacts, "hs_lastmodifieddate" elsewhere. */
  lastModifiedProperty: string;
  primaryDisplayProperty: string;
  secondaryDisplayProperties: string[];
  custom?: { fullyQualifiedName: string; schemaId: string };
}

export interface FakeRecord {
  id: string;
  properties: Record<string, string | null>;
  createdAt: string;
  updatedAt: string;
}

export interface FakeAssociationType {
  category: 'HUBSPOT_DEFINED' | 'USER_DEFINED';
  typeId: number;
  label: string | null;
}

export interface FakeAssociation {
  fromType: string;
  fromId: string;
  toType: string;
  toId: string;
  /** Types as seen from `from` → `to`. */
  types: FakeAssociationType[];
  /** Types as seen from `to` → `from`. */
  reverseTypes: FakeAssociationType[];
}

export interface FakePipelineStage {
  id: string;
  label: string;
  displayOrder: number;
  metadata: Record<string, string>;
}

export interface FakePipeline {
  id: string;
  label: string;
  displayOrder: number;
  stages: FakePipelineStage[];
}

export interface FakeOwner {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  userId: number;
}

export interface FakeSeed {
  portalId: number;
  hubDomain: string;
  objectTypes: FakeObjectType[];
  records: Map<string, FakeRecord[]>;
  associations: FakeAssociation[];
  pipelines: Map<string, FakePipeline[]>;
  owners: FakeOwner[];
}

const CREATED = '2024-01-15T10:30:00.000Z';
const UPDATED = '2025-06-02T14:05:00.000Z';

function opts(pairs: Array<[string, string]>): FakePropertyOption[] {
  return pairs.map(([value, label], i) => ({ value, label, displayOrder: i, hidden: false }));
}

function std(name: string, label: string, type: FakeProperty['type'], fieldType: string, groupName: string, extra: Partial<FakeProperty> = {}): FakeProperty {
  return { name, label, type, fieldType, groupName, hubspotDefined: true, ...extra };
}

function custom(name: string, label: string, type: FakeProperty['type'], fieldType: string, groupName: string, extra: Partial<FakeProperty> = {}): FakeProperty {
  return { name, label, type, fieldType, groupName, hubspotDefined: false, ...extra };
}

const SYSTEM = (lastModified: string, created = 'createdate'): FakeProperty[] => [
  std('hs_object_id', 'Record ID', 'number', 'number', 'system', { readOnlyValue: true }),
  std(created, 'Create date', 'datetime', 'date', 'system', { readOnlyValue: true }),
  std(lastModified, 'Last modified date', 'datetime', 'date', 'system', { readOnlyValue: true, calculated: false }),
];

export const OWNERS: FakeOwner[] = [
  { id: '101', email: 'jordan.lee@acmedemo.com', firstName: 'Jordan', lastName: 'Lee', userId: 9001 },
  { id: '102', email: 'sam.rivera@acmedemo.com', firstName: 'Sam', lastName: 'Rivera', userId: 9002 },
  { id: '103', email: 'alex.morgan@acmedemo.com', firstName: 'Alex', lastName: 'Morgan', userId: 9003 },
];

const OWNER_PROPERTY = std('hubspot_owner_id', 'Owner', 'enumeration', 'select', 'sales_properties', {
  options: OWNERS.map((o, i) => ({ value: o.id, label: `${o.firstName} ${o.lastName}`, displayOrder: i, hidden: false })),
});

const LIFECYCLE = opts([
  ['subscriber', 'Subscriber'],
  ['lead', 'Lead'],
  ['marketingqualifiedlead', 'Marketing Qualified Lead'],
  ['salesqualifiedlead', 'Sales Qualified Lead'],
  ['opportunity', 'Opportunity'],
  ['customer', 'Customer'],
  ['evangelist', 'Evangelist'],
  ['other', 'Other'],
]);

export const DEAL_PIPELINES: FakePipeline[] = [
  {
    id: 'default',
    label: 'Sales Pipeline',
    displayOrder: 0,
    stages: [
      { id: 'appointmentscheduled', label: 'Appointment Scheduled', displayOrder: 0, metadata: { isClosed: 'false', probability: '0.2' } },
      { id: 'qualifiedtobuy', label: 'Qualified To Buy', displayOrder: 1, metadata: { isClosed: 'false', probability: '0.4' } },
      { id: 'presentationscheduled', label: 'Presentation Scheduled', displayOrder: 2, metadata: { isClosed: 'false', probability: '0.6' } },
      { id: 'decisionmakerboughtin', label: 'Decision Maker Bought-In', displayOrder: 3, metadata: { isClosed: 'false', probability: '0.8' } },
      { id: 'contractsent', label: 'Contract Sent', displayOrder: 4, metadata: { isClosed: 'false', probability: '0.9' } },
      { id: 'closedwon', label: 'Closed Won', displayOrder: 5, metadata: { isClosed: 'true', probability: '1.0' } },
      { id: 'closedlost', label: 'Closed Lost', displayOrder: 6, metadata: { isClosed: 'true', probability: '0.0' } },
    ],
  },
  {
    id: '75012345',
    label: 'Renewals',
    displayOrder: 1,
    stages: [
      { id: '1001', label: 'Renewal upcoming', displayOrder: 0, metadata: { isClosed: 'false', probability: '0.5' } },
      { id: '1002', label: 'In negotiation', displayOrder: 1, metadata: { isClosed: 'false', probability: '0.7' } },
      { id: '1003', label: 'Renewed', displayOrder: 2, metadata: { isClosed: 'true', probability: '1.0' } },
      { id: '1004', label: 'Churned', displayOrder: 3, metadata: { isClosed: 'true', probability: '0.0' } },
    ],
  },
];

export const TICKET_PIPELINES: FakePipeline[] = [
  {
    id: '0',
    label: 'Support Pipeline',
    displayOrder: 0,
    stages: [
      { id: '1', label: 'New', displayOrder: 0, metadata: { ticketState: 'OPEN' } },
      { id: '2', label: 'Waiting on contact', displayOrder: 1, metadata: { ticketState: 'OPEN' } },
      { id: '3', label: 'Waiting on us', displayOrder: 2, metadata: { ticketState: 'OPEN' } },
      { id: '4', label: 'Closed', displayOrder: 3, metadata: { ticketState: 'CLOSED' } },
    ],
  },
];

function stageOptions(pipelines: FakePipeline[]): FakePropertyOption[] {
  let i = 0;
  return pipelines.flatMap((p) => p.stages.map((s) => ({ value: s.id, label: `${s.label} (${p.label})`, displayOrder: i++, hidden: false })));
}

function pipelineOptions(pipelines: FakePipeline[]): FakePropertyOption[] {
  return pipelines.map((p, i) => ({ value: p.id, label: p.label, displayOrder: i, hidden: false }));
}

export const CUSTOM_OBJECT_TYPE_ID = '2-4561234';

export function buildObjectTypes(portalId: number): FakeObjectType[] {
  return [
    {
      name: 'contacts',
      objectTypeId: '0-1',
      singular: 'Contact',
      plural: 'Contacts',
      aliases: ['contact', '0-1'],
      readScopes: ['crm.objects.contacts.read'],
      schemaScopes: ['crm.schemas.contacts.read'],
      searchable: ['firstname', 'lastname', 'email', 'phone', 'company'],
      defaultProperties: ['firstname', 'lastname', 'email', 'createdate', 'lastmodifieddate', 'hs_object_id'],
      lastModifiedProperty: 'lastmodifieddate',
      primaryDisplayProperty: 'firstname',
      secondaryDisplayProperties: ['email'],
      properties: [
        std('firstname', 'First name', 'string', 'text', 'contactinformation'),
        std('lastname', 'Last name', 'string', 'text', 'contactinformation'),
        std('email', 'Email', 'string', 'text', 'contactinformation', { description: "A contact's email address" }),
        std('phone', 'Phone number', 'string', 'phonenumber', 'contactinformation'),
        std('company', 'Company name', 'string', 'text', 'contactinformation'),
        std('jobtitle', 'Job title', 'string', 'text', 'contactinformation'),
        std('city', 'City', 'string', 'text', 'contactinformation'),
        std('country', 'Country/Region', 'string', 'text', 'contactinformation'),
        std('lifecyclestage', 'Lifecycle stage', 'enumeration', 'radio', 'contactinformation', { options: LIFECYCLE }),
        std('hs_lead_status', 'Lead status', 'enumeration', 'select', 'sales_properties', {
          options: opts([
            ['NEW', 'New'],
            ['OPEN', 'Open'],
            ['IN_PROGRESS', 'In Progress'],
            ['OPEN_DEAL', 'Open Deal'],
            ['UNQUALIFIED', 'Unqualified'],
            ['ATTEMPTED_TO_CONTACT', 'Attempted to Contact'],
            ['CONNECTED', 'Connected'],
            ['BAD_TIMING', 'Bad Timing'],
          ]),
        }),
        OWNER_PROPERTY,
        ...SYSTEM('lastmodifieddate'),
        custom('favorite_product', 'Favorite product', 'enumeration', 'select', 'contactinformation', {
          description: 'Which plan the contact likes best',
          options: opts([
            ['starter', 'Starter'],
            ['pro', 'Professional'],
            ['enterprise', 'Enterprise'],
          ]),
        }),
        custom('loyalty_points', 'Loyalty points', 'number', 'number', 'contactinformation'),
        custom('onboarding_date', 'Onboarding date', 'date', 'date', 'contactinformation'),
        custom('newsletter_opt_in', 'Newsletter opt-in', 'bool', 'booleancheckbox', 'contactinformation', {
          options: opts([
            ['true', 'Yes'],
            ['false', 'No'],
          ]),
        }),
      ],
    },
    {
      name: 'companies',
      objectTypeId: '0-2',
      singular: 'Company',
      plural: 'Companies',
      aliases: ['company', '0-2'],
      readScopes: ['crm.objects.companies.read'],
      schemaScopes: ['crm.schemas.companies.read'],
      searchable: ['name', 'domain', 'phone', 'city'],
      defaultProperties: ['name', 'domain', 'createdate', 'hs_lastmodifieddate', 'hs_object_id'],
      lastModifiedProperty: 'hs_lastmodifieddate',
      primaryDisplayProperty: 'name',
      secondaryDisplayProperties: ['domain'],
      properties: [
        std('name', 'Company name', 'string', 'text', 'companyinformation'),
        std('domain', 'Company domain name', 'string', 'text', 'companyinformation'),
        std('industry', 'Industry', 'enumeration', 'select', 'companyinformation', {
          options: opts([
            ['COMPUTER_SOFTWARE', 'Computer Software'],
            ['FINANCIAL_SERVICES', 'Financial Services'],
            ['LOGISTICS_AND_SUPPLY_CHAIN', 'Logistics and Supply Chain'],
            ['RESEARCH', 'Research'],
            ['CONSULTING', 'Management Consulting'],
          ]),
        }),
        std('city', 'City', 'string', 'text', 'companyinformation'),
        std('country', 'Country/Region', 'string', 'text', 'companyinformation'),
        std('phone', 'Phone number', 'string', 'phonenumber', 'companyinformation'),
        std('numberofemployees', 'Number of employees', 'number', 'number', 'companyinformation'),
        std('annualrevenue', 'Annual revenue', 'number', 'number', 'companyinformation'),
        std('lifecyclestage', 'Lifecycle stage', 'enumeration', 'radio', 'companyinformation', { options: LIFECYCLE }),
        OWNER_PROPERTY,
        ...SYSTEM('hs_lastmodifieddate'),
        custom('customer_tier', 'Customer tier', 'enumeration', 'select', 'companyinformation', {
          options: opts([
            ['gold', 'Gold'],
            ['silver', 'Silver'],
            ['bronze', 'Bronze'],
          ]),
        }),
        custom('contract_renewal_date', 'Contract renewal date', 'date', 'date', 'companyinformation'),
        custom('health_score', 'Health score', 'number', 'number', 'companyinformation', { description: '0–100, higher is healthier' }),
      ],
    },
    {
      name: 'deals',
      objectTypeId: '0-3',
      singular: 'Deal',
      plural: 'Deals',
      aliases: ['deal', '0-3'],
      readScopes: ['crm.objects.deals.read'],
      schemaScopes: ['crm.schemas.deals.read'],
      searchable: ['dealname', 'description'],
      defaultProperties: ['dealname', 'amount', 'closedate', 'dealstage', 'pipeline', 'createdate', 'hs_lastmodifieddate', 'hs_object_id'],
      lastModifiedProperty: 'hs_lastmodifieddate',
      primaryDisplayProperty: 'dealname',
      secondaryDisplayProperties: ['amount'],
      properties: [
        std('dealname', 'Deal name', 'string', 'text', 'dealinformation'),
        std('amount', 'Amount', 'number', 'number', 'dealinformation'),
        std('dealstage', 'Deal stage', 'enumeration', 'radio', 'dealinformation', { options: stageOptions(DEAL_PIPELINES) }),
        std('pipeline', 'Pipeline', 'enumeration', 'select', 'dealinformation', { options: pipelineOptions(DEAL_PIPELINES) }),
        std('closedate', 'Close date', 'datetime', 'date', 'dealinformation'),
        std('dealtype', 'Deal type', 'enumeration', 'radio', 'dealinformation', {
          options: opts([
            ['newbusiness', 'New Business'],
            ['existingbusiness', 'Existing Business'],
          ]),
        }),
        std('description', 'Deal description', 'string', 'textarea', 'dealinformation'),
        OWNER_PROPERTY,
        ...SYSTEM('hs_lastmodifieddate'),
        custom('deal_source', 'Deal source', 'enumeration', 'select', 'dealinformation', {
          options: opts([
            ['inbound', 'Inbound'],
            ['outbound', 'Outbound'],
            ['partner', 'Partner'],
            ['referral', 'Referral'],
          ]),
        }),
        custom('discount_percent', 'Discount (%)', 'number', 'number', 'dealinformation'),
        custom('is_renewal', 'Is renewal', 'bool', 'booleancheckbox', 'dealinformation', {
          options: opts([
            ['true', 'Yes'],
            ['false', 'No'],
          ]),
        }),
      ],
    },
    {
      name: 'tickets',
      objectTypeId: '0-5',
      singular: 'Ticket',
      plural: 'Tickets',
      aliases: ['ticket', '0-5'],
      readScopes: ['tickets'],
      schemaScopes: ['tickets'],
      searchable: ['subject', 'content'],
      defaultProperties: ['subject', 'content', 'hs_pipeline', 'hs_pipeline_stage', 'createdate', 'hs_lastmodifieddate', 'hs_object_id'],
      lastModifiedProperty: 'hs_lastmodifieddate',
      primaryDisplayProperty: 'subject',
      secondaryDisplayProperties: ['hs_pipeline_stage'],
      properties: [
        std('subject', 'Ticket name', 'string', 'text', 'ticketinformation'),
        std('content', 'Ticket description', 'string', 'textarea', 'ticketinformation'),
        std('hs_pipeline', 'Pipeline', 'enumeration', 'select', 'ticketinformation', { options: pipelineOptions(TICKET_PIPELINES) }),
        std('hs_pipeline_stage', 'Ticket status', 'enumeration', 'select', 'ticketinformation', { options: stageOptions(TICKET_PIPELINES) }),
        std('hs_ticket_priority', 'Priority', 'enumeration', 'select', 'ticketinformation', {
          options: opts([
            ['LOW', 'Low'],
            ['MEDIUM', 'Medium'],
            ['HIGH', 'High'],
            ['URGENT', 'Urgent'],
          ]),
        }),
        OWNER_PROPERTY,
        ...SYSTEM('hs_lastmodifieddate'),
        custom('product_area', 'Product area', 'enumeration', 'select', 'ticketinformation', {
          options: opts([
            ['billing', 'Billing'],
            ['onboarding', 'Onboarding'],
            ['integrations', 'Integrations'],
            ['reporting', 'Reporting'],
          ]),
        }),
        custom('affected_users', 'Affected users', 'number', 'number', 'ticketinformation'),
        custom('sla_due', 'SLA due', 'datetime', 'date', 'ticketinformation'),
      ],
    },
    {
      name: 'products',
      objectTypeId: '0-7',
      singular: 'Product',
      plural: 'Products',
      aliases: ['product', '0-7'],
      readScopes: ['crm.objects.products.read', 'e-commerce'],
      schemaScopes: ['crm.objects.products.read', 'e-commerce'],
      searchable: ['name', 'hs_sku', 'description'],
      defaultProperties: ['name', 'price', 'description', 'createdate', 'hs_lastmodifieddate', 'hs_object_id'],
      lastModifiedProperty: 'hs_lastmodifieddate',
      primaryDisplayProperty: 'name',
      secondaryDisplayProperties: ['price'],
      properties: [
        std('name', 'Name', 'string', 'text', 'productinformation'),
        std('price', 'Unit price', 'number', 'number', 'productinformation'),
        std('hs_sku', 'SKU', 'string', 'text', 'productinformation'),
        std('description', 'Description', 'string', 'textarea', 'productinformation'),
        ...SYSTEM('hs_lastmodifieddate'),
        custom('product_family', 'Product family', 'enumeration', 'select', 'productinformation', {
          options: opts([
            ['software', 'Software'],
            ['services', 'Services'],
          ]),
        }),
        custom('margin_percent', 'Margin (%)', 'number', 'number', 'productinformation'),
        custom('launch_date', 'Launch date', 'date', 'date', 'productinformation'),
      ],
    },
    {
      name: 'line_items',
      objectTypeId: '0-8',
      singular: 'Line item',
      plural: 'Line items',
      aliases: ['line_item', '0-8'],
      readScopes: ['crm.objects.line_items.read', 'e-commerce'],
      schemaScopes: ['crm.objects.line_items.read', 'e-commerce'],
      searchable: ['name'],
      defaultProperties: ['name', 'quantity', 'price', 'amount', 'createdate', 'hs_lastmodifieddate', 'hs_object_id'],
      lastModifiedProperty: 'hs_lastmodifieddate',
      primaryDisplayProperty: 'name',
      secondaryDisplayProperties: ['price'],
      properties: [
        std('name', 'Name', 'string', 'text', 'lineiteminformation'),
        std('quantity', 'Quantity', 'number', 'number', 'lineiteminformation'),
        std('price', 'Unit price', 'number', 'number', 'lineiteminformation'),
        std('amount', 'Net price', 'number', 'number', 'lineiteminformation', { calculated: true, readOnlyValue: true }),
        std('hs_product_id', 'Product ID', 'number', 'number', 'lineiteminformation'),
        ...SYSTEM('hs_lastmodifieddate'),
      ],
    },
    {
      name: 'quotes',
      objectTypeId: '0-14',
      singular: 'Quote',
      plural: 'Quotes',
      aliases: ['quote', '0-14'],
      readScopes: ['crm.objects.quotes.read'],
      schemaScopes: ['crm.objects.quotes.read'],
      searchable: ['hs_title'],
      defaultProperties: ['hs_title', 'hs_expiration_date', 'createdate', 'hs_lastmodifieddate', 'hs_object_id'],
      lastModifiedProperty: 'hs_lastmodifieddate',
      primaryDisplayProperty: 'hs_title',
      secondaryDisplayProperties: ['hs_expiration_date'],
      properties: [
        std('hs_title', 'Quote name', 'string', 'text', 'quoteinformation'),
        std('hs_expiration_date', 'Expiration date', 'date', 'date', 'quoteinformation'),
        std('hs_status', 'Status', 'enumeration', 'select', 'quoteinformation', {
          options: opts([
            ['DRAFT', 'Draft'],
            ['APPROVED', 'Approved'],
          ]),
        }),
        ...SYSTEM('hs_lastmodifieddate'),
      ],
    },
    {
      name: 'projects',
      objectTypeId: CUSTOM_OBJECT_TYPE_ID,
      singular: 'Project',
      plural: 'Projects',
      aliases: [CUSTOM_OBJECT_TYPE_ID, 'p_projects', `p${portalId}_projects`],
      readScopes: ['crm.objects.custom.read'],
      schemaScopes: ['crm.schemas.custom.read', 'crm.objects.custom.read'],
      searchable: ['project_name'],
      defaultProperties: ['project_name', 'hs_createdate', 'hs_lastmodifieddate', 'hs_object_id'],
      lastModifiedProperty: 'hs_lastmodifieddate',
      primaryDisplayProperty: 'project_name',
      secondaryDisplayProperties: ['project_status'],
      custom: { fullyQualifiedName: `p${portalId}_projects`, schemaId: '4561234' },
      properties: [
        custom('project_name', 'Project name', 'string', 'text', 'projects_information'),
        custom('project_status', 'Status', 'enumeration', 'select', 'projects_information', {
          options: opts([
            ['planning', 'Planning'],
            ['in_progress', 'In progress'],
            ['on_hold', 'On hold'],
            ['done', 'Done'],
          ]),
        }),
        custom('budget', 'Budget', 'number', 'number', 'projects_information'),
        custom('start_date', 'Start date', 'date', 'date', 'projects_information'),
        { ...OWNER_PROPERTY },
        ...SYSTEM('hs_lastmodifieddate', 'hs_createdate'),
      ],
    },
  ];
}

function rec(id: string, properties: Record<string, string | null>, lastModifiedProperty = 'hs_lastmodifieddate', created = 'createdate'): FakeRecord {
  return {
    id,
    createdAt: CREATED,
    updatedAt: UPDATED,
    properties: { hs_object_id: id, [created]: CREATED, [lastModifiedProperty]: UPDATED, ...properties },
  };
}

const contact = (id: string, p: Record<string, string | null>) => rec(id, p, 'lastmodifieddate');

function buildRecords(): Map<string, FakeRecord[]> {
  const contacts: FakeRecord[] = [
    contact('1001', { firstname: 'Ada', lastname: 'Lovelace', email: 'ada@analyticalengines.com', phone: '+44 20 7946 0001', company: 'Analytical Engines Ltd', jobtitle: 'CTO', city: 'London', country: 'United Kingdom', lifecyclestage: 'customer', hs_lead_status: 'CONNECTED', hubspot_owner_id: '101', favorite_product: 'enterprise', loyalty_points: '1250', onboarding_date: '2023-03-14', newsletter_opt_in: 'true' }),
    contact('1002', { firstname: 'Grace', lastname: 'Hopper', email: 'grace@cobolworks.com', phone: '+1 703 555 0102', company: 'COBOL Works', jobtitle: 'VP Engineering', city: 'Arlington', country: 'United States', lifecyclestage: 'customer', hs_lead_status: 'OPEN_DEAL', hubspot_owner_id: '102', favorite_product: 'pro', loyalty_points: '980', onboarding_date: '2023-07-01', newsletter_opt_in: 'false' }),
    contact('1003', { firstname: 'Alan', lastname: 'Turing', email: 'alan@bletchleylabs.com', phone: '+44 1908 555 103', company: 'Bletchley Labs', jobtitle: 'Research Lead', city: 'Milton Keynes', country: 'United Kingdom', lifecyclestage: 'opportunity', hs_lead_status: 'IN_PROGRESS', hubspot_owner_id: '101', favorite_product: 'pro', loyalty_points: '320', onboarding_date: null, newsletter_opt_in: 'true' }),
    contact('1004', { firstname: 'Katherine', lastname: 'Johnson', email: 'katherine@orbitalmath.com', phone: '+1 757 555 0104', company: 'Orbital Math', jobtitle: 'Mathematician', city: 'Hampton', country: 'United States', lifecyclestage: 'lead', hs_lead_status: 'NEW', hubspot_owner_id: '103', favorite_product: null, loyalty_points: '0', onboarding_date: null, newsletter_opt_in: 'false' }),
    contact('1005', { firstname: 'Maria', lastname: 'Garcia', email: 'maria.garcia@northwindtraders.com', phone: '+34 91 555 0105', company: 'Northwind Traders', jobtitle: 'Purchasing Manager', city: 'Madrid', country: 'Spain', lifecyclestage: 'customer', hs_lead_status: 'CONNECTED', hubspot_owner_id: '102', favorite_product: 'enterprise', loyalty_points: '2100', onboarding_date: '2022-11-20', newsletter_opt_in: 'true' }),
    contact('1006', { firstname: 'James', lastname: 'Chen', email: 'james.chen@northwindtraders.com', phone: '+1 206 555 0106', company: 'Northwind Traders', jobtitle: 'Operations Director', city: 'Seattle', country: 'United States', lifecyclestage: 'customer', hs_lead_status: 'OPEN', hubspot_owner_id: '102', favorite_product: 'pro', loyalty_points: '640', onboarding_date: '2023-01-09', newsletter_opt_in: 'false' }),
    contact('1007', { firstname: 'Priya', lastname: 'Patel', email: 'priya@globex.io', phone: '+1 415 555 0107', company: 'Globex', jobtitle: 'Head of RevOps', city: 'San Francisco', country: 'United States', lifecyclestage: 'salesqualifiedlead', hs_lead_status: 'IN_PROGRESS', hubspot_owner_id: '101', favorite_product: 'enterprise', loyalty_points: '150', onboarding_date: null, newsletter_opt_in: 'true' }),
    contact('1008', { firstname: 'Tom', lastname: 'Becker', email: 'tom.becker@globex.io', phone: '+49 30 555 0108', company: 'Globex', jobtitle: 'Finance Manager', city: 'Berlin', country: 'Germany', lifecyclestage: 'opportunity', hs_lead_status: 'ATTEMPTED_TO_CONTACT', hubspot_owner_id: '103', favorite_product: 'starter', loyalty_points: '75', onboarding_date: null, newsletter_opt_in: null }),
    contact('1009', { firstname: 'Sofia', lastname: 'Rossi', email: 'sofia@initech.com', phone: '+39 02 555 0109', company: 'Initech', jobtitle: 'Customer Success Manager', city: 'Milan', country: 'Italy', lifecyclestage: 'customer', hs_lead_status: 'CONNECTED', hubspot_owner_id: '103', favorite_product: 'pro', loyalty_points: '1720', onboarding_date: '2021-09-30', newsletter_opt_in: 'true' }),
    contact('1010', { firstname: 'Liam', lastname: "O'Connor", email: 'liam@initech.com', phone: '+353 1 555 0110', company: 'Initech', jobtitle: 'IT Administrator', city: 'Dublin', country: 'Ireland', lifecyclestage: 'customer', hs_lead_status: 'OPEN', hubspot_owner_id: '101', favorite_product: 'starter', loyalty_points: '410', onboarding_date: '2024-02-12', newsletter_opt_in: 'false' }),
    contact('1011', { firstname: 'Emma', lastname: 'Svensson', email: 'emma@analyticalengines.com', phone: '+46 8 555 0111', company: 'Analytical Engines Ltd', jobtitle: 'Product Manager', city: 'Stockholm', country: 'Sweden', lifecyclestage: 'customer', hs_lead_status: 'CONNECTED', hubspot_owner_id: '101', favorite_product: 'enterprise', loyalty_points: '890', onboarding_date: '2023-03-14', newsletter_opt_in: 'true' }),
    contact('1012', { firstname: 'Noah', lastname: 'Kim', email: 'noah.kim@cobolworks.com', phone: '+82 2 555 0112', company: 'COBOL Works', jobtitle: 'Software Engineer', city: 'Seoul', country: 'South Korea', lifecyclestage: 'marketingqualifiedlead', hs_lead_status: 'NEW', hubspot_owner_id: '102', favorite_product: 'starter', loyalty_points: '30', onboarding_date: null, newsletter_opt_in: 'true' }),
    contact('1013', { firstname: 'Olivia', lastname: 'Brown', email: 'olivia@example.org', phone: null, company: null, jobtitle: null, city: 'Toronto', country: 'Canada', lifecyclestage: 'subscriber', hs_lead_status: null, hubspot_owner_id: null, favorite_product: null, loyalty_points: null, onboarding_date: null, newsletter_opt_in: 'true' }),
    contact('1014', { firstname: 'Lucas', lastname: 'Müller', email: 'lucas.mueller@bletchleylabs.com', phone: '+41 44 555 0114', company: 'Bletchley Labs', jobtitle: 'Data Scientist', city: 'Zürich', country: 'Switzerland', lifecyclestage: 'opportunity', hs_lead_status: 'IN_PROGRESS', hubspot_owner_id: '103', favorite_product: 'pro', loyalty_points: '505', onboarding_date: null, newsletter_opt_in: 'false' }),
  ];

  const companies: FakeRecord[] = [
    rec('2001', { name: 'Analytical Engines Ltd', domain: 'analyticalengines.com', industry: 'COMPUTER_SOFTWARE', city: 'London', country: 'United Kingdom', phone: '+44 20 7946 0000', numberofemployees: '240', annualrevenue: '18500000', lifecyclestage: 'customer', hubspot_owner_id: '101', customer_tier: 'gold', contract_renewal_date: '2026-03-31', health_score: '86' }),
    rec('2002', { name: 'COBOL Works', domain: 'cobolworks.com', industry: 'COMPUTER_SOFTWARE', city: 'Arlington', country: 'United States', phone: '+1 703 555 0100', numberofemployees: '1200', annualrevenue: '96000000', lifecyclestage: 'customer', hubspot_owner_id: '102', customer_tier: 'silver', contract_renewal_date: '2025-12-15', health_score: '72' }),
    rec('2003', { name: 'Bletchley Labs', domain: 'bletchleylabs.com', industry: 'RESEARCH', city: 'Milton Keynes', country: 'United Kingdom', phone: '+44 1908 555 100', numberofemployees: '85', annualrevenue: '7200000', lifecyclestage: 'opportunity', hubspot_owner_id: '101', customer_tier: 'bronze', contract_renewal_date: null, health_score: '58' }),
    rec('2004', { name: 'Northwind Traders', domain: 'northwindtraders.com', industry: 'LOGISTICS_AND_SUPPLY_CHAIN', city: 'Seattle', country: 'United States', phone: '+1 206 555 0100', numberofemployees: '3400', annualrevenue: '410000000', lifecyclestage: 'customer', hubspot_owner_id: '102', customer_tier: 'gold', contract_renewal_date: '2026-01-31', health_score: '91' }),
    rec('2005', { name: 'Globex', domain: 'globex.io', industry: 'FINANCIAL_SERVICES', city: 'San Francisco', country: 'United States', phone: '+1 415 555 0100', numberofemployees: '560', annualrevenue: '54000000', lifecyclestage: 'opportunity', hubspot_owner_id: '101', customer_tier: 'silver', contract_renewal_date: null, health_score: '64' }),
    rec('2006', { name: 'Initech', domain: 'initech.com', industry: 'CONSULTING', city: 'Austin', country: 'United States', phone: '+1 512 555 0100', numberofemployees: '310', annualrevenue: '22000000', lifecyclestage: 'customer', hubspot_owner_id: '103', customer_tier: 'bronze', contract_renewal_date: '2025-11-30', health_score: '45' }),
  ];

  const deals: FakeRecord[] = [
    rec('3001', { dealname: 'Analytical Engines – Enterprise plan', amount: '48000', dealstage: 'closedwon', pipeline: 'default', closedate: '2025-02-28T17:00:00.000Z', dealtype: 'newbusiness', description: 'Three-year enterprise agreement', hubspot_owner_id: '101', deal_source: 'inbound', discount_percent: '10', is_renewal: 'false' }),
    rec('3002', { dealname: 'COBOL Works – Expansion', amount: '22500', dealstage: 'contractsent', pipeline: 'default', closedate: '2025-07-15T17:00:00.000Z', dealtype: 'existingbusiness', description: 'Add 150 seats for the platform team', hubspot_owner_id: '102', deal_source: 'outbound', discount_percent: '5', is_renewal: 'false' }),
    rec('3003', { dealname: 'Bletchley Labs – Pilot', amount: '7500', dealstage: 'qualifiedtobuy', pipeline: 'default', closedate: '2025-08-01T17:00:00.000Z', dealtype: 'newbusiness', description: 'Eight-week pilot for the research team', hubspot_owner_id: '101', deal_source: 'referral', discount_percent: '0', is_renewal: 'false' }),
    rec('3004', { dealname: 'Northwind – Annual renewal', amount: '36000', dealstage: '1002', pipeline: '75012345', closedate: '2026-01-31T17:00:00.000Z', dealtype: 'existingbusiness', description: 'Annual renewal, pricing review requested', hubspot_owner_id: '102', deal_source: 'inbound', discount_percent: '8', is_renewal: 'true' }),
    rec('3005', { dealname: 'Globex – Onboarding package', amount: '12000', dealstage: 'presentationscheduled', pipeline: 'default', closedate: '2025-09-10T17:00:00.000Z', dealtype: 'newbusiness', description: 'Guided onboarding for the RevOps team', hubspot_owner_id: '101', deal_source: 'partner', discount_percent: '0', is_renewal: 'false' }),
    rec('3006', { dealname: 'Initech – Support add-on', amount: '4800', dealstage: 'appointmentscheduled', pipeline: 'default', closedate: '2025-10-01T17:00:00.000Z', dealtype: 'existingbusiness', description: 'Premium support tier', hubspot_owner_id: '103', deal_source: 'inbound', discount_percent: '0', is_renewal: 'false' }),
    rec('3007', { dealname: 'Globex – Data migration', amount: '18000', dealstage: 'decisionmakerboughtin', pipeline: 'default', closedate: '2025-08-20T17:00:00.000Z', dealtype: 'newbusiness', description: 'Migrate 10 years of CRM history', hubspot_owner_id: '103', deal_source: 'outbound', discount_percent: '12.5', is_renewal: 'false' }),
    rec('3008', { dealname: 'Analytical Engines – Training', amount: '3200', dealstage: 'closedlost', pipeline: 'default', closedate: '2025-04-30T17:00:00.000Z', dealtype: 'existingbusiness', description: 'On-site admin training', hubspot_owner_id: '101', deal_source: 'inbound', discount_percent: '0', is_renewal: 'false' }),
    rec('3009', { dealname: 'Northwind – Warehouse integration', amount: '27500', dealstage: 'qualifiedtobuy', pipeline: 'default', closedate: '2025-11-15T17:00:00.000Z', dealtype: 'existingbusiness', description: 'Connect the warehouse system', hubspot_owner_id: '102', deal_source: 'partner', discount_percent: '3', is_renewal: 'false' }),
    rec('3010', { dealname: 'Initech – Multi-year renewal', amount: '54000', dealstage: '1001', pipeline: '75012345', closedate: '2025-11-30T17:00:00.000Z', dealtype: 'existingbusiness', description: 'Three-year renewal proposal', hubspot_owner_id: '103', deal_source: 'inbound', discount_percent: '15', is_renewal: 'true' }),
  ];

  const tickets: FakeRecord[] = [
    rec('4001', { subject: 'Cannot export report to CSV', content: 'The export button spins forever on the revenue report.', hs_pipeline: '0', hs_pipeline_stage: '3', hs_ticket_priority: 'HIGH', hubspot_owner_id: '101', product_area: 'reporting', affected_users: '12', sla_due: '2025-06-05T12:00:00.000Z' }),
    rec('4002', { subject: 'Invoice shows wrong VAT', content: 'VAT is 19% but should be 21% for Spain.', hs_pipeline: '0', hs_pipeline_stage: '2', hs_ticket_priority: 'MEDIUM', hubspot_owner_id: '102', product_area: 'billing', affected_users: '1', sla_due: '2025-06-10T12:00:00.000Z' }),
    rec('4003', { subject: 'SSO login loop', content: 'Users are redirected back to the login page after signing in with SSO.', hs_pipeline: '0', hs_pipeline_stage: '1', hs_ticket_priority: 'URGENT', hubspot_owner_id: '103', product_area: 'integrations', affected_users: '140', sla_due: '2025-06-03T09:00:00.000Z' }),
    rec('4004', { subject: 'Request: dark mode', content: 'Could the dashboard support a dark theme?', hs_pipeline: '0', hs_pipeline_stage: '4', hs_ticket_priority: 'LOW', hubspot_owner_id: '101', product_area: 'reporting', affected_users: '0', sla_due: null }),
    rec('4005', { subject: 'Data sync delayed', content: 'Contacts take more than an hour to sync from the warehouse.', hs_pipeline: '0', hs_pipeline_stage: '3', hs_ticket_priority: 'HIGH', hubspot_owner_id: '102', product_area: 'integrations', affected_users: '35', sla_due: '2025-06-04T15:00:00.000Z' }),
  ];

  const products: FakeRecord[] = [
    rec('5001', { name: 'Starter plan', price: '49', hs_sku: 'PLAN-STARTER', description: 'For small teams', product_family: 'software', margin_percent: '82', launch_date: '2020-05-01' }),
    rec('5002', { name: 'Professional plan', price: '499', hs_sku: 'PLAN-PRO', description: 'For growing teams', product_family: 'software', margin_percent: '78', launch_date: '2020-05-01' }),
    rec('5003', { name: 'Onboarding service', price: '1500', hs_sku: 'SVC-ONBOARD', description: 'Guided setup', product_family: 'services', margin_percent: '35', launch_date: '2021-02-15' }),
  ];

  const lineItems: FakeRecord[] = [
    rec('6001', { name: 'Professional plan', quantity: '80', price: '499', amount: '39920', hs_product_id: '5002' }),
    rec('6002', { name: 'Onboarding service', quantity: '1', price: '1500', amount: '1500', hs_product_id: '5003' }),
    rec('6003', { name: 'Starter plan', quantity: '25', price: '49', amount: '1225', hs_product_id: '5001' }),
    rec('6004', { name: 'Onboarding service', quantity: '2', price: '1500', amount: '3000', hs_product_id: '5003' }),
  ];

  const project = (id: string, p: Record<string, string | null>) => rec(id, p, 'hs_lastmodifieddate', 'hs_createdate');
  const projects: FakeRecord[] = [
    project('7001', { project_name: 'Enterprise rollout', project_status: 'in_progress', budget: '42000', start_date: '2025-03-01', hubspot_owner_id: '101' }),
    project('7002', { project_name: 'Warehouse integration', project_status: 'planning', budget: '27500', start_date: '2025-11-20', hubspot_owner_id: '102' }),
    project('7003', { project_name: 'RevOps onboarding', project_status: 'planning', budget: '12000', start_date: '2025-09-15', hubspot_owner_id: '101' }),
    project('7004', { project_name: 'Legacy CRM migration', project_status: 'on_hold', budget: '18000', start_date: '2025-08-25', hubspot_owner_id: '103' }),
    project('7005', { project_name: 'Admin training', project_status: 'done', budget: '3200', start_date: '2025-01-10', hubspot_owner_id: '101' }),
  ];

  return new Map([
    ['contacts', contacts],
    ['companies', companies],
    ['deals', deals],
    ['tickets', tickets],
    ['products', products],
    ['line_items', lineItems],
    ['quotes', []],
    ['projects', projects],
  ]);
}

const HD = 'HUBSPOT_DEFINED' as const;
const UD = 'USER_DEFINED' as const;

function link(fromType: string, fromId: string, toType: string, toId: string, types: FakeAssociationType[], reverseTypes: FakeAssociationType[]): FakeAssociation {
  return { fromType, fromId, toType, toId, types, reverseTypes };
}

function buildAssociations(): FakeAssociation[] {
  const out: FakeAssociation[] = [];
  const contactCompany: Array<[string, string]> = [
    ['1001', '2001'],
    ['1011', '2001'],
    ['1002', '2002'],
    ['1012', '2002'],
    ['1003', '2003'],
    ['1014', '2003'],
    ['1005', '2004'],
    ['1006', '2004'],
    ['1007', '2005'],
    ['1008', '2005'],
    ['1009', '2006'],
    ['1010', '2006'],
  ];
  for (const [c, co] of contactCompany) {
    out.push(
      link(
        'contacts',
        c,
        'companies',
        co,
        [
          { category: HD, typeId: 1, label: 'Primary' },
          { category: HD, typeId: 279, label: null },
        ],
        [{ category: HD, typeId: 280, label: null }],
      ),
    );
  }
  const dealCompany: Array<[string, string]> = [
    ['3001', '2001'],
    ['3008', '2001'],
    ['3002', '2002'],
    ['3003', '2003'],
    ['3004', '2004'],
    ['3009', '2004'],
    ['3005', '2005'],
    ['3007', '2005'],
    ['3006', '2006'],
    ['3010', '2006'],
  ];
  for (const [d, co] of dealCompany) {
    out.push(
      link(
        'deals',
        d,
        'companies',
        co,
        [
          { category: HD, typeId: 5, label: 'Primary' },
          { category: HD, typeId: 341, label: null },
        ],
        [{ category: HD, typeId: 342, label: null }],
      ),
    );
  }
  const dealContact: Array<[string, string, string | null]> = [
    ['3001', '1001', 'Decision maker'],
    ['3001', '1011', null],
    ['3002', '1002', 'Decision maker'],
    ['3002', '1012', null],
    ['3003', '1003', null],
    ['3004', '1005', 'Decision maker'],
    ['3004', '1006', null],
    ['3005', '1007', null],
    ['3006', '1009', null],
    ['3007', '1007', 'Decision maker'],
    ['3007', '1008', 'Budget holder'],
    ['3008', '1011', null],
    ['3009', '1006', null],
    ['3010', '1009', 'Decision maker'],
    ['3010', '1010', null],
  ];
  for (const [d, c, label] of dealContact) {
    const types: FakeAssociationType[] = [{ category: HD, typeId: 3, label: null }];
    if (label) types.push({ category: UD, typeId: label === 'Decision maker' ? 31 : 33, label });
    const reverse: FakeAssociationType[] = [{ category: HD, typeId: 4, label: null }];
    if (label) reverse.push({ category: UD, typeId: label === 'Decision maker' ? 32 : 34, label });
    out.push(link('deals', d, 'contacts', c, types, reverse));
  }
  const ticketContact: Array<[string, string, string]> = [
    ['4001', '1001', '2001'],
    ['4002', '1005', '2004'],
    ['4003', '1009', '2006'],
    ['4004', '1003', '2003'],
    ['4005', '1006', '2004'],
  ];
  for (const [t, c, co] of ticketContact) {
    out.push(link('tickets', t, 'contacts', c, [{ category: HD, typeId: 16, label: null }], [{ category: HD, typeId: 15, label: null }]));
    out.push(link('tickets', t, 'companies', co, [{ category: HD, typeId: 339, label: null }], [{ category: HD, typeId: 340, label: null }]));
  }
  out.push(link('tickets', '4005', 'deals', '3009', [{ category: HD, typeId: 28, label: null }], [{ category: HD, typeId: 27, label: null }]));
  const dealLineItems: Array<[string, string]> = [
    ['3001', '6001'],
    ['3001', '6002'],
    ['3006', '6003'],
    ['3005', '6004'],
  ];
  for (const [d, li] of dealLineItems) {
    out.push(link('deals', d, 'line_items', li, [{ category: HD, typeId: 19, label: null }], [{ category: HD, typeId: 20, label: null }]));
  }
  const projectLinks: Array<[string, string, string]> = [
    ['7001', '2001', '3001'],
    ['7002', '2004', '3009'],
    ['7003', '2005', '3005'],
    ['7004', '2005', '3007'],
    ['7005', '2001', '3008'],
  ];
  for (const [p, co, d] of projectLinks) {
    out.push(link('projects', p, 'companies', co, [{ category: UD, typeId: 101, label: null }], [{ category: UD, typeId: 102, label: null }]));
    out.push(link('projects', p, 'deals', d, [{ category: UD, typeId: 103, label: null }], [{ category: UD, typeId: 104, label: null }]));
  }
  return out;
}

export const DEFAULT_PORTAL_ID = 12345678;

export function createSeed(portalId = DEFAULT_PORTAL_ID): FakeSeed {
  return {
    portalId,
    hubDomain: 'acmedemo.com',
    objectTypes: buildObjectTypes(portalId),
    records: buildRecords(),
    associations: buildAssociations(),
    pipelines: new Map([
      ['deals', DEAL_PIPELINES],
      ['tickets', TICKET_PIPELINES],
    ]),
    owners: OWNERS.map((o) => ({ ...o })),
  };
}
