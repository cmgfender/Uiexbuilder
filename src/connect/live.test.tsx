import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { createExtension, createProject } from '../model/factory';
import { useEditor } from '../model/store';
import { ConnectorClient, ConnectorError, setConnectorClient } from './client';
import { buildLiveAdapter, recordFitsCard, useLiveAdapter } from './live';
import { LIVE_DATA_KEY_PREFIX, resetLiveDataForTests, useLiveData } from './records';
import { resetConnectionForTests, useConnection } from './store';
import type { CrmRecordSummary } from './types';
import { OBJECT_TYPES, PORTAL_ID, connectedInfo, healthFixture, json, routedFetch } from './testUtils';

const ADA: CrmRecordSummary = { id: '101', objectType: 'contacts', objectTypeId: '0-1', label: 'Ada Lovelace', secondary: 'ada@example.com' };

function routes() {
  return routedFetch({
    'GET /api/crm/records/contacts/101': () => json({ id: '101', objectType: 'contacts', objectTypeId: '0-1', properties: { firstname: 'Ada', email: 'ada@example.com' } }),
    'GET /api/crm/records/contacts/101/associations/companies': () =>
      json([{ toObjectId: 5, associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 1, label: 'Primary' }], properties: { name: 'Acme' } }]),
    'POST /api/crm/search/deals': () => json({ results: [{ objectId: 9, properties: { dealname: 'Big deal' } }], total: 1, hasMore: false }),
    'POST /api/proxy/fetch': () => json({ status: 200, ok: true, headers: {}, body: '{"ok":true}', truncated: false }),
    'GET /api/crm/records/contacts/404': () => json({ error: { code: 'missing_scope', message: 'Missing scope', status: 403, requiredScopes: ['crm.objects.contacts.read'] } }, 403),
  });
}

beforeEach(() => {
  resetConnectionForTests();
  resetLiveDataForTests();
  localStorage.clear();
});

afterEach(() => {
  resetConnectionForTests();
  resetLiveDataForTests();
  localStorage.clear();
});

describe('buildLiveAdapter', () => {
  it('is null when disconnected, or for a card without a sample record', () => {
    expect(buildLiveAdapter({ info: { connected: false } }, { kind: 'card' }, ADA)).toBeNull();
    expect(buildLiveAdapter({ info: connectedInfo() }, { kind: 'card' }, null)).toBeNull();
  });

  it('gives a card the record context and a key of portal + record + mode', () => {
    const a = buildLiveAdapter({ info: connectedInfo() }, { kind: 'card' }, ADA)!;
    expect(a.key).toBe(`${PORTAL_ID}|0-1:101|live`);
    expect(a.context).toEqual({ portal: { id: PORTAL_ID }, user: { id: 7, email: 'ada@acme.com' }, crm: { objectId: 101, objectTypeId: '0-1' } });
    expect(a.proxyFetch).toBeUndefined();
  });

  it('needs no record for settings pages and app home (context only)', () => {
    const a = buildLiveAdapter({ info: connectedInfo() }, { kind: 'settings' }, null)!;
    expect(a.key).toBe(`${PORTAL_ID}|settings|live`);
    expect(a.context.crm).toBeUndefined();
    expect(buildLiveAdapter({ info: connectedInfo() }, { kind: 'home' }, null)?.key).toBe(`${PORTAL_ID}|home|live`);
  });

  it('reads properties, associations and search results through the connector', async () => {
    const r = routes();
    const client = new ConnectorClient({ baseUrl: '', fetch: r.fetch });
    const a = buildLiveAdapter({ info: connectedInfo(), health: healthFixture() }, { kind: 'card' }, ADA, { client })!;

    await expect(a.getRecordProperties('0-1', 101, ['firstname', 'email'], true)).resolves.toEqual({ firstname: 'Ada', email: 'ada@example.com' });
    expect(r.calls[0].query.get('properties')).toBe('firstname,email');
    expect(r.calls[0].query.get('formatted')).toBe('1');

    const assoc = await a.getAssociations('0-1', 101, { toObjectType: '0-2', properties: ['name'], pageLength: 5, formatted: false });
    expect(assoc[0]).toMatchObject({ toObjectId: 5, properties: { name: 'Acme' } });
    expect(r.calls[1].path).toBe('/api/crm/records/contacts/101/associations/companies');
    expect(r.calls[1].query.get('limit')).toBe('5');

    const found = await a.search('deals', { query: 'big', properties: ['dealname'] });
    expect(found.total).toBe(1);
    expect(r.calls[2].body).toEqual({ query: 'big', properties: ['dealname'] });

    // fetch proxy only when the connector offers it.
    expect(a.proxyFetch).toBeTypeOf('function');
    await expect(a.proxyFetch!({ url: 'https://api.example.com/x', method: 'GET' })).resolves.toMatchObject({ status: 200 });
  });

  it('reports failures (e.g. a missing permission) and still rejects', async () => {
    const r = routes();
    const client = new ConnectorClient({ baseUrl: '', fetch: r.fetch });
    const onError = vi.fn();
    const a = buildLiveAdapter({ info: connectedInfo() }, { kind: 'card' }, { ...ADA, id: '404' }, { client, onError })!;
    await expect(a.getRecordProperties('0-1', 404, ['email'], false)).rejects.toBeInstanceOf(ConnectorError);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ code: 'missing_scope', requiredScopes: ['crm.objects.contacts.read'] });
  });

  it('recordFitsCard matches any spelling of the card object types', () => {
    expect(recordFitsCard(ADA, ['contacts'])).toBe(true);
    expect(recordFitsCard(ADA, ['0-1', 'deals'])).toBe(true);
    expect(recordFitsCard(ADA, ['deals'])).toBe(false);
    expect(recordFitsCard({ objectType: 'p_projects', objectTypeId: '2-555' }, ['p_projects'], OBJECT_TYPES)).toBe(true);
    expect(recordFitsCard(ADA, [])).toBe(true);
  });
});

describe('useLiveData: per-project selection', () => {
  it('remembers only the mode and record ids per project', () => {
    useConnection.setState({ status: 'connected', info: connectedInfo() });
    const s = useLiveData.getState();
    s.loadProject('p1');
    s.setMode('live');
    s.setRecord('ext1', ADA);
    const stored = JSON.parse(localStorage.getItem(`${LIVE_DATA_KEY_PREFIX}p1`)!);
    expect(stored).toEqual({ v: 1, mode: 'live', records: { ext1: { portalId: PORTAL_ID, objectType: 'contacts', objectTypeId: '0-1', id: '101' } } });
    // No record contents (names, emails) are stored.
    expect(JSON.stringify(stored)).not.toContain('Ada');

    s.loadProject('p2');
    expect(useLiveData.getState()).toMatchObject({ projectId: 'p2', mode: 'mock', recordByExtension: {} });
    useLiveData.getState().loadProject('p1');
    expect(useLiveData.getState().mode).toBe('live');
    expect(useLiveData.getState().recordByExtension.ext1).toEqual({ id: '101', objectType: 'contacts', objectTypeId: '0-1', label: '' });
    expect(useLiveData.getState().portalByExtension.ext1).toBe(PORTAL_ID);
  });

  it('ignores corrupted storage and forgets cleared selections', () => {
    localStorage.setItem(`${LIVE_DATA_KEY_PREFIX}bad`, '{not json');
    useLiveData.getState().loadProject('bad');
    expect(useLiveData.getState().mode).toBe('mock');
    localStorage.setItem(`${LIVE_DATA_KEY_PREFIX}odd`, JSON.stringify({ mode: 'live', records: { a: { portalId: 1, objectType: 'contacts', objectTypeId: '0-1', id: '<script>' } } }));
    useLiveData.getState().loadProject('odd');
    expect(useLiveData.getState().recordByExtension).toEqual({});
    useLiveData.getState().setMode('mock');
    expect(localStorage.getItem(`${LIVE_DATA_KEY_PREFIX}odd`)).toBeNull();
  });

  it('switches to live data right after a sign-in', () => {
    useLiveData.getState().loadProject('p1');
    expect(useLiveData.getState().mode).toBe('mock');
    useConnection.setState({ connectedAt: Date.now() });
    expect(useLiveData.getState().mode).toBe('live');
  });

  it('describes problems in plain language', () => {
    useLiveData.getState().reportError(new ConnectorError({ code: 'missing_scope', status: 403, message: 'x', requiredScopes: ['tickets'] }));
    expect(useLiveData.getState().error).toMatchObject({ code: 'missing_scope', title: 'Permission needed', action: 'reconnect', requiredScopes: ['tickets'] });
    expect(useLiveData.getState().error?.message).toMatch(/See tickets/);
    useLiveData.getState().reportError(new DOMException('aborted', 'AbortError'));
    expect(useLiveData.getState().error?.code).toBe('missing_scope');
  });
});

describe('useLiveAdapter (shell → RuntimeProvider live=)', () => {
  function loadEditor() {
    const card = createExtension({ name: 'Contact Card', objectTypes: ['contacts'] });
    const settings = createExtension({ kind: 'settings' });
    const project = createProject('Live test', [card, settings]);
    useEditor.getState().loadProject(project);
    useEditor.getState().setActiveExtension(card.id);
    return { project, card, settings };
  }

  it('is null in mock mode, when disconnected, or until a card has a sample record', () => {
    setConnectorClient(new ConnectorClient({ baseUrl: '', fetch: routes().fetch }));
    const { project, card, settings } = loadEditor();
    useConnection.setState({ status: 'connected', info: connectedInfo(), health: healthFixture() });
    const { result } = renderHook(() => useLiveAdapter());
    expect(useLiveData.getState().projectId).toBe(project.id);
    expect(result.current).toBeNull(); // mock mode

    act(() => useLiveData.getState().setMode('live'));
    expect(result.current).toBeNull(); // no record picked yet

    act(() => useLiveData.getState().setRecord(card.id, ADA));
    expect(result.current?.key).toBe(`${PORTAL_ID}|0-1:101|live`);
    expect(result.current?.context.crm).toEqual({ objectId: 101, objectTypeId: '0-1' });
    expect(result.current?.proxyFetch).toBeTypeOf('function');
    const first = result.current;

    // Looking up the label again does not rebuild the adapter.
    act(() => useLiveData.getState().setRecord(card.id, { ...ADA, label: 'Ada L.' }));
    expect(result.current).toBe(first);

    // Settings pages need no record.
    act(() => useEditor.getState().setActiveExtension(settings.id));
    expect(result.current?.key).toBe(`${PORTAL_ID}|settings|live`);

    act(() => useConnection.setState({ status: 'disconnected', info: { connected: false } }));
    expect(result.current).toBeNull();
  });

  it('ignores a record that does not fit the card or belongs to another portal', () => {
    const { card } = loadEditor();
    useConnection.setState({ status: 'connected', info: connectedInfo(), health: healthFixture() });
    const { result } = renderHook(() => useLiveAdapter());
    act(() => {
      useLiveData.getState().setMode('live');
      useLiveData.getState().setRecord(card.id, { id: '9', objectType: 'deals', objectTypeId: '0-3', label: 'Deal' });
    });
    expect(result.current).toBeNull();
    act(() => useLiveData.getState().setRecord(card.id, ADA, 4242));
    expect(result.current).toBeNull();
  });
});
