/**
 * Generates the TSX source of one extension (card, settings page or app home page).
 *
 * Output shape (matches HubSpot's 2026.03 templates):
 *   imports
 *   module helpers (toText / asArray, only when used)
 *   interface ExtensionProps { context; actions }
 *   hubspot.extend<'<location>'>(({ context, actions }) => <Component ... />);
 *   const Component = ({ context, actions }: ExtensionProps) => {
 *     state, data sources, handlers
 *     return (<>...</>);
 *   };
 */
import { ALL_COMPONENTS, getComponent } from '../registry';
import { TO_TEXT_HELPER_SOURCE } from '../model/template';
import { toPascalCase } from '../model/ids';
import type { Extension, JsonValue, Project, StateVar } from '../model/types';
import { isExpr } from '../model/types';
import { collectStepCode } from './actions';
import type { GenContext } from './context';
import { createContext, importValue, setterName, UI_EXTENSIONS, type HelperName } from './context';
import { dataSourceExposedNames, dataSourceSetterNames, emitDataSources, planDataSources } from './dataSources';
import { JsxRenderer } from './jsx';
import { asString } from './templates';
import {
  CodeWriter,
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

/** PascalCase component identifier for the extension (its file name when valid). */
export function componentName(ext: Extension): string {
  const base = /^[A-Z][A-Za-z0-9_]*$/.test(ext.fileName) ? ext.fileName : toPascalCase(ext.fileName || ext.name, 'Extension');
  const taken = new Set(ALL_COMPONENTS.map((d) => d.importName ?? d.type.split('.')[0]));
  ['ExtensionProps', 'React', 'Fragment'].forEach((n) => taken.add(n));
  return taken.has(base) ? `${base}Extension` : base;
}

export function generateExtensionSource(project: Project, ext: Extension): string {
  const ctx = createContext(project, ext);
  const name = componentName(ext);
  reserveUserNames(ctx);
  ctx.names.reserve(name);
  planDataSources(ctx);

  // JSX first: it declares the handlers and registers component imports.
  const jsx = new JsxRenderer(ctx);
  const rootChildren = jsx.renderRoot(6);

  const body = new CodeWriter(1);
  const sections: Array<(w: CodeWriter) => boolean> = [
    (w) => emitState(w, ctx),
    (w) => emitDataSources(w, ctx),
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
