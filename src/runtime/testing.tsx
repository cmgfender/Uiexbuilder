/**
 * Test helpers for the runtime (used by src/runtime/*.test.tsx only).
 * Builds projects from node templates and renders them inside a RuntimeProvider.
 */
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createExtension, createProject } from '../model/factory';
import type { DataSource, Extension, NodeTemplate, PreviewMockData, Project, StateVar, UINode } from '../model/types';
import { useRuntime } from './context';
import { ExtensionRenderer } from './NodeRenderer';
import { PreviewHost } from './PreviewHost';
import { RuntimeProvider } from './RuntimeProvider';
import type { LiveDataAdapter, RuntimeApi } from './types';

export interface TestDocOptions {
  state?: Array<Omit<StateVar, 'id'> & { id?: string }>;
  dataSources?: DataSource[];
  mock?: Partial<PreviewMockData>;
  kind?: Extension['kind'];
}

/** A project with one extension whose root holds `content`. */
export function makeDoc(content: NodeTemplate[], opts: TestDocOptions = {}): { project: Project; ext: Extension } {
  const ext = createExtension({ content, kind: opts.kind });
  ext.state = (opts.state ?? []).map((v, i) => ({ id: v.id ?? `s_${i}`, ...v }));
  ext.dataSources = opts.dataSources ?? [];
  if (opts.mock) ext.mock = { ...ext.mock, ...opts.mock };
  const project = createProject('Test App', [ext]);
  return { project, ext };
}

/** Finds a node by its layer name. */
export function byName(ext: Extension, name: string): UINode {
  const node = Object.values(ext.nodes).find((n) => n.name === name);
  if (!node) throw new Error(`No node named ${name}`);
  return node;
}

export interface RenderOptions {
  mode?: 'design' | 'preview';
  withHost?: boolean;
  resetKey?: number;
  /** Extra elements rendered inside the provider. */
  extra?: ReactNode;
  /** Live HubSpot data adapter (null = mock data). */
  live?: LiveDataAdapter | null;
}

/** Renders an extension inside a RuntimeProvider and exposes the live RuntimeApi. */
export function renderDoc(project: Project, ext: Extension, opts: RenderOptions = {}) {
  const ref: { api: RuntimeApi | null } = { api: null };
  function Capture() {
    ref.api = useRuntime();
    return null;
  }
  const ui = (p: Project, e: Extension, mode: 'design' | 'preview', resetKey: number, withHost: boolean, live: LiveDataAdapter | null) => (
    <RuntimeProvider project={p} extension={e} mode={mode} resetKey={resetKey} live={live}>
      <div className={`hsp-root ${mode === 'preview' ? 'hsp-live' : 'hsp-design'}`}>
        <div className="card-frame" style={{ position: 'relative' }}>
          <ExtensionRenderer />
          {withHost && <PreviewHost />}
        </div>
      </div>
      {opts.extra}
      <Capture />
    </RuntimeProvider>
  );
  const state = {
    project,
    ext,
    mode: opts.mode ?? 'preview',
    resetKey: opts.resetKey ?? 0,
    withHost: opts.withHost ?? true,
    live: opts.live ?? null,
  };
  const result = render(ui(state.project, state.ext, state.mode, state.resetKey, state.withHost, state.live));
  return {
    ...result,
    get api(): RuntimeApi {
      if (!ref.api) throw new Error('Runtime not rendered');
      return ref.api;
    },
    update(next: Partial<typeof state>) {
      Object.assign(state, next);
      result.rerender(ui(state.project, state.ext, state.mode, state.resetKey, state.withHost, state.live));
    },
    /** All rendered elements of a node (repeat copies included). */
    nodes(nodeId: string): HTMLElement[] {
      return Array.from(result.container.querySelectorAll<HTMLElement>(`[data-node-id="${nodeId}"]`));
    },
  };
}
