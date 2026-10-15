/**
 * Data sources -> hooks and loaders.
 *
 * Every data source named `x` exposes `x`, `xLoading` and `xError` (an error message string or
 * null, like the designer runtime) at component scope:
 *   crmProperties -> useCrmProperties([...])          x: Record<string, any>
 *   associations  -> useAssociations({...})           x: any[]   (association results)
 *   crmSearch     -> useCrmSearch({...})              x: any[]   (search results)
 *   fetch         -> useState + useCallback loader around hubspot.fetch()       x: any
 *   function      -> useState + useCallback loader around hubspot.serverless()  x: any
 *
 * Declaration order keeps the Rules of Hooks and avoids temporal-dead-zone reads: user state,
 * loader state, CRM hooks (topologically sorted by references), loaders, then the mount effect.
 */
import type {
  AssociationsSource,
  CrmPropertiesSource,
  CrmSearchSource,
  DataSource,
  FetchSource,
  FunctionSource,
} from '../model/types';
import type { DataSourcePlan, GenContext } from './context';
import {
  BASE_RESERVED,
  capitalize,
  declaredStateNames,
  importValue,
  NameAllocator,
  setterName,
  UI_EXTENSIONS,
  UI_EXTENSIONS_CRM,
} from './context';
import {
  asOperand,
  CodeWriter,
  isIdentifierName,
  jsArray,
  jsCode,
  jsObject,
  normalizeExpression,
  printNumber,
  quoteString,
  scanCode,
  writeCall,
  type JsNode,
} from './printer';
import { asString, templateText, templateValue, userExpr } from './templates';

const HOOK_KINDS = new Set<DataSource['kind']>(['crmProperties', 'associations', 'crmSearch']);

/** Names a data source declares at component scope. */
export function dataSourceExposedNames(source: DataSource): string[] {
  return [source.name, `${source.name}Loading`, `${source.name}Error`];
}

/** Setters declared for loader-backed sources (fetch / function). */
export function dataSourceSetterNames(source: DataSource): string[] {
  if (HOOK_KINDS.has(source.kind)) return [];
  return dataSourceExposedNames(source).map(setterName);
}

/**
 * Assigns internal identifiers (query variables, loaders) to every valid data source and
 * registers them in the context. Must run before handlers are generated (runDataSource steps).
 */
export function planDataSources(ctx: GenContext): void {
  const declared = declaredStateNames(ctx.states.values());
  const kinds = new Set<DataSource['kind']>(['crmProperties', 'associations', 'crmSearch', 'fetch', 'function']);
  for (const source of Array.isArray(ctx.ext.dataSources) ? ctx.ext.dataSources : []) {
    if (!source || !kinds.has(source.kind) || !isIdentifierName(source.name)) continue;
    // A source whose names are already declared (state, another source) would not compile.
    const declares = [...dataSourceExposedNames(source), ...dataSourceSetterNames(source)];
    if (declares.some((n) => declared.has(n))) continue;
    declares.forEach((n) => declared.add(n));
    const exposes = dataSourceExposedNames(source);
    exposes.forEach((n) => ctx.componentScope.add(n));
    let plan: DataSourcePlan;
    if (HOOK_KINDS.has(source.kind)) {
      const queryVar = ctx.names.allocate(`${source.name}Query`);
      plan = { source, queryVar, rerunCall: `${queryVar}.refetch()`, exposes };
    } else {
      const loaderName = ctx.names.allocate(`load${capitalize(source.name)}`);
      plan = { source, loaderName, rerunCall: `${loaderName}()`, exposes };
    }
    ctx.dataSources.set(source.id, plan);
  }
}

function stringArray(values: string[] | undefined): JsNode {
  return jsArray((Array.isArray(values) ? values : []).map((v) => jsCode(quoteString(asString(v)))));
}

function formatOptions(formatted: boolean | undefined): JsNode[] {
  return formatted ? [jsObject([['propertiesToFormat', jsCode("'all'")]])] : [];
}

/** Component-scope identifiers referenced by user code (hook dependency lists). */
function scopeDeps(ctx: GenContext, codes: string[]): string[] {
  const deps = new Set<string>();
  for (const code of codes) {
    for (const id of scanCode(code).identifiers) if (ctx.componentScope.has(id)) deps.add(id);
  }
  return [...deps].sort();
}

function emitCrmProperties(w: CodeWriter, ctx: GenContext, s: CrmPropertiesSource, plan: DataSourcePlan): void {
  const hook = importValue(ctx, UI_EXTENSIONS_CRM, 'useCrmProperties');
  writeCall(w, `const ${plan.queryVar} = `, hook, [stringArray(s.properties), ...formatOptions(s.formatted)]);
  writeExposures(w, ctx, s, plan, 'Record<string, any>', 'properties');
}

function emitAssociations(w: CodeWriter, ctx: GenContext, s: AssociationsSource, plan: DataSourcePlan): void {
  const hook = importValue(ctx, UI_EXTENSIONS_CRM, 'useAssociations');
  const entries: Array<[string, JsNode]> = [
    ['toObjectType', jsCode(quoteString(asString(s.toObjectType)))],
    ['properties', stringArray(s.properties)],
  ];
  if (Number.isFinite(s.pageLength)) entries.push(['pageLength', jsCode(printNumber(s.pageLength))]);
  const config = jsObject(entries);
  writeCall(w, `const ${plan.queryVar} = `, hook, [config, ...formatOptions(s.formatted)]);
  writeExposures(w, ctx, s, plan, 'any[]', 'results');
}

const NO_VALUE_OPERATORS = new Set(['HAS_PROPERTY', 'NOT_HAS_PROPERTY']);
const LIST_OPERATORS = new Set(['IN', 'NOT_IN']);

/** One search filter: `value`, `values` (IN / NOT_IN) or `value` + `highValue` (BETWEEN). */
function searchFilter(ctx: GenContext, f: CrmSearchSource['filters'][number]): JsNode {
  const entries: Array<[string, JsNode]> = [
    ['propertyName', jsCode(quoteString(asString(f.propertyName)))],
    ['operator', jsCode(quoteString(asString(f.operator)))],
  ];
  const operator = asString(f.operator).toUpperCase();
  const value = asString(f.value);
  const literalValue = (v: string): JsNode => jsCode(asOperand(templateValue(ctx, v).code));
  if (NO_VALUE_OPERATORS.has(operator)) return jsObject(entries);
  if (LIST_OPERATORS.has(operator)) {
    const tv = templateValue(ctx, value);
    if (tv.origin === 'expr') entries.push(['values', jsCode(asOperand(tv.code))]);
    else entries.push(['values', jsArray(value.split(',').map((v) => v.trim()).filter(Boolean).map(literalValue))]);
    return jsObject(entries);
  }
  if (operator === 'BETWEEN' && !value.includes('{{') && value.includes(',')) {
    const [low, high] = value.split(',').map((v) => v.trim());
    entries.push(['value', literalValue(low)], ['highValue', literalValue(high ?? '')]);
    return jsObject(entries);
  }
  entries.push(['value', literalValue(value)]);
  return jsObject(entries);
}

function emitCrmSearch(w: CodeWriter, ctx: GenContext, s: CrmSearchSource, plan: DataSourcePlan): void {
  const hook = importValue(ctx, UI_EXTENSIONS, 'useCrmSearch');
  const filters = Array.isArray(s.filters) ? s.filters.filter((f) => f && typeof f === 'object') : [];
  const sorts = Array.isArray(s.sorts) ? s.sorts.filter((x) => x && typeof x === 'object') : [];
  const entries: Array<[string, JsNode]> = [['objectType', jsCode(quoteString(asString(s.objectType)))]];
  if (Array.isArray(s.properties) && s.properties.length) entries.push(['properties', stringArray(s.properties)]);
  if (asString(s.query).trim() !== '') entries.push(['query', jsCode(templateText(ctx, s.query!))]);
  if (filters.length) {
    entries.push(['filterGroups', jsArray([jsObject([['filters', jsArray(filters.map((f) => searchFilter(ctx, f)))]])])]);
  }
  if (sorts.length) {
    entries.push([
      'sorts',
      jsArray(
        sorts.map((sort) =>
          jsObject([
            ['propertyName', jsCode(quoteString(asString(sort.propertyName)))],
            ['direction', jsCode(sort.direction === 'DESCENDING' ? "'DESCENDING'" : "'ASCENDING'")],
          ]),
        ),
      ),
    ]);
  }
  if (Number.isFinite(s.pageLength)) entries.push(['pageLength', jsCode(printNumber(s.pageLength))]);
  writeCall(w, `const ${plan.queryVar} = `, hook, [jsObject(entries), ...formatOptions(s.formatted)]);
  writeExposures(w, ctx, s, plan, 'any[]', 'results');
}

/**
 * Declares the scope names of a hook-based source that user code reads: the data (loosely
 * typed so any expression over it type-checks), `xLoading` and `xError` (message or null).
 */
function writeExposures(w: CodeWriter, ctx: GenContext, s: DataSource, plan: DataSourcePlan, type: string, field: string): void {
  const used = (name: string) => ctx.userIdentifiers.has(name);
  if (used(s.name)) {
    ctx.usesAny = true;
    w.line(`const ${s.name}: ${type} = ${plan.queryVar}.${field};`);
  }
  if (used(`${s.name}Loading`)) w.line(`const ${s.name}Loading = ${plan.queryVar}.isLoading;`);
  if (used(`${s.name}Error`)) w.line(`const ${s.name}Error = ${plan.queryVar}.error?.message ?? null;`);
}

/** useState triple of a loader-backed source. */
function emitLoaderState(w: CodeWriter, ctx: GenContext, s: FetchSource | FunctionSource): void {
  const useState = importValue(ctx, 'react', 'useState');
  ctx.usesAny = true;
  w.line(`const [${s.name}, ${setterName(s.name)}] = ${useState}<any>(null);`);
  w.line(`const [${s.name}Loading, ${setterName(`${s.name}Loading`)}] = ${useState}<boolean>(${s.runOnMount === true});`);
  w.line(`const [${s.name}Error, ${setterName(`${s.name}Error`)}] = ${useState}<string | null>(null);`);
}

/**
 * Allocator for a loader's local names (`response`, `result`): they only have to avoid the
 * component-scope names and whatever the loader's own request code references.
 */
function loaderLocals(ctx: GenContext, codes: string[]): NameAllocator {
  const reserved = new Set<string>([...BASE_RESERVED, ...ctx.componentScope, ...ctx.imports.allValueNames()]);
  for (const st of ctx.states.values()) reserved.add(setterName(st.name));
  for (const plan of ctx.dataSources.values()) {
    if (plan.queryVar) reserved.add(plan.queryVar);
    if (plan.loaderName) reserved.add(plan.loaderName);
    dataSourceSetterNames(plan.source).forEach((n) => reserved.add(n));
  }
  for (const code of codes) scanCode(code).identifiers.forEach((id) => reserved.add(id));
  return new NameAllocator(reserved);
}

/** The `try` part of a loader: performs the request and stores the result. Returns the user code used. */
function emitLoaderRequest(w: CodeWriter, ctx: GenContext, s: FetchSource | FunctionSource): string[] {
  const codes: string[] = [];
  if (s.kind === 'fetch') {
    const hubspot = importValue(ctx, UI_EXTENSIONS, 'hubspot');
    const url = templateText(ctx, s.url);
    codes.push(url);
    const options: Array<[string, JsNode]> = [['method', jsCode(quoteString(asString(s.method) || 'GET'))]];
    if (normalizeExpression(asString(s.body)) !== '') {
      const body = userExpr(ctx, s.body!);
      codes.push(body);
      options.push(['body', jsCode(asOperand(body))]);
    }
    const res = loaderLocals(ctx, codes).allocate('response');
    writeCall(w, `const ${res} = await `, `${hubspot}.fetch`, [jsCode(asOperand(url)), jsObject(options)]);
    w.block(`if (!${res}.ok) {`, () => {
      w.line(`throw new Error(\`Request failed with status \${${res}.status}\`);`);
    });
    w.line(`${setterName(s.name)}(await ${res}.json());`);
    return codes;
  }
  const fn = ctx.functions.get(s.functionId);
  if (!fn) {
    w.line(`throw new Error(${quoteString(`The app function of data source "${s.name}" no longer exists.`)});`);
    return codes;
  }
  const hubspot = importValue(ctx, UI_EXTENSIONS, 'hubspot');
  const options: Array<[string, JsNode]> = [];
  if (normalizeExpression(asString(s.parameters)) !== '') {
    const params = userExpr(ctx, s.parameters!);
    codes.push(params);
    options.push(['parameters', jsCode(asOperand(params))]);
  }
  if (Array.isArray(s.propertiesToSend) && s.propertiesToSend.length) {
    options.push(['propertiesToSend', stringArray(s.propertiesToSend)]);
  }
  const result = loaderLocals(ctx, codes).allocate('result');
  const args = [jsCode(quoteString(fn.uid)), ...(options.length ? [jsObject(options)] : [])];
  writeCall(w, `const ${result} = await `, `${hubspot}.serverless`, args);
  w.line(`${setterName(s.name)}(${result});`);
  return codes;
}

function emitLoader(w: CodeWriter, ctx: GenContext, s: FetchSource | FunctionSource, plan: DataSourcePlan): void {
  const useCallback = importValue(ctx, 'react', 'useCallback');
  let codes: string[] = [];
  w.line(`const ${plan.loaderName} = ${useCallback}(async () => {`);
  w.indent(() => {
    w.line(`${setterName(`${s.name}Loading`)}(true);`);
    w.line(`${setterName(`${s.name}Error`)}(null);`);
    w.line('try {');
    w.indent(() => {
      codes = emitLoaderRequest(w, ctx, s);
    });
    w.line('} catch (error) {');
    w.indent(() => w.line(`${setterName(`${s.name}Error`)}(error instanceof Error ? error.message : String(error));`));
    w.line('} finally {');
    w.indent(() => w.line(`${setterName(`${s.name}Loading`)}(false);`));
    w.line('}');
  });
  // The dependency list is known once the request code has been generated.
  w.line(`}, [${scopeDeps(ctx, codes).join(', ')}]);`);
}

/** Orders hook-based sources so a source is declared after the sources its config reads. */
function sortHookSources(plans: DataSourcePlan[]): DataSourcePlan[] {
  const byExposed = new Map<string, DataSourcePlan>();
  for (const p of plans) p.exposes.forEach((n) => byExposed.set(n, p));
  const refs = (p: DataSourcePlan): DataSourcePlan[] => {
    if (p.source.kind !== 'crmSearch') return [];
    const filters = Array.isArray(p.source.filters) ? p.source.filters : [];
    const codes = [asString(p.source.query), ...filters.map((f) => asString(f?.value))];
    const out: DataSourcePlan[] = [];
    for (const code of codes) {
      for (const m of code.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
        for (const id of scanCode(m[1]).identifiers) {
          const dep = byExposed.get(id);
          if (dep && dep !== p && !out.includes(dep)) out.push(dep);
        }
      }
    }
    return out;
  };
  const ordered: DataSourcePlan[] = [];
  const state = new Map<DataSourcePlan, 'visiting' | 'done'>();
  const visit = (p: DataSourcePlan) => {
    if (state.get(p)) return; // done, or a cycle (kept in declaration order)
    state.set(p, 'visiting');
    refs(p).forEach(visit);
    state.set(p, 'done');
    ordered.push(p);
  };
  plans.forEach(visit);
  return ordered;
}

/**
 * Writes every data source declaration into `w` (component body level). Returns true when
 * something was written.
 */
export function emitDataSources(w: CodeWriter, ctx: GenContext): boolean {
  const plans = [...ctx.dataSources.values()];
  if (plans.length === 0) return false;
  const loaderPlans = plans.filter((p) => !HOOK_KINDS.has(p.source.kind));
  const hookPlans = sortHookSources(plans.filter((p) => HOOK_KINDS.has(p.source.kind)));
  let first = true;
  const gap = () => {
    if (!first) w.line();
    first = false;
  };

  for (const p of loaderPlans) {
    gap();
    w.line(`// ${describeSource(ctx, p.source)}`);
    emitLoaderState(w, ctx, p.source as FetchSource | FunctionSource);
  }
  for (const p of hookPlans) {
    gap();
    w.line(`// ${describeSource(ctx, p.source)}`);
    const s = p.source;
    if (s.kind === 'crmProperties') emitCrmProperties(w, ctx, s, p);
    else if (s.kind === 'associations') emitAssociations(w, ctx, s, p);
    else if (s.kind === 'crmSearch') emitCrmSearch(w, ctx, s, p);
  }
  for (const p of loaderPlans) {
    gap();
    emitLoader(w, ctx, p.source as FetchSource | FunctionSource, p);
  }
  const onMount = loaderPlans.filter((p) => (p.source as FetchSource | FunctionSource).runOnMount === true);
  if (onMount.length) {
    const useEffect = importValue(ctx, 'react', 'useEffect');
    gap();
    w.block(`${useEffect}(() => {`, () => {
      for (const p of onMount) w.line(`void ${p.rerunCall};`);
      w.line('// Load once on mount; refresh actions call the loaders again.');
      w.line('// eslint-disable-next-line react-hooks/exhaustive-deps');
    }, '}, []);');
  }
  return true;
}

/** One-line description used as a comment above the declaration. */
function describeSource(ctx: GenContext, s: DataSource): string {
  switch (s.kind) {
    case 'crmProperties':
      return `${s.name}: properties of the current CRM record`;
    case 'associations':
      return `${s.name}: associated ${s.toObjectType} records`;
    case 'crmSearch':
      return `${s.name}: CRM search on ${s.objectType}`;
    case 'fetch':
      return `${s.name}: ${asString(s.method) || 'GET'} ${asString(s.url).replace(/\s+/g, ' ')}${s.runOnMount ? ' (loads on mount)' : ''}`;
    case 'function': {
      const fn = ctx.functions.get(s.functionId);
      return `${s.name}: app function ${fn ? fn.uid : '(missing)'}${s.runOnMount ? ' (loads on mount)' : ''}`;
    }
  }
}
