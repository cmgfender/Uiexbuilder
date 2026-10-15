/**
 * Error boundary behaviour: a preview that throws renders a small red box carrying the node's
 * data-node-id (so the canvas can still select / delete it) without affecting its siblings.
 * The registry is wrapped to add a test-only component whose preview throws on demand.
 */
import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TypeIcon } from 'lucide-react';
import type { ComponentDef, PreviewProps } from '../registry/types';
import { byName, makeDoc, renderDoc } from './testing';

vi.mock('../registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../registry')>();
  function BoomPreview({ props, rootProps }: PreviewProps) {
    if (props.explode) throw new Error(`Boom: ${String(props.explode)}`);
    return <div {...rootProps}>fine</div>;
  }
  const boom: ComponentDef = {
    type: 'TestBoom',
    label: 'Boom',
    category: 'Layout',
    description: 'Test component that throws when `explode` is truthy.',
    icon: TypeIcon,
    importFrom: '@hubspot/ui-extensions',
    props: [],
    children: { mode: 'none' },
    preview: BoomPreview,
  };
  return {
    ...actual,
    getComponent: (type: string) => (type === 'TestBoom' ? boom : actual.getComponent(type)),
  };
});

const swallow = (e: ErrorEvent) => e.preventDefault();
beforeEach(() => {
  // React logs caught render errors; keep test output readable.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  window.addEventListener('error', swallow);
});
afterEach(() => {
  cleanup();
  window.removeEventListener('error', swallow);
  vi.restoreAllMocks();
});

describe('NodeRenderer error boundary', () => {
  it('renders a selectable error box for a throwing preview and keeps siblings', () => {
    const { project, ext } = makeDoc(
      [
        { type: 'TestBoom', name: 'bad', props: { explode: { $expr: 'reason' } } },
        { type: 'Text', name: 'ok', text: 'Still here' },
      ],
      { state: [{ name: 'reason', type: 'string', initial: 'bad input' }] },
    );
    const r = renderDoc(project, ext, { mode: 'design' });
    const bad = r.nodes(byName(ext, 'bad').id);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toHaveClass('hsp-rt-error');
    expect(bad[0]).toHaveAttribute('data-node-type', 'TestBoom');
    expect(bad[0]).toHaveTextContent('Boom could not be rendered: Boom: bad input');
    expect(r.nodes(byName(ext, 'ok').id)[0]).toHaveTextContent('Still here');
  });

  it('retries rendering when the inputs change', () => {
    const { project, ext } = makeDoc([{ type: 'TestBoom', name: 'bad', props: { explode: { $expr: 'reason' } } }], {
      state: [{ name: 'reason', type: 'string', initial: 'x' }],
    });
    const r = renderDoc(project, ext);
    const id = byName(ext, 'bad').id;
    expect(r.nodes(id)[0]).toHaveClass('hsp-rt-error');
    act(() => r.api.setStateValue('reason', ''));
    expect(r.nodes(id)[0]).not.toHaveClass('hsp-rt-error');
    expect(r.nodes(id)[0]).toHaveTextContent('fine');
  });

  it('isolates failures per repeat copy', () => {
    const { project, ext } = makeDoc([
      {
        type: 'TestBoom',
        name: 'rows',
        props: { explode: '{{ item.bad }}' },
        repeat: { items: '[{ bad: false }, { bad: "yes" }, { bad: false }]', itemName: 'item', indexName: 'index' },
      },
    ]);
    const r = renderDoc(project, ext, { mode: 'design' });
    const copies = r.nodes(byName(ext, 'rows').id);
    expect(copies.map((c) => c.classList.contains('hsp-rt-error'))).toEqual([false, true, false]);
    expect(copies[1]).toHaveAttribute('data-uiex-clone', '1');
  });
});
