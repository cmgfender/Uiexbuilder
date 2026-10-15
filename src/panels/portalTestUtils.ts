/**
 * Test helpers for portal-aware pickers: a fake connected HubSpot account behind mocked catalog
 * hooks. Only imported by tests. Use from a test file:
 *
 *   vi.mock('../connect', async (importOriginal) => {
 *     const { mockConnect } = await import('./portalTestUtils');
 *     return mockConnect(await importOriginal());
 *   });
 *
 * then `connectFakePortal()` / `disconnectFakePortal()` in the tests. The connection store stays
 * real (its state is set directly), so `useConnection` behaves as in the app.
 */
import type * as Connect from '../connect';
import type { CrmObjectTypeInfo, CrmPipeline, CrmPropertyDef, PropertyCatalog } from '../connect';

type ConnectModule = typeof Connect;

export interface FakePortal {
  connected: boolean;
  /** Catalogs still loading. */
  loading: boolean;
  /** Properties by canonical object type id ('0-1', '0-3', '2-555'); a missing type fails with `errorFor`. */
  properties: Record<string, CrmPropertyDef[]>;
  objectTypes: CrmObjectTypeInfo[];
  pipelines: Record<string, CrmPipeline[]>;
  errorFor: string;
}

const p = (name: string, label: string, type: string, extra: Partial<CrmPropertyDef> = {}): CrmPropertyDef => ({
  name,
  label,
  type,
  fieldType: type === 'enumeration' ? 'select' : type === 'number' ? 'number' : type === 'date' || type === 'datetime' ? 'date' : 'text',
  groupName: 'contactinformation',
  hubspotDefined: true,
  ...extra,
});

export const FAKE_PROPERTIES: Record<string, CrmPropertyDef[]> = {
  '0-1': [
    p('firstname', 'First name', 'string'),
    p('lastname', 'Last name', 'string'),
    p('email', 'Email', 'string'),
    p('lifecyclestage', 'Lifecycle stage', 'enumeration', {
      options: [
        { label: 'Lead', value: 'lead', displayOrder: 1 },
        { label: 'Subscriber', value: 'subscriber', displayOrder: 0 },
        { label: 'Customer', value: 'customer', displayOrder: 2 },
      ],
    }),
    p('favorite_color', 'Favorite color', 'enumeration', {
      hubspotDefined: false,
      groupName: 'preferences',
      options: [
        { label: 'Red', value: 'red', displayOrder: 0, description: 'Warm' },
        { label: 'Blue', value: 'blue', displayOrder: 1 },
        { label: 'Green (old)', value: 'green', displayOrder: 2, hidden: true },
      ],
    }),
    p('renewal_date', 'Renewal date', 'date', { hubspotDefined: false, groupName: 'preferences' }),
    p('hs_internal_score', 'Internal score', 'number', { hidden: true }),
  ],
  '0-3': [
    p('dealname', 'Deal name', 'string', { groupName: 'dealinformation' }),
    p('amount', 'Amount', 'number', { groupName: 'dealinformation' }),
    p('dealstage', 'Deal stage', 'enumeration', {
      groupName: 'dealinformation',
      options: [
        { label: 'Appointment scheduled', value: 'appointmentscheduled', displayOrder: 0 },
        { label: 'Closed won', value: 'closedwon', displayOrder: 1 },
      ],
    }),
    p('closedate', 'Close date', 'datetime', { groupName: 'dealinformation' }),
    p('contract_tier', 'Contract tier', 'enumeration', {
      hubspotDefined: false,
      groupName: 'dealinformation',
      options: [
        { label: 'Gold', value: 'gold', displayOrder: 0 },
        { label: 'Silver', value: 'silver', displayOrder: 1 },
      ],
    }),
  ],
  '2-555': [p('project_name', 'Project name', 'string', { hubspotDefined: false, groupName: 'projectinformation' }), p('budget', 'Budget', 'number', { hubspotDefined: false, groupName: 'projectinformation' })],
};

export const FAKE_OBJECT_TYPES: CrmObjectTypeInfo[] = [
  { objectType: 'contacts', objectTypeId: '0-1', label: 'Contact', pluralLabel: 'Contacts', primaryDisplayProperty: 'firstname', secondaryDisplayProperties: ['email'], custom: false },
  { objectType: 'deals', objectTypeId: '0-3', label: 'Deal', pluralLabel: 'Deals', primaryDisplayProperty: 'dealname', secondaryDisplayProperties: [], custom: false },
  { objectType: 'p_projects', objectTypeId: '2-555', label: 'Project', pluralLabel: 'Projects', primaryDisplayProperty: 'project_name', secondaryDisplayProperties: [], custom: true },
];

export const FAKE_PIPELINES: Record<string, CrmPipeline[]> = {
  '0-3': [
    {
      id: 'default',
      label: 'Sales pipeline',
      displayOrder: 0,
      stages: [
        { id: 's2', label: 'Contract sent', displayOrder: 2 },
        { id: 's1', label: 'Qualified', displayOrder: 1 },
        { id: 's3', label: 'Closed won', displayOrder: 3 },
      ],
    },
    { id: 'renewals', label: 'Renewals', displayOrder: 1, stages: [{ id: 'r1', label: 'Due', displayOrder: 0 }] },
  ],
};

export const fakePortal: FakePortal = {
  connected: false,
  loading: false,
  properties: FAKE_PROPERTIES,
  objectTypes: FAKE_OBJECT_TYPES,
  pipelines: FAKE_PIPELINES,
  errorFor: 'Your HubSpot sign-in doesn’t allow reading these properties.',
};

const cache = new Map<string, unknown>();
function memo<T>(key: string, make: () => T): T {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
}

function stateKey(): string {
  return `${fakePortal.connected}|${fakePortal.loading}`;
}

/** Builds the mocked connect module: the real one with fake catalog hooks. */
export function mockConnect(actual: ConnectModule): ConnectModule {
  const canonical = (t: string) => {
    const c = actual.canonicalObjectType(t, fakePortal.objectTypes);
    return c;
  };
  const usePropertyCatalog = (objectType: string | null | undefined): PropertyCatalog => {
    const type = typeof objectType === 'string' ? objectType.trim() : '';
    return memo(`props|${stateKey()}|${type}`, () => {
      if (!fakePortal.connected || !type) return { connected: false, loading: false, error: null, properties: [], byName: new Map() };
      if (fakePortal.loading) return { connected: true, loading: true, error: null, properties: [], byName: new Map() };
      const list = fakePortal.properties[canonical(type)];
      if (!list) return { connected: true, loading: false, error: fakePortal.errorFor, properties: [], byName: new Map() };
      return { connected: true, loading: false, error: null, properties: list, byName: new Map(list.map((x) => [x.name, x])) };
    });
  };
  const useObjectTypes = () =>
    memo(`types|${stateKey()}`, () =>
      fakePortal.connected
        ? { connected: true, loading: fakePortal.loading, objectTypes: fakePortal.loading ? [] : fakePortal.objectTypes, error: null }
        : { connected: false, loading: false, objectTypes: [] as CrmObjectTypeInfo[], error: null },
    );
  const usePipelines = (objectType: string | null | undefined) => {
    const type = typeof objectType === 'string' ? objectType.trim() : '';
    return memo(`pipes|${stateKey()}|${type}`, () =>
      fakePortal.connected && type
        ? { connected: true, loading: false, pipelines: fakePortal.pipelines[canonical(type)] ?? [], error: null }
        : { connected: false, loading: false, pipelines: [] as CrmPipeline[], error: null },
    );
  };
  return { ...actual, usePropertyCatalog, useObjectTypes, usePipelines } as ConnectModule;
}

/** Connects the fake account (the store reports a connected portal). */
export function connectFakePortal(connect: Pick<ConnectModule, 'useConnection'>, opts: { loading?: boolean } = {}): void {
  fakePortal.connected = true;
  fakePortal.loading = !!opts.loading;
  cache.clear();
  connect.useConnection.setState({
    status: 'connected',
    info: {
      connected: true,
      portalId: 12345678,
      hubDomain: 'acme.com',
      user: { id: 7, email: 'ada@acme.com' },
      scopes: ['oauth'],
      expiresAt: Date.now() + 30 * 60_000,
      appHost: 'app.hubspot.com',
    },
  });
}

export function disconnectFakePortal(connect: Pick<ConnectModule, 'useConnection'>): void {
  fakePortal.connected = false;
  fakePortal.loading = false;
  cache.clear();
  connect.useConnection.setState({ status: 'disconnected', info: { connected: false, reason: 'signed-out' } });
}
