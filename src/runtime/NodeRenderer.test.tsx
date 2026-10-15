import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getComponent } from '../registry';
import type { NodeTemplate } from '../model/types';
import { RUNTIME_TIMING } from './actions';
import { useRuntime } from './context';
import { NodeRenderer } from './NodeRenderer';
import { byName, makeDoc, renderDoc } from './testing';

const ORIGINAL_TIMING = { ...RUNTIME_TIMING };
beforeEach(() => {
  Object.assign(RUNTIME_TIMING, { dataSourceLatencyMs: 10, functionLatencyMs: 10 });
});
afterEach(() => {
  cleanup();
  Object.assign(RUNTIME_TIMING, ORIGINAL_TIMING);
});

const text = (name: string, value: string, extra: Partial<NodeTemplate> = {}): NodeTemplate => ({
  type: 'Text',
  name,
  text: value,
  ...extra,
});

describe('NodeRenderer — resolution', () => {
  it('interpolates templates in text from the mock context', () => {
    const { project, ext } = makeDoc([text('greeting', 'Hello {{ context.user.firstName }}!')]);
    const r = renderDoc(project, ext, { mode: 'design' });
    const el = r.nodes(byName(ext, 'greeting').id)[0];
    expect(el).toHaveTextContent('Hello Jordan!');
    expect(el).toHaveAttribute('data-node-type', 'Text');
  });

  it('resolves expression and template props', () => {
    const { project, ext } = makeDoc(
      [
        text('micro', 'Small print', { props: { variant: { $expr: "isSmall ? 'microcopy' : 'bodytext'" } } }),
        text('inline', 'Inline', { props: { inline: '{{ count > 1 }}' } }),
      ],
      {
        state: [
          { name: 'isSmall', type: 'boolean', initial: true },
          { name: 'count', type: 'number', initial: 2 },
        ],
      },
    );
    const r = renderDoc(project, ext, { mode: 'design' });
    expect(r.nodes(byName(ext, 'micro').id)[0]).toHaveClass('hsp-microcopy');
    // A single {{ }} segment yields the raw boolean -> rendered inline (span).
    expect(r.nodes(byName(ext, 'inline').id)[0].tagName).toBe('SPAN');
  });

  it('renders nested children and a drop placeholder for empty containers in design mode only', () => {
    const { project, ext } = makeDoc([
      { type: 'Flex', name: 'outer', children: [text('inner', 'Inside')] },
      { type: 'Flex', name: 'empty' },
    ]);
    const r = renderDoc(project, ext, { mode: 'design' });
    const outer = r.nodes(byName(ext, 'outer').id)[0];
    expect(outer.querySelector(`[data-node-id="${byName(ext, 'inner').id}"]`)).toHaveTextContent('Inside');
    const emptyId = byName(ext, 'empty').id;
    const placeholder = r.container.querySelector(`[data-drop-placeholder-for="${emptyId}"]`);
    expect(placeholder).toHaveTextContent('Drop components here');
    expect(r.nodes(emptyId)[0]).toContainElement(placeholder as HTMLElement);

    r.update({ mode: 'preview' });
    expect(r.container.querySelector('[data-drop-placeholder-for]')).toBeNull();
  });

  it('shows the empty-card placeholder for an empty root in design mode', () => {
    const { project, ext } = makeDoc([]);
    const r = renderDoc(project, ext, { mode: 'design' });
    expect(r.container.querySelector(`[data-drop-placeholder-for="${ext.rootId}"]`)).toHaveTextContent(
      'Drag components here to start building your card',
    );
  });

  it('shows a selectable error box for unknown component types', () => {
    const { project, ext } = makeDoc([{ type: 'NotAComponent', name: 'bad' }]);
    const r = renderDoc(project, ext, { mode: 'design' });
    const box = r.nodes(byName(ext, 'bad').id)[0];
    expect(box).toHaveClass('hsp-rt-error');
    expect(box).toHaveTextContent('Unknown component type "NotAComponent"');
  });

  it('does not render hiddenInDesigner nodes in design mode', () => {
    const { project, ext } = makeDoc([text('hidden', 'Secret')]);
    byName(ext, 'hidden').hiddenInDesigner = true;
    const r = renderDoc(project, ext, { mode: 'design' });
    expect(r.nodes(byName(ext, 'hidden').id)).toHaveLength(0);
    r.update({ mode: 'preview' });
    expect(r.nodes(byName(ext, 'hidden').id)).toHaveLength(1);
  });
});

describe('NodeRenderer — condition & repeat', () => {
  it('skips falsy conditions in preview and flags them in design mode', () => {
    const { project, ext } = makeDoc(
      [text('maybe', 'Maybe', { condition: 'show' }), text('always', 'Always', { condition: '!show' })],
      { state: [{ name: 'show', type: 'boolean', initial: false }] },
    );
    const r = renderDoc(project, ext, { mode: 'design' });
    const maybe = r.nodes(byName(ext, 'maybe').id);
    expect(maybe).toHaveLength(1);
    expect(maybe[0]).toHaveAttribute('data-uiex-cond', 'false');
    expect(r.nodes(byName(ext, 'always').id)[0]).not.toHaveAttribute('data-uiex-cond');

    r.update({ mode: 'preview' });
    expect(r.nodes(byName(ext, 'maybe').id)).toHaveLength(0);
    expect(r.nodes(byName(ext, 'always').id)).toHaveLength(1);

    act(() => r.api.setStateValue('show', true));
    expect(r.nodes(byName(ext, 'maybe').id)).toHaveLength(1);
    expect(r.nodes(byName(ext, 'always').id)).toHaveLength(0);
  });

  it('renders one copy per item, flagging clones after the first', () => {
    const { project, ext } = makeDoc(
      [text('row', '{{ index + 1 }}. {{ fruit.name }}', { repeat: { items: 'fruits', itemName: 'fruit', indexName: 'index', key: 'fruit.name' } })],
      { state: [{ name: 'fruits', type: 'array', initial: [{ name: 'Apple' }, { name: 'Pear' }, { name: 'Plum' }] }] },
    );
    const r = renderDoc(project, ext, { mode: 'design' });
    const copies = r.nodes(byName(ext, 'row').id);
    expect(copies.map((c) => c.textContent)).toEqual(['1. Apple', '2. Pear', '3. Plum']);
    expect(copies[0]).not.toHaveAttribute('data-uiex-clone');
    expect(copies[1]).toHaveAttribute('data-uiex-clone', '1');
    expect(copies[2]).toHaveAttribute('data-uiex-clone', '2');

    r.update({ mode: 'preview' });
    expect(r.nodes(byName(ext, 'row').id)).toHaveLength(3);
  });

  it('passes repeat variables to descendants', () => {
    const { project, ext } = makeDoc(
      [
        {
          type: 'Flex',
          name: 'card',
          repeat: { items: '[1, 2]', itemName: 'n', indexName: 'i' },
          children: [text('label', 'n={{ n }} i={{ i }}')],
        },
      ],
      {},
    );
    const r = renderDoc(project, ext, { mode: 'preview' });
    expect(r.nodes(byName(ext, 'label').id).map((e) => e.textContent)).toEqual(['n=1 i=0', 'n=2 i=1']);
  });

  it('draws a stand-in for empty / invalid repeats in design mode only', () => {
    const { project, ext } = makeDoc([
      text('none', 'Empty {{ item }}', { repeat: { items: '[]', itemName: 'item', indexName: 'index' } }),
      text('broken', 'Broken', { repeat: { items: 'doesNotExist.list', itemName: 'item', indexName: 'index' } }),
    ]);
    const r = renderDoc(project, ext, { mode: 'design' });
    for (const name of ['none', 'broken']) {
      const copies = r.nodes(byName(ext, name).id);
      expect(copies).toHaveLength(1);
      expect(copies[0]).toHaveAttribute('data-uiex-repeat-empty', 'true');
      expect(copies[0]).not.toHaveAttribute('data-uiex-clone');
    }
    r.update({ mode: 'preview' });
    expect(r.nodes(byName(ext, 'none').id)).toHaveLength(0);
    expect(r.nodes(byName(ext, 'broken').id)).toHaveLength(0);
  });

  it('caps design-mode repeats to keep the canvas fast', () => {
    const { project, ext } = makeDoc([text('many', '{{ item }}', { repeat: { items: 'Array.from({ length: 500 }, (_, i) => i)', itemName: 'item', indexName: 'index' } })]);
    const r = renderDoc(project, ext, { mode: 'design' });
    expect(r.nodes(byName(ext, 'many').id)).toHaveLength(50);
  });
});

describe('Runtime — state & actions', () => {
  it('runs setState steps with snapshot semantics', async () => {
    const { project, ext } = makeDoc(
      [
        text('display', 'Count: {{ count }}, doubled: {{ doubled }}', {
          events: {
            onClick: [
              { id: 'a1', type: 'setState', state: 'count', value: 'count + 1' },
              // Sees the snapshot (count is still 1), exactly like a React handler.
              { id: 'a2', type: 'setState', state: 'doubled', value: 'count * 2' },
            ],
          },
        }),
      ],
      {
        state: [
          { name: 'count', type: 'number', initial: 1 },
          { name: 'doubled', type: 'number', initial: 0 },
        ],
      },
    );
    const r = renderDoc(project, ext);
    const id = byName(ext, 'display').id;
    act(() => r.api.fireEvent(id, 'onClick', [{}]));
    await waitFor(() => expect(r.api.stateValues).toEqual({ count: 2, doubled: 2 }));
    expect(r.nodes(id)[0]).toHaveTextContent('Count: 2, doubled: 2');

    act(() => r.api.fireEvent(id, 'onClick', [{}]));
    await waitFor(() => expect(r.api.stateValues).toEqual({ count: 3, doubled: 4 }));
  });

  it('runs if / else branches', async () => {
    const { project, ext } = makeDoc([text('t', '{{ size }}')], {
      state: [
        { name: 'count', type: 'number', initial: 3 },
        { name: 'size', type: 'string', initial: '' },
      ],
    });
    const r = renderDoc(project, ext);
    const steps = [
      {
        id: 'if1',
        type: 'if' as const,
        condition: 'count > 5',
        then: [{ id: 't1', type: 'setState' as const, state: 'size', value: "'big'" }],
        else: [{ id: 'e1', type: 'setState' as const, state: 'size', value: "'small'" }],
      },
    ];
    await act(() => r.api.runActions(steps));
    expect(r.api.stateValues.size).toBe('small');
    act(() => r.api.setStateValue('count', 10));
    await act(() => r.api.runActions(steps));
    expect(r.api.stateValues.size).toBe('big');
  });

  it('binds event params into the handler scope', async () => {
    const { project, ext } = makeDoc([text('t', 'x')], { state: [{ name: 'last', type: 'any', initial: null }] });
    const r = renderDoc(project, ext);
    await act(() => r.api.runActions([{ id: 's', type: 'setState', state: 'last', value: 'value * 10' }], { value: 4 }));
    expect(r.api.stateValues.last).toBe(40);
  });

  it('aborts the handler and logs when an expression fails', async () => {
    const { project, ext } = makeDoc([], {
      state: [
        { name: 'a', type: 'number', initial: 0 },
        { name: 'b', type: 'number', initial: 0 },
      ],
    });
    const r = renderDoc(project, ext);
    await act(() =>
      r.api.runActions([
        { id: '1', type: 'setState', state: 'a', value: 'missing.value' },
        { id: '2', type: 'setState', state: 'b', value: '1' },
      ]),
    );
    expect(r.api.stateValues).toEqual({ a: 0, b: 0 });
    const errors = r.api.logs.filter((l) => l.level === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Set a');
  });

  it('shows alerts in PreviewHost with interpolated text, dismissable and auto-dismissed', async () => {
    Object.assign(RUNTIME_TIMING, { alertDismissMs: 150 });
    const { project, ext } = makeDoc([], { state: [{ name: 'count', type: 'number', initial: 7 }] });
    const r = renderDoc(project, ext);
    await act(() =>
      r.api.runActions([
        { id: 'al', type: 'addAlert', alertType: 'success', title: 'Saved {{ count }} items', message: 'Hi {{ context.user.firstName }}' },
      ]),
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('hsp-rt-alert', 'hsp-rt-alert-success');
    expect(alert).toHaveTextContent('Saved 7 items');
    expect(alert).toHaveTextContent('Hi Jordan');
    expect(alert.closest('.hsp-overlay-host')).not.toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss alert' }));
    expect(screen.queryByRole('alert')).toBeNull();

    await act(() => r.api.runActions([{ id: 'al2', type: 'addAlert', alertType: 'danger', title: '', message: 'Oops' }]));
    expect(screen.getByRole('alert')).toHaveClass('hsp-rt-alert-danger');
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('simulates reload / refresh with an info alert and log entry', async () => {
    const { project, ext } = makeDoc([]);
    const r = renderDoc(project, ext);
    await act(() => r.api.runActions([{ id: 'r', type: 'reloadPage' }]));
    expect(screen.getByRole('alert')).toHaveTextContent('(simulated)');
    expect(r.api.logs.some((l) => l.message.includes('Reload page (simulated)'))).toBe(true);
  });

  it('opens and closes the iframe modal', async () => {
    const { project, ext } = makeDoc([]);
    const r = renderDoc(project, ext);
    await act(() =>
      r.api.runActions([
        { id: 'i', type: 'openIframeModal', uri: 'https://example.com/?u={{ context.user.id }}', title: 'Docs for {{ context.user.firstName }}', width: 400, height: 300 },
      ]),
    );
    const dialog = screen.getByRole('dialog', { name: 'Docs for Jordan' });
    expect(dialog.querySelector('iframe')).toHaveAttribute('src', 'https://example.com/?u=1001');
    expect(r.api.iframeModal).toMatchObject({ width: 400, height: 300 });
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('refuses non-http iframe URLs', async () => {
    const { project, ext } = makeDoc([]);
    const r = renderDoc(project, ext);
    await act(() => r.api.runActions([{ id: 'i', type: 'openIframeModal', uri: 'javascript:alert(1)', title: 'Bad', width: 400, height: 300 }]));
    expect(screen.getByRole('dialog').querySelector('iframe')).toBeNull();
    expect(screen.getByRole('dialog')).toHaveTextContent('only http(s) URLs');
  });

  it('logs with interpolated messages and copies to the clipboard', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (t: string) => void written.push(t) },
    });
    const { project, ext } = makeDoc([]);
    const r = renderDoc(project, ext);
    await act(() =>
      r.api.runActions([
        { id: 'l', type: 'log', level: 'warn', message: 'User {{ context.user.id }}' },
        { id: 'c', type: 'copyToClipboard', text: '{{ context.user.email }}' },
      ]),
    );
    expect(r.api.logs.some((l) => l.level === 'warn' && l.message === 'User 1001')).toBe(true);
    expect(written).toEqual(['jordan.lee@example.com']);
  });

  it('runs custom code with setters, actions and logger; errors are logged and abort', async () => {
    const { project, ext } = makeDoc([], {
      state: [
        { name: 'count', type: 'number', initial: 1 },
        { name: 'after', type: 'boolean', initial: false },
      ],
    });
    const r = renderDoc(project, ext);
    await act(() =>
      r.api.runActions([
        {
          id: 'c1',
          type: 'custom',
          code: `
            setCount((c) => c + 5);
            actions.addAlert({ type: 'warning', title: 'From code', message: 'count was ' + count });
            logger.info('custom ran', { count });
            const props = await actions.fetchCrmObjectProperties(['firstname']);
            logger.debug(props.firstname);
          `,
        },
      ]),
    );
    expect(r.api.stateValues.count).toBe(6);
    expect(screen.getByRole('alert')).toHaveTextContent('count was 1');
    expect(r.api.logs.some((l) => l.level === 'info' && l.message === 'custom ran {"count":1}')).toBe(true);
    expect(r.api.logs.some((l) => l.level === 'debug' && l.message === 'Ada')).toBe(true);

    await act(() =>
      r.api.runActions([
        { id: 'c2', type: 'custom', code: 'throw new Error("boom")' },
        { id: 's', type: 'setState', state: 'after', value: 'true' },
      ]),
    );
    expect(r.api.stateValues.after).toBe(false);
    expect(r.api.logs.some((l) => l.level === 'error' && l.message.includes('boom'))).toBe(true);
  });

  it('runs app functions against mock results', async () => {
    const { project, ext } = makeDoc([], {
      state: [
        { name: 'result', type: 'any', initial: null },
        { name: 'msg', type: 'string', initial: '' },
      ],
    });
    project.functions.push({ id: 'f_1', uid: 'get_stats', fileName: 'getStats', code: '', secretKeys: [] });
    ext.mock.functions.f_1 = { total: 42 };
    const r = renderDoc(project, ext);
    await act(() =>
      r.api.runActions([
        {
          id: 'rf',
          type: 'runFunction',
          functionId: 'f_1',
          parameters: '{ id: context.crm.objectId }',
          resultState: 'result',
          onSuccess: [{ id: 's', type: 'setState', state: 'msg', value: '"total " + response.total' }],
        },
      ]),
    );
    expect(r.api.stateValues).toEqual({ result: { total: 42 }, msg: 'total 42' });
    expect(r.api.logs.some((l) => l.message.includes("hubspot.serverless('get_stats')"))).toBe(true);

    delete ext.mock.functions.f_1;
    await act(() =>
      r.api.runActions([{ id: 'rf2', type: 'runFunction', functionId: 'f_1', resultState: 'result' }]),
    );
    expect(r.api.stateValues.result).toEqual({ ok: true });

    // Parameter errors run the onError steps with `error` in scope.
    await act(() =>
      r.api.runActions([
        {
          id: 'rf3',
          type: 'runFunction',
          functionId: 'f_1',
          parameters: 'nope.x',
          onError: [{ id: 'e', type: 'setState', state: 'msg', value: '"failed: " + (error instanceof Error)' }],
        },
      ]),
    );
    expect(r.api.stateValues.msg).toBe('failed: true');
  });

  it('refetches data sources with a loading phase and fresh mock data', async () => {
    const { project, ext } = makeDoc([text('t', '{{ quoteLoading ? "Loading…" : (quote ? quote.text : "none") }}')], {
      dataSources: [{ id: 'd1', name: 'quote', kind: 'fetch', url: 'https://x.example', method: 'GET', runOnMount: false }],
    });
    ext.mock.dataSources.d1 = { text: 'Stay hungry' };
    const r = renderDoc(project, ext);
    const id = byName(ext, 't').id;
    expect(r.nodes(id)[0]).toHaveTextContent('none');
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = r.api.runDataSource('d1');
    });
    expect(r.api.dataSources.d1.loading).toBe(true);
    expect(r.nodes(id)[0]).toHaveTextContent('Loading…');
    await act(() => done);
    expect(r.api.dataSources.d1).toEqual({ data: { text: 'Stay hungry' }, loading: false, error: null });
    expect(r.nodes(id)[0]).toHaveTextContent('Stay hungry');
  });

  it('calls real fetch, stores the JSON response and runs onSuccess', async () => {
    const original = globalThis.fetch;
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true, echo: JSON.parse(String(init.body)) }), { status: 200 });
    }) as typeof fetch;
    try {
      const { project, ext } = makeDoc([], {
        state: [
          { name: 'data', type: 'any', initial: null },
          { name: 'email', type: 'string', initial: 'a@b.c' },
        ],
      });
      const r = renderDoc(project, ext);
      await act(() =>
        r.api.runActions([
          {
            id: 'f',
            type: 'fetch',
            url: 'https://api.example.com/users/{{ context.user.id }}',
            method: 'POST',
            body: '{ email }',
            resultState: 'data',
            onSuccess: [{ id: 'a', type: 'addAlert', alertType: 'success', title: 'Done', message: '{{ response.echo.email }}' }],
          },
        ]),
      );
      expect(calls[0].url).toBe('https://api.example.com/users/1001');
      expect(calls[0].init.method).toBe('POST');
      expect(r.api.stateValues.data).toEqual({ ok: true, echo: { email: 'a@b.c' } });
      expect(screen.getByRole('alert')).toHaveTextContent('a@b.c');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('explains CORS failures and runs onError', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    try {
      const { project, ext } = makeDoc([], { state: [{ name: 'err', type: 'string', initial: '' }] });
      const r = renderDoc(project, ext);
      await act(() =>
        r.api.runActions([
          {
            id: 'f',
            type: 'fetch',
            url: 'https://blocked.example.com',
            method: 'GET',
            onError: [{ id: 'e', type: 'setState', state: 'err', value: 'error.message' }],
          },
        ]),
      );
      expect(r.api.stateValues.err).toContain('Failed to fetch');
      const log = r.api.logs.find((l) => l.level === 'error');
      expect(log?.message).toContain('proxied by HubSpot');
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('Runtime — lifecycle', () => {
  it('keeps unchanged state values when definitions change and resets on resetKey', () => {
    const { project, ext } = makeDoc([], {
      state: [
        { id: 's1', name: 'count', type: 'number', initial: 0 },
        { id: 's2', name: 'label', type: 'string', initial: 'a' },
      ],
    });
    const r = renderDoc(project, ext);
    act(() => {
      r.api.setStateValue('count', 5);
      r.api.setStateValue('label', 'changed');
    });
    const ext2 = { ...ext, state: [ext.state[0], { ...ext.state[1], initial: 'b' }, { id: 's3', name: 'flag', type: 'boolean' as const, initial: true }] };
    r.update({ ext: ext2 });
    expect(r.api.stateValues).toEqual({ count: 5, label: 'b', flag: true });

    r.update({ resetKey: 1 });
    expect(r.api.stateValues).toEqual({ count: 0, label: 'b', flag: true });

    act(() => r.api.setStateValue('count', 9));
    act(() => r.api.reset());
    expect(r.api.stateValues.count).toBe(0);
  });

  it('ignores unknown state names and supports updater functions', () => {
    const { project, ext } = makeDoc([], { state: [{ name: 'n', type: 'number', initial: 1 }] });
    const r = renderDoc(project, ext);
    act(() => {
      r.api.setStateValue('ghost', 1);
      r.api.setStateValue('n', (v: number) => v + 1);
    });
    expect(r.api.stateValues).toEqual({ n: 2 });
  });

  it('throws a helpful error when useRuntime is used outside a provider', () => {
    function Orphan() {
      useRuntime();
      return null;
    }
    // React reports render errors through console.error and window error events; keep output quiet.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const swallow = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', swallow);
    try {
      expect(() => render(<Orphan />)).toThrow(/useRuntime\(\) must be used inside <RuntimeProvider/);
      expect(() => render(<NodeRenderer nodeId="x" />)).toThrow(/<NodeRenderer> must be used inside <RuntimeProvider/);
    } finally {
      window.removeEventListener('error', swallow);
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Interactions with real registry components.
// ---------------------------------------------------------------------------

describe('Runtime — component interactions', () => {
  it('two-way binding updates the bound state', async () => {
    const { project, ext } = makeDoc(
      [
        { type: 'Input', name: 'nameInput', props: { name: 'name', label: 'Name' }, binding: { state: 'name' } },
        text('echo', 'Hello {{ name }}'),
      ],
      { state: [{ name: 'name', type: 'string', initial: 'Ada' }] },
    );
    const r = renderDoc(project, ext);
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('Ada');
    await userEvent.clear(input);
    await userEvent.type(input, 'Grace');
    await userEvent.tab(); // HubSpot Input fires onChange on blur
    expect(r.api.stateValues.name).toBe('Grace');
    expect(r.nodes(byName(ext, 'echo').id)[0]).toHaveTextContent('Hello Grace');

    // Programmatic change through fireEvent: binding first, then the handler sees `value`.
    act(() => r.api.fireEvent(byName(ext, 'nameInput').id, 'onChange', ['Linus']));
    expect(r.api.stateValues.name).toBe('Linus');
    expect(input).toHaveValue('Linus');
  });

  it('runs onClick actions of a button in preview mode only', async () => {
    const { project, ext } = makeDoc(
      [
        {
          type: 'Button',
          name: 'inc',
          text: 'Add',
          events: { onClick: [{ id: 'a', type: 'setState', state: 'count', value: 'count + 1' }] },
        },
      ],
      { state: [{ name: 'count', type: 'number', initial: 0 }] },
    );
    const r = renderDoc(project, ext, { mode: 'design' });
    const designEl = r.nodes(byName(ext, 'inc').id)[0];
    designEl.click();
    expect(r.api.stateValues.count).toBe(0);

    r.update({ mode: 'preview' });
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(r.api.stateValues.count).toBe(1));
  });

  it(
    'opens a Modal overlay from its trigger and closes it with closeOverlay',
    async () => {
      const modal = getComponent('Modal')!.create!();
      const { project, ext } = makeDoc([{ type: 'Button', name: 'open', text: 'Open', slots: { overlay: [{ ...modal, name: 'dialog' }] } }]);
      const r = renderDoc(project, ext);
      const dialogNode = byName(ext, 'dialog');
      // Overlay slot content is never rendered inline.
      expect(r.nodes(dialogNode.id)).toHaveLength(0);

      await userEvent.click(screen.getByRole('button', { name: 'Open' }));
      expect(r.api.openOverlays).toEqual([dialogNode.id]);
      const dialog = await screen.findByRole('dialog');
      expect(dialog.closest('.hsp-overlay-host')).not.toBeNull();

      // Close by the overlay's `id` prop, as actions.closeOverlay(id) does.
      act(() => r.api.closeOverlay(String(dialogNode.props.id)));
      expect(screen.queryByRole('dialog')).toBeNull();

      // The template's footer buttons close it with a closeOverlay step.
      await userEvent.click(screen.getByRole('button', { name: 'Open' }));
      const cancel = await screen.findByRole('button', { name: 'Cancel' });
      await userEvent.click(cancel);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(r.api.openOverlays).toEqual([]);
    },
  );

  it(
    'gives overlays the repeat scope of their trigger and runs the overlay onClose handler',
    async () => {
      const { project, ext } = makeDoc(
        [
          {
            type: 'Button',
            name: 'rowButton',
            text: 'Edit {{ person }}',
            repeat: { items: "['Ada', 'Grace']", itemName: 'person', indexName: 'i' },
            slots: {
              overlay: [
                {
                  type: 'Modal',
                  name: 'editor',
                  props: { id: 'edit-person', title: 'Editing {{ person }}' },
                  events: { onClose: [{ id: 'c', type: 'setState', state: 'closed', value: 'closed + 1' }] },
                  children: [{ type: 'Text', name: 'body', text: 'Person #{{ i + 1 }}' }],
                },
              ],
            },
          },
        ],
        { state: [{ name: 'closed', type: 'number', initial: 0 }] },
      );
      const r = renderDoc(project, ext);
      await userEvent.click(screen.getByRole('button', { name: 'Edit Grace' }));
      const dialog = await screen.findByRole('dialog', { name: 'Editing Grace' });
      expect(dialog).toHaveTextContent('Person #2');

      // Let the open transition finish (onOpen), then close: the Modal reports onClose on unmount.
      await new Promise((resolve) => setTimeout(resolve, 250));
      act(() => r.api.closeOverlay('edit-person'));
      await waitFor(() => expect(r.api.stateValues.closed).toBe(1));
    },
  );

  it('shows a Tooltip bubble on hover', async () => {
    const { project, ext } = makeDoc([
      {
        type: 'Button',
        name: 'help',
        text: 'Help',
        condition: 'visible',
        slots: { overlay: [{ type: 'Tooltip', name: 'tip', text: 'Hi {{ context.user.firstName }}' }] },
      },
    ], { state: [{ name: 'visible', type: 'boolean', initial: true }] });
    const r = renderDoc(project, ext);
    const button = screen.getByRole('button', { name: 'Help' });
    expect(button).not.toHaveAttribute('title'); // PreviewHost draws the bubble instead
    await userEvent.hover(button);
    const bubble = r.container.querySelector('.hsp-rt-tooltip');
    expect(bubble).toHaveTextContent('Hi Jordan');
    expect(bubble).toHaveAttribute('data-tooltip-for', byName(ext, 'help').id);
    await userEvent.unhover(button);
    expect(r.container.querySelector('.hsp-rt-tooltip')).toBeNull();

    // A trigger hidden while hovered takes its bubble with it.
    await userEvent.hover(button);
    expect(r.container.querySelector('.hsp-rt-tooltip')).not.toBeNull();
    act(() => r.api.setStateValue('visible', false));
    expect(r.container.querySelector('.hsp-rt-tooltip')).toBeNull();
  });

  it('falls back to a title attribute without PreviewHost', () => {
    const { project, ext } = makeDoc([
      { type: 'Button', name: 'help', text: 'Help', slots: { overlay: [{ type: 'Tooltip', text: 'Tip text' }] } },
    ]);
    renderDoc(project, ext, { withHost: false });
    expect(screen.getByRole('button', { name: 'Help' })).toHaveAttribute('title', 'Tip text');
  });
});
