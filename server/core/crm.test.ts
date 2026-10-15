// @vitest-environment node
import { describe, expect, it, beforeAll } from 'vitest';
import { createTestEnv, type TestEnv } from './testing';
import type { AssociationResultDTO, CrmObjectTypeInfo, CrmPipeline, CrmPropertyDef, CrmRecord, CrmRecordSummary, CrmSearchResponseDTO } from '../../src/connect/types';
import { buildSearchBody, parsePropertyList } from './routes/crm';

let env: TestEnv;
beforeAll(async () => {
  env = createTestEnv();
  await env.signIn();
});

async function get<T>(path: string, e: TestEnv = env): Promise<{ status: number; body: T }> {
  const res = await e.call(path);
  return { status: res.status, body: (await res.json()) as T };
}

describe('GET /api/crm/object-types', () => {
  it('lists the standard objects plus the custom object', async () => {
    const { status, body } = await get<CrmObjectTypeInfo[]>('/api/crm/object-types');
    expect(status).toBe(200);
    expect(body[0]).toEqual({
      objectType: 'contacts',
      objectTypeId: '0-1',
      label: 'Contact',
      pluralLabel: 'Contacts',
      primaryDisplayProperty: 'firstname',
      secondaryDisplayProperties: ['email'],
      custom: false,
    });
    const byType = new Map(body.map((t) => [t.objectType, t]));
    expect(byType.get('companies')).toMatchObject({ objectTypeId: '0-2', primaryDisplayProperty: 'name', secondaryDisplayProperties: ['domain'] });
    expect(byType.get('deals')).toMatchObject({ objectTypeId: '0-3', primaryDisplayProperty: 'dealname', secondaryDisplayProperties: ['amount'] });
    expect(byType.get('tickets')).toMatchObject({ objectTypeId: '0-5', primaryDisplayProperty: 'subject', secondaryDisplayProperties: ['hs_pipeline_stage'] });
    expect(byType.get('products')?.objectTypeId).toBe('0-7');
    expect(byType.get('line_items')?.objectTypeId).toBe('0-8');
    expect(byType.get('quotes')?.objectTypeId).toBe('0-14');
    expect(byType.get('p_projects')).toEqual({
      objectType: 'p_projects',
      objectTypeId: '2-4561234',
      label: 'Project',
      pluralLabel: 'Projects',
      primaryDisplayProperty: 'project_name',
      secondaryDisplayProperties: ['project_status'],
      custom: true,
    });
    expect(body.filter((t) => t.custom)).toHaveLength(1);
  });

  it('skips custom objects when the custom schema scope was not granted', async () => {
    const e = createTestEnv();
    e.fake.dropScopes('crm.schemas.custom.read');
    await e.signIn();
    const { body } = await get<CrmObjectTypeInfo[]>('/api/crm/object-types', e);
    expect(body.some((t) => t.custom)).toBe(false);
    expect(e.fake.requests.some((r) => r.path === '/crm/v3/schemas')).toBe(false);
  });
});

describe('GET /api/crm/properties/:objectType', () => {
  it('maps properties (with options), sorted by label', async () => {
    const { status, body } = await get<CrmPropertyDef[]>('/api/crm/properties/contacts');
    expect(status).toBe(200);
    const labels = body.map((p) => p.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
    const fav = body.find((p) => p.name === 'favorite_product')!;
    expect(fav).toEqual({
      name: 'favorite_product',
      label: 'Favorite product',
      type: 'enumeration',
      fieldType: 'select',
      description: 'Which plan the contact likes best',
      groupName: 'contactinformation',
      options: [
        { label: 'Starter', value: 'starter', displayOrder: 0 },
        { label: 'Professional', value: 'pro', displayOrder: 1 },
        { label: 'Enterprise', value: 'enterprise', displayOrder: 2 },
      ],
    });
    expect(body.find((p) => p.name === 'email')).toMatchObject({ type: 'string', fieldType: 'text', hubspotDefined: true });
    expect(body.find((p) => p.name === 'hs_object_id')).toMatchObject({ readOnlyValue: true });
    expect(body.find((p) => p.name === 'loyalty_points')).toMatchObject({ type: 'number' });
    expect(body.find((p) => p.name === 'loyalty_points')?.hubspotDefined).toBeUndefined();
  });

  it('accepts object type ids and custom object names', async () => {
    const byId = await get<CrmPropertyDef[]>('/api/crm/properties/0-3');
    expect(byId.body.some((p) => p.name === 'dealname')).toBe(true);
    const custom = await get<CrmPropertyDef[]>('/api/crm/properties/p_projects');
    expect(custom.status).toBe(200);
    expect(custom.body.map((p) => p.name)).toContain('project_status');
    expect(env.fake.requests.some((r) => r.path === '/crm/v3/properties/2-4561234')).toBe(true);
    const fqn = await get<CrmPropertyDef[]>('/api/crm/properties/p12345678_projects');
    expect(fqn.status).toBe(200);
    const typeId = await get<CrmPropertyDef[]>('/api/crm/properties/2-4561234');
    expect(typeId.status).toBe(200);
  });

  it('validates the object type', async () => {
    const bad = await get<{ error: { code: string } }>('/api/crm/properties/con%20tacts');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('bad_request');
    const dots = await get<{ error: { code: string } }>('/api/crm/properties/..%2F..%2Foauth');
    expect(dots.status).toBe(400);
    const unknown = await get<{ error: { code: string } }>('/api/crm/properties/p_nothing');
    expect(unknown.status).toBe(404);
  });
});

describe('GET /api/crm/pipelines/:objectType', () => {
  it('returns deal pipelines with ordered stages', async () => {
    const { status, body } = await get<CrmPipeline[]>('/api/crm/pipelines/deals');
    expect(status).toBe(200);
    expect(body.map((p) => p.label)).toEqual(['Sales Pipeline', 'Renewals']);
    expect(body[0].stages[0]).toEqual({ id: 'appointmentscheduled', label: 'Appointment Scheduled', displayOrder: 0, metadata: { isClosed: 'false', probability: '0.2' } });
    expect(body[0].stages.map((s) => s.displayOrder)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('returns ticket pipelines', async () => {
    const { body } = await get<CrmPipeline[]>('/api/crm/pipelines/0-5');
    expect(body).toHaveLength(1);
    expect(body[0].stages.map((s) => s.label)).toEqual(['New', 'Waiting on contact', 'Waiting on us', 'Closed']);
  });

  it('returns an empty list for objects without pipelines', async () => {
    const before = env.fake.requests.length;
    expect((await get<CrmPipeline[]>('/api/crm/pipelines/contacts')).body).toEqual([]);
    expect(env.fake.requests.slice(before).some((r) => r.path.startsWith('/crm/v3/pipelines'))).toBe(false);
    expect((await get<CrmPipeline[]>('/api/crm/pipelines/p_projects')).body).toEqual([]);
  });
});

describe('GET /api/crm/owners', () => {
  it('lists owners', async () => {
    const { status, body } = await get('/api/crm/owners');
    expect(status).toBe(200);
    expect(body).toEqual([
      { id: '101', email: 'jordan.lee@acmedemo.com', firstName: 'Jordan', lastName: 'Lee', userId: 9001 },
      { id: '102', email: 'sam.rivera@acmedemo.com', firstName: 'Sam', lastName: 'Rivera', userId: 9002 },
      { id: '103', email: 'alex.morgan@acmedemo.com', firstName: 'Alex', lastName: 'Morgan', userId: 9003 },
    ]);
  });

  it('reports a missing owners scope', async () => {
    const e = createTestEnv();
    e.fake.dropScopes('crm.objects.owners.read');
    await e.signIn();
    const { status, body } = await get<{ error: { code: string; requiredScopes: string[] } }>('/api/crm/owners', e);
    expect(status).toBe(403);
    expect(body.error).toMatchObject({ code: 'missing_scope', requiredScopes: ['crm.objects.owners.read'] });
  });
});

describe('GET /api/crm/records/:objectType/search (record picker)', () => {
  it('finds contacts by name with label, email and a deep link', async () => {
    const { status, body } = await get<CrmRecordSummary[]>('/api/crm/records/contacts/search?q=ada');
    expect(status).toBe(200);
    expect(body[0]).toEqual({
      id: '1001',
      objectType: 'contacts',
      objectTypeId: '0-1',
      label: 'Ada Lovelace',
      secondary: 'ada@analyticalengines.com',
      url: 'https://app.hubspot.com/contacts/12345678/record/0-1/1001',
    });
  });

  it('lists recent records when there is no query and clamps the limit', async () => {
    const ten = await get<CrmRecordSummary[]>('/api/crm/records/contacts/search');
    expect(ten.body).toHaveLength(10);
    const big = await get<CrmRecordSummary[]>('/api/crm/records/contacts/search?limit=999');
    expect(big.body).toHaveLength(14);
    const one = await get<CrmRecordSummary[]>('/api/crm/records/contacts/search?limit=0');
    expect(one.body).toHaveLength(1);
  });

  it('finds a record by its ID', async () => {
    const { body } = await get<CrmRecordSummary[]>('/api/crm/records/0-1/search?q=1003');
    expect(body[0]).toMatchObject({ id: '1003', label: 'Alan Turing' });
  });

  it('formats secondary lines (amounts, stages) for other objects', async () => {
    const deals = await get<CrmRecordSummary[]>('/api/crm/records/deals/search?q=Enterprise');
    expect(deals.body[0]).toMatchObject({ id: '3001', label: 'Analytical Engines – Enterprise plan', secondary: '48,000', url: 'https://app.hubspot.com/contacts/12345678/record/0-3/3001' });
    const tickets = await get<CrmRecordSummary[]>('/api/crm/records/tickets/search?q=CSV');
    expect(tickets.body[0]).toMatchObject({ id: '4001', label: 'Cannot export report to CSV', secondary: 'Waiting on us' });
    const companies = await get<CrmRecordSummary[]>('/api/crm/records/companies/search?q=globex');
    expect(companies.body[0]).toMatchObject({ label: 'Globex', secondary: 'globex.io' });
    const projects = await get<CrmRecordSummary[]>('/api/crm/records/p_projects/search?q=rollout');
    expect(projects.body[0]).toMatchObject({ id: '7001', objectType: 'p_projects', objectTypeId: '2-4561234', label: 'Enterprise rollout', url: 'https://app.hubspot.com/contacts/12345678/record/2-4561234/7001' });
  });

  it('falls back to the email or a generic label', async () => {
    env.fake.seed.records.get('contacts')!.push({ id: '1099', createdAt: '', updatedAt: '', properties: { hs_object_id: '1099', email: 'nameless@example.com', firstname: null, lastname: null } });
    const { body } = await get<CrmRecordSummary[]>('/api/crm/records/contacts/search?q=nameless');
    expect(body[0]).toMatchObject({ id: '1099', label: 'nameless@example.com' });
    expect(body[0].secondary).toBeUndefined();
    env.fake.seed.records.get('contacts')!.pop();
  });

  it('returns an empty list when nothing matches', async () => {
    expect((await get<CrmRecordSummary[]>('/api/crm/records/contacts/search?q=zzzzzz')).body).toEqual([]);
  });
});

describe('GET /api/crm/records/:objectType/:id', () => {
  const props = 'firstname,lastname,email,loyalty_points,onboarding_date,favorite_product,lifecyclestage,newsletter_opt_in,not_a_property';

  it('returns the requested properties (null when unset or unknown)', async () => {
    const { status, body } = await get<CrmRecord>(`/api/crm/records/contacts/1001?properties=${props}`);
    expect(status).toBe(200);
    expect(body.id).toBe('1001');
    expect(body.objectType).toBe('contacts');
    expect(body.objectTypeId).toBe('0-1');
    expect(body.properties).toMatchObject({
      firstname: 'Ada',
      lastname: 'Lovelace',
      email: 'ada@analyticalengines.com',
      loyalty_points: '1250',
      onboarding_date: '2023-03-14',
      favorite_product: 'enterprise',
      lifecyclestage: 'customer',
      newsletter_opt_in: 'true',
      not_a_property: null,
    });
  });

  it('formats values with formatted=1', async () => {
    const { body } = await get<CrmRecord>(`/api/crm/records/0-1/1001?properties=${props}&formatted=1`);
    expect(body.properties).toMatchObject({
      firstname: 'Ada',
      loyalty_points: '1,250',
      onboarding_date: 'Mar 14, 2023',
      favorite_product: 'Enterprise',
      lifecyclestage: 'Customer',
      newsletter_opt_in: 'Yes',
      not_a_property: null,
    });
    const deal = await get<CrmRecord>('/api/crm/records/deals/3001?properties=amount,closedate,dealstage,hubspot_owner_id&formatted=1');
    expect(deal.body.properties).toMatchObject({ amount: '48,000', closedate: 'Feb 28, 2025, 5:00 PM UTC', dealstage: 'Closed Won (Sales Pipeline)', hubspot_owner_id: 'Jordan Lee' });
  });

  it('accepts repeated properties params and custom objects', async () => {
    const { body } = await get<CrmRecord>('/api/crm/records/p_projects/7001?properties=project_name&properties=budget');
    expect(body).toMatchObject({ id: '7001', objectType: 'p_projects', objectTypeId: '2-4561234', properties: { project_name: 'Enterprise rollout', budget: '42000' } });
  });

  it('validates ids and property lists', async () => {
    expect((await get('/api/crm/records/contacts/abc')).status).toBe(400);
    expect((await get('/api/crm/records/contacts/1001?properties=bad%20name')).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => `p${i}`).join(',');
    const tooMany = await get<{ error: { message: string } }>(`/api/crm/records/contacts/1001?properties=${many}`);
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.message).toContain('200');
  });

  it('reports records that do not exist', async () => {
    const { status, body } = await get<{ error: { code: string } }>('/api/crm/records/contacts/999999');
    expect(status).toBe(404);
    expect(body.error.code).toBe('not_found');
  });
});

describe('GET /api/crm/records/:objectType/:id/associations/:toObjectType', () => {
  it('returns associated records with association types and properties', async () => {
    const { status, body } = await get<AssociationResultDTO[]>('/api/crm/records/contacts/1001/associations/companies?properties=name,domain');
    expect(status).toBe(200);
    expect(body).toEqual([
      {
        toObjectId: 2001,
        associationTypes: [
          { category: 'HUBSPOT_DEFINED', typeId: 1, label: 'Primary' },
          { category: 'HUBSPOT_DEFINED', typeId: 279, label: '' },
        ],
        properties: { name: 'Analytical Engines Ltd', domain: 'analyticalengines.com' },
      },
    ]);
  });

  it('includes association labels and honours the limit', async () => {
    const all = await get<AssociationResultDTO[]>('/api/crm/records/deals/3007/associations/contacts?properties=firstname,lastname');
    expect(all.body.map((a) => a.toObjectId)).toEqual([1007, 1008]);
    expect(all.body[0].associationTypes.map((t) => t.label)).toContain('Decision maker');
    expect(all.body[1].associationTypes.map((t) => t.label)).toContain('Budget holder');
    expect(all.body[0].properties).toEqual({ firstname: 'Priya', lastname: 'Patel' });
    const limited = await get<AssociationResultDTO[]>('/api/crm/records/0-3/3007/associations/0-1?limit=1');
    expect(limited.body).toHaveLength(1);
    expect(limited.body[0].properties).toEqual({});
  });

  it('works for custom objects in both directions and formats values', async () => {
    const fromProject = await get<AssociationResultDTO[]>('/api/crm/records/p_projects/7001/associations/deals?properties=amount&formatted=1');
    expect(fromProject.body).toEqual([{ toObjectId: 3001, associationTypes: [{ category: 'USER_DEFINED', typeId: 103, label: '' }], properties: { amount: '48,000' } }]);
    const toProject = await get<AssociationResultDTO[]>('/api/crm/records/companies/2005/associations/p_projects?properties=project_name,project_status&formatted=1');
    expect(toProject.body.map((a) => a.properties)).toEqual([
      { project_name: 'RevOps onboarding', project_status: 'Planning' },
      { project_name: 'Legacy CRM migration', project_status: 'On hold' },
    ]);
  });

  it('returns an empty list when nothing is associated', async () => {
    expect((await get('/api/crm/records/contacts/1013/associations/companies?properties=name')).body).toEqual([]);
  });

  it('reports a missing scope for the associated object type', async () => {
    const e = createTestEnv();
    e.fake.dropScopes('tickets');
    await e.signIn();
    const res = await get<{ error: { code: string } }>('/api/crm/records/contacts/1001/associations/tickets', e);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('missing_scope');
  });
});

describe('POST /api/crm/search/:objectType', () => {
  const search = async (objectType: string, body: unknown) => {
    const res = await env.call(`/api/crm/search/${objectType}`, { method: 'POST', json: body });
    return { status: res.status, body: (await res.json()) as CrmSearchResponseDTO & { error?: { code: string; message: string } } };
  };

  it('filters, sorts and pages like useCrmSearch', async () => {
    const first = await search('contacts', {
      properties: ['firstname', 'lastname', 'loyalty_points'],
      filterGroups: [{ filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }] }],
      sorts: [{ propertyName: 'loyalty_points', direction: 'DESCENDING' }],
      pageLength: 3,
    });
    expect(first.status).toBe(200);
    expect(first.body.total).toBe(7);
    expect(first.body.hasMore).toBe(true);
    expect(first.body.after).toBe('3');
    expect(first.body.results.map((r) => r.objectId)).toEqual([1005, 1009, 1001]);
    expect(first.body.results[0].properties).toMatchObject({ firstname: 'Maria', loyalty_points: '2100' });
    const last = await search('contacts', {
      properties: ['firstname'],
      filterGroups: [{ filters: [{ propertyName: 'lifecyclestage', operator: 'EQ', value: 'customer' }] }],
      sorts: [{ propertyName: 'loyalty_points', direction: 'DESCENDING' }],
      pageLength: 3,
      after: '6',
    });
    expect(last.body.results).toHaveLength(1);
    expect(last.body.hasMore).toBe(false);
    expect(last.body.after).toBeUndefined();
  });

  it('supports free-text queries, IN filters, numbers and formatting', async () => {
    const q = await search('companies', { query: 'north', properties: ['name'] });
    expect(q.body.results.map((r) => r.objectId)).toEqual([2004]);
    const inFilter = await search('deals', {
      properties: ['dealname', 'amount'],
      filterGroups: [{ filters: [{ propertyName: 'dealstage', operator: 'IN', values: ['closedwon', 'contractsent'] }, { propertyName: 'amount', operator: 'GT', value: 10000 }] }],
      formatted: true,
    });
    expect(inFilter.body.results.map((r) => r.objectId)).toEqual([3001, 3002]);
    expect(inFilter.body.results[0].properties.amount).toBe('48,000');
  });

  it('validates requests before calling HubSpot', async () => {
    const before = env.fake.requests.length;
    expect((await search('contacts', { filterGroups: [{ filters: [{ propertyName: 'email', operator: 'LIKE', value: 'x' }] }] })).status).toBe(400);
    expect((await search('contacts', { filterGroups: Array.from({ length: 6 }, () => ({ filters: [] })) })).status).toBe(400);
    expect((await search('contacts', { properties: ['ok', 'not ok'] })).status).toBe(400);
    expect((await search('contacts', { after: '../x' })).status).toBe(400);
    expect((await search('contacts', [1, 2])).status).toBe(400);
    expect(env.fake.requests.length).toBe(before);
    const notJson = await env.call('/api/crm/search/contacts', { method: 'POST', body: 'not json', headers: { 'Content-Type': 'application/json' } });
    expect(notJson.status).toBe(400);
  });

  it("passes HubSpot's validation message through as bad_request", async () => {
    const res = await search('contacts', { filterGroups: [{ filters: [{ propertyName: 'no_such_property', operator: 'EQ', value: '1' }] }] });
    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('bad_request');
    expect(res.body.error?.message).toContain('no_such_property');
  });

  it('rejects oversized bodies', async () => {
    const res = await env.call('/api/crm/search/contacts', { method: 'POST', body: JSON.stringify({ query: 'x'.repeat(70 * 1024) }), headers: { 'Content-Type': 'application/json' } });
    expect(res.status).toBe(413);
  });
});

describe('validation helpers', () => {
  it('parsePropertyList splits, trims and de-duplicates', () => {
    expect(parsePropertyList(['a, b,,a', 'c'])).toEqual(['a', 'b', 'c']);
    expect(() => parsePropertyList(['a;b'])).toThrow();
  });

  it('buildSearchBody maps DTO fields to the HubSpot body', () => {
    const { body, formatted } = buildSearchBody({
      query: 'x',
      properties: ['a'],
      filterGroups: [{ filters: [{ propertyName: 'a', operator: 'between', value: 1, highValue: 5 }, { propertyName: 'b', operator: 'IN', values: [true, 2, 'x'] }] }],
      sorts: [{ propertyName: 'a', direction: 'DESCENDING' }],
      pageLength: 500,
      after: '20',
      formatted: true,
    });
    expect(formatted).toBe(true);
    expect(body).toEqual({
      query: 'x',
      properties: ['a'],
      filterGroups: [{ filters: [{ propertyName: 'a', operator: 'BETWEEN', value: '1', highValue: '5' }, { propertyName: 'b', operator: 'IN', values: ['true', '2', 'x'] }] }],
      sorts: [{ propertyName: 'a', direction: 'DESCENDING' }],
      limit: 200,
      after: '20',
    });
    expect(buildSearchBody({}).body).toEqual({ limit: 10 });
    expect(() => buildSearchBody({ filterGroups: [{ filters: Array.from({ length: 7 }, () => ({ propertyName: 'a', operator: 'EQ', value: 1 })) }] })).toThrow(/6 filters/);
    expect(() => buildSearchBody({ filterGroups: [{ filters: [{ propertyName: 'a', operator: 'EQ', value: { x: 1 } }] }] })).toThrow();
  });
});
