/**
 * Generates the TSX source of one extension (card, settings page or app home page).
 *
 * Output shape (matches HubSpot's 2026.03 templates):
 *   imports
 *   module helpers (toText / asArray, only when used)
 *   user helper code (Extension.helpers; untyped parameters annotated `any`)
 *   interface ExtensionProps { context; actions }
 *   hubspot.extend<'<location>'>(({ context, actions }) => <Component ... />);
 *   const Component = ({ context, actions }: ExtensionProps) => {
 *     state, data sources, computed values (`const x: any = expr;`, in order), handlers
 *     return (<>...</>);
 *   };
 *
 * Computed values are declared after every data source, so data source options cannot use them
 * (validation reports it); they can use state, data, context, helpers and earlier computed values.
 */
import { ALL_COMPONENTS, getComponent } from '../registry';
import { TO_TEXT_HELPER_SOURCE } from '../model/template';
import { toPascalCase } from '../model/ids';
import { buildParentIndex } from '../model/tree';
import type { Extension, JsonValue, NodeId, Project, StateVar } from '../model/types';
import { isExpr } from '../model/types';
import { COMPUTED_FORBIDDEN_NAMES } from '../power/computed';
import { prepareHelpersForTypeScript } from '../power/helpers';
import { collectStepCode } from './actions';
import type { GenContext } from './context';
import { createContext, declaredStateNames, importValue, setterName, UI_EXTENSIONS, type HelperName } from './context';
import { dataSourceExposedNames, dataSourceSetterNames, emitDataSources, planDataSources } from './dataSources';
import { JsxRenderer } from './jsx';
import { asString, userExpr } from './templates';
import {
  asOperand,
  CodeWriter,
  INDENT,
  indentLines,
  isIdentifierName,
  jsArray,
  jsCode,
  jsObject,
  printNumber,
  quoteString,
  scanCode,
  writeCall,
  type JsNode,
} from './printer';

/** Source of the `asArray` helper used by repeats. */
export const AS_ARRAY_HELPER_SOURCE = `const asArray = (value: unknown): any[] => (Array.isArray(value) ? value : []);`;

/** Context type of each extension location. */
function contextType(ctx: GenContext): string {
  if (ctx.location === 'settings') return 'SettingsContext';
  if (ctx.location === 'home') return 'AppHomeContext';
  return 'CrmContext';
}

/** Every user code fragment of the extension (expressions, templates, custom code). */
export function collectExtensionCode(ext: Extension): string[] {
  const out: string[] = [];
  const template = (s: string) => {
    for (const m of asString(s).matchAll(/\{\{([\s\S]*?)\}\}/g)) out.push(m[1]);
  };
  const literal = (v: JsonValue): void => {
    if (typeof v === 'string') template(v);
    else if (Array.isArray(v)) v.forEach(literal);
    else if (v && typeof v === 'object') Object.values(v).forEach(literal);
  };
  for (const node of Object.values(ext.nodes)) {
    for (const value of Object.values(node.props ?? {})) {
      if (isExpr(value)) out.push(value.$expr);
      else literal(value);
    }
    template(asString(node.text));
    out.push(asString(node.condition));
    if (node.repeat) out.push(asString(node.repeat.items), asString(node.repeat.key));
    for (const steps of Object.values(node.events ?? {})) out.push(...collectStepCode(steps));
  }
  for (const ds of Array.isArray(ext.dataSources) ? ext.dataSources : []) {
    if (!ds) continue;
    if (ds.kind === 'fetch') {
      template(asString(ds.url));
      out.push(asString(ds.body));
    } else if (ds.kind === 'function') out.push(asString(ds.parameters));
    else if (ds.kind === 'crmSearch') {
      template(asString(ds.query));
      (Array.isArray(ds.filters) ? ds.filters : []).forEach((f) => template(asString(f?.value)));
    }
  }
  for (const c of Array.isArray(ext.computed) ? ext.computed : []) {
    if (c && typeof c === 'object') out.push(asString(c.expr));
  }
  return out;
}

/**
 * Reserves every user-visible identifier so generated names never shadow them, and records the
 * names the document declares inside the component (`ctx.shadowed`) so module-level imports and
 * helpers with the same name are aliased.
 */
function reserveUserNames(ctx: GenContext): void {
  const { ext, names } = ctx;
  const declare = (name: string) => {
    names.reserve(name);
    ctx.shadowed.add(name);
  };
  for (const s of ctx.states.values()) {
    declare(s.name);
    declare(setterName(s.name));
    ctx.componentScope.add(s.name);
  }
  for (const ds of Array.isArray(ext.dataSources) ? ext.dataSources : []) {
    if (!ds || !isIdentifierName(ds.name)) continue;
    [...dataSourceExposedNames(ds), ...dataSourceSetterNames(ds)].forEach(declare);
  }
  for (const c of Array.isArray(ext.computed) ? ext.computed : []) {
    if (c && typeof c.name === 'string' && isIdentifierName(c.name)) declare(c.name);
  }
  // Helper declarations live at module level: imports / generated helpers with the same names are
  // aliased like shadowed names, and nothing generated may reuse a name the helper code mentions.
  ctx.userHelpers.names.forEach(declare);
  scanCode(ctx.userHelpers.code).identifiers.forEach((id) => names.reserve(id));
  for (const node of Object.values(ext.nodes)) {
    if (node.repeat) {
      declare(node.repeat.itemName);
      declare(node.repeat.indexName);
    }
    for (const event of getComponent(node.type)?.events ?? []) event.params.forEach((p) => declare(p.name));
  }
  for (const code of collectExtensionCode(ext)) {
    scanCode(code).identifiers.forEach((id) => {
      names.reserve(id);
      ctx.userIdentifiers.add(id);
    });
  }
  // Component identifiers that may be imported.
  for (const def of ALL_COMPONENTS) names.reserve(def.importName ?? def.type.split('.')[0]);
}

function jsonNode(value: JsonValue): JsNode {
  if (typeof value === 'string') return jsCode(quoteString(value));
  if (typeof value === 'number') return jsCode(printNumber(value));
  if (typeof value === 'boolean') return jsCode(String(value));
  if (value === null) return jsCode('null');
  if (Array.isArray(value)) return jsArray(value.map(jsonNode));
  return jsObject(Object.entries(value).map(([k, v]) => [k, jsonNode(v)]));
}

/**
 * `useState` type argument. Primitive states keep their type (`| null` when the initial value is
 * null); arrays are `any[]`; objects and `any` are `any` so they can feed typed props such as a
 * DateInput value (a `Record<string, any>` is not assignable to `{ year; month; date }`).
 */
function stateTypeArg(s: StateVar): string {
  const initial = s.initial;
  switch (s.type) {
    case 'string':
    case 'number':
    case 'boolean':
      if (initial === null) return `${s.type} | null`;
      return typeof initial === s.type ? s.type : 'any';
    case 'array':
      return Array.isArray(initial) ? 'any[]' : 'any';
    default:
      return 'any';
  }
}

function emitState(w: CodeWriter, ctx: GenContext): boolean {
  if (ctx.states.size === 0) return false;
  const useState = importValue(ctx, 'react', 'useState');
  for (const s of ctx.states.values()) {
    if (s.description && s.description.trim()) w.line(`// ${s.description.replace(/\s+/g, ' ').trim()}`);
    const typeArg = stateTypeArg(s);
    if (typeArg.includes('any')) ctx.usesAny = true;
    // The setter is only destructured when something calls it (bindings, actions, user code).
    const setter = setterName(s.name);
    const used = ctx.usedSetters.has(setter) || ctx.userIdentifiers.has(setter);
    const pattern = used ? `[${s.name}, ${setter}]` : `[${s.name}]`;
    writeCall(w, `const ${pattern} = `, `${useState}<${typeArg}>`, [jsonNode(s.initial ?? null)]);
  }
  return true;
}

/**
 * Chooses the computed values to declare: valid identifiers that do not redeclare a component
 * parameter, state variable (or setter), data source name or an earlier computed value. Must run
 * after planDataSources.
 */
function planComputed(ctx: GenContext): void {
  const declared = declaredStateNames(ctx.states.values());
  for (const plan of ctx.dataSources.values()) {
    [...dataSourceExposedNames(plan.source), ...dataSourceSetterNames(plan.source)].forEach((n) => declared.add(n));
  }
  for (const c of Array.isArray(ctx.ext.computed) ? ctx.ext.computed : []) {
    if (!c || typeof c.name !== 'string' || !isIdentifierName(c.name)) continue;
    if (COMPUTED_FORBIDDEN_NAMES.has(c.name) || declared.has(c.name)) continue;
    declared.add(c.name);
    ctx.computed.push(c);
  }
}

/**
 * `const <name>: any = <expr>;` per computed value, in order. Typed `any` so any well-formed
 * expression type-checks and the value can feed any prop, handler or later computed value.
 */
function emitComputed(w: CodeWriter, ctx: GenContext): boolean {
  if (ctx.computed.length === 0) return false;
  ctx.usesAny = true;
  for (const c of ctx.computed) {
    if (typeof c.description === 'string' && c.description.trim()) w.line(`// ${c.description.replace(/\s+/g, ' ').trim()}`);
    const code = asOperand(userExpr(ctx, asString(c.expr)));
    const head = `const ${c.name}: any = `;
    if (!code.includes('\n') || scanCode(code).hasMultilineLiteral) {
      // Multi-line string literals must be emitted verbatim (re-indenting would change them).
      w.line(`${head}${code};`);
      continue;
    }
    const [first, ...rest] = code.split('\n');
    const indents = rest.filter((l) => l.trim() !== '').map((l) => /^[ \t]*/.exec(l)?.[0].length ?? 0);
    const common = indents.length ? Math.min(...indents) : 0;
    const lines = [`${head}${first.trimEnd()}`, ...rest.map((l) => (l.trim() === '' ? '' : INDENT + l.slice(common).trimEnd()))];
    lines[lines.length - 1] += ';';
    w.lines(lines);
  }
  return true;
}

/** PascalCase component identifier for the extension (its file name when valid). */
export function componentName(ext: Extension): string {
  const base = /^[A-Z][A-Za-z0-9_]*$/.test(ext.fileName) ? ext.fileName : toPascalCase(ext.fileName || ext.name, 'Extension');
  const taken = new Set(ALL_COMPONENTS.map((d) => d.importName ?? d.type.split('.')[0]));
  ['ExtensionProps', 'React', 'Fragment'].forEach((n) => taken.add(n));
  return taken.has(base) ? `${base}Extension` : base;
}

/** Creates the generation context with every name reserved and data / computed values planned. */
function prepare(project: Project, ext: Extension): { ctx: GenContext; name: string } {
  const ctx = createContext(project, ext);
  let name = componentName(ext);
  reserveUserNames(ctx);
  // A helper with the component's name would collide at module level.
  if (ctx.userHelpers.names.includes(name)) name = ctx.names.allocate(`${name}Component`);
  ctx.names.reserve(name);
  planDataSources(ctx);
  planComputed(ctx);
  return { ctx, name };
}

export function generateExtensionSource(project: Project, ext: Extension): string {
  const { ctx, name } = prepare(project, ext);

  // JSX first: it declares the handlers and registers component imports.
  const jsx = new JsxRenderer(ctx);
  const rootChildren = jsx.renderRoot(6);

  const body = new CodeWriter(1);
  const sections: Array<(w: CodeWriter) => boolean> = [
    (w) => emitState(w, ctx),
    (w) => emitDataSources(w, ctx),
    (w) => emitComputed(w, ctx),
    (w) => {
      jsx.handlers.forEach((h, i) => {
        if (i > 0) w.line();
        w.lines(h.lines);
      });
      return jsx.handlers.length > 0;
    },
  ];
  for (const section of sections) {
    const w = new CodeWriter(1);
    if (section(w)) {
      if (!body.isEmpty()) body.line();
      body.lines(w.toLines().map((l) => l.slice(2)));
    }
  }
  if (!body.isEmpty()) body.line();
  if (rootChildren.length === 0) {
    body.line('return <></>;');
  } else {
    body.line('return (');
    body.lines(['  <>', ...indentLines(rootChildren, 2), '  </>']);
    body.line(');');
  }

  // Imports & entry point
  const location = ctx.location;
  const ctxType = contextType(ctx);
  const hubspot = importValue(ctx, UI_EXTENSIONS, 'hubspot');
  // User code may call `logger` directly (custom code, handler expressions).
  if (ctx.referenced.has('logger') && !ctx.shadowed.has('logger')) importValue(ctx, UI_EXTENSIONS, 'logger');
  // Helper code is module-level code: it may use `hubspot` / `logger` from the SDK directly.
  const helperCode = ctx.userHelpers.code.trim() ? prepareHelpersForTypeScript(ctx.userHelpers.code) : '';
  if (helperCode) {
    const ids = scanCode(helperCode).identifiers;
    for (const sdk of ['hubspot', 'logger']) {
      if (ids.has(sdk) && !ctx.shadowed.has(sdk) && !ctx.imports.has(UI_EXTENSIONS, sdk)) ctx.imports.add(UI_EXTENSIONS, sdk);
    }
    if (/\bany\b/.test(helperCode)) ctx.usesAny = true;
  }
  ctx.imports.addType(UI_EXTENSIONS, ctxType);
  ctx.imports.addType(UI_EXTENSIONS, 'ExtensionPointApiActions');

  const usesContext = ctx.referenced.has('context');
  const usesActions = ctx.referenced.has('actions');
  const destructured = [usesContext ? 'context' : null, usesActions ? 'actions' : null].filter(Boolean);
  const params = destructured.length ? `{ ${destructured.join(', ')} }: ExtensionProps` : '_props: ExtensionProps';

  const out: string[] = [];
  out.push(`// ${ext.name.replace(/\s+/g, ' ').trim() || name} — ${describeExtension(ext, location)}.`);
  out.push('// Generated by UI Extension Builder. Re-import the project\'s .uiex.json to keep editing visually.');
  if (ctx.usesAny || ctx.helperNames.has('asArray')) out.push('/* eslint-disable @typescript-eslint/no-explicit-any */');
  out.push(...ctx.imports.print());
  out.push('');
  const helperSources: Record<HelperName, string> = { toText: TO_TEXT_HELPER_SOURCE, asArray: AS_ARRAY_HELPER_SOURCE };
  for (const helper of ['toText', 'asArray'] as const) {
    const local = ctx.helperNames.get(helper);
    // Helper sources declare `const <helper> = ...`; a shadowed helper is declared as `local`.
    if (local) out.push(helperSources[helper].replace(`const ${helper} `, `const ${local} `), '');
  }
  if (helperCode) {
    out.push('// Helper functions (Data panel › Helpers): module-level code, callable from any expression.');
    out.push(...helperCode.split('\n'), '');
  }
  out.push('interface ExtensionProps {');
  out.push(`  context: ${ctxType};`);
  out.push(`  actions: ExtensionPointApiActions<'${location}'>;`);
  out.push('}');
  out.push('');
  out.push(`${hubspot}.extend<'${location}'>(({ context, actions }: ExtensionProps) => (`);
  out.push(`  <${name} context={context} actions={actions} />`);
  out.push('));');
  out.push('');
  out.push(`const ${name} = (${params}) => {`);
  out.push(...body.toLines());
  out.push('};');
  return `${out.join('\n')}\n`;
}

function describeExtension(ext: Extension, location: string): string {
  if (ext.kind === 'settings') return 'app settings page';
  if (ext.kind === 'home') return 'app home page';
  return `app card (${location})`;
}

/**
 * The JSX of one node subtree as it appears inside the generated component: condition / repeat
 * wrappers, slot content, handlers referenced by the names the full file declares (the whole tree
 * is rendered so names match `generateExtensionSource`). A node inside a slot (e.g. a Modal in a
 * button's `overlay`) is returned as the bare element; other nodes as a JSX child (`{...}` around
 * expressions). The root id yields the whole `<>...</>` fragment. Returns '' for unknown ids.
 * Used by "view code of selection" and "copy JSX".
 */
export function generateNodeJsx(project: Project, ext: Extension, nodeId: NodeId): string {
  if (!ext?.nodes || !ext.nodes[ext.rootId]) return '';
  const { ctx } = prepare(project, ext);
  const jsx = new JsxRenderer(ctx);
  if (nodeId === ext.rootId) {
    const lines = jsx.renderRoot(2);
    return lines.length ? `${['<>', ...indentLines(lines), '</>'].join('\n')}\n` : '';
  }
  if (!ext.nodes[nodeId]) return '';
  jsx.capture(nodeId);
  jsx.renderRoot(6);
  const parents = buildParentIndex(ext);
  const inSlot = !!parents.get(nodeId)?.slot;
  let lines = jsx.capturedJsx(inSlot);
  if (!lines) {
    // Not reachable from the root (malformed document): render it on its own with the repeat
    // variables of its ancestors in scope.
    const repeats: Array<{ itemName: string; indexName: string }> = [];
    const seen = new Set<NodeId>();
    let cur = parents.get(nodeId)?.parentId;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const r = ext.nodes[cur]?.repeat;
      if (r) repeats.unshift({ itemName: r.itemName, indexName: r.indexName });
      cur = parents.get(cur)?.parentId;
    }
    lines = jsx.renderDetached(nodeId, repeats, inSlot);
  }
  return lines && lines.length ? `${lines.join('\n')}\n` : '';
}
