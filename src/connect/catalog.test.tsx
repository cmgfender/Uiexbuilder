import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ConnectorClient, setConnectorClient } from './client';
import { useObjectTypes, useOwners, usePipelines, usePropertyCatalog } from './catalog';
import { resetConnectionForTests, useConnection } from './store';
import { OBJECT_TYPES, connectedInfo, errorBody, json, routedFetch } from './testUtils';

const CONTACT_PROPS = [
  { name: 'email', label: 'Email', type: 'string', fieldType: 'text' },
  { name: 'lifecyclestage', label: 'Lifecycle stage', type: 'enumeration', fieldType: 'select', options: [{ label: 'Lead', value: 'lead' }] },
];

function setup() {
  const r = routedFetch({
    'GET /api/crm/object-types': () => json(OBJECT_TYPES),
    'GET /api/crm/properties/contacts': () => json(CONTACT_PROPS),
    'GET /api/crm/properties/tickets': () => errorBody('missing_scope', 403, { requiredScopes: ['tickets'] }),
    'GET /api/crm/pipelines/deals': () => json([{ id: 'default', label: 'Sales', displayOrder: 0, stages: [{ id: 'won', label: 'Won', displayOrder: 1 }] }]),
    'GET /api/crm/owners': () => json([{ id: '1', email: 'owner@acme.com', firstName: 'Olive' }]),
  });
  const client = new ConnectorClient({ baseUrl: '', fetch: r.fetch });
  setConnectorClient(client);
  return { ...r, client };
}

/** Signed in to a portal, as the connection store's applyInfo() leaves it (cache scoped to the portal). */
function connect(client: ConnectorClient, portalId = 12345678) {
  client.setCacheScope(String(portalId));
  useConnection.setState({ status: 'connected', info: connectedInfo({ portalId }) });
}

beforeEach(() => resetConnectionForTests());
afterEach(() => resetConnectionForTests());

describe('catalog hooks', () => {
  it('return empty data while not connected (callers fall back to built-in suggestions)', () => {
    const { calls } = setup();
    const { result } = renderHook(() => usePropertyCatalog('contacts'));
    expect(result.current).toMatchObject({ connected: false, loading: false, error: null, properties: [] });
    expect(result.current.byName.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('load real properties with a by-name lookup', async () => {
    const { client } = setup();
    connect(client);
    const { result } = renderHook(() => usePropertyCatalog('contacts'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.connected).toBe(true);
    expect(result.current.properties.map((p) => p.name)).toEqual(['email', 'lifecyclestage']);
    expect(result.current.byName.get('lifecyclestage')?.options?.[0]).toEqual({ label: 'Lead', value: 'lead' });
  });

  it("share one request and cache entry for 'contacts' and '0-1'", async () => {
    const { calls, client } = setup();
    connect(client);
    const a = renderHook(() => usePropertyCatalog('contacts'));
    const b = renderHook(() => usePropertyCatalog('0-1'));
    await waitFor(() => expect(a.result.current.loading || b.result.current.loading).toBe(false));
    expect(calls.filter((c) => c.path === '/api/crm/properties/contacts')).toHaveLength(1);
    // A later picker gets the cached answer at once.
    const c = renderHook(() => usePropertyCatalog('contact'));
    expect(c.result.current.loading).toBe(false);
    expect(c.result.current.properties).toHaveLength(2);
    expect(calls).toHaveLength(1);
  });

  it('explain errors in plain language', async () => {
    const { client } = setup();
    connect(client);
    const { result } = renderHook(() => usePropertyCatalog('tickets'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.properties).toEqual([]);
    expect(result.current.error).toMatch(/Reconnect HubSpot/);
  });

  it('load object types, pipelines and owners', async () => {
    const { client } = setup();
    connect(client);
    const types = renderHook(() => useObjectTypes());
    const pipelines = renderHook(() => usePipelines('0-3'));
    const owners = renderHook(() => useOwners());
    await waitFor(() => {
      expect(types.result.current.objectTypes).toHaveLength(4);
      expect(pipelines.result.current.pipelines[0]?.stages[0]?.label).toBe('Won');
      expect(owners.result.current.owners[0]?.email).toBe('owner@acme.com');
    });
    expect(usePipelinesNoType()).toBe(true);
  });

  it('start over for another portal', async () => {
    const { calls, client } = setup();
    connect(client, 1);
    const { result } = renderHook(() => useObjectTypes());
    await waitFor(() => expect(result.current.objectTypes).toHaveLength(4));
    act(() => connect(client, 2));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.connected).toBe(true);
    expect(result.current.objectTypes).toHaveLength(4);
    expect(calls.filter((c) => c.path === '/api/crm/object-types')).toHaveLength(2);
  });
});

/** usePipelines without an object type asks nothing. */
function usePipelinesNoType(): boolean {
  const { result } = renderHook(() => usePipelines(''));
  return result.current.loading === false && result.current.pipelines.length === 0;
}
