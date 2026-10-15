/**
 * Live HubSpot data in the preview runtime (RuntimeProviderProps.live / LiveDataAdapter): CRM
 * sources load from the portal with real async semantics, errors surface as `<name>Error` plus a
 * console entry, stale responses are ignored, a new live key reloads everything, dependent sources
 * wait for and re-run with their inputs, fetch goes through the connector proxy and the context
 * shows the real portal / user / record.
 */
import { act, cleanup, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmSearchResponseDTO, ProxyFetchResponse } from '../connect/types';
import type { CrmSearchSource, DataSource, NodeTemplate } from '../model/types';
import { previewRequestToProxy, readProxyJson, RUNTIME_TIMING } from './actions';
import {
  buildSearchRequest,
  isLiveSource,
  liveDependencies,
  liveGates,
  LiveRequestError,
  NO_RECORD_CONTEXT_MESSAGE,
  NO_SAMPLE_RECORD_MESSAGE,
  planLiveRequest,
} from './live';
import { liveErrorInfo } from './liveErrors';
import { mockDataForSource } from './mockData';
import { buildContext } from './scope';
import { byName, makeDoc, renderDoc } from './testing';
import type { LiveDataAdapter, RuntimeLogEntry } from './types';

const ORIGINAL_TIMING = { ...RUNTIME_TIMING };
beforeEach(() => {
  Object.assign(RUNTIME_TIMING, { dataSourceLatencyMs: 20, functionLatencyMs: 10, liveDebounceMs: 40 });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.assign(RUNTIME_TIMING, ORIGINAL_TIMING);
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const text = (name: string, value: string): NodeTemplate => ({ type: 'Text', name, text: value });
const contact: DataSource = { id: 'd_c', kind: 'crmProperties', name: 'contact', properties: ['firstname', 'email'] };
const deals: DataSource = { id: 'd_d', kind: 'associations', name: 'deals', toObjectType: '0-3', properties: ['dealname'], pageLength: 3 };
const search = (over: Partial<CrmSearchSource> = {}): CrmSearchSource => ({
  id: 'd_s',
  kind: 'crmSearch',
  name: 'found',
  objectType: 'companies',
  properties: ['name'],
  filters: [],
  sorts: [],
  pageLength: 5,
  ...over,
});

type Props = Record<string, string | null>;

/** A fake LiveDataAdapter: real-looking answers unless a test replaces a method. */
function makeLive(over: Partial<LiveDataAdapter> = {}): LiveDataAdapter {
  return {
    key: '999|0-1:101|live',
    context: { portal: { id: 999 }, user: { id: 7, email: 'admin@acme.test' }, crm: { objectId: 101, objectTypeId: '0-1' } },
    getRecordProperties: vi.fn(async (_type: string, _id: number, properties: string[]) =>
      Object.fromEntries(properties.map((p) => [p, `real ${p}`])) as Props,
    ),
    getAssociations: vi.fn(async () => [
      { toObjectId: 501, associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 3, label: '' }], properties: { dealname: 'Real deal' } },
    ]),
    search: vi.fn(async (): Promise<CrmSearchResponseDTO> => ({ results: [{ objectId: 9, properties: { name: 'Acme' } }], total: 1, hasMore: false })),
    ...over,
  };
}

const liveLogs = (logs: RuntimeLogEntry[]) => logs.filter((l) => l.message.startsWith('Live:'));
const proxyOk = (body: unknown, status = 200): ProxyFetchResponse => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
  truncated: false,
});

// ---------------------------------------------------------------------------
// CRM data sources
// ---------------------------------------------------------------------------

describe('live CRM data sources', () => {
  it('loads record properties from HubSpot, starting with HubSpot’s loading values', async () => {
    const pending = deferred<Props>();
    const live = makeLive({ getRecordProperties: vi.fn(() => pending.promise) });
    const { project, ext } = makeDoc([text('t', 'Hi {{ contact.firstname }}{{ contactLoading ? " (loading)" : "" }}')], { dataSources: [contact] });
    const r = renderDoc(project, ext, { live });
    expect(r.api.dataSources.d_c).toEqual({ data: {}, loading: true, error: null });
    expect(r.nodes(byName(ext, 't').id)[0]).toHaveTextContent('Hi (loading)');
    await waitFor(() => expect(live.getRecordProperties).toHaveBeenCalledTimes(1));
    expect(live.getRecordProperties).toHaveBeenCalledWith('0-1', 101, ['firstname', 'email'], false);

    await act(async () => pending.resolve({ firstname: 'Ada', extra: 'not requested' }));
    // Exactly the requested properties; missing ones are null (like useCrmProperties).
    expect(r.api.dataSources.d_c).toEqual({ data: { firstname: 'Ada', email: null }, loading: false, error: null });
    expect(r.nodes(byName(ext, 't').id)[0]).toHaveTextContent('Hi Ada');
    const entries = liveLogs(r.api.logs);
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('info');
    expect(entries[0].message).toMatch(/^Live: GET contact properties \(2\) for contact — \d+ ms$/);
    // The mock loader never ran for the live source.
    expect(r.api.logs.some((l) => l.message.includes('mock data'))).toBe(false);
  });

  it('asks HubSpot for formatted values when the source is formatted', async () => {
    const live = makeLive();
    const { project, ext } = makeDoc([], { dataSources: [{ ...contact, formatted: true } as DataSource] });
    renderDoc(project, ext, { live });
    await waitFor(() => expect(live.getRecordProperties).toHaveBeenCalledWith('0-1', 101, ['firstname', 'email'], true));
  });

  it('loads associations of the sample record ([] until loaded)', async () => {
    const live = makeLive();
    const { project, ext } = makeDoc([text('t', '{{ deals.length }} deals: {{ deals[0]?.properties.dealname }}')], { dataSources: [deals] });
    const r = renderDoc(project, ext, { live });
    expect(r.api.dataSources.d_d).toEqual({ data: [], loading: true, error: null });
    await waitFor(() => expect(r.nodes(byName(ext, 't').id)[0]).toHaveTextContent('1 deals: Real deal'));
    expect(live.getAssociations).toHaveBeenCalledWith('0-1', 101, { toObjectType: '0-3', properties: ['dealname'], pageLength: 3, formatted: false });
    expect(liveLogs(r.api.logs)[0].message).toMatch(/^Live: GET associated deals \(1\) for deals — \d+ ms$/);
  });

  it('runs CRM searches with the request the generated useCrmSearch makes', async () => {
    const live = makeLive();
    const ds = search({
      objectType: 'deals',
      properties: ['dealname', 'amount'],
      query: 'renewal {{ year }}',
      filters: [
        { propertyName: 'email', operator: 'EQ', value: '{{ email }}' },
        { propertyName: 'stage', operator: 'IN', value: 'open, won' },
        { propertyName: 'pipeline', operator: 'IN', value: '{{ pipelines }}' },
        { propertyName: 'amount', operator: 'BETWEEN', value: '10, 20' },
        { propertyName: 'closedate', operator: 'HAS_PROPERTY', value: 'ignored' },
        { propertyName: 'n', operator: 'GT', value: '{{ n }}' },
      ],
      sorts: [{ propertyName: 'amount', direction: 'DESCENDING' }],
      pageLength: 5,
      formatted: true,
    });
    const { project, ext } = makeDoc([text('t', '{{ found[0]?.properties.name }}')], {
      dataSources: [ds],
      state: [
        { name: 'year', type: 'number', initial: 2027 },
        { name: 'email', type: 'string', initial: 'a@b.c' },
        { name: 'pipelines', type: 'array', initial: ['default', 'p2'] },
        { name: 'n', type: 'number', initial: 3 },
      ],
    });
    const r = renderDoc(project, ext, { live });
    await waitFor(() => expect(r.nodes(byName(ext, 't').id)[0]).toHaveTextContent('Acme'));
    expect(live.search).toHaveBeenCalledTimes(1);
    expect(live.search).toHaveBeenCalledWith('deals', {
      properties: ['dealname', 'amount'],
      query: 'renewal 2027',
      filterGroups: [
        {
          filters: [
            { propertyName: 'email', operator: 'EQ', value: 'a@b.c' },
            { propertyName: 'stage', operator: 'IN', values: ['open', 'won'] },
            { propertyName: 'pipeline', operator: 'IN', values: ['default', 'p2'] },
            { propertyName: 'amount', operator: 'BETWEEN', value: '10', highValue: '20' },
            { propertyName: 'closedate', operator: 'HAS_PROPERTY' },
            { propertyName: 'n', operator: 'GT', value: 3 },
          ],
        },
      ],
      sorts: [{ propertyName: 'amount', direction: 'DESCENDING' }],
      pageLength: 5,
      formatted: true,
    });
    expect(r.api.dataSources.d_s.data).toEqual([{ objectId: 9, properties: { name: 'Acme' } }]);
    expect(liveLogs(r.api.logs)[0].message).toMatch(/^Live: POST deals search \(1\) for found — \d+ ms$/);
  });

  it('shows failures as <name>Error and logs them with the connector error code', async () => {
    const err = Object.assign(new Error('HubSpot did not give this app permission to read deals.'), {
      name: 'ConnectorError',
      code: 'missing_scope',
      status: 403,
      requiredScopes: ['crm.objects.deals.read'],
    });
    const live = makeLive({ getAssociations: vi.fn(async () => Promise.reject(err)) });
    const { project, ext } = makeDoc([text('t', 'Problem: {{ dealsError }}')], { dataSources: [deals] });
    const r = renderDoc(project, ext, { live });
    await waitFor(() => expect(r.api.dataSources.d_d.loading).toBe(false));
    expect(r.api.dataSources.d_d).toEqual({ data: [], loading: false, error: err.message });
    expect(r.nodes(byName(ext, 't').id)[0]).toHaveTextContent(`Problem: ${err.message}`);
    const entry = liveLogs(r.api.logs)[0];
    expect(entry.level).toBe('error');
    expect(entry.message).toBe(`Live: GET associated deals failed for deals — ${err.message} (missing_scope)`);
    expect(entry.detail).toMatchObject({ code: 'missing_scope', status: 403, requiredScopes: ['crm.objects.deals.read'] });
  });

  it('asks for a sample record when the live context has none (no request is made)', async () => {
    const live = makeLive();
    delete live.context.crm;
    const { project, ext } = makeDoc([text('t', '{{ contactError }}')], { dataSources: [contact, deals] });
    const r = renderDoc(project, ext, { live });
    await waitFor(() => expect(r.api.dataSources.d_c.error).toBe(NO_SAMPLE_RECORD_MESSAGE));
    expect(NO_SAMPLE_RECORD_MESSAGE).toMatch(/^Pick a sample record/);
    expect(r.api.dataSources.d_d.error).toBe(NO_SAMPLE_RECORD_MESSAGE);
    expect(r.api.dataSources.d_c.data).toEqual({});
    expect(r.nodes(byName(ext, 't').id)[0]).toHaveTextContent('Pick a sample record');
    expect(live.getRecordProperties).not.toHaveBeenCalled();
    expect(live.getAssociations).not.toHaveBeenCalled();
    const warn = liveLogs(r.api.logs).find((l) => l.message.includes('for contact'));
    expect(warn?.level).toBe('warn');
    expect(warn?.message).toContain('(no_sample_record)');
  });

  it('explains that settings pages have no record data', async () => {
    const live = makeLive();
    delete live.context.crm;
    const { project, ext } = makeDoc([], { dataSources: [contact], kind: 'settings' });
    const r = renderDoc(project, ext, { live });
    await waitFor(() => expect(r.api.dataSources.d_c.error).toBe(NO_RECORD_CONTEXT_MESSAGE));
    expect(live.getRecordProperties).not.toHaveBeenCalled();
  });

  it('re-runs the live request on a refetch action, keeping the data while it loads', async () => {
    let name = 'First';
    const next = deferred<Props>();
    let calls = 0;
    const live = makeLive({
      getRecordProperties: vi.fn(async () => {
        calls += 1;
        return calls === 1 ? { firstname: name, email: null } : next.promise;
      }),
    });
    const { project, ext } = makeDoc([], { dataSources: [contact] });
    const r = renderDoc(project, ext, { live });
    await waitFor(() => expect(r.api.dataSources.d_c.data).toEqual({ firstname: 'First', email: null }));
    name = 'Second';
    let done!: Promise<void>;
    act(() => {
      done = r.api.runDataSource('contact');
    });
    await waitFor(() => expect(live.getRecordProperties).toHaveBeenCalledTimes(2));
    expect(r.api.dataSources.d_c).toEqual({ data: { firstname: 'First', email: null }, loading: true, error: null });
    await act(async () => {
      next.resolve({ firstname: name, email: 'x@y.z' });
      await done;
    });
    expect(r.api.dataSources.d_c).toEqual({ data: { firstname: 'Second', email: 'x@y.z' }, loading: false, error: null });
    expect(r.api.logs.some((l) => l.level === 'action' && l.message === 'Refetching contact (useCrmProperties)')).toBe(true);
    expect(liveLogs(r.api.logs)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Sessions, staleness and dependencies
// ---------------------------------------------------------------------------

describe('live sessions', () => {
  it('reloads everything when live.key changes (another sample record)', async () => {
    const live = makeLive();
    const { project, ext } = makeDoc([text('t', 'Hi {{ contact.firstname }}')], { dataSources: [contact, deals] });
    const r = renderDoc(project, ext, { live });
    await waitFor(() => expect(r.api.dataSources.d_c.loading).toBe(false));
    const pending = deferred<Props>();
    const other: LiveDataAdapter = {
      ...live,
      key: '999|0-1:202|live',
      context: { ...live.context, crm: { objectId: 202, objectTypeId: '0-1' } },
      getRecordProperties: vi.fn(() => pending.promise),
    };
    r.update({ live: other });
    // A new record opens like a new card: loading, with HubSpot's first-render values.
    expect(r.api.dataSources.d_c).toEqual({ data: {}, loading: true, error: null });
    await waitFor(() => expect(other.getRecordProperties).toHaveBeenCalledWith('0-1', 202, ['firstname', 'email'], false));
    await waitFor(() => expect(live.getAssociations).toHaveBeenCalledTimes(2));
    expect((live.getAssociations as ReturnType<typeof vi.fn>).mock.calls[1][1]).toBe(202);
    await act(async () => pending.resolve({ firstname: 'Grace', email: null }));
    expect(r.nodes(byName(ext, 't').id)[0]).toHaveTextContent('Hi Grace');
    expect(r.api.scope.context).toMatchObject({ crm: { objectId: 202 } });
  });

  it('ignores the response of an older live session that arrives late', async () => {
    const slow = deferred<Props>();
    const fast = deferred<Props>();
    const first = makeLive({ getRecordProperties: vi.fn(() => slow.promise) });
    const { project, ext } = makeDoc([text('t', 'Hi {{ contact.firstname }}')], { dataSources: [contact] });
    const r = renderDoc(project, ext, { live: first });
    await waitFor(() => expect(first.getRecordProperties).toHaveBeenCalled());
    const second = makeLive({ key: 'other', getRecordProperties: vi.fn(() => fast.promise) });
    r.update({ live: second });
    await waitFor(() => expect(second.getRecordProperties).toHaveBeenCalled());
    await act(async () => fast.resolve({ firstname: 'New', email: null }));
    await act(async () => slow.resolve({ firstname: 'Old', email: null }));
    expect(r.api.dataSources.d_c.data).toEqual({ firstname: 'New', email: null });
    expect(r.nodes(byName(ext, 't').id)[0]).toHaveTextContent('Hi New');
    expect(liveLogs(r.api.logs)).toHaveLength(1);
  });

  it('ignores a superseded request of the same source (newest request wins)', async () => {
    const responses: Array<Deferred<CrmSearchResponseDTO>> = [];
    const live = makeLive({
      search: vi.fn(() => {
        const d = deferred<CrmSearchResponseDTO>();
        responses.push(d);
        return d.promise;
      }),
    });
    const { project, ext } = makeDoc([], { dataSources: [search({ query: '{{ q }}' })], state: [{ name: 'q', type: 'string', initial: 'a' }] });
    const r = renderDoc(project, ext, { live });
    await waitFor(() => expect(responses).toHaveLength(1));
    act(() => r.api.setStateValue('q', 'b'));
    await waitFor(() => expect(responses).toHaveLength(2));
    expect((live.search as ReturnType<typeof vi.fn>).mock.calls[1][1]).toMatchObject({ query: 'b' });
    await act(async () => responses[1].resolve({ results: [{ objectId: 2, properties: { name: 'B' } }], total: 1, hasMore: false }));
    await act(async () => responses[0].resolve({ results: [{ objectId: 1, properties: { name: 'A' } }], total: 1, hasMore: false }));
    expect(r.api.dataSources.d_s.data).toEqual([{ objectId: 2, properties: { name: 'B' } }]);
  });

  it('ignores responses that arrive after the runtime unmounted', async () => {
    const pending = deferred<Props>();
    const live = makeLive({ getRecordProperties: vi.fn(() => pending.promise) });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { project, ext } = makeDoc([], { dataSources: [contact] });
    const r = renderDoc(project, ext, { live });
    await waitFor(() => expect(live.getRecordProperties).toHaveBeenCalled());
    const before = r.api.logs.length;
    r.unmount();
    await act(async () => pending.resolve({ firstname: 'Late', email: null }));
    expect(errors).not.toHaveBeenCalled();
    expect(r.api.logs.length).toBe(before);
  });

  it('waits for the record before a search that reads it, then re-runs when it changes', async () => {
    let email = 'first@acme.test';
    const live = makeLive({ getRecordProperties: vi.fn(async () => ({ email })) });
    const ds = search({ objectType: 'contacts', filters: [{ propertyName: 'email', operator: 'EQ', value: '{{ contact.email }}' }] });
    const { project, ext } = makeDoc([], { dataSources: [ds, { ...contact, properties: ['email'] } as DataSource] });
    const r = renderDoc(project, ext, { live });
    await waitFor(() => expect(live.search).toHaveBeenCalledTimes(1));
    // Never searched with the empty first-render value.
    expect((live.search as ReturnType<typeof vi.fn>).mock.calls[0][1].filterGroups[0].filters[0].value).toBe('first@acme.test');
    await waitFor(() => expect(r.api.dataSources.d_s.loading).toBe(false));

    email = 'second@acme.test';
    await act(() => r.api.runDataSource('contact'));
    expect(r.api.dataSources.d_c.data).toEqual({ email: 'second@acme.test' });
    await waitFor(() => expect(live.search).toHaveBeenCalledTimes(2));
    expect((live.search as ReturnType<typeof vi.fn>).mock.calls[1][1].filterGroups[0].filters[0].value).toBe('second@acme.test');
  });

  it('waits for a record read through a computed value', async () => {
    const live = makeLive({ getRecordProperties: vi.fn(async () => ({ domain: 'acme.test' })) });
    const ds = search({ query: '{{ companyDomain }}' });
    const { project, ext } = makeDoc([], { dataSources: [ds, { id: 'd_co', kind: 'crmProperties', name: 'company', properties: ['domain'] }] });
    ext.computed = [{ id: 'c1', name: 'companyDomain', expr: 'company.domain ?? ""' }];
    renderDoc(project, ext, { live });
    await waitFor(() => expect(live.search).toHaveBeenCalledTimes(1));
    expect((live.search as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ query: 'acme.test' });
  });

  it('debounces changing inputs: one request once they settle', async () => {
    const live = makeLive();
    const { project, ext } = makeDoc([], { dataSources: [search({ query: '{{ q }}' })], state: [{ name: 'q', type: 'string', initial: '' }] });
    const r = renderDoc(project, ext, { live });
    await waitFor(() => expect(live.search).toHaveBeenCalledTimes(1));
    act(() => r.api.setStateValue('q', 'a'));
    act(() => r.api.setStateValue('q', 'ac'));
    act(() => r.api.setStateValue('q', 'acme'));
    expect(live.search).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(live.search).toHaveBeenCalledTimes(2));
    expect((live.search as ReturnType<typeof vi.fn>).mock.calls[1][1]).toMatchObject({ query: 'acme' });
    await new Promise((resolve) => setTimeout(resolve, RUNTIME_TIMING.liveDebounceMs * 2));
    expect(live.search).toHaveBeenCalledTimes(2);
  });

  it('re-runs a source when its definition changes (e.g. another property)', async () => {
    const live = makeLive();
    const { project, ext } = makeDoc([], { dataSources: [contact] });
    const r = renderDoc(project, ext, { live });
    await waitFor(() => expect(r.api.dataSources.d_c.loading).toBe(false));
    const edited = { ...ext, dataSources: [{ ...contact, properties: ['firstname', 'email', 'phone'] } as DataSource] };
    r.update({ ext: edited });
    await waitFor(() => expect(live.getRecordProperties).toHaveBeenCalledTimes(2));
    expect(live.getRecordProperties).toHaveBeenLastCalledWith('0-1', 101, ['firstname', 'email', 'phone'], false);
    await waitFor(() => expect(r.api.dataSources.d_c.data).toEqual({ firstname: 'real firstname', email: 'real email', phone: 'real phone' }));
  });

  it('loads live data in design mode too', async () => {
    const live = makeLive();
    const { project, ext } = makeDoc([text('t', 'Hi {{ contact.firstname }}')], { dataSources: [contact] });
    const r = renderDoc(project, ext, { live, mode: 'design' });
    await waitFor(() => expect(r.nodes(byName(ext, 't').id)[0]).toHaveTextContent('Hi real firstname'));
  });

  it('a reset loads the live data again', async () => {
    const live = makeLive();
    const { project, ext } = makeDoc([], { dataSources: [contact] });
    const r = renderDoc(project, ext, { live });
    await waitFor(() => expect(r.api.dataSources.d_c.loading).toBe(false));
    act(() => r.api.reset());
    expect(r.api.dataSources.d_c.loading).toBe(true);
    await waitFor(() => expect(live.getRecordProperties).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(r.api.dataSources.d_c.loading).toBe(false));
  });
});

// ---------------------------------------------------------------------------
// Mock fallback
// ---------------------------------------------------------------------------

describe('mock data next to live data', () => {
  it('keeps app function sources on their mock results', async () => {
    const live = makeLive();
    const { project, ext } = makeDoc([], {
      dataSources: [contact, { id: 'd_f', kind: 'function', name: 'score', functionId: 'fn1', runOnMount: true }],
    });
    ext.mock.dataSources.d_f = { score: 42 };
    const r = renderDoc(project, ext, { live });
    await waitFor(() => expect(r.api.dataSources.d_f).toEqual({ data: { score: 42 }, loading: false, error: null }));
    await waitFor(() => expect(r.api.dataSources.d_c.loading).toBe(false));
    expect(r.api.dataSources.d_c.data).toEqual({ firstname: 'real firstname', email: 'real email' });
  });

  it('returns to mock data when live data is switched off', async () => {
    const live = makeLive();
    const { project, ext } = makeDoc([], { dataSources: [contact] });
    const r = renderDoc(project, ext, { live });
    await waitFor(() => expect(r.api.dataSources.d_c.data).toEqual({ firstname: 'real firstname', email: 'real email' }));
    r.update({ live: null });
    expect(r.api.dataSources.d_c.loading).toBe(true);
    await waitFor(() => expect(r.api.dataSources.d_c).toEqual({ data: mockDataForSource(ext, contact), loading: false, error: null }));
  });

  it('keeps fetch sources on mock data without the connector proxy', async () => {
    const live = makeLive();
    const ds: DataSource = { id: 'd_w', kind: 'fetch', name: 'weather', url: 'https://api.example.com/w', method: 'GET', runOnMount: true };
    expect(isLiveSource(ds, live)).toBe(false);
    const { project, ext } = makeDoc([], { dataSources: [ds] });
    ext.mock.dataSources.d_w = { t: 21 };
    const r = renderDoc(project, ext, { live });
    await waitFor(() => expect(r.api.dataSources.d_w).toEqual({ data: { t: 21 }, loading: false, error: null }));
  });
});

// ---------------------------------------------------------------------------
// hubspot.fetch through the connector
// ---------------------------------------------------------------------------

describe('fetch through the connector proxy', () => {
  it('sends fetch actions through proxyFetch (no browser fetch) and stores the JSON', async () => {
    const browserFetch = vi.spyOn(globalThis, 'fetch');
    const proxyFetch = vi.fn(async () => proxyOk({ n: 1 }));
    const live = makeLive({ proxyFetch });
    const { project, ext } = makeDoc([], { state: [{ name: 'data', type: 'any', initial: null }, { name: 'ok', type: 'boolean', initial: false }] });
    const r = renderDoc(project, ext, { live });
    await act(() =>
      r.api.runActions([
        {
          id: 'f',
          type: 'fetch',
          url: 'https://api.example.com/x/{{ context.crm.objectId }}',
          method: 'POST',
          body: '{ a: 1 }',
          headers: [{ key: 'X-User', value: '{{ context.user.email }}' }],
          resultState: 'data',
          onSuccess: [{ id: 's', type: 'setState', state: 'ok', value: 'response.n === 1' }],
        },
      ]),
    );
    expect(proxyFetch).toHaveBeenCalledWith({
      url: 'https://api.example.com/x/101',
      method: 'POST',
      headers: { 'X-User': 'admin@acme.test' },
      body: { a: 1 },
      timeoutMs: RUNTIME_TIMING.fetchTimeoutMs,
    });
    expect(browserFetch).not.toHaveBeenCalled();
    expect(r.api.stateValues.data).toEqual({ n: 1 });
    expect(r.api.stateValues.ok).toBe(true);
    expect(liveLogs(r.api.logs)[0].message).toMatch(/^Live: POST https:\/\/api\.example\.com\/x\/101 → 200 — \d+ ms$/);
  });

  it('runs onError for an error status, like the preview’s own fetch', async () => {
    const live = makeLive({ proxyFetch: vi.fn(async () => proxyOk({ message: 'nope' }, 500)) });
    const { project, ext } = makeDoc([], { state: [{ name: 'err', type: 'string', initial: '' }] });
    const r = renderDoc(project, ext, { live });
    await act(() =>
      r.api.runActions([
        { id: 'f', type: 'fetch', url: 'https://api.example.com/x', method: 'GET', onError: [{ id: 'e', type: 'setState', state: 'err', value: 'error.message' }] },
      ]),
    );
    expect(r.api.stateValues.err).toBe('Request failed with status 500');
    const entry = liveLogs(r.api.logs)[0];
    expect(entry.level).toBe('error');
    expect(entry.message).toBe('Live: GET https://api.example.com/x failed — Request failed with status 500');
    expect(entry.detail).toEqual({ message: 'nope' });
  });

  it('runs onError (and logs the code) when the connector refuses the request', async () => {
    const err = Object.assign(new Error('That address is not allowed.'), { code: 'url_not_allowed', status: 400 });
    const live = makeLive({ proxyFetch: vi.fn(async () => Promise.reject(err)) });
    const { project, ext } = makeDoc([], { state: [{ name: 'err', type: 'string', initial: '' }] });
    const r = renderDoc(project, ext, { live });
    await act(() =>
      r.api.runActions([
        { id: 'f', type: 'fetch', url: 'http://localhost/x', method: 'GET', onError: [{ id: 'e', type: 'setState', state: 'err', value: 'error.message' }] },
      ]),
    );
    expect(r.api.stateValues.err).toBe('That address is not allowed.');
    expect(liveLogs(r.api.logs)[0].message).toContain('(url_not_allowed)');
  });

  it('loads fetch data sources through the proxy (on open and when refetched)', async () => {
    let n = 0;
    const proxyFetch = vi.fn(async () => proxyOk({ n: ++n }));
    const live = makeLive({ proxyFetch });
    const ds: DataSource = {
      id: 'd_w',
      kind: 'fetch',
      name: 'weather',
      url: 'https://api.example.com/w?email={{ contact.email }}',
      method: 'GET',
      runOnMount: true,
    };
    const { project, ext } = makeDoc([text('t', 'N={{ weather?.n }}')], { dataSources: [ds, contact] });
    ext.mock.dataSources.d_w = { n: 'mock' };
    const r = renderDoc(project, ext, { live });
    expect(r.api.dataSources.d_w).toEqual({ data: null, loading: true, error: null });
    await waitFor(() => expect(r.nodes(byName(ext, 't').id)[0]).toHaveTextContent('N=1'));
    // Waited for the record it reads.
    expect(proxyFetch).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://api.example.com/w?email=real email', method: 'GET' }));
    expect(liveLogs(r.api.logs).some((l) => /^Live: GET https:\/\/api\.example\.com\/w\?email=real email → 200 for weather — \d+ ms$/.test(l.message))).toBe(true);
    await act(() => r.api.runDataSource('weather'));
    expect(r.api.dataSources.d_w).toEqual({ data: { n: 2 }, loading: false, error: null });
  });

  it('reports a fetch data source error status as <name>Error', async () => {
    const live = makeLive({ proxyFetch: vi.fn(async () => proxyOk('', 404)) });
    const ds: DataSource = { id: 'd_w', kind: 'fetch', name: 'weather', url: 'https://api.example.com/w', method: 'GET', runOnMount: false };
    const { project, ext } = makeDoc([], { dataSources: [ds] });
    const r = renderDoc(project, ext, { live });
    expect(r.api.dataSources.d_w).toEqual({ data: null, loading: false, error: null });
    await act(() => r.api.runDataSource('weather'));
    expect(r.api.dataSources.d_w).toEqual({ data: null, loading: false, error: 'Request failed with status 404' });
  });

  it('gives custom code’s hubspot.fetch a Response-like result from the proxy', async () => {
    const live = makeLive({ proxyFetch: vi.fn(async () => proxyOk({ hello: 'world' })) });
    const { project, ext } = makeDoc([], { state: [{ name: 'data', type: 'any', initial: null }] });
    const r = renderDoc(project, ext, { live });
    await act(() =>
      r.api.runActions([
        {
          id: 'c',
          type: 'custom',
          code: "const res = await hubspot.fetch('https://api.example.com/y'); if (res.ok && res.status === 200) setData(await res.json());",
        },
      ]),
    );
    expect(r.api.stateValues.data).toEqual({ hello: 'world' });
    expect(live.proxyFetch).toHaveBeenCalledWith({ url: 'https://api.example.com/y', method: 'GET', timeoutMs: RUNTIME_TIMING.fetchTimeoutMs });
  });

  it('reads the sample record in actions.fetchCrmObjectProperties', async () => {
    const live = makeLive();
    const { project, ext } = makeDoc([], { state: [{ name: 'data', type: 'any', initial: null }] });
    const r = renderDoc(project, ext, { live });
    await act(() => r.api.runActions([{ id: 'c', type: 'custom', code: "setData(await actions.fetchCrmObjectProperties(['firstname']));" }]));
    expect(r.api.stateValues.data).toEqual({ firstname: 'real firstname' });
  });
});

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

describe('live context', () => {
  it('shows the real portal, user and record (keeping the mock locale)', () => {
    const live = makeLive();
    const { project, ext } = makeDoc([
      text('t', '{{ context.user.email }}|{{ context.user.id }}|{{ context.portal.id }}|{{ context.crm.objectId }}|{{ context.user.locale }}'),
    ]);
    const r = renderDoc(project, ext, { live });
    expect(r.nodes(byName(ext, 't').id)[0]).toHaveTextContent('admin@acme.test|7|999|101|en-us');
    expect(r.api.scope.context).toMatchObject({ user: { emails: ['admin@acme.test'] }, portal: { id: 999, timezone: 'America/New_York' } });
  });

  it('uses the user’s names when the connection provides them', () => {
    const { project, ext } = makeDoc([]);
    const ctx = buildContext(project, ext, {
      portal: { id: 5, timezone: 'Europe/Paris' },
      user: { email: 'ada@acme.test', firstName: 'Ada', lastName: 'Lovelace' },
      crm: { objectId: 3, objectTypeId: '0-2' },
    }) as Record<string, Record<string, unknown>>;
    expect(ctx.user).toMatchObject({ email: 'ada@acme.test', firstName: 'Ada', lastName: 'Lovelace', id: 1001, locale: 'en-us' });
    expect(ctx.portal).toEqual({ id: 5, timezone: 'Europe/Paris' });
    expect(ctx.crm).toEqual({ objectId: 3, objectTypeId: '0-2' });
  });

  it('gives settings pages no record even with live data', () => {
    const { project, ext } = makeDoc([], { kind: 'settings' });
    expect(buildContext(project, ext, makeLive().context)).not.toHaveProperty('crm');
  });

  it('switching back to mock data restores the mock context', () => {
    const { project, ext } = makeDoc([text('t', '{{ context.user.email }}')]);
    const r = renderDoc(project, ext, { live: makeLive() });
    expect(r.nodes(byName(ext, 't').id)[0]).toHaveTextContent('admin@acme.test');
    r.update({ live: null });
    expect(r.nodes(byName(ext, 't').id)[0]).toHaveTextContent('jordan.lee@example.com');
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('live helpers', () => {
  it('buildSearchRequest leaves out empty parts and fails on broken expressions', () => {
    expect(buildSearchRequest(search({ properties: [], pageLength: NaN }), {})).toEqual({});
    expect(() => buildSearchRequest(search({ query: '{{ missing.value }}' }), {})).toThrow(LiveRequestError);
    expect(buildSearchRequest(search({ filters: [{ propertyName: 'a', operator: 'BETWEEN', value: '{{ lo }}' }] }), { lo: 4 })).toMatchObject({
      filterGroups: [{ filters: [{ propertyName: 'a', operator: 'BETWEEN', value: 4 }] }],
    });
    expect(buildSearchRequest(search({ filters: [{ propertyName: 'a', operator: 'not_in', value: 'x, {{ y }}' }] }), { y: 2 })).toMatchObject({
      filterGroups: [{ filters: [{ propertyName: 'a', operator: 'not_in', values: ['x', 2] }] }],
    });
  });

  it('planLiveRequest reports failing request expressions as errors', () => {
    const live = makeLive({ proxyFetch: vi.fn() });
    const plan = planLiveRequest(search({ query: '{{ nope.x }}' }), {}, live);
    expect(plan.ok).toBe(false);
    const fetchPlan = planLiveRequest({ id: 'f', kind: 'fetch', name: 'f', url: 'https://x.test', method: 'POST', body: 'nope.x', runOnMount: false }, {}, live);
    expect(fetchPlan).toMatchObject({ ok: false, code: 'expression_error' });
  });

  it('liveDependencies follows templates and computed values; liveGates breaks cycles', () => {
    const a = search({ id: 'a', name: 'a', query: '{{ bLoading ? "" : b[0]?.objectId }}' });
    const b = search({ id: 'b', name: 'b', query: '{{ derived }}' });
    const c: DataSource = { id: 'c', kind: 'crmProperties', name: 'c', properties: ['x'] };
    const ext = { dataSources: [a, b, c], computed: [{ id: 'k', name: 'derived', expr: 'c.x + a.length' }] };
    expect(liveDependencies(ext, a).map((d) => d.id)).toEqual(['b']);
    expect(liveDependencies(ext, b).map((d) => d.id).sort()).toEqual(['a', 'c']);
    const gates = liveGates(ext);
    expect(gates.get('a')).toEqual([]);
    expect(gates.get('b')?.map((d) => d.id)).toEqual(['c']);
    expect(gates.get('c')).toEqual([]);
  });

  it('converts proxy requests and responses', () => {
    expect(previewRequestToProxy('https://x.test', { method: 'put', body: '{"a":1}', timeout: 50 })).toEqual({
      url: 'https://x.test',
      method: 'PUT',
      body: { a: 1 },
      timeoutMs: 50,
    });
    expect(previewRequestToProxy('https://x.test', { method: 'GET', body: { ignored: true } })).not.toHaveProperty('body');
    expect(readProxyJson(proxyOk(''))).toBeNull();
    expect(() => readProxyJson({ ...proxyOk('{"a":'), truncated: true })).toThrow(/too large/);
    expect(() => readProxyJson(proxyOk('not json'))).toThrow('Response is not valid JSON');
  });

  it('liveErrorInfo keeps the connector code and facts', () => {
    expect(liveErrorInfo({ message: 'Slow down', code: 'rate_limited', retryAfter: 10 })).toEqual({
      message: 'Slow down',
      code: 'rate_limited',
      detail: { code: 'rate_limited', retryAfter: 10 },
    });
    expect(liveErrorInfo('boom')).toEqual({ message: 'boom' });
    expect(liveErrorInfo(null)).toEqual({ message: 'The request failed.' });
  });
});
