/**
 * The preview behaves like the card on HubSpot: data loads after the card opens (first render
 * with HubSpot's loading values), expressions that would crash the card fail visibly, settings /
 * home pages have no `context.crm`, plus simulated data states, formatted values, alerts in the
 * flow, debounced diagnostics, modal focus handling and request options.
 */
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource, NodeTemplate } from '../model/types';
import { RUNTIME_TIMING } from './actions';
import { DIAGNOSTICS_DEBOUNCE_MS } from './RuntimeProvider';
import { formatPropertyValue, mockDataForSource } from './mockData';
import { buildContext, resolveDataSources, SIMULATED_ERROR } from './scope';
import { byName, makeDoc, renderDoc } from './testing';

const ORIGINAL_TIMING = { ...RUNTIME_TIMING };
beforeEach(() => {
  Object.assign(RUNTIME_TIMING, { dataSourceLatencyMs: 30, functionLatencyMs: 10, alertDismissMs: 5000 });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.assign(RUNTIME_TIMING, ORIGINAL_TIMING);
});

const text = (name: string, value: string, extra: Partial<NodeTemplate> = {}): NodeTemplate => ({ type: 'Text', name, text: value, ...extra });
const weather: DataSource = { id: 'd_w', kind: 'fetch', name: 'weather', url: 'https://api.example.com/w', method: 'GET', runOnMount: true };
const contact: DataSource = { id: 'd_c', kind: 'crmProperties', name: 'contact', properties: ['firstname', 'email'] };
const deals: DataSource = { id: 'd_d', kind: 'associations', name: 'deals', toObjectType: '0-3', properties: ['dealname'], pageLength: 3 };

describe('first render while data loads', () => {
  it('starts on-open sources with HubSpot’s loading values, then shows the mock data', async () => {
    const { project, ext } = makeDoc(
      [
        text('t', 'Temp: {{ weather?.temperature }} {{ weatherLoading ? "(loading)" : "" }}'),
        text('c', 'Hi {{ contact.firstname }}'),
        text('d', '{{ deals.length }} deals'),
      ],
      { dataSources: [weather, contact, deals] },
    );
    ext.mock.dataSources.d_w = { temperature: 21 };
    const r = renderDoc(project, ext);
    expect(r.api.dataSources.d_w).toEqual({ data: null, loading: true, error: null });
    expect(r.api.dataSources.d_c).toEqual({ data: {}, loading: true, error: null });
    expect(r.api.dataSources.d_d).toEqual({ data: [], loading: true, error: null });
    expect(r.nodes(byName(ext, 't').id)[0]).toHaveTextContent('Temp: (loading)');
    expect(r.nodes(byName(ext, 'd').id)[0]).toHaveTextContent('0 deals');
    await waitFor(() => expect(r.nodes(byName(ext, 't').id)[0]).toHaveTextContent('Temp: 21'));
    expect(r.nodes(byName(ext, 'c').id)[0]).toHaveTextContent('Hi Ada');
    expect(r.nodes(byName(ext, 'd').id)[0]).toHaveTextContent('3 deals');
  });

  it('shows an error (and logs it) for expressions that would crash the card on HubSpot', async () => {
    const { project, ext } = makeDoc([text('t', 'Temp: {{ weather.temperature }}'), text('first', 'First: {{ deals[0].properties.dealname }}')], {
      dataSources: [weather, deals],
    });
    ext.mock.dataSources.d_w = { temperature: 21 };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = renderDoc(project, ext);
    const box = r.nodes(byName(ext, 't').id)[0];
    expect(box).toHaveClass('hsp-rt-error');
    expect(box).toHaveTextContent("reading 'temperature'");
    expect(box).toHaveTextContent('On HubSpot this error stops the whole card');
    expect(r.nodes(byName(ext, 'first').id)[0]).toHaveClass('hsp-rt-error');
    expect(r.api.logs.filter((l) => l.level === 'error').map((l) => l.message).join('\n')).toMatch(/Text “t” could not be rendered: “weather.temperature” failed/);
    // Once the data has loaded the node renders normally.
    await waitFor(() => expect(r.nodes(byName(ext, 't').id)[0]).toHaveTextContent('Temp: 21'));
    expect(r.nodes(byName(ext, 't').id)[0]).not.toHaveClass('hsp-rt-error');
    spy.mockRestore();
  });

  it('design mode stays static: data is loaded and failing expressions degrade quietly', () => {
    const { project, ext } = makeDoc([text('t', 'Temp: {{ weather.temperature }}'), text('x', 'X {{ nope.y }}')], { dataSources: [weather] });
    ext.mock.dataSources.d_w = { temperature: 21 };
    const r = renderDoc(project, ext, { mode: 'design' });
    expect(r.nodes(byName(ext, 't').id)[0]).toHaveTextContent('Temp: 21');
    expect(r.nodes(byName(ext, 'x').id)[0]).toHaveTextContent('X');
    expect(r.nodes(byName(ext, 'x').id)[0]).not.toHaveClass('hsp-rt-error');
  });

  it('runs a request that reads record data only after that data has loaded', async () => {
    const api: DataSource = { id: 'd_api', kind: 'fetch', name: 'enrich', url: 'https://api.example.com/e?email={{ contact.email }}', method: 'GET', runOnMount: true };
    const { project, ext } = makeDoc([], { dataSources: [contact, api] });
    ext.mock.properties.email = 'ada@example.com';
    ext.mock.dataSources.d_api = { ok: true };
    const r = renderDoc(project, ext);
    await waitFor(() => expect(r.api.dataSources.d_api.loading).toBe(false));
    const request = r.api.logs.find((l) => l.message.startsWith('hubspot.fetch GET'));
    expect(request?.message).toBe('hubspot.fetch GET https://api.example.com/e?email=ada@example.com (on open)');
  });

  it('explains fetch sources without mock data', async () => {
    const { project, ext } = makeDoc([], { dataSources: [weather] });
    const r = renderDoc(project, ext);
    await waitFor(() => expect(r.api.logs.some((l) => l.level === 'warn' && /weather has no mock data/.test(l.message))).toBe(true));
  });
});

describe('simulated data states', () => {
  it('loading / empty / error per data source', () => {
    const { ext } = makeDoc([], { dataSources: [weather, contact, deals] });
    ext.mock.dataSources.d_w = { temperature: 21 };
    ext.mock.simulate = { d_w: 'loading', d_c: 'empty', d_d: 'error' };
    const ds = resolveDataSources(ext, {});
    expect(ds.d_w).toEqual({ data: null, loading: true, error: null });
    expect(ds.d_c).toEqual({ data: { firstname: null, email: null }, loading: false, error: null });
    expect(ds.d_d).toEqual({ data: [], loading: false, error: SIMULATED_ERROR });
  });
});

describe('context per location', () => {
  it('only app cards have context.crm', () => {
    const settings = makeDoc([text('t', 'Record {{ context.crm.objectId }}')], { kind: 'settings' });
    expect(buildContext(settings.project, settings.ext)).not.toHaveProperty('crm');
    const card = makeDoc([]);
    expect(buildContext(card.project, card.ext)).toHaveProperty('crm');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = renderDoc(settings.project, settings.ext);
    expect(r.nodes(byName(settings.ext, 't').id)[0]).toHaveClass('hsp-rt-error');
    spy.mockRestore();
  });
});

describe('formatted values', () => {
  it('formats currency, numbers, dates and option labels like propertiesToFormat', () => {
    expect(formatPropertyValue('amount', '48000')).toBe('$48,000.00');
    expect(formatPropertyValue('dealstage', 'contractsent')).toBe('Contract sent');
    expect(formatPropertyValue('lifecyclestage', 'customer')).toBe('Customer');
    expect(formatPropertyValue('hs_lead_status', 'IN_PROGRESS')).toBe('In progress');
    expect(formatPropertyValue('numberofemployees', '1200')).toBe('1,200');
    expect(formatPropertyValue('closedate', '2026-12-01T00:00:00.000Z')).toBe('12/1/2026');
    expect(formatPropertyValue('amount', '$1,000')).toBe('$1,000');
    expect(formatPropertyValue('firstname', 'Ada')).toBe('Ada');
  });

  it('applies to formatted CRM sources only', () => {
    const { ext } = makeDoc([]);
    const raw: DataSource = { id: 'a', kind: 'associations', name: 'deals', toObjectType: '0-3', properties: ['amount', 'dealstage'], pageLength: 1 };
    const rows = mockDataForSource(ext, raw) as Array<{ properties: Record<string, string> }>;
    expect(rows[0].properties).toEqual({ amount: '48000', dealstage: 'contractsent' });
    const formatted = mockDataForSource(ext, { ...raw, formatted: true } as DataSource) as Array<{ properties: Record<string, string> }>;
    expect(formatted[0].properties).toEqual({ amount: '$48,000.00', dealstage: 'Contract sent' });
    const props = mockDataForSource(ext, { id: 'p', kind: 'crmProperties', name: 'p', properties: ['amount'], formatted: true });
    expect(props).toEqual({ amount: '$125,000.00' });
  });
});

describe('alerts', () => {
  it('render above the card content and count repeats instead of stacking', async () => {
    const { project, ext } = makeDoc([text('first', 'First field')]);
    const r = renderDoc(project, ext);
    const add = () => r.api.runActions([{ id: 'a', type: 'addAlert', alertType: 'danger', title: 'Required', message: 'Fill in the name' }]);
    await act(add);
    await act(add);
    const alerts = screen.getAllByRole('alert').filter((a) => a.classList.contains('hsp-rt-alert'));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('×2');
    const content = r.nodes(byName(ext, 'first').id)[0];
    // The alert comes before the content in the document (pushes it down, never covers it).
    expect(alerts[0].compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('diagnostics in the console', () => {
  it('keeps one live entry per computed value while editing and removes it once fixed', async () => {
    const { project, ext } = makeDoc([], { state: [{ name: 'items', type: 'array', initial: ['a'] }] });
    ext.computed = [{ id: 'c1', name: 'filtered', expr: 'items.filter(i => i' }];
    const r = renderDoc(project, ext);
    const errors = () => r.api.logs.filter((l) => l.level === 'error');
    expect(errors()).toHaveLength(1);
    vi.useFakeTimers();
    for (const expr of ['items.filter(i => it', 'items.filter(i => ite', 'items.filter(i => matches(i, s))']) {
      r.update({ ext: { ...ext, computed: [{ id: 'c1', name: 'filtered', expr }] } });
      act(() => vi.advanceTimersByTime(100));
    }
    // Still the first message: nothing is reported while typing.
    expect(errors()).toHaveLength(1);
    act(() => vi.advanceTimersByTime(DIAGNOSTICS_DEBOUNCE_MS));
    expect(errors()).toHaveLength(1);
    expect(errors()[0].message).toMatch(/matches is not defined/);
    r.update({ ext: { ...ext, computed: [{ id: 'c1', name: 'filtered', expr: 'items.filter(Boolean)' }] } });
    act(() => vi.advanceTimersByTime(DIAGNOSTICS_DEBOUNCE_MS));
    expect(errors()).toHaveLength(0);
  });
});

describe('preview modal focus', () => {
  it('moves focus in, keeps Tab inside and returns focus to the trigger on close', async () => {
    const { project, ext } = makeDoc([
      {
        type: 'Button',
        name: 'open',
        text: 'Open',
        slots: {
          overlay: [
            {
              type: 'Modal',
              props: { id: 'm', title: 'Edit' },
              children: [{ type: 'ModalFooter', children: [{ type: 'Button', text: 'Save' }, { type: 'Button', text: 'Cancel' }] }],
            },
          ],
        },
      },
    ]);
    renderDoc(project, ext);
    const trigger = screen.getByRole('button', { name: 'Open' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toHaveFocus());
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Close' }), { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
  });
});

describe('fetch action requests', () => {
  it('sends headers and the timeout, and no body with GET', async () => {
    const original = globalThis.fetch;
    const calls: RequestInit[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      calls.push(init);
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    try {
      const { project, ext } = makeDoc([], { state: [{ name: 'token', type: 'string', initial: 'abc' }, { name: 'out', type: 'any', initial: 1 }] });
      const r = renderDoc(project, ext);
      await act(() =>
        r.api.runActions([
          {
            id: 'f',
            type: 'fetch',
            url: 'https://api.example.com/x',
            method: 'GET',
            body: '{ stale: true }',
            headers: [{ key: 'Authorization', value: 'Bearer {{ token }}' }],
            timeout: 2500,
            resultState: 'out',
          },
        ]),
      );
      expect(calls[0].method).toBe('GET');
      expect(calls[0].body).toBeUndefined();
      expect(calls[0].headers).toEqual({ Authorization: 'Bearer abc' });
      // 204 No Content -> null, like the exported readJson helper.
      expect(r.api.stateValues.out).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});
