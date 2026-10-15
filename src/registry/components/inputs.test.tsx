import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { FORM_VALUE_ATTR, collectFormValues, inputComponents } from './inputs';
import { renderPreview, templateFor } from '../../test/previewHarness';
import { STANDARD_DOCS } from '../constants';
import type { ComponentDef, PreviewProps, PropDef } from '../types';
import type { NodeTemplate } from '../../model/types';

afterEach(cleanup);

const TYPES = [
  'Form',
  'Input',
  'TextArea',
  'NumberInput',
  'CurrencyInput',
  'StepperInput',
  'DateInput',
  'TimeInput',
  'Select',
  'MultiSelect',
  'SearchInput',
  'Checkbox',
  'RadioButton',
  'Toggle',
  'ToggleGroup',
];

const byType = (type: string): ComponentDef => {
  const def = inputComponents.find((d) => d.type === type);
  if (!def) throw new Error(`missing ${type}`);
  return def;
};

/** Renders and asserts the root exists and is the single outermost element of the preview. */
function renderRoot(def: ComponentDef, opts: Parameters<typeof renderPreview>[1] = {}) {
  const result = renderPreview(def, opts);
  const host = result.container.querySelector('.hsp-overlay-host');
  expect(result.root).not.toBeNull();
  expect(host?.childElementCount).toBe(1);
  expect(host?.firstElementChild).toBe(result.root);
  return { ...result, root: result.root as HTMLElement };
}

/** A standalone preview of one of this group's components (e.g. as a Form child). */
function Child({ type, props, text = '', mode = 'preview' }: { type: string; props: Record<string, unknown>; text?: string; mode?: 'design' | 'preview' }) {
  const def = byType(type);
  const Preview = def.preview;
  const id = `c_${String(props.name ?? type)}`;
  return (
    <Preview
      node={{ id, type, props: {}, children: [] }}
      props={props}
      text={text}
      slots={{}}
      mode={mode}
      rootProps={{ 'data-node-id': id, 'data-node-type': type }}
      trigger={() => {}}
    />
  );
}

const enumValues = (p: PropDef): unknown[] => (p.type.kind === 'enum' ? p.type.options.map((o) => o.value) : []);

/** Every component exported by @hubspot/ui-extensions (for template child / parent references). */
const HUBSPOT_EXPORTS: Set<string> = (() => {
  const index = readFileSync(resolve(process.cwd(), 'node_modules/@hubspot/ui-extensions/dist/index.d.ts'), 'utf8');
  const line = index.split('\n').find((l) => l.includes("from './shared.synced/remoteComponents.synced.tsx'"));
  const names = line?.slice(line.indexOf('{') + 1, line.indexOf('}')).split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  return new Set(names);
})();

// ---------------------------------------------------------------------------
// Declarations from the installed @hubspot/ui-extensions package, via the TypeScript compiler
// (resolves inherited members, Omit<> and the ToggleGroup toggleType union).
// ---------------------------------------------------------------------------

interface DeclaredMember {
  optional: boolean;
  deprecated: boolean;
  callback: boolean;
  /** Max parameter count of the callback signature(s). */
  paramCount: number;
  /** String literal members (enums), with TShirtSizes aliases normalised and 'default' dropped. */
  literals: string[];
  typeText: string;
  defaultValue?: unknown;
}

const SIZE_ALIASES: Record<string, string> = { xs: 'extra-small', sm: 'small', md: 'medium', lg: 'large', xl: 'extra-large' };

/** '`"on"`' -> 'on', '`false`' -> false, '`30`' -> 30, '`[]`' -> [], '"USD"' -> 'USD'. */
function parseDefault(raw: string): unknown {
  const s = raw.trim().replace(/^`|`$/g, '').trim();
  if (s === 'true' || s === 'false') return s === 'true';
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s === '[]') return [];
  const unquoted = s.replace(/^["']|["']$/g, '');
  return SIZE_ALIASES[unquoted] ?? unquoted;
}

/** Type-checks an in-memory TSX module located in the project root (so node_modules resolve). */
function compileVirtual(name: string, source: string) {
  const fileName = resolve(process.cwd(), name);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.getSourceFile = (name, language, ...rest) =>
    name === fileName ? ts.createSourceFile(name, source, language, true) : getSourceFile(name, language, ...rest);
  host.fileExists = (name) => name === fileName || fileExists(name);
  const program = ts.createProgram([fileName], options, host);
  const sf = program.getSourceFile(fileName);
  if (!sf) throw new Error('virtual source file missing');
  const diagnostics = ts.getPreEmitDiagnostics(program, sf).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  return { program, sf, diagnostics };
}

function loadDeclarations(types: string[]): Map<string, Map<string, DeclaredMember>> {
  const source = [
    "import type { ComponentProps } from 'react';",
    `import { ${types.join(', ')} } from '@hubspot/ui-extensions';`,
    ...types.map((t) => `export type P_${t} = ComponentProps<typeof ${t}>;`),
  ].join('\n');
  const { program, sf, diagnostics } = compileVirtual('__uiex_inputs_declarations__.tsx', source);
  expect(diagnostics).toEqual([]);
  const checker = program.getTypeChecker();

  const out = new Map<string, Map<string, DeclaredMember>>();
  for (const stmt of sf.statements) {
    if (!ts.isTypeAliasDeclaration(stmt)) continue;
    const type = checker.getTypeAtLocation(stmt.name);
    const variants = type.isUnion() ? type.types : [type];
    const members = new Map<string, DeclaredMember>();
    const seenIn = new Map<string, number>();
    for (const variant of variants) {
      for (const symbol of checker.getPropertiesOfType(variant)) {
        const decl = symbol.valueDeclaration ?? symbol.declarations?.[0] ?? stmt;
        const propType = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(symbol, decl));
        const parts = propType.isUnion() ? propType.types : [propType];
        const literals = parts
          .filter((t): t is ts.StringLiteralType => t.isStringLiteral())
          .map((t) => SIZE_ALIASES[t.value] ?? t.value)
          .filter((v) => v !== 'default');
        const tags = symbol.getJsDocTags(checker);
        const defaultTag = tags.find((t) => t.name === 'defaultValue' || t.name === 'default');
        const signatures = propType.getCallSignatures();
        const member: DeclaredMember = {
          optional: (symbol.flags & ts.SymbolFlags.Optional) !== 0,
          deprecated: tags.some((t) => t.name === 'deprecated'),
          callback: signatures.length > 0,
          paramCount: Math.max(0, ...signatures.map((s) => s.parameters.length)),
          literals,
          typeText: checker.typeToString(propType),
          defaultValue: defaultTag?.text ? parseDefault(ts.displayPartsToString(defaultTag.text)) : undefined,
        };
        const prev = members.get(symbol.name);
        seenIn.set(symbol.name, (seenIn.get(symbol.name) ?? 0) + 1);
        if (!prev) {
          members.set(symbol.name, member);
        } else {
          // Merge union variants: required only when required in every variant.
          prev.optional ||= member.optional;
          prev.literals = [...new Set([...prev.literals, ...member.literals])];
          prev.paramCount = Math.max(prev.paramCount, member.paramCount);
          prev.defaultValue ??= member.defaultValue;
        }
      }
    }
    for (const [name, count] of seenIn) if (count < variants.length) members.get(name)!.optional = true;
    out.set(stmt.name.text.replace(/^P_/, ''), members);
  }
  return out;
}

let DECLS: Map<string, Map<string, DeclaredMember>>;
beforeAll(() => {
  DECLS = loadDeclarations(TYPES);
});

// ---------------------------------------------------------------------------
// Group-level checks
// ---------------------------------------------------------------------------

describe('inputs group registry', () => {
  it('registers every Forms & inputs component', () => {
    expect(inputComponents.map((d) => d.type)).toEqual(TYPES);
    for (const def of inputComponents) {
      expect(def.category).toBe('Forms & inputs');
      expect(def.importFrom).toBe('@hubspot/ui-extensions');
      expect(HUBSPOT_EXPORTS.has(def.type)).toBe(true);
    }
  });

  it('uses the expected value bindings and event params', () => {
    const expected: Record<string, [string, string, string, unknown] | undefined> = {
      Form: undefined,
      Input: ['value', 'onChange', 'string', ''],
      TextArea: ['value', 'onChange', 'string', ''],
      NumberInput: ['value', 'onChange', 'number', 0],
      CurrencyInput: ['value', 'onChange', 'number', 0],
      StepperInput: ['value', 'onChange', 'number', 0],
      DateInput: ['value', 'onChange', 'object', null],
      TimeInput: ['value', 'onChange', 'object', null],
      Select: ['value', 'onChange', 'string', ''],
      MultiSelect: ['value', 'onChange', 'array', []],
      SearchInput: ['value', 'onChange', 'string', ''],
      Checkbox: ['checked', 'onChange', 'boolean', false],
      RadioButton: ['checked', 'onChange', 'boolean', false],
      Toggle: ['checked', 'onChange', 'boolean', false],
      ToggleGroup: ['value', 'onChange', 'array', []],
    };
    for (const def of inputComponents) {
      const b = def.valueBinding;
      expect(b ? [b.prop, b.event, b.stateType, b.initial] : undefined, def.type).toEqual(expected[def.type]);
    }
    const params = (type: string, event: string) => byType(type).events?.find((e) => e.name === event)?.params.map((p) => p.name);
    expect(params('Form', 'onSubmit')).toEqual(['event']);
    expect(params('Checkbox', 'onChange')).toEqual(['checked', 'value']);
    expect(params('RadioButton', 'onChange')).toEqual(['checked', 'value']);
    expect(params('Toggle', 'onChange')).toEqual(['checked']);
    for (const type of ['Input', 'TextArea', 'SearchInput']) {
      for (const ev of ['onChange', 'onInput', 'onBlur', 'onFocus']) expect(params(type, ev), `${type}.${ev}`).toEqual(['value']);
    }
    for (const type of ['NumberInput', 'CurrencyInput', 'StepperInput', 'DateInput', 'TimeInput']) {
      expect(byType(type).events?.map((e) => e.name)).toEqual(['onChange', 'onBlur', 'onFocus']);
    }
    expect(byType('Select').events?.map((e) => e.name)).toEqual(['onChange', 'onInput']);
  });

  it('declares option fields matching each option type', () => {
    const optionFields = (type: string) => {
      const p = byType(type).props.find((x) => x.name === 'options');
      return p?.type.kind === 'options' ? p.type.optionFields : 'not options';
    };
    expect(optionFields('Select')).toEqual([]);
    expect(optionFields('MultiSelect')).toEqual([]);
    expect(optionFields('ToggleGroup')).toEqual(['description', 'initialIsChecked', 'readOnly']);
  });

  it('create() templates type-check as JSX against @hubspot/ui-extensions', () => {
    const used = new Set<string>();
    const jsx = (t: NodeTemplate): string => {
      used.add(t.type);
      const attrs = Object.entries(t.props ?? {})
        .map(([k, v]) => (typeof v === 'string' ? `${k}=${JSON.stringify(v)}` : `${k}={${JSON.stringify(v)}}`))
        .join(' ');
      const inner = t.text !== undefined ? `{${JSON.stringify(t.text)}}` : (t.children ?? []).map(jsx).join('');
      return inner ? `<${t.type} ${attrs}>${inner}</${t.type}>` : `<${t.type} ${attrs} />`;
    };
    const elements = inputComponents.map((def) => jsx(templateFor(def)));
    const source = [
      `import { ${[...used].sort().join(', ')} } from '@hubspot/ui-extensions';`,
      `export const templates = <>${elements.join('\n')}</>;`,
      // Bindings as codegen would emit them (state setters receive the event's first param).
      'declare const setText: (v: string) => void, setNum: (v: number) => void, setOn: (v: boolean) => void;',
      'declare const setList: (v: string[]) => void, setOne: (v: string) => void, setAny: (v: unknown) => void;',
      'export const bound = <>',
      '  <Input label="a" name="a" value="" onChange={setText} onInput={setText} onBlur={setText} onFocus={setText} />',
      '  <NumberInput label="a" name="a" value={0} onChange={setNum} onBlur={setNum} onFocus={setNum} />',
      '  <Checkbox checked={false} onChange={(checked, value) => { setOn(checked); setText(value); }} />',
      '  <Toggle label="t" checked onChange={setOn} />',
      '  <MultiSelect options={[]} value={[]} onChange={setAny} />',
      '  <Select options={[]} value="" onChange={setAny} onInput={setText} />',
      '  <ToggleGroup toggleType="checkboxList" name="g" label="g" options={[{ label: "A", value: "a", description: "d", initialIsChecked: true, readOnly: false }]} value={[]} onChange={setList} />',
      '  <ToggleGroup toggleType="radioButtonList" name="g" label="g" options={[]} value="" onChange={setOne} />',
      '  <DateInput label="d" name="d" onChange={(v) => setAny(v.formattedDate)} />',
      '  <TimeInput label="t" name="t" onChange={(v) => setNum(v.hours)} />',
      '  <Form onSubmit={(e) => setAny(e.targetValue)} autoComplete="off"><Input label="a" name="a" /></Form>',
      '</>;',
    ].join('\n');
    expect(compileVirtual('__uiex_inputs_templates__.tsx', source).diagnostics).toEqual([]);
  });

  it('returns fresh templates from create()', () => {
    for (const def of inputComponents) {
      const a = templateFor(def);
      const b = templateFor(def);
      expect(a).toEqual(b);
      if (a.props) expect(a.props).not.toBe(b.props);
    }
    const first = templateFor(byType('Select'));
    (first.props?.options as Array<{ label: string }>)[0].label = 'Mutated';
    expect((templateFor(byType('Select')).props?.options as Array<{ label: string }>)[0].label).toBe('Appointment scheduled');
  });
});

// ---------------------------------------------------------------------------
// Per-component checks
// ---------------------------------------------------------------------------

const ODD_PROPS: Record<string, unknown> = {
  label: { not: 'a label' },
  name: 42,
  value: { weird: true },
  defaultValue: [1, 2],
  checked: 'yes',
  options: [null, 5, 'plain', { label: {}, value: {} }, { value: 'x' }],
  min: 'low',
  max: { year: 'soon' },
  precision: 'many',
  currency: 'not-a-code',
  format: 42,
  size: [],
  variant: 9,
  type: {},
  toggleType: 7,
  labelDisplay: null,
  interval: -30,
  stepSize: 'big',
  rows: 'x',
  resize: 'diagonal',
  tooltip: 5,
  description: { a: 1 },
  validationMessage: ['x'],
  error: 'true',
  required: 1,
  readOnly: 'no',
  inline: {},
  textChecked: null,
  clearable: 'nope',
  autoComplete: 3,
};

describe.each(inputComponents.map((def) => [def.type, def] as const))('%s', (type, def) => {
  it.each(['design', 'preview'] as const)('renders its create() template in %s mode with the root outermost', (mode) => {
    const { root } = renderRoot(def, { mode });
    expect(root.getAttribute('data-node-type')).toBe(type);
    expect(root.className).toMatch(/\bhsp-/);
  });

  it('renders with empty props and text without throwing', () => {
    for (const mode of ['design', 'preview'] as const) {
      renderRoot(def, { mode, props: {}, text: '' });
      cleanup();
    }
  });

  it('degrades gracefully on odd prop shapes', () => {
    for (const mode of ['design', 'preview'] as const) {
      renderRoot(def, { mode, props: ODD_PROPS, text: '' });
      cleanup();
    }
  });

  it('merges rootProps.className and forwards runtime hover handlers', () => {
    const onMouseEnter = vi.fn();
    const Preview = def.preview;
    const tpl = templateFor(def);
    const { container } = render(
      <div className="hsp-root hsp-live">
        <Preview
          node={{ id: 'n_rp', type, props: {}, children: [] }}
          props={(tpl.props ?? {}) as Record<string, unknown>}
          text={tpl.text ?? ''}
          slots={{}}
          mode="preview"
          rootProps={{ 'data-node-id': 'n_rp', 'data-node-type': type, className: 'runtime-hook', onMouseEnter }}
          trigger={vi.fn()}
        />
      </div>,
    );
    const root = container.querySelector('[data-node-id="n_rp"]') as HTMLElement;
    expect(root).toHaveClass('runtime-hook');
    expect(root.className).toMatch(/\bhsp-/);
    fireEvent.mouseEnter(root);
    expect(onMouseEnter).toHaveBeenCalled();
  });

  it('has a sane definition', () => {
    const tpl = templateFor(def);
    expect(tpl.type).toBe(type);
    expect(def.docsUrl?.startsWith(`${STANDARD_DOCS}/`)).toBe(true);
    expect(def.description.length).toBeGreaterThan(10);
    expect(def.keywords?.length ?? 0).toBeGreaterThan(2);
    expect(def.icon).toBeTruthy();

    const names = def.props.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(def.props.find((p) => p.name === 'testId')?.group).toBe('Advanced');
    const eventNames = (def.events ?? []).map((e) => e.name);
    expect(new Set(eventNames).size).toBe(eventNames.length);

    for (const p of def.props) {
      expect(p.description, `${type}.${p.name} description`).toBeTruthy();
      if (p.required) expect(tpl.props?.[p.name], `${type}.${p.name} required`).toBeDefined();
      if (p.type.kind === 'enum') {
        const values = enumValues(p);
        expect(new Set(values).size).toBe(values.length);
        if (p.defaultValue !== undefined) expect(values).toContain(p.defaultValue);
        const v = tpl.props?.[p.name];
        if (v !== undefined) expect(values).toContain(v);
      }
    }
    if (def.valueBinding) {
      expect(names).toContain(def.valueBinding.prop);
      expect(eventNames).toContain(def.valueBinding.event);
    }

    if (def.children.mode === 'text') {
      expect(def.children.defaultText).toBeTruthy();
      expect(tpl.text).toBeTruthy();
    }
    if (def.children.mode === 'nodes' && def.children.required) expect(tpl.children?.length ?? 0).toBeGreaterThan(0);
    for (const t of [...(def.children.accepts ?? []), ...(def.parents ?? [])]) expect(HUBSPOT_EXPORTS.has(t), t).toBe(true);
    // Every node in the default template is a real component; nodes of this group have their required props.
    const visit = (node: NodeTemplate) => {
      expect(HUBSPOT_EXPORTS.has(node.type), node.type).toBe(true);
      const own = inputComponents.find((d) => d.type === node.type);
      for (const p of own?.props ?? []) if (p.required) expect(node.props?.[p.name], `${node.type}.${p.name}`).toBeDefined();
      node.children?.forEach(visit);
    };
    visit(tpl);
  });

  it('matches the @hubspot/ui-extensions declaration', () => {
    const declared = DECLS.get(type);
    expect(declared && declared.size).toBeGreaterThan(0);
    if (!declared) return;
    const propDefs = new Map(def.props.map((p) => [p.name, p]));
    const events = new Map((def.events ?? []).map((e) => [e.name, e]));

    for (const [name, decl] of declared) {
      if (name === 'children') {
        expect(def.children.mode).not.toBe('none');
        expect(Boolean(def.children.required && def.children.mode === 'nodes')).toBe(!decl.optional && def.children.mode === 'nodes');
        continue;
      }
      if (decl.callback) {
        if (decl.deprecated) {
          expect(events.has(name), `${type}.${name} is deprecated`).toBe(false);
          continue;
        }
        const ev = events.get(name);
        expect(ev, `${type}.${name} should be an event`).toBeDefined();
        expect(ev!.params.length).toBeGreaterThan(0);
        expect(ev!.params.length).toBeLessThanOrEqual(decl.paramCount);
        continue;
      }
      const p = propDefs.get(name);
      if (decl.deprecated) {
        // Deprecated props are omitted, or kept and flagged (Form.preventDefault).
        if (p) expect(p.deprecated, `${type}.${name} deprecated flag`).toBe(true);
        continue;
      }
      expect(p, `${type}.${name} missing from registry`).toBeDefined();
      if (!p) continue;
      expect(Boolean(p.required), `${type}.${name} required-ness`).toBe(!decl.optional);
      if (decl.literals.length > 0) {
        expect(p.type.kind, `${type}.${name} kind`).toBe('enum');
        expect(new Set(enumValues(p)), `${type}.${name} enum values`).toEqual(new Set(decl.literals));
      }
      if (decl.typeText === 'boolean') expect(p.type.kind, `${type}.${name}`).toBe('boolean');
      if (decl.typeText === 'number') expect(p.type.kind, `${type}.${name}`).toBe('number');
      if (decl.typeText === 'string') expect(p.type.kind, `${type}.${name}`).toBe('string');
      if (/\bBaseDate\b/.test(decl.typeText)) expect(p.type.kind, `${type}.${name}`).toBe('date');
      if (/\bBaseTime\b/.test(decl.typeText)) expect(p.type.kind, `${type}.${name}`).toBe('time');
      if (decl.defaultValue !== undefined) expect(p.defaultValue, `${type}.${name} default`).toEqual(decl.defaultValue);
    }
    // Nothing invented: every registry prop and event exists in the declaration.
    for (const name of propDefs.keys()) expect(declared.has(name), `${type}.${name} declared`).toBe(true);
    for (const name of events.keys()) expect(declared.has(name), `${type}.${name} event declared`).toBe(true);
    if (!declared.has('children')) expect(def.children.mode).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Shared field chrome
// ---------------------------------------------------------------------------

describe('field chrome', () => {
  it('renders label, required asterisk, tooltip, description and error message', () => {
    const { root } = renderRoot(byType('Input'), {
      props: {
        label: 'Email',
        name: 'email',
        required: true,
        tooltip: 'Work email only',
        description: 'We never share it',
        error: true,
        validationMessage: 'Enter a valid email',
      },
    });
    const input = root.querySelector('input') as HTMLInputElement;
    expect(screen.getByLabelText(/Email/)).toBe(input);
    expect(root.querySelector('.hsp-field-required')).toHaveTextContent('*');
    expect(root.querySelector('[role="tooltip"]')).toHaveTextContent('Work email only');
    expect(root).toHaveTextContent('We never share it');
    expect(root.querySelector('.hsp-field-error')).toHaveTextContent('Enter a valid email');
    expect(input).toHaveClass('hsp-invalid');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('name', 'email');
  });

  it('shows the validation message as success when error is off', () => {
    const { root } = renderRoot(byType('Select'), { props: { label: 'Stage', options: [], validationMessage: 'Looks good' } });
    expect(root.querySelector('.hsp-field-success')).toHaveTextContent('Looks good');
    expect(root.querySelector('.hsp-field-error')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Text inputs
// ---------------------------------------------------------------------------

describe('Input / TextArea / SearchInput', () => {
  it.each(['Input', 'TextArea', 'SearchInput'])('%s fires onInput per edit and onChange/onBlur when committed', async (type) => {
    const user = userEvent.setup();
    const trigger = vi.fn();
    const { root } = renderRoot(byType(type), { mode: 'preview', trigger });
    const control = root.querySelector('input, textarea') as HTMLInputElement;
    await user.click(control);
    expect(trigger).toHaveBeenCalledWith('onFocus', '');
    await user.type(control, 'Ada');
    expect(trigger).toHaveBeenCalledWith('onInput', 'Ada');
    expect(trigger).not.toHaveBeenCalledWith('onChange', expect.anything());
    await user.tab();
    expect(trigger).toHaveBeenCalledWith('onChange', 'Ada');
    expect(trigger).toHaveBeenCalledWith('onBlur', 'Ada');
    // Blurring again without edits does not re-commit.
    trigger.mockClear();
    fireEvent.focus(control);
    fireEvent.blur(control);
    expect(trigger).not.toHaveBeenCalledWith('onChange', expect.anything());
  });

  it('commits an Input on Enter', () => {
    const trigger = vi.fn();
    const { root } = renderRoot(byType('Input'), { mode: 'preview', trigger });
    const input = root.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Grace' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(trigger).toHaveBeenCalledWith('onChange', 'Grace');
  });

  it('shows the controlled value and the password type', () => {
    const { root } = renderRoot(byType('Input'), { props: { label: 'Secret', name: 's', value: 'hunter2', type: 'password' } });
    const input = root.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('hunter2');
    expect(input.type).toBe('password');
  });

  it('respects readOnly and design mode', () => {
    const trigger = vi.fn();
    const ro = renderRoot(byType('Input'), { mode: 'preview', trigger, props: { label: 'A', name: 'a', readOnly: true, defaultValue: 'x' } });
    const input = ro.root.querySelector('input') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    fireEvent.change(input, { target: { value: 'changed' } });
    fireEvent.blur(input);
    expect(trigger).not.toHaveBeenCalledWith('onChange', expect.anything());
    cleanup();
    const design = renderRoot(byType('Input'), { mode: 'design', trigger });
    const designInput = design.root.querySelector('input') as HTMLInputElement;
    expect(designInput.tabIndex).toBe(-1);
    fireEvent.change(designInput, { target: { value: 'typed' } });
    expect(designInput.value).toBe('');
  });

  it('applies TextArea rows, cols, maxLength and resize', () => {
    const { root } = renderRoot(byType('TextArea'), { props: { label: 'Notes', name: 'n', rows: 6, cols: 30, maxLength: 200, resize: 'vertical' } });
    const area = root.querySelector('textarea') as HTMLTextAreaElement;
    expect(area.rows).toBe(6);
    expect(area.cols).toBe(30);
    expect(area.maxLength).toBe(200);
    expect(area.style.resize).toBe('vertical');
  });

  it('clears a SearchInput with the clear button (clearable by default)', () => {
    const trigger = vi.fn();
    const { root } = renderRoot(byType('SearchInput'), { mode: 'preview', trigger, props: { label: 'Search', name: 'q', defaultValue: 'acme' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(trigger).toHaveBeenCalledWith('onInput', '');
    expect(trigger).toHaveBeenCalledWith('onChange', '');
    expect((root.querySelector('input') as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    cleanup();
    renderRoot(byType('SearchInput'), { mode: 'preview', props: { label: 'Search', name: 'q', defaultValue: 'acme', clearable: false } });
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Number inputs
// ---------------------------------------------------------------------------

describe('NumberInput / CurrencyInput / StepperInput', () => {
  const commit = (input: HTMLInputElement, text: string) => {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: text } });
    fireEvent.blur(input);
  };

  it('commits parsed numbers on blur, clamped and rounded', () => {
    const trigger = vi.fn();
    const { root } = renderRoot(byType('NumberInput'), {
      mode: 'preview',
      trigger,
      props: { label: 'Qty', name: 'qty', min: 0, max: 5000, precision: 1 },
    });
    const input = root.querySelector('input') as HTMLInputElement;
    commit(input, '1234.56');
    expect(trigger).toHaveBeenCalledWith('onChange', 1234.6);
    expect(trigger).toHaveBeenCalledWith('onBlur', 1234.6);
    expect(input.value).toBe('1,234.6');
    expect(input.getAttribute(FORM_VALUE_ATTR)).toBe('1234.6');
    commit(input, '-7');
    expect(trigger).toHaveBeenLastCalledWith('onBlur', 0);
    expect(trigger).toHaveBeenCalledWith('onChange', 0);
    trigger.mockClear();
    commit(input, 'abc');
    expect(trigger).not.toHaveBeenCalledWith('onChange', expect.anything());
    expect(input.value).toBe('0.0');
    commit(input, '');
    expect(trigger).toHaveBeenCalledWith('onChange', undefined);
  });

  it('shows a percent suffix and right alignment', () => {
    const { root } = renderRoot(byType('NumberInput'), { props: { label: 'Rate', name: 'r', formatStyle: 'percentage', textAlign: 'right', value: 25 } });
    expect(root.querySelector('.hsp-input-suffix')).toHaveTextContent('%');
    const input = root.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('25');
    expect(input.style.textAlign).toBe('right');
  });

  it('formats currency with the currency symbol and precision', () => {
    const trigger = vi.fn();
    const { root } = renderRoot(byType('CurrencyInput'), { mode: 'preview', trigger });
    expect(root.querySelector('.hsp-input-prefix')).toHaveTextContent('$');
    const input = root.querySelector('input') as HTMLInputElement;
    commit(input, '$1,999.999');
    expect(trigger).toHaveBeenCalledWith('onChange', 2000);
    expect(input.value).toBe('2,000.00');
    cleanup();
    const eur = renderRoot(byType('CurrencyInput'), { props: { label: 'A', name: 'a', currency: 'EUR', value: 5 } });
    expect(eur.root.querySelector('.hsp-input-prefix')).toHaveTextContent('€');
    cleanup();
    const jpy = renderRoot(byType('CurrencyInput'), { props: { label: 'A', name: 'a', currency: 'JPY', value: 1500 } });
    expect((jpy.root.querySelector('input') as HTMLInputElement).value).toBe('1,500');
  });

  it('steps by stepSize within min/max and shows the limit tooltips', () => {
    const trigger = vi.fn();
    const { root } = renderRoot(byType('StepperInput'), {
      mode: 'preview',
      trigger,
      props: { label: 'Seats', name: 'seats', min: 1, max: 2, defaultValue: 1, stepSize: 1, minValueReachedTooltip: 'At least one seat' },
    });
    const dec = screen.getByRole('button', { name: 'Decrease' });
    const inc = screen.getByRole('button', { name: 'Increase' });
    expect(dec).toBeDisabled();
    expect(dec.parentElement).toHaveAttribute('title', 'At least one seat');
    fireEvent.click(inc);
    expect(trigger).toHaveBeenCalledWith('onChange', 2);
    expect((root.querySelector('input') as HTMLInputElement).value).toBe('2');
    expect(inc).toBeDisabled();
    fireEvent.click(dec);
    expect(trigger).toHaveBeenLastCalledWith('onChange', 1);
  });

  it('avoids floating point drift when stepping decimals', () => {
    const trigger = vi.fn();
    renderRoot(byType('StepperInput'), { mode: 'preview', trigger, props: { label: 'x', name: 'x', defaultValue: 0.1, stepSize: 0.2 } });
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(trigger).toHaveBeenCalledWith('onChange', 0.3);
  });
});

// ---------------------------------------------------------------------------
// Date & time
// ---------------------------------------------------------------------------

describe('DateInput', () => {
  const props = { label: 'Close date', name: 'closedate', defaultValue: { year: 2026, month: 0, date: 15 } };

  it('opens a calendar and commits the picked date with formattedDate', async () => {
    const user = userEvent.setup();
    const trigger = vi.fn();
    const { root } = renderRoot(byType('DateInput'), { mode: 'preview', trigger, props });
    const input = root.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('01/15/2026');
    await user.click(input);
    expect(trigger).toHaveBeenCalledWith('onFocus', { year: 2026, month: 0, date: 15, formattedDate: '01/15/2026' });
    expect(screen.getByText('January 2026')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'January 20, 2026' }));
    expect(trigger).toHaveBeenCalledWith('onChange', { year: 2026, month: 0, date: 20, formattedDate: '01/20/2026' });
    expect(input.value).toBe('01/20/2026');
    expect(screen.queryByText('January 2026')).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('navigates months, clears, and honours min/max', () => {
    const trigger = vi.fn();
    const { root } = renderRoot(byType('DateInput'), {
      mode: 'preview',
      trigger,
      props: { ...props, max: { year: 2026, month: 1, date: 10 }, maxValidationMessage: 'Too late', clearButtonLabel: 'Reset' },
    });
    fireEvent.click(root.querySelector('input') as HTMLInputElement);
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByText('February 2026')).toBeInTheDocument();
    const blocked = screen.getByRole('button', { name: 'February 11, 2026' });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    expect(blocked).toHaveAttribute('title', 'Too late');
    fireEvent.click(blocked);
    expect(trigger).not.toHaveBeenCalledWith('onChange', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(trigger).toHaveBeenCalledWith('onChange', null);
  });

  it('parses typed dates on Enter and uses the format', () => {
    const trigger = vi.fn();
    const { root } = renderRoot(byType('DateInput'), { mode: 'preview', trigger, props: { ...props, format: 'll' } });
    const input = root.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('Jan 15, 2026');
    fireEvent.change(input, { target: { value: '2026-03-04' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(trigger).toHaveBeenCalledWith('onChange', { year: 2026, month: 2, date: 4, formattedDate: 'Mar 4, 2026' });
    expect(input.value).toBe('Mar 4, 2026');
    expect(JSON.parse(input.getAttribute(FORM_VALUE_ATTR) ?? 'null')).toEqual({ year: 2026, month: 2, date: 4 });
    trigger.mockClear();
    fireEvent.change(input, { target: { value: 'not a date' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(trigger).not.toHaveBeenCalled();
    expect(input.value).toBe('Mar 4, 2026');
  });

  it('keeps a picked date when the runtime re-renders with an equal defaultValue object', () => {
    const Preview = byType('DateInput').preview;
    const view = (p: Record<string, unknown>) => (
      <Preview
        node={{ id: 'd', type: 'DateInput', props: {}, children: [] }}
        props={p}
        text=""
        slots={{}}
        mode="preview"
        rootProps={{ 'data-node-id': 'd', 'data-node-type': 'DateInput' }}
        trigger={() => {}}
      />
    );
    const { container, rerender } = render(view({ ...props, defaultValue: { ...props.defaultValue } }));
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.click(input);
    fireEvent.click(screen.getByRole('button', { name: 'January 3, 2026' }));
    rerender(view({ ...props, defaultValue: { ...props.defaultValue } }));
    expect(input.value).toBe('01/03/2026');
  });

  it('hints the format while empty', () => {
    const { root } = renderRoot(byType('DateInput'), { props: { label: 'When', name: 'when', format: 'medium' } });
    expect(root.querySelector('input')).toHaveAttribute('placeholder', 'Mon D, YYYY');
  });

  it('does not open the calendar in design mode', () => {
    const { root } = renderRoot(byType('DateInput'), { mode: 'design', props });
    fireEvent.click(root.querySelector('input') as HTMLInputElement);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('TimeInput', () => {
  it('lists times at the interval and commits { hours, minutes }', () => {
    const trigger = vi.fn();
    const { root } = renderRoot(byType('TimeInput'), {
      mode: 'preview',
      trigger,
      props: { label: 'At', name: 'at', interval: 15, min: { hours: 9, minutes: 0 }, max: { hours: 10, minutes: 0 } },
    });
    const input = root.querySelector('input') as HTMLInputElement;
    fireEvent.click(input);
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['9:00 AM', '9:15 AM', '9:30 AM', '9:45 AM', '10:00 AM']);
    fireEvent.click(screen.getByRole('option', { name: '9:30 AM' }));
    expect(trigger).toHaveBeenCalledWith('onChange', { hours: 9, minutes: 30 });
    expect(input.value).toBe('9:30 AM');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('parses typed times and ignores out-of-range ones', () => {
    const trigger = vi.fn();
    const { root } = renderRoot(byType('TimeInput'), { mode: 'preview', trigger, props: { label: 'At', name: 'at', max: { hours: 18, minutes: 0 } } });
    const input = root.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2:05 pm' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(trigger).toHaveBeenCalledWith('onChange', { hours: 14, minutes: 5 });
    expect(input.value).toBe('2:05 PM');
    trigger.mockClear();
    fireEvent.change(input, { target: { value: '23:00' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(trigger).not.toHaveBeenCalled();
    expect(input.value).toBe('2:05 PM');
  });
});

// ---------------------------------------------------------------------------
// Selects
// ---------------------------------------------------------------------------

describe('Select', () => {
  it('opens the menu and fires onChange with the option value', async () => {
    const user = userEvent.setup();
    const trigger = vi.fn();
    const { root } = renderRoot(byType('Select'), { mode: 'preview', trigger });
    const button = screen.getByRole('button', { name: /Deal stage/ });
    expect(button).toHaveTextContent('Select a stage');
    await user.click(button);
    await user.click(screen.getByRole('option', { name: 'Qualified to buy' }));
    expect(trigger).toHaveBeenCalledWith('onChange', 'qualifiedtobuy');
    expect(button).toHaveTextContent('Qualified to buy');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(root.querySelector('input[type="hidden"]')).toHaveAttribute(FORM_VALUE_ATTR, '"qualifiedtobuy"');
  });

  it('supports keyboard selection and non-string values', () => {
    const trigger = vi.fn();
    renderRoot(byType('Select'), {
      mode: 'preview',
      trigger,
      props: { label: 'Priority', options: [{ label: 'Low', value: 1 }, { label: 'High', value: 2 }, { label: 'Yes', value: true }] },
    });
    const button = screen.getByRole('button', { name: /Priority/ });
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(trigger).toHaveBeenCalledWith('onChange', 2);
  });

  it('adds a search box with more than seven options and fires onInput', () => {
    const trigger = vi.fn();
    const options = Array.from({ length: 9 }, (_, i) => ({ label: `Option ${i + 1}`, value: `o${i + 1}` }));
    renderRoot(byType('Select'), { mode: 'preview', trigger, props: { label: 'Pick', options } });
    fireEvent.click(screen.getByRole('button', { name: /Pick/ }));
    const search = screen.getByRole('textbox', { name: 'Search options' });
    fireEvent.change(search, { target: { value: '9' } });
    expect(trigger).toHaveBeenCalledWith('onInput', '9');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Option 9']);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(trigger).toHaveBeenCalledWith('onChange', 'o9');
  });

  it('shows the controlled value, the transparent variant, and stays closed when read-only or in design mode', () => {
    const { root } = renderRoot(byType('Select'), {
      mode: 'preview',
      props: { label: 'Stage', options: [{ label: 'Won', value: 'won' }], value: 'won', variant: 'transparent', readOnly: true },
    });
    expect(root).toHaveClass('hsp-select-transparent');
    const button = screen.getByRole('button', { name: /Stage/ });
    expect(button).toHaveTextContent('Won');
    fireEvent.click(button);
    expect(screen.queryByRole('listbox')).toBeNull();
    cleanup();
    renderRoot(byType('Select'), { mode: 'design' });
    fireEvent.click(screen.getByRole('button', { name: /Deal stage/ }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('MultiSelect', () => {
  it('toggles options into tags and removes them', async () => {
    const user = userEvent.setup();
    const trigger = vi.fn();
    const { root } = renderRoot(byType('MultiSelect'), { mode: 'preview', trigger });
    const combo = screen.getByRole('combobox');
    expect(combo).toHaveTextContent('Select interests');
    await user.click(combo);
    await user.click(screen.getByRole('option', { name: 'Events' }));
    expect(trigger).toHaveBeenLastCalledWith('onChange', ['events']);
    await user.click(screen.getByRole('option', { name: 'Webinars' }));
    expect(trigger).toHaveBeenLastCalledWith('onChange', ['events', 'webinars']);
    expect(root.querySelectorAll('.hsp-ms-tag')).toHaveLength(2);
    await user.click(screen.getByRole('option', { name: 'Events' }));
    expect(trigger).toHaveBeenLastCalledWith('onChange', ['webinars']);
    await user.click(screen.getByRole('button', { name: 'Remove Webinars' }));
    expect(trigger).toHaveBeenLastCalledWith('onChange', []);
    expect(root.querySelector('input[type="hidden"]')).toHaveAttribute(FORM_VALUE_ATTR, '[]');
  });

  it('renders controlled values as tags (unknown values by their raw value)', () => {
    const { root } = renderRoot(byType('MultiSelect'), {
      props: { label: 'Tags', options: [{ label: 'Alpha', value: 'a' }], value: ['a', 'zzz'] },
    });
    expect([...root.querySelectorAll('.hsp-ms-tag-label')].map((t) => t.textContent)).toEqual(['Alpha', 'zzz']);
  });
});

// ---------------------------------------------------------------------------
// Checkbox, RadioButton, Toggle, ToggleGroup
// ---------------------------------------------------------------------------

describe('Checkbox / RadioButton', () => {
  it('Checkbox fires onChange(checked, value)', async () => {
    const user = userEvent.setup();
    const trigger = vi.fn();
    const { root } = renderRoot(byType('Checkbox'), { mode: 'preview', trigger, props: { name: 'terms', value: 'yes' }, text: 'I agree' });
    const box = screen.getByRole('checkbox', { name: 'I agree' });
    await user.click(screen.getByText('I agree'));
    expect(trigger).toHaveBeenLastCalledWith('onChange', true, 'yes');
    expect(box).toBeChecked();
    await user.click(box);
    expect(trigger).toHaveBeenLastCalledWith('onChange', false, 'yes');
    expect(root).toHaveClass('hsp-check');
  });

  it('Checkbox honours initialIsChecked, size, inline, readOnly and design mode', () => {
    const trigger = vi.fn();
    const { root } = renderRoot(byType('Checkbox'), {
      mode: 'preview',
      trigger,
      props: { initialIsChecked: true, size: 'sm', inline: true, readOnly: true, description: 'Required for access' },
      text: 'Locked',
    });
    expect(root).toHaveClass('hsp-check-small', 'hsp-check-inline', 'hsp-check-readonly');
    expect(root).toHaveTextContent('Required for access');
    const box = screen.getByRole('checkbox');
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(box).toBeChecked();
    expect(trigger).not.toHaveBeenCalled();
    cleanup();
    const design = renderRoot(byType('Checkbox'), { mode: 'design', trigger });
    fireEvent.click(design.root);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(trigger).not.toHaveBeenCalled();
  });

  it('RadioButton fires onChange(true, value) and unchecks same-name siblings', () => {
    const trigger = vi.fn();
    renderRoot(byType('RadioButton'), { mode: 'preview', trigger, props: { name: 'plan', value: 'starter', initialIsChecked: true }, text: 'Starter' });
    const extra = document.createElement('div');
    document.body.appendChild(extra);
    render(<Child type="RadioButton" props={{ name: 'plan', value: 'pro' }} text="Pro" />, { container: extra });
    const starter = screen.getByRole('radio', { name: 'Starter' });
    const pro = screen.getByRole('radio', { name: 'Pro' });
    expect(starter).toBeChecked();
    fireEvent.click(pro);
    expect(pro).toBeChecked();
    expect(starter).not.toBeChecked();
    fireEvent.click(starter);
    expect(trigger).toHaveBeenCalledWith('onChange', true, 'starter');
    expect(starter).toBeChecked();
  });
});

describe('Toggle', () => {
  it('fires onChange(checked) and shows ON/OFF text on medium toggles', () => {
    const trigger = vi.fn();
    const { root } = renderRoot(byType('Toggle'), { mode: 'preview', trigger });
    const sw = screen.getByRole('switch', { name: 'Email notifications' });
    expect(root).toHaveTextContent('OFF');
    fireEvent.click(sw);
    expect(trigger).toHaveBeenCalledWith('onChange', true);
    expect(sw).toBeChecked();
    expect(root).toHaveTextContent('ON');
  });

  it('applies size, labelDisplay and custom texts', () => {
    const top = renderRoot(byType('Toggle'), { props: { label: 'Sync', labelDisplay: 'top', textChecked: 'YES', checked: true } });
    expect(top.root).toHaveClass('hsp-switch-label-top', 'hsp-switch-medium');
    expect(top.root.firstElementChild).toHaveTextContent('Sync');
    expect(top.root).toHaveTextContent('YES');
    cleanup();
    const small = renderRoot(byType('Toggle'), { props: { label: 'Sync', size: 'xs', labelDisplay: 'hidden' } });
    expect(small.root).toHaveClass('hsp-switch-extra-small');
    expect(small.root.querySelector('.hsp-switch-text')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Sync' })).toBeInTheDocument();
    expect(small.root.querySelector('.hsp-switch-label')).toBeNull();
  });
});

describe('ToggleGroup', () => {
  it('checkboxList reports string[] in option order', async () => {
    const user = userEvent.setup();
    const trigger = vi.fn();
    const { root } = renderRoot(byType('ToggleGroup'), { mode: 'preview', trigger });
    expect(root).toHaveAttribute('role', 'group');
    expect(screen.getByRole('group', { name: 'Preferred channels' })).toBe(root);
    await user.click(screen.getByRole('checkbox', { name: 'SMS' }));
    expect(trigger).toHaveBeenLastCalledWith('onChange', ['sms']);
    await user.click(screen.getByRole('checkbox', { name: 'Email' }));
    expect(trigger).toHaveBeenLastCalledWith('onChange', ['email', 'sms']);
    await user.click(screen.getByRole('checkbox', { name: 'SMS' }));
    expect(trigger).toHaveBeenLastCalledWith('onChange', ['email']);
    expect(root.querySelector('input[type="hidden"]')).toHaveAttribute(FORM_VALUE_ATTR, '["email"]');
  });

  it('radioButtonList reports a single string and honours option flags', () => {
    const trigger = vi.fn();
    const { root } = renderRoot(byType('ToggleGroup'), {
      mode: 'preview',
      trigger,
      props: {
        toggleType: 'radioButtonList',
        name: 'tier',
        label: 'Tier',
        inline: true,
        options: [
          { label: 'Free', value: 'free', initialIsChecked: true, description: 'Forever free' },
          { label: 'Pro', value: 'pro' },
          { label: 'Legacy', value: 'legacy', readOnly: true },
        ],
      },
    });
    expect(root.querySelector('.hsp-toggle-group-inline')).not.toBeNull();
    expect(root).toHaveTextContent('Forever free');
    expect(screen.getByRole('radio', { name: /Free/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'Legacy' }));
    expect(trigger).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Pro' }));
    expect(trigger).toHaveBeenCalledWith('onChange', 'pro');
    expect(screen.getByRole('radio', { name: 'Pro' })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Free/ })).not.toBeChecked();
  });

  it('accepts a controlled value of either shape', () => {
    renderRoot(byType('ToggleGroup'), { props: { name: 'c', label: 'C', toggleType: 'checkboxList', options: [{ label: 'A', value: 'a' }], value: 'a' } });
    expect(screen.getByRole('checkbox', { name: 'A' })).toBeChecked();
    cleanup();
    renderRoot(byType('ToggleGroup'), { props: { name: 'c', label: 'C', toggleType: 'radioButtonList', options: [{ label: 'A', value: 'a' }], value: ['a'] } });
    expect(screen.getByRole('radio', { name: 'A' })).toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

describe('Form', () => {
  const STAGES = [
    { label: 'Open', value: 'open' },
    { label: 'Closed won', value: 'closedwon' },
  ];
  const fields = (
    <>
      <Child type="Input" props={{ label: 'First name', name: 'firstname' }} />
      <Child type="NumberInput" props={{ label: 'Qty', name: 'qty', defaultValue: 3 }} />
      <Child type="Checkbox" props={{ name: 'subscribe', initialIsChecked: true }} text="Subscribe" />
      <Child type="Checkbox" props={{ name: 'terms' }} text="Terms" />
      <Child type="Checkbox" props={{ name: 'optin', value: 'yes' }} text="Opt in" />
      <Child type="Select" props={{ label: 'Stage', name: 'stage', value: 'closedwon', options: STAGES }} />
      <Child type="MultiSelect" props={{ label: 'Tags', name: 'tags', value: ['a', 1], options: [] }} />
      <Child
        type="ToggleGroup"
        props={{ toggleType: 'checkboxList', name: 'channels', label: 'Channels', options: [{ label: 'Email', value: 'email', initialIsChecked: true }, { label: 'SMS', value: 'sms' }] }}
      />
      <Child type="ToggleGroup" props={{ toggleType: 'radioButtonList', name: 'plan', label: 'Plan', options: [{ label: 'A', value: 'a' }], value: 'a' }} />
      <Child type="DateInput" props={{ label: 'Close', name: 'closedate', defaultValue: { year: 2026, month: 2, date: 31 } }} />
      <Child type="TimeInput" props={{ label: 'At', name: 'at', defaultValue: { hours: 9, minutes: 0 } }} />
      <Child type="Toggle" props={{ label: 'Enabled', name: 'enabled', checked: true }} />
      <Child type="TextArea" props={{ label: 'Untouched', name: 'notes' }} />
      <Child type="CurrencyInput" props={{ label: 'Empty amount', name: 'amount' }} />
    </>
  );

  function renderForm(children: ReactNode, trigger: PreviewProps['trigger'] = vi.fn()) {
    const { root } = renderRoot(byType('Form'), { mode: 'preview', trigger, children });
    const submits: Event[] = [];
    root.addEventListener('submit', (e) => submits.push(e));
    return { root, submits };
  }

  it('renders a real <form> with autoComplete and its children', () => {
    const { root } = renderRoot(byType('Form'), { props: { autoComplete: 'off' }, children: <span>inside</span> });
    expect(root.tagName).toBe('FORM');
    expect(root).toHaveAttribute('autocomplete', 'off');
    expect(root).toHaveTextContent('inside');
  });

  it('submits via a type=submit button with values by input name, without reloading', async () => {
    const user = userEvent.setup();
    const trigger = vi.fn();
    const { submits } = renderForm(
      <>
        {fields}
        <button type="submit">Send</button>
      </>,
      trigger,
    );
    await user.type(screen.getByLabelText('First name'), 'Ada');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(submits).toHaveLength(1);
    expect(submits[0].defaultPrevented).toBe(true);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith(
      'onSubmit',
      expect.objectContaining({
        type: 'submit',
        id: 'n_test',
        targetValue: {
          firstname: 'Ada',
          qty: 3,
          subscribe: true,
          terms: false,
          stage: 'closedwon',
          tags: ['a', 1],
          channels: ['email'],
          plan: 'a',
          closedate: { year: 2026, month: 2, date: 31 },
          at: { hours: 9, minutes: 0 },
          enabled: true,
          notes: '',
          amount: '',
        },
      }),
    );
  });

  it('submits on Enter in a text input (implicit submission)', async () => {
    const user = userEvent.setup();
    const trigger = vi.fn();
    renderForm(
      <>
        <Child type="Input" props={{ label: 'Email', name: 'email' }} />
        <button type="submit">Go</button>
      </>,
      trigger,
    );
    await user.type(screen.getByLabelText('Email'), 'a@b.co{Enter}');
    expect(trigger).toHaveBeenCalledWith('onSubmit', expect.objectContaining({ targetValue: { email: 'a@b.co' } }));
  });

  it("does not submit when the inputs' own buttons are used", async () => {
    const user = userEvent.setup();
    const trigger = vi.fn();
    renderForm(
      <>
        <Child type="StepperInput" props={{ label: 'Seats', name: 'seats', defaultValue: 1 }} />
        <Child type="Select" props={{ label: 'Stage', name: 'stage', options: STAGES }} />
        <Child type="SearchInput" props={{ label: 'Find', name: 'q', defaultValue: 'x' }} />
        <Child type="DateInput" props={{ label: 'When', name: 'when', defaultValue: { year: 2026, month: 0, date: 1 } }} />
      </>,
      trigger,
    );
    await user.click(screen.getByRole('button', { name: 'Increase' }));
    await user.click(screen.getByRole('button', { name: /Stage/ }));
    await user.click(screen.getByRole('option', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    await user.click(screen.getByLabelText('When'));
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(trigger).not.toHaveBeenCalled();
  });

  it('does not submit an ancestor form from a nested one', () => {
    // React warns about <form> in <form> (invalid in HubSpot too); the preview must still be safe.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const outer = vi.fn();
    const inner = vi.fn();
    const Form = byType('Form').preview;
    renderForm(
      <Form
        node={{ id: 'inner', type: 'Form', props: {}, children: [] }}
        props={{}}
        text=""
        slots={{}}
        mode="preview"
        rootProps={{ 'data-node-id': 'inner', 'data-node-type': 'Form' }}
        trigger={inner}
      >
        <button type="submit">Inner</button>
      </Form>,
      outer,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Inner' }));
    expect(inner).toHaveBeenCalledWith('onSubmit', expect.objectContaining({ id: 'inner' }));
    expect(outer).not.toHaveBeenCalled();
    expect(String(consoleError.mock.calls[0]?.[0])).toMatch(/validateDOMNesting/);
    consoleError.mockRestore();
  });
});

describe('collectFormValues', () => {
  it('reads typed values, checkbox/radio semantics and skips disabled or unnamed elements', () => {
    const { container } = render(
      <form>
        <input name="text" defaultValue="hello" />
        <input name="typed" {...{ [FORM_VALUE_ATTR]: '{"a":1}' }} defaultValue="ignored" />
        <input name="broken" {...{ [FORM_VALUE_ATTR]: '{oops' }} defaultValue="fallback" />
        <input type="checkbox" name="flag" />
        <input type="checkbox" name="withValue" value="v" />
        <input type="checkbox" name="withValueOn" value="v" defaultChecked />
        <input type="radio" name="r" value="one" />
        <input type="radio" name="r" value="two" defaultChecked />
        <input name="off" disabled defaultValue="x" />
        <input defaultValue="no name" />
        <textarea name="area" defaultValue="multi" />
        <select name="sel" defaultValue="b">
          <option value="a">A</option>
          <option value="b">B</option>
        </select>
      </form>,
    );
    expect(collectFormValues(container.querySelector('form') as HTMLFormElement)).toEqual({
      text: 'hello',
      typed: { a: 1 },
      broken: 'fallback',
      flag: false,
      withValueOn: 'v',
      r: 'two',
      area: 'multi',
      sel: 'b',
    });
  });
});
