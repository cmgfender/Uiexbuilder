/**
 * Node tree -> JSX, plus the event handlers the JSX refers to.
 *
 * Layout follows prettier's conventions closely enough that the output reads like hand-written
 * code: elements stay on one line when they fit in 80 columns, otherwise attributes / children
 * break onto their own lines with 2-space indentation.
 */
import { getComponent } from '../registry';
import type { ComponentDef, EventDef, PropDef, PropType } from '../registry/types';
import type { ActionStep, JsonValue, NodeId, PropValue, UINode } from '../model/types';
import { isExpr, ROOT_TYPE } from '../model/types';
import { toPascalCase } from '../model/ids';
import { collectStepCode, emitSteps, stepsNeedAsync, type HandlerScope } from './actions';
import type { GenContext, NameAllocator } from './context';
import { importValue, stateSetter, useHelper } from './context';
import {
  asConditionalTest,
  asOperand,
  CodeWriter,
  INDENT,
  indentLines,
  isIdentifierName,
  isJsxAttributeName,
  jsArray,
  jsCode,
  jsObject,
  jsxAttributeString,
  PRINT_WIDTH,
  printJs,
  printNumber,
  scanCode,
  type JsNode,
} from './printer';
import { asString, templateValue, textChildren, userExpr } from './templates';

/** A handler declared in the component body. */
export interface HandlerDecl {
  name: string;
  /** Full declaration lines (relative to the component body indentation). */
  lines: string[];
}

/** A variable bound by an enclosing repeat. */
interface RepeatBinding {
  name: string;
  kind: 'item' | 'index';
}

type Rendered =
  | { kind: 'element'; lines: string[] }
  | { kind: 'expr'; lines: string[] }
  | { kind: 'comment'; text: string };

interface Attr {
  name: string;
  /** null = boolean shorthand (`disabled`). Otherwise `"..."` or `{...}` (possibly multi-line). */
  value: string[] | null;
}

export class JsxRenderer {
  readonly handlers: HandlerDecl[] = [];
  /** Nodes currently being rendered (guards against cyclic references in malformed documents). */
  private readonly active = new Set<NodeId>();
  /** Node whose rendering is recorded while the whole tree renders (generateNodeJsx). */
  private captureId: NodeId | null = null;
  private captured: Rendered | null = null;

  constructor(private readonly ctx: GenContext) {}

  /** Children of the extension root, laid out at column `col`. */
  renderRoot(col: number): string[] {
    const root = this.ctx.ext.nodes[this.ctx.ext.rootId];
    if (!root) return [];
    return this.renderChildList(root.children, [], col);
  }

  /** Records the output of node `id` during the next render (see capturedJsx). */
  capture(id: NodeId): void {
    this.captureId = id;
    this.captured = null;
  }

  /**
   * The captured node as it appears in the component: a JSX child (`{cond ? <X /> : null}` for
   * expressions) or, for slot content (`asSlotContent`), the bare element / expression. Null when
   * the node was not rendered.
   */
  capturedJsx(asSlotContent: boolean): string[] | null {
    return this.captured ? this.asJsx(this.captured, asSlotContent) : null;
  }

  /**
   * Renders a node outside of the tree pass (nodes the tree does not reach). `repeatScope` lists
   * the item / index names of enclosing repeats, outermost first.
   */
  renderDetached(id: NodeId, repeatScope: Array<{ itemName: string; indexName: string }>, asSlotContent: boolean): string[] | null {
    const scope: RepeatBinding[] = [];
    for (const r of repeatScope) {
      const item = validLocalName(r.itemName, 'item');
      let index = validLocalName(r.indexName, 'index');
      if (index === item) index = `${item}Index`;
      const kept = scope.filter((b) => b.name !== item && b.name !== index);
      scope.length = 0;
      scope.push(...kept, { name: item, kind: 'item' }, { name: index, kind: 'index' });
    }
    const r = this.renderNode(id, scope, 0);
    return r ? this.asJsx(r, asSlotContent) : null;
  }

  private asJsx(r: Rendered, asSlotContent: boolean): string[] {
    if (r.kind === 'comment') return [`{/* ${r.text} */}`];
    if (asSlotContent || r.kind === 'element') return r.lines;
    return wrapBraces(r.lines);
  }

  private renderChildList(ids: NodeId[] | undefined, scope: RepeatBinding[], col: number): string[] {
    const lines: string[] = [];
    for (const id of Array.isArray(ids) ? ids : []) lines.push(...this.renderChild(id, scope, col));
    return lines;
  }

  /** A node as a JSX child (expressions wrapped in `{}`). */
  private renderChild(id: NodeId, scope: RepeatBinding[], col: number): string[] {
    const r = this.renderNode(id, scope, col);
    if (!r) return [];
    if (r.kind === 'comment') return [`{/* ${r.text} */}`];
    if (r.kind === 'element') return r.lines;
    return wrapBraces(r.lines);
  }

  /** A node with its repeat / condition applied. */
  private renderNode(id: NodeId, scope: RepeatBinding[], col: number): Rendered | null {
    const node = this.ctx.ext.nodes[id];
    if (!node || node.type === ROOT_TYPE || this.active.has(id)) return null;
    this.active.add(id);
    try {
      const rendered = this.renderNodeInner(node, scope, col);
      if (id === this.captureId && !this.captured && rendered) this.captured = rendered;
      return rendered;
    } finally {
      this.active.delete(id);
    }
  }

  private renderNodeInner(node: UINode, scope: RepeatBinding[], col: number): Rendered | null {
    const def = getComponent(node.type);
    if (!def) return { kind: 'comment', text: `Unknown component ${String(node.type).replace(/\*\//g, '')}` };
    if (!node.props || typeof node.props !== 'object') node = { ...node, props: {} };
    const condition = asString(node.condition).trim();

    if (node.repeat && typeof node.repeat.items === 'string' && node.repeat.items.trim() !== '') {
      const itemName = validLocalName(node.repeat.itemName, 'item');
      let indexName = validLocalName(node.repeat.indexName, 'index');
      if (indexName === itemName) indexName = `${itemName}Index`;
      const inner: RepeatBinding[] = [
        ...scope.filter((b) => b.name !== itemName && b.name !== indexName),
        { name: itemName, kind: 'item' },
        { name: indexName, kind: 'index' },
      ];
      const keyCode = asString(node.repeat.key);
      const key = keyCode.trim() !== '' ? asOperand(userExpr(this.ctx, keyCode)) : indexName;
      const elementCol = col + INDENT.length * (condition ? 2 : 1);
      const element = this.renderElement(node, def, inner, elementCol, key);
      const body = condition ? this.conditional(condition, element, col + INDENT.length) : null;
      const used = (name: string) => mentions([...element, ...(body ?? [])], name);
      const itemParam = used(itemName) ? itemName : `_${itemName}`;
      const indexParam = used(indexName) ? `, ${indexName}: number` : '';
      this.ctx.usesAny = true;
      const items = asOperand(userExpr(this.ctx, node.repeat.items));
      const head = `${useHelper(this.ctx, 'asArray')}(${items}).map((${itemParam}: any${indexParam}) =>`;
      if (body) return { kind: 'expr', lines: [head, ...indentLines(body), ')'] };
      return { kind: 'expr', lines: [`${head} (`, ...indentLines(element), '))'] };
    }

    if (condition) {
      const element = this.renderElement(node, def, scope, col + INDENT.length);
      return { kind: 'expr', lines: this.conditional(condition, element, col) };
    }
    return { kind: 'element', lines: this.renderElement(node, def, scope, col) };
  }

  /** `test ? <X /> : null` — a ternary, so falsy values such as 0 never render. */
  private conditional(condition: string, element: string[], col: number): string[] {
    const test = asConditionalTest(userExpr(this.ctx, condition));
    if (element.length === 1) {
      const inline = `${test} ? ${element[0]} : null`;
      if (col + inline.length + 2 <= PRINT_WIDTH) return [inline];
    }
    return [`${test} ? (`, ...indentLines(element), ') : null'];
  }

  private renderElement(node: UINode, def: ComponentDef, scope: RepeatBinding[], col: number, key?: string): string[] {
    // Compound components (`Dropdown.ButtonItem`) import their namespace (`Dropdown`) once.
    const importName = def.importName ?? def.type.split('.')[0];
    const local = importValue(this.ctx, def.importFrom, importName);
    const inNamespace = def.type === importName || def.type.startsWith(`${importName}.`);
    const tag = inNamespace ? local + def.type.slice(importName.length) : def.type;
    const attrCol = col + INDENT.length;
    const attrs: Attr[] = [];
    if (key !== undefined) attrs.push({ name: 'key', value: [`{${key}}`] });
    attrs.push(...this.propAttrs(node, def, attrCol));
    attrs.push(...this.eventAttrs(node, def, scope));
    attrs.push(...this.slotAttrs(node, def, scope, attrCol));

    // Children
    let children: { kind: 'none' } | { kind: 'text'; text: string } | { kind: 'nodes'; lines: string[] };
    if (def.children.mode === 'text') {
      children = { kind: 'text', text: textChildren(this.ctx, node.text) };
    } else if (def.children.mode === 'nodes') {
      const lines = this.renderChildList(node.children, scope, col + INDENT.length);
      if (lines.length) children = { kind: 'nodes', lines };
      else if (def.children.required) children = { kind: 'text', text: '{null}' };
      else children = { kind: 'none' };
    } else {
      children = { kind: 'none' };
    }

    const singleLineAttrs = attrs.every((a) => a.value === null || a.value.length === 1);
    const inlineAttrs = attrs.map((a) => (a.value === null ? ` ${a.name}` : ` ${a.name}=${a.value[0]}`)).join('');
    const multiAttrs = (): string[] => {
      const out: string[] = [];
      for (const a of attrs) {
        if (a.value === null) out.push(a.name);
        else out.push(`${a.name}=${a.value[0]}`, ...a.value.slice(1));
      }
      return indentLines(out);
    };

    if (children.kind === 'none') {
      const inline = `<${tag}${inlineAttrs} />`;
      if (singleLineAttrs && col + inline.length <= PRINT_WIDTH) return [inline];
      if (attrs.length === 0) return [inline];
      return [`<${tag}`, ...multiAttrs(), '/>'];
    }

    const openInline = `<${tag}${inlineAttrs}>`;
    const close = `</${tag}>`;
    const openFits = singleLineAttrs && col + openInline.length <= PRINT_WIDTH;
    const open = openFits || attrs.length === 0 ? [openInline] : [`<${tag}`, ...multiAttrs(), '>'];

    if (children.kind === 'text') {
      const inline = `${openInline}${children.text}${close}`;
      if (openFits && col + inline.length <= PRINT_WIDTH) return [inline];
      return [...open, `${INDENT}${children.text}`, close];
    }
    return [...open, ...indentLines(children.lines), close];
  }

  // -------------------------------------------------------------------------
  // Props
  // -------------------------------------------------------------------------

  private propAttrs(node: UINode, def: ComponentDef, attrCol: number): Attr[] {
    const binding = this.bindingOf(node, def);
    const slotNames = new Set((def.slots ?? []).filter((s) => (node.slots?.[s.name]?.length ?? 0) > 0).map((s) => s.name));
    const skip = (name: string) =>
      name === 'children' ||
      name === 'key' ||
      name === 'ref' ||
      /^on[A-Z]/.test(name) ||
      slotNames.has(name) ||
      (binding !== null && name === binding.prop) ||
      !isJsxAttributeName(name) ||
      isHiddenProp(def, node, name);

    const known = def.props.map((p) => p.name);
    const names = [
      ...known.filter((n) => Object.prototype.hasOwnProperty.call(node.props, n)),
      ...Object.keys(node.props).filter((n) => !known.includes(n)),
    ];
    const attrs: Attr[] = [];
    for (const name of names) {
      if (skip(name)) continue;
      const value = node.props[name];
      if (value === undefined) continue;
      const propDef = def.props.find((p) => p.name === name);
      const attr = this.propAttr(name, value, propDef, attrCol);
      if (attr) attrs.push(attr);
    }
    if (binding) {
      const propDef = def.props.find((p) => p.name === binding.prop);
      attrs.push({ name: binding.prop, value: [`{${this.castIfNeeded(binding.state, 'expr', propDef)}}`] });
    }
    return attrs;
  }

  private propAttr(name: string, value: PropValue, propDef: PropDef | undefined, attrCol: number): Attr | null {
    if (isExpr(value)) {
      if (value.$expr.trim() === '') return null;
      const code = userExpr(this.ctx, value.$expr);
      return { name, value: [`{${asOperand(this.castIfNeeded(code, 'expr', propDef))}}`] };
    }
    if (typeof value === 'string') {
      const t = templateValue(this.ctx, value);
      if (t.origin === 'literal') return { name, value: [jsxAttributeString(t.text) ?? `{${t.code}}`] };
      return { name, value: [`{${asOperand(this.castIfNeeded(t.code, t.origin, propDef))}}`] };
    }
    if (value === true) return { name, value: null };
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
      return { name, value: [`{${value === null ? 'null' : String(value)}}`] };
    }
    const target: ValueType = propDef ? propDef.type : { kind: 'loose' };
    const lines = printJs(this.typedLiteral(value as JsonValue, target), attrCol, attrCol + name.length + 2, 1);
    lines[0] = `{${lines[0]}`;
    lines[lines.length - 1] += '}';
    return { name, value: lines };
  }

  /**
   * A literal array / object prop value with template strings at any depth (template rule 4).
   * Template values nested in positions whose type the registry describes (object fields such as
   * Text `format.fontWeight`, option labels / values, string lists) are cast like top-level props
   * when their static type cannot fit; positions of unknown shape (JSON props) are left as is.
   */
  private typedLiteral(value: JsonValue, target: ValueType): JsNode {
    if (typeof value === 'string') {
      const t = templateValue(this.ctx, value);
      if (t.origin === 'literal') return jsCode(t.code);
      return jsCode(asOperand(this.castTo(t.code, t.origin, target)));
    }
    if (typeof value === 'number') return jsCode(printNumber(value));
    if (typeof value === 'boolean') return jsCode(String(value));
    if (value === null) return jsCode('null');
    if (Array.isArray(value)) return jsArray(value.map((v) => this.typedLiteral(v, elementType(target))));
    return jsObject(Object.entries(value).map(([k, v]) => [k, this.typedLiteral(v, fieldType(target, k))]));
  }

  /**
   * Casts an expression to `any` when it is known not to fit the prop's TypeScript type: a state
   * variable typed string/number/boolean passed to a narrower prop (e.g. a string state driving a
   * `variant` enum), or an interpolated string passed to a non-string prop. Everything else in
   * the expression scope is loosely typed already. Props the registry does not describe (raw
   * props) are cast whenever the value has such a known primitive type.
   */
  private castIfNeeded(code: string, origin: 'expr' | 'interpolated' | 'literal', propDef: PropDef | undefined): string {
    return this.castTo(code, origin, propDef ? propDef.type : { kind: 'unknown' });
  }

  private castTo(code: string, origin: 'expr' | 'interpolated' | 'literal', target: ValueType): string {
    if (origin === 'literal') return code;
    let staticType: StaticType | null = null;
    if (origin === 'interpolated') staticType = 'string';
    else {
      const state = this.ctx.states.get(code);
      if (state && (state.type === 'string' || state.type === 'number' || state.type === 'boolean')) {
        staticType = state.initial === null ? 'nullable' : state.type;
      }
    }
    if (staticType === null || typeAccepts(target, staticType)) return code;
    this.ctx.usesAny = true;
    return `${code} as any`;
  }

  // -------------------------------------------------------------------------
  // Binding & events
  // -------------------------------------------------------------------------

  private bindingOf(node: UINode, def: ComponentDef): { prop: string; event: string; state: string } | null {
    if (!node.binding || !def.valueBinding) return null;
    const state = this.ctx.states.get(node.binding.state);
    if (!state) return null;
    // A binding to a prop the current union variant does not have (e.g. Table `page` while not
    // paginated) is inactive, like the hidden prop itself.
    if (isHiddenProp(def, node, def.valueBinding.prop)) return null;
    return { prop: def.valueBinding.prop, event: def.valueBinding.event, state: state.name };
  }

  private eventAttrs(node: UINode, def: ComponentDef, scope: RepeatBinding[]): Attr[] {
    const binding = this.bindingOf(node, def);
    const literalProps: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node.props)) if (!isExpr(v)) literalProps[k] = v;
    const attrs: Attr[] = [];
    for (const event of def.events ?? []) {
      const rawSteps = node.events?.[event.name];
      const steps = Array.isArray(rawSteps) ? rawSteps : [];
      const bound = binding !== null && binding.event === event.name ? binding.state : null;
      let required = false;
      try {
        required = event.requiredWhen?.(literalProps) ?? false;
      } catch {
        required = false;
      }
      if (steps.length === 0 && bound === null) {
        // `() => undefined` rather than `() => {}`: typescript-eslint's stylistic config rejects
        // empty functions (no-empty-function) in the exported project's lint setup.
        if (required) attrs.push({ name: event.name, value: ['{() => undefined}'] });
        continue;
      }
      const params = event.params.map((p, i) => validLocalName(p.name, `arg${i + 1}`));
      if (steps.length === 0 && bound !== null) {
        const p = params[0] ?? 'value';
        this.ctx.usesAny = true;
        attrs.push({ name: event.name, value: [`{(${p}: any) => ${stateSetter(this.ctx, bound)}(${p})}`] });
        continue;
      }
      attrs.push({ name: event.name, value: [this.namedHandler(node, def, event, params, steps, bound, scope)] });
    }
    return attrs;
  }

  /** Declares `const handleXxx = (...) => {...}` and returns the attribute value referencing it. */
  private namedHandler(
    node: UINode,
    def: ComponentDef,
    event: EventDef,
    params: string[],
    steps: ActionStep[],
    bound: string | null,
    scope: RepeatBinding[],
  ): string {
    const ctx = this.ctx;
    const used = new Set<string>();
    for (const code of collectStepCode(steps)) scanCode(code).identifiers.forEach((id) => used.add(id));
    if (bound !== null && params.length > 0) used.add(params[0]);

    // Keep params up to the last one used; unused earlier ones get a `_` prefix.
    let lastUsed = -1;
    params.forEach((p, i) => {
      if (used.has(p)) lastUsed = i;
    });
    const eventParams = params.slice(0, lastUsed + 1).map((p) => (used.has(p) ? p : `_${p}`));
    // Repeat variables referenced by the steps (an event param of the same name shadows them).
    const repeatParams = scope.filter((b) => used.has(b.name) && !params.includes(b.name));

    const name = ctx.names.allocate(`handle${handlerBaseName(node, def)}${eventSuffix(event.name)}`);
    const local: NameAllocator = ctx.names.fork();
    ['response', 'error', ...params, ...scope.map((b) => b.name)].forEach((n) => local.reserve(n));
    const hs: HandlerScope = { ctx, local };

    const body = new CodeWriter();
    if (bound !== null) body.line(`${stateSetter(ctx, bound)}(${params[0] ?? 'undefined'});`);
    emitSteps(body, steps, hs);

    const declParams = [
      ...eventParams.map((p) => `${p}: any`),
      ...repeatParams.map((b) => `${b.name}: ${b.kind === 'index' ? 'number' : 'any'}`),
    ];
    if (eventParams.length || repeatParams.some((b) => b.kind === 'item')) ctx.usesAny = true;
    const isAsync = stepsNeedAsync(steps);
    const head = `const ${name} = ${isAsync ? 'async ' : ''}(${declParams.join(', ')}) => {`;
    const bodyLines = body.toLines();
    const lines = bodyLines.length ? [head, ...indentLines(bodyLines), '};'] : [`${head}};`];
    this.handlers.push({ name, lines });

    if (repeatParams.length === 0) return `{${name}}`;
    const wrapperParams = eventParams.map((p) => `${p}: any`).join(', ');
    const args = [...eventParams, ...repeatParams.map((b) => b.name)].join(', ');
    return `{(${wrapperParams}) => ${name}(${args})}`;
  }

  // -------------------------------------------------------------------------
  // Slots
  // -------------------------------------------------------------------------

  private slotAttrs(node: UINode, def: ComponentDef, scope: RepeatBinding[], attrCol: number): Attr[] {
    const attrs: Attr[] = [];
    for (const slot of def.slots ?? []) {
      const slotIds = node.slots?.[slot.name];
      const ids = Array.isArray(slotIds) ? slotIds : [];
      if (ids.length === 0 || !isJsxAttributeName(slot.name)) continue;
      const contentCol = attrCol + INDENT.length;
      let content: string[];
      if (ids.length === 1) {
        const r = this.renderNode(ids[0], scope, contentCol);
        if (!r || r.kind === 'comment') continue;
        content = r.lines;
      } else {
        const children = this.renderChildList(ids, scope, contentCol + INDENT.length);
        if (children.length === 0) continue;
        content = ['<>', ...indentLines(children), '</>'];
      }
      const inline = content.length === 1 ? `{${content[0]}}` : null;
      if (inline !== null && attrCol + slot.name.length + 1 + inline.length <= PRINT_WIDTH) {
        attrs.push({ name: slot.name, value: [inline] });
      } else {
        attrs.push({ name: slot.name, value: ['{', ...indentLines(content), '}'] });
      }
    }
    return attrs;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Whether a prop is hidden by its `visibleWhen` predicate given the node's props. The inspector
 * hides such props because they belong to another variant of a discriminated union (e.g. Table
 * `pageCount` without `paginated`, TableHeader `disabled` without sorting), where TypeScript
 * rejects them, so codegen omits them too. Predicates see expression props as `{ $expr }` objects.
 */
function isHiddenProp(def: ComponentDef, node: UINode, name: string): boolean {
  const propDef = def.props.find((p) => p.name === name);
  if (!propDef?.visibleWhen) return false;
  try {
    return !propDef.visibleWhen(node.props as Record<string, unknown>);
  } catch {
    return false;
  }
}

function wrapBraces(lines: string[]): string[] {
  if (lines.length === 1) return [`{${lines[0]}}`];
  return [`{${lines[0]}`, ...lines.slice(1, -1), `${lines[lines.length - 1]}}`];
}

/** Whether `name` appears as a whole identifier word in any of the lines. */
function mentions(lines: string[], name: string): boolean {
  const re = new RegExp(`(?<![A-Za-z0-9_$])${name.replace(/\$/g, '\\$')}(?![A-Za-z0-9_$])`);
  return lines.some((l) => re.test(l));
}

function validLocalName(name: string | undefined, fallback: string): string {
  return name && isIdentifierName(name) ? name : fallback;
}

/** 'onClick' -> 'Click', 'onSelectedChange' -> 'SelectedChange'. */
function eventSuffix(eventName: string): string {
  const s = eventName.startsWith('on') && eventName.length > 2 ? eventName.slice(2) : eventName;
  return toPascalCase(s, 'Event');
}

/** Readable base for a handler name: layer name, text, label/title, then the component label. */
function handlerBaseName(node: UINode, def: ComponentDef): string {
  const literal = (key: string) => {
    const v = node.props[key];
    return typeof v === 'string' ? v : undefined;
  };
  const candidates = [
    node.name,
    node.text,
    literal('label'),
    literal('title'),
    literal('buttonText'),
    literal('name'),
    def.label,
    def.type,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const cleaned = candidate.replace(/\{\{[\s\S]*?\}\}/g, ' ');
    const pascal = toPascalCase(cleaned, '');
    const words = pascal.match(/[A-Z][a-z0-9]*|[0-9]+|[a-z][a-z0-9]*/g) ?? [];
    const base = words.slice(0, 3).join('');
    if (/^[A-Za-z][A-Za-z0-9]*$/.test(base)) return base;
  }
  return 'Component';
}

/** Statically known type of generated code: a typed primitive state or an interpolated string. */
type StaticType = 'string' | 'number' | 'boolean' | 'nullable';

/**
 * What a prop (or a position inside a literal prop value) accepts: a registry PropType, or
 *  - 'scalar'  : string | number | boolean (Select / MultiSelect option values)
 *  - 'loose'   : anything (JSON props; unknown keys) — never cast
 *  - 'unknown' : a raw prop the registry does not describe — cast every known primitive type
 */
type ValueType = PropType | { kind: 'scalar' } | { kind: 'loose' } | { kind: 'unknown' };

const LOOSE: ValueType = { kind: 'loose' };
const STRING: ValueType = { kind: 'string' };
const NUMBER: ValueType = { kind: 'number' };
const BOOLEAN: ValueType = { kind: 'boolean' };

/** Type of the elements of an array literal in a position of type `t`. */
function elementType(t: ValueType): ValueType {
  // Restricted string lists (e.g. ChartColor[]) hold enum items; others hold plain strings.
  if (t.kind === 'stringList') return t.options ? { kind: 'enum', options: t.options } : STRING;
  // An `options` array holds option objects; fieldType() resolves their keys.
  if (t.kind === 'options') return t;
  return LOOSE;
}

/** Type of the property `key` of an object literal in a position of type `t`. */
function fieldType(t: ValueType, key: string): ValueType {
  switch (t.kind) {
    case 'object':
      return t.fields.find((f) => f.name === key)?.type ?? LOOSE;
    case 'options':
      // HubSpot option types: { label: string; value: ...; description?: string } plus the
      // ToggleGroup-only flags, whose option `value` is a string (Select / MultiSelect: scalar).
      if (key === 'label' || key === 'description') return STRING;
      if (key === 'initialIsChecked' || key === 'readOnly') return BOOLEAN;
      if (key === 'value') return t.optionFields?.includes('initialIsChecked') ? STRING : { kind: 'scalar' };
      return LOOSE;
    case 'date':
      return key === 'year' || key === 'month' || key === 'date' ? NUMBER : LOOSE;
    case 'time':
      return key === 'hours' || key === 'minutes' ? NUMBER : LOOSE;
    default:
      return LOOSE;
  }
}

/** Whether a value whose static type is `t` fits the target type. */
function typeAccepts(type: ValueType, t: StaticType): boolean {
  if (type.kind === 'loose') return true;
  if (t === 'nullable') return false;
  switch (type.kind) {
    case 'scalar':
      return true;
    case 'string':
    case 'url':
    case 'href':
      return t === 'string';
    case 'number':
      return t === 'number';
    case 'boolean':
      return t === 'boolean';
    case 'enum': {
      if (t !== 'boolean') return false;
      const values = type.options.map((o) => o.value);
      return values.includes(true) && values.includes(false);
    }
    default:
      return false;
  }
}
