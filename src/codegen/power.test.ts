/**
 * Codegen of power features: computed values, helper code and generateNodeJsx.
 * (The strict type-check of a project using them is the 'power' case in typecheck.test.ts.)
 */
import { describe, expect, it } from 'vitest';
import { createExtension, createProject } from '../model/factory';
import type { ActionStep, ComputedValue, DataSource, Extension, NodeTemplate, Project, StateVar } from '../model/types';
import { createPowerProject } from './fixtures';
import { generateExtensionSource, generateNodeJsx } from './index';

interface Doc {
  project: Project;
  ext: Extension;
}

function doc(
  content: NodeTemplate[],
  opts: { state?: StateVar[]; dataSources?: DataSource[]; computed?: ComputedValue[]; helpers?: string } = {},
): Doc {
  const project = createProject('Test App', []);
  const ext = createExtension({ name: 'Test', content });
  ext.state = opts.state ?? [];
  ext.dataSources = opts.dataSources ?? [];
  if (opts.computed) ext.computed = opts.computed;
  if (opts.helpers !== undefined) ext.helpers = opts.helpers;
  project.extensions = [ext];
  return { project, ext };
}

const gen = (d: Doc) => generateExtensionSource(d.project, d.ext);
const st = (name: string, type: StateVar['type'], initial: StateVar['initial']): StateVar => ({ id: `s_${name}`, name, type, initial });
const cv = (id: string, name: string, expr: string, description?: string): ComputedValue => ({ id, name, expr, ...(description ? { description } : {}) });
let n = 0;
const step = (s: Record<string, unknown>): ActionStep => ({ id: `a_${++n}`, ...s }) as unknown as ActionStep;
const byName = (ext: Extension, name: string) => Object.values(ext.nodes).find((x) => x.name === name)!.id;

describe('computed values', () => {
  it('are declared in order after state and data sources and before handlers', () => {
    const d = doc(
      [{ type: 'Button', text: '{{ label }}', events: { onClick: [step({ type: 'setState', state: 'count', value: 'next' })] } }],
      {
        state: [st('count', 'number', 1)],
        dataSources: [{ id: 'd1', kind: 'crmProperties', name: 'contact', properties: ['firstname'] }],
        computed: [cv('c1', 'next', 'count + 1', 'The next value'), cv('c2', 'label', '`Go to ${next} for ${contact.firstname}`')],
      },
    );
    const src = gen(d);
    const iState = src.indexOf('const [count, setCount]');
    const iData = src.indexOf('const contact: Record<string, any> = contactQuery.properties;');
    const iNext = src.indexOf('  // The next value\n  const next: any = count + 1;');
    const iLabel = src.indexOf('const label: any = `Go to ${next} for ${contact.firstname}`;');
    const iHandler = src.indexOf('const handle');
    expect(iState).toBeGreaterThan(0);
    expect(iData).toBeGreaterThan(iState);
    expect(iNext).toBeGreaterThan(iData);
    expect(iLabel).toBeGreaterThan(iNext);
    expect(iHandler).toBeGreaterThan(iLabel);
    expect(src).toContain('setCount(next);');
    expect(src).toContain('/* eslint-disable @typescript-eslint/no-explicit-any */');
  });

  it('declares data a computed value reads even when nothing else uses it', () => {
    const src = gen(
      doc([{ type: 'Text', text: '{{ count }}' }], {
        dataSources: [{ id: 'd1', kind: 'associations', name: 'deals', toObjectType: '0-3', properties: [], pageLength: 5 }],
        computed: [cv('c1', 'count', 'deals.length')],
      }),
    );
    expect(src).toContain('const deals: any[] = dealsQuery.results;');
    expect(src).toContain('const count: any = deals.length;');
  });

  it('skips invalid and conflicting names, keeps empty expressions defined', () => {
    const src = gen(
      doc([{ type: 'Text', text: '{{ a }} {{ b }}' }], {
        state: [st('count', 'number', 1)],
        computed: [
          cv('c1', 'count', '2'),
          cv('c2', 'setCount', '3'),
          cv('c3', 'not valid', '4'),
          cv('c4', 'context', '5'),
          cv('c5', 'a', ''),
          cv('c6', 'b', 'a, 1'),
          cv('c7', 'b', '6'),
        ],
      }),
    );
    expect(src).not.toMatch(/const (count|setCount|context): any/);
    expect(src).toContain('const a: any = undefined;');
    expect(src).toContain('const b: any = (a, 1);');
    expect(src.match(/const b: any/g)).toHaveLength(1);
  });

  it('lays out multi-line expressions and keeps multi-line template literals verbatim', () => {
    const src = gen(
      doc([{ type: 'Text', text: '{{ names }}{{ block }}' }], {
        state: [st('rows', 'array', [])],
        computed: [
          cv('c1', 'names', 'rows\n      .map((r) => r.name) // names only\n      .join(", ")'),
          cv('c2', 'block', '`line 1\n  line 2`'),
        ],
      }),
    );
    expect(src).toContain('  const names: any = rows\n    .map((r) => r.name)\n    .join(", ");');
    expect(src).toContain('  const block: any = `line 1\n  line 2`;');
  });

  it('aliases imports that a computed value shadows', () => {
    const src = gen(doc([{ type: 'Text', text: '{{ Text }}' }], { computed: [cv('c1', 'Text', "'hi'")] }));
    expect(src).toContain('Text as TextComponent');
    expect(src).toContain('const Text: any = \'hi\';');
    expect(src).toContain('<TextComponent>{toText(Text)}</TextComponent>');
  });
});

describe('helper code', () => {
  it('is emitted at module level after generated helpers, with untyped params annotated', () => {
    const src = gen(
      doc([{ type: 'Text', text: 'Total: {{ money(5) }}' }], {
        helpers: 'function money(v, digits = 2) {\n  return `$${Number(v).toFixed(digits)}`;\n}\n\n\n',
      }),
    );
    const iToText = src.indexOf('const toText = (value: unknown): string =>');
    const iHelpers = src.indexOf('// Helper functions (Data panel › Helpers)');
    const iProps = src.indexOf('interface ExtensionProps');
    expect(iToText).toBeGreaterThan(0);
    expect(iHelpers).toBeGreaterThan(iToText);
    expect(iProps).toBeGreaterThan(iHelpers);
    expect(src).toContain('function money(v: any, digits: any = 2) {\n  return `$${Number(v).toFixed(digits)}`;\n}\n\ninterface');
    expect(src).toContain('<Text>Total: {toText(money(5))}</Text>');
  });

  it('renames generated helpers and aliases imports that clash with helper names', () => {
    const src = gen(
      doc([{ type: 'Text', text: 'A {{ Text() }}' }], { helpers: "function Text() { return 'x'; }\nconst toText = (v) => String(v);" }),
    );
    expect(src).toContain('Text as TextComponent');
    expect(src).toContain('const toText2 = (value: unknown): string =>');
    expect(src).toContain('<TextComponent>A {toText2(Text())}</TextComponent>');
  });

  it('imports SDK names the helper code uses', () => {
    const src = gen(doc([{ type: 'Text', text: 'x' }], { helpers: "function track(e: string) { logger.info(e); return hubspot; }" }));
    expect(src).toMatch(/import \{ hubspot, logger, Text \} from '@hubspot\/ui-extensions';/);
  });

  it('renames the component when a helper uses its name', () => {
    const src = gen(doc([{ type: 'Text', text: 'x' }], { helpers: 'function TestCard() {}' }));
    expect(src).toContain('const TestCardComponent = (_props: ExtensionProps) => {');
    expect(src).toContain('<TestCardComponent context={context} actions={actions} />');
  });

  it('emits nothing for empty helper code', () => {
    expect(gen(doc([{ type: 'Text', text: 'x' }], { helpers: '   \n' }))).not.toContain('Helper functions');
  });
});

describe('generateNodeJsx', () => {
  const build = () =>
    doc(
      [
        {
          type: 'Flex',
          name: 'list',
          props: { direction: 'column' },
          children: [
            { type: 'Text', name: 'cond', text: 'Shown', condition: 'show' },
            {
              type: 'Button',
              name: 'rowButton',
              text: 'Pick {{ item.name }}',
              repeat: { items: 'rows', itemName: 'item', indexName: 'i' },
              events: { onClick: [step({ type: 'setState', state: 'picked', value: 'item.name' })] },
            },
          ],
        },
        {
          type: 'Button',
          name: 'opener',
          text: 'Open',
          slots: {
            overlay: [
              {
                type: 'Modal',
                name: 'modal',
                props: { id: 'm1', title: 'Details' },
                children: [{ type: 'ModalBody', name: 'body', children: [{ type: 'Text', name: 'inner', text: '{{ picked }}' }] }],
              },
            ],
          },
        },
      ],
      { state: [st('show', 'boolean', true), st('rows', 'array', []), st('picked', 'string', '')] },
    );

  it('returns a plain element as it appears in the component', () => {
    const d = build();
    expect(generateNodeJsx(d.project, d.ext, byName(d.ext, 'inner'))).toBe('<Text>{toText(picked)}</Text>\n');
  });

  it('keeps condition wrappers as a JSX child expression', () => {
    const d = build();
    expect(generateNodeJsx(d.project, d.ext, byName(d.ext, 'cond'))).toBe('{show ? <Text>Shown</Text> : null}\n');
  });

  it('keeps repeats and references handlers by the names of the full file', () => {
    const d = build();
    const jsx = generateNodeJsx(d.project, d.ext, byName(d.ext, 'rowButton'));
    expect(jsx.startsWith("{asArray(rows).map((item: any, i: number) => (\n  <Button key={i}")).toBe(true);
    const handler = /onClick=\{\(\) => (handle\w+)\(item\)\}/.exec(jsx)?.[1];
    expect(handler).toBeTruthy();
    expect(gen(d)).toContain(`const ${handler} = (item: any) => {`);
  });

  it('renders containers with their subtree', () => {
    const d = build();
    const jsx = generateNodeJsx(d.project, d.ext, byName(d.ext, 'list'));
    expect(jsx.startsWith('<Flex direction="column">\n')).toBe(true);
    expect(jsx).toContain('{show ? <Text>Shown</Text> : null}');
    expect(jsx.trimEnd().endsWith('</Flex>')).toBe(true);
  });

  it('returns slot content (overlays) as the bare element and triggers with their overlay', () => {
    const d = build();
    const modal = generateNodeJsx(d.project, d.ext, byName(d.ext, 'modal'));
    expect(modal.startsWith('<Modal id="m1" title="Details">')).toBe(true);
    const opener = generateNodeJsx(d.project, d.ext, byName(d.ext, 'opener'));
    expect(opener).toContain('overlay={');
    expect(opener).toContain('<Modal id="m1" title="Details">');
  });

  it('returns the whole fragment for the root and nothing for unknown ids', () => {
    const d = build();
    const root = generateNodeJsx(d.project, d.ext, d.ext.rootId);
    expect(root.startsWith('<>\n  <Flex')).toBe(true);
    expect(root.trimEnd().endsWith('</>')).toBe(true);
    expect(generateNodeJsx(d.project, d.ext, 'n_missing')).toBe('');
  });

  it('works for nodes using computed values and helpers', () => {
    const p = createPowerProject();
    const ext = p.extensions[0];
    const repeated = Object.values(ext.nodes).find((x) => x.repeat)!;
    const jsx = generateNodeJsx(p, ext, repeated.id);
    expect(jsx).toContain('{asArray(sorted).map((row: any, i: number) => (');
    expect(jsx).toContain('formatMoney(row.amount)');
    // generated toText is renamed because a helper is called toText
    expect(jsx).toContain('toText2(');
  });
});
