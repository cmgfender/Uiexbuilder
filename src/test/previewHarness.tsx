/**
 * Test helper: renders a registry component's preview in isolation (no runtime), the same way
 * the NodeRenderer would, using a node built from the component's `create()` template.
 */
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ComponentDef, PreviewProps } from '../registry/types';
import type { NodeTemplate, UINode } from '../model/types';

export interface HarnessOptions {
  mode?: 'design' | 'preview';
  /** Override props (defaults to the create() template props). */
  props?: Record<string, unknown>;
  text?: string;
  children?: ReactNode;
  trigger?: PreviewProps['trigger'];
  overlay?: PreviewProps['overlay'];
}

export function templateFor(def: ComponentDef): NodeTemplate {
  if (def.create) return def.create();
  if (def.children.mode === 'text') return { type: def.type, text: def.children.defaultText ?? def.label };
  return { type: def.type };
}

export function renderPreview(def: ComponentDef, opts: HarnessOptions = {}) {
  const tpl = templateFor(def);
  const node: UINode = {
    id: 'n_test',
    type: def.type,
    props: (tpl.props ?? {}) as UINode['props'],
    text: tpl.text,
    children: [],
  };
  const Preview = def.preview;
  const result = render(
    <div className={`hsp-root ${opts.mode === 'preview' ? 'hsp-live' : 'hsp-design'}`}>
      <div className="hsp-overlay-host" style={{ position: 'relative' }}>
        <Preview
          node={node}
          props={(opts.props ?? node.props) as Record<string, unknown>}
          text={opts.text ?? node.text ?? ''}
          slots={{}}
          mode={opts.mode ?? 'design'}
          rootProps={{ 'data-node-id': node.id, 'data-node-type': def.type }}
          trigger={opts.trigger ?? (() => {})}
          overlay={opts.overlay}
        >
          {opts.children}
        </Preview>
      </div>
    </div>,
  );
  const root = result.container.querySelector('[data-node-id="n_test"]');
  return { ...result, root, node };
}
