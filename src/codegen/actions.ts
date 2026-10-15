/**
 * Event action steps -> TypeScript statements inside a generated handler.
 *
 * Steps run in order. Network steps (fetch / runFunction / runDataSource / copy) are awaited so
 * later steps observe their completion, which makes the handler `async`.
 */
import { getComponent } from '../registry';
import type { ActionStep, FetchAction, RunFunctionAction } from '../model/types';
import { isExpr } from '../model/types';
import type { GenContext, NameAllocator } from './context';
import { importValue, noteUserCode, stateSetter, stateTypeArg, UI_EXTENSIONS, useHelper } from './context';
import { fitsStateType, inferValueType, optionalContextAccess, type InferredType } from './rewrite';
import {
  asOperand,
  CodeWriter,
  dedentStatements,
  jsArray,
  jsCode,
  jsObject,
  negate,
  normalizeExpression,
  printNumber,
  quoteString,
  scanCode,
  writeCall,
  type JsNode,
} from './printer';
import { asString, templateText, templateValue, userExpr } from './templates';

export interface HandlerScope {
  ctx: GenContext;
  /** Allocator for handler-local helper identifiers (never collides with user names). */
  local: NameAllocator;
}

/** Whether running the steps requires `await` (and so an async handler). */
export function stepsNeedAsync(steps: ActionStep[] | undefined): boolean {
  return asSteps(steps).some((step) => {
    switch (step.type) {
      case 'fetch':
      case 'runFunction':
      case 'runDataSource':
      case 'copyToClipboard':
        return true;
      case 'if':
        return stepsNeedAsync(step.then) || stepsNeedAsync(step.else);
      case 'custom': {
        // `return` makes the custom code run in an awaited async arrow function (see emitCustom).
        const ids = scanCode(asString(step.code)).identifiers;
        return ids.has('await') || ids.has('return');
      }
      default:
        return false;
    }
  });
}

/** Every user code fragment of the steps (expressions, templates, custom code), for analysis. */
export function collectStepCode(steps: ActionStep[] | undefined): string[] {
  const out: string[] = [];
  const template = (s: string) => {
    for (const m of asString(s).matchAll(/\{\{([\s\S]*?)\}\}/g)) out.push(m[1]);
  };
  for (const step of asSteps(steps)) {
    switch (step.type) {
      case 'setState':
        out.push(asString(step.value));
        break;
      case 'addAlert':
        template(step.title);
        template(step.message);
        break;
      case 'openIframeModal':
        template(step.uri);
        template(step.title);
        break;
      case 'copyToClipboard':
        template(step.text);
        break;
      case 'log':
        template(step.message);
        break;
      case 'fetch':
        template(step.url);
        for (const h of Array.isArray(step.headers) ? step.headers : []) template(asString(h?.value));
        out.push(asString(step.body), ...collectStepCode(step.onSuccess), ...collectStepCode(step.onError));
        break;
      case 'runFunction':
        out.push(asString(step.parameters), ...collectStepCode(step.onSuccess), ...collectStepCode(step.onError));
        break;
      case 'if':
        out.push(asString(step.condition), ...collectStepCode(step.then), ...collectStepCode(step.else));
        break;
      case 'custom':
        out.push(asString(step.code));
        break;
      default:
        break;
    }
  }
  return out;
}

/** Steps of a document field (tolerates missing / malformed lists). */
function asSteps(steps: ActionStep[] | undefined): ActionStep[] {
  return Array.isArray(steps) ? steps.filter((s) => s && typeof s === 'object') : [];
}

/** Writes the statements of `steps`. */
export function emitSteps(w: CodeWriter, steps: ActionStep[] | undefined, hs: HandlerScope): void {
  for (const step of asSteps(steps)) emitStep(w, step, hs);
}

function useActions(hs: HandlerScope): string {
  hs.ctx.referenced.add('actions');
  return 'actions';
}


function emitStep(w: CodeWriter, step: ActionStep, hs: HandlerScope): void {
  const { ctx } = hs;
  switch (step.type) {
    case 'setState': {
      const state = ctx.states.get(step.state);
      if (!state) {
        w.line(`// Set variable: unknown state variable ${quoteString(step.state)}.`);
        return;
      }
      const value = normalizeExpression(asString(step.value)) === '' ? 'undefined' : userExpr(ctx, step.value);
      w.line(`${stateSetter(ctx, state.name)}(${setStateArgument(ctx, value, stateTypeArg(state))});`);
      return;
    }
    case 'addAlert': {
      const entries: Array<[string, JsNode]> = [['type', jsCode(quoteString(asString(step.alertType) || 'info'))]];
      // Like the designer runtime: an empty title is omitted, anything else is passed through.
      if (asString(step.title) !== '') entries.push(['title', jsCode(templateText(ctx, step.title))]);
      entries.push(['message', jsCode(templateText(ctx, step.message))]);
      writeCall(w, '', `${useActions(hs)}.addAlert`, [jsObject(entries)]);
      return;
    }
    case 'refreshObjectProperties':
      if (ctx.isCrm) w.line(`${useActions(hs)}.refreshObjectProperties();`);
      else w.line(`// actions.refreshObjectProperties() is only available on CRM record locations.`);
      return;
    case 'reloadPage':
      w.line(`${useActions(hs)}.reloadPage();`);
      return;
    case 'openIframeModal': {
      const entries: Array<[string, JsNode]> = [['uri', jsCode(templateText(ctx, step.uri))]];
      if (asString(step.title).trim() !== '') entries.push(['title', jsCode(templateText(ctx, step.title))]);
      entries.push(['width', jsCode(String(finiteOr(step.width, 640)))]);
      entries.push(['height', jsCode(String(finiteOr(step.height, 480)))]);
      if (typeof step.flush === 'boolean') entries.push(['flush', jsCode(String(step.flush))]);
      writeCall(w, '', `${useActions(hs)}.openIframeModal`, [jsObject(entries)]);
      return;
    }
    case 'closeOverlay': {
      const id = overlayIdCode(hs, step.overlayNodeId);
      if (id === null) {
        w.line('// Close overlay: the overlay no longer exists.');
        return;
      }
      w.line(`${useActions(hs)}.closeOverlay(${id});`);
      return;
    }
    case 'copyToClipboard':
      w.line(`await ${useActions(hs)}.copyTextToClipboard(${asOperand(templateText(ctx, step.text))});`);
      return;
    case 'runDataSource': {
      const plan = ctx.dataSources.get(step.dataSourceId);
      if (!plan) {
        w.line('// Refresh data: the data source no longer exists.');
        return;
      }
      w.line(`await ${plan.rerunCall};`);
      return;
    }
    case 'fetch':
      emitFetch(w, step, hs);
      return;
    case 'runFunction':
      emitRunFunction(w, step, hs);
      return;
    case 'log': {
      const logger = importValue(ctx, UI_EXTENSIONS, 'logger');
      const level = ['info', 'warn', 'error', 'debug'].includes(step.level) ? step.level : 'info';
      w.line(`${logger}.${level}(${asOperand(templateText(ctx, step.message))});`);
      return;
    }
    case 'if': {
      const hasThen = asSteps(step.then).length > 0;
      const hasElse = asSteps(step.else).length > 0;
      if (!hasThen && !hasElse) return;
      if (normalizeExpression(asString(step.condition)) === '') {
        // No condition is false (as in the preview): only the else branch runs. `if (undefined)`
        // would fail TypeScript 5.9 (TS2873, "always falsy").
        if (hasElse) emitSteps(w, step.else, hs);
        return;
      }
      const cond = userExpr(ctx, step.condition);
      if (!hasThen) {
        w.block(`if (${negate(cond)}) {`, () => emitSteps(w, step.else, hs));
        return;
      }
      w.line(`if (${cond}) {`);
      w.indent(() => emitSteps(w, step.then, hs));
      if (hasElse) {
        w.line('} else {');
        w.indent(() => emitSteps(w, step.else, hs));
      }
      w.line('}');
      return;
    }
    case 'custom':
      emitCustom(w, step.code, hs);
      return;
  }
}

/** Static type of a known component-scope name (state variables, data source flags), or null. */
function knownType(ctx: GenContext): (name: string) => InferredType {
  return (name) => {
    const state = ctx.states.get(name);
    if (state) return stateTypeArg(state);
    for (const plan of ctx.dataSources.values()) {
      if (name === `${plan.source.name}Loading`) return 'boolean';
      if (name === `${plan.source.name}Error`) return 'string | null';
    }
    return null;
  };
}

/**
 * The argument of a state setter. Values whose type provably differs from the state's
 * (`setName(count + 1)` for a string state) are cast to `any` — the designer stores them as is,
 * and the generated code keeps that behaviour while still type-checking under `strict`.
 */
function setStateArgument(ctx: GenContext, value: string, target: string): string {
  if (fitsStateType(inferValueType(value, knownType(ctx)), target)) return asOperand(value);
  ctx.usesAny = true;
  const simple = /^[A-Za-z_$][A-Za-z0-9_$.]*$|^'[^']*'$|^-?[0-9.]+$/.test(value);
  return `${simple ? value : `(${value})`} as any`;
}

/** hubspot.fetch options: method, headers, timeout and (never for GET) the JSON body. */
export function fetchOptions(
  ctx: GenContext,
  method: string,
  body: string | null,
  headers: Array<{ key: string; value: string }> | undefined,
  timeout: number | undefined,
): Array<[string, JsNode]> {
  const verb = asString(method).toUpperCase() || 'GET';
  const options: Array<[string, JsNode]> = [['method', jsCode(quoteString(verb))]];
  const list = (Array.isArray(headers) ? headers : []).filter((h) => h && asString(h.key).trim() !== '');
  if (list.length) {
    options.push(['headers', jsObject(list.map((h) => [asString(h.key).trim(), jsCode(templateText(ctx, asString(h.value)))]))]);
  }
  if (typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0) options.push(['timeout', jsCode(printNumber(timeout))]);
  // HubSpot (like browsers) sends no body with GET; the designer preview drops it too.
  if (body !== null && verb !== 'GET') options.push(['body', jsCode(asOperand(body))]);
  return options;
}

function finiteOr(value: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The `id` prop of a Modal/Panel node as code, or null when the node is gone. */
function overlayIdCode(hs: HandlerScope, nodeId: string): string | null {
  const node = hs.ctx.ext.nodes[nodeId];
  if (!node) return null;
  const idProp = getComponent(node.type)?.overlay?.idProp ?? 'id';
  const value = node.props[idProp];
  if (value === undefined) return null;
  if (isExpr(value)) return asOperand(userExpr(hs.ctx, value.$expr));
  if (typeof value === 'string') return asOperand(templateValue(hs.ctx, value).code);
  return JSON.stringify(value);
}

/**
 * Inline `hubspot.fetch` step. `response` (the parsed JSON body) is in scope for onSuccess steps
 * and `error` for onError steps, as in the designer runtime.
 */
function emitFetch(w: CodeWriter, step: FetchAction, hs: HandlerScope): void {
  const { ctx } = hs;
  const hubspot = importValue(ctx, UI_EXTENSIONS, 'hubspot');
  let url = templateText(ctx, step.url);
  const isGet = (asString(step.method).toUpperCase() || 'GET') === 'GET';
  let body = !isGet && normalizeExpression(asString(step.body)) !== '' ? userExpr(ctx, step.body!) : null;
  // The request is built inside the `try` block that declares `response`; if the request refers
  // to an outer `response` (nested in another step's onSuccess) evaluate it before the block.
  const refersToResponse = (code: string | null) => code !== null && scanCode(code).identifiers.has('response');
  if (refersToResponse(url)) {
    const name = hs.local.allocate('requestUrl');
    w.line(`const ${name} = ${url};`);
    url = name;
  }
  if (refersToResponse(body)) {
    const name = hs.local.allocate('requestBody');
    w.line(`const ${name} = ${body};`);
    body = name;
  }
  const res = hs.local.allocate('res');
  const options = fetchOptions(ctx, asString(step.method), body, step.headers, step.timeout);
  const usesResponse = responseUsed(step.resultState, step.onSuccess, hs);
  w.block('try {', () => {
    writeCall(w, `const ${res} = await `, `${hubspot}.fetch`, [jsCode(asOperand(url)), jsObject(options)]);
    w.block(`if (!${res}.ok) {`, () => {
      w.line(`throw new Error(\`Request failed with status \${${res}.status}\`);`);
    });
    if (usesResponse) w.line(`const response = await ${useHelper(ctx, 'readJson')}(${res});`);
    emitResultAndSuccess(w, step.resultState, step.onSuccess, hs);
  }, catchClause(step.onError, hs));
  w.indent(() => emitErrorSteps(w, step.onError, hs));
  w.line('}');
}

/**
 * `error` is typed `any` when user steps read it (e.g. `{{ error.message }}`), otherwise the
 * default `unknown` is kept and the failure is logged.
 */
function catchClause(onError: ActionStep[] | undefined, hs: HandlerScope): string {
  if (asSteps(onError).length > 0) {
    hs.ctx.usesAny = true;
    return '} catch (error: any) {';
  }
  return '} catch (error) {';
}

/** `hubspot.serverless(uid, { parameters, propertiesToSend })` step. */
function emitRunFunction(w: CodeWriter, step: RunFunctionAction, hs: HandlerScope): void {
  const { ctx } = hs;
  const fn = ctx.functions.get(step.functionId);
  if (!fn) {
    w.line('// Run function: the app function no longer exists.');
    return;
  }
  const hubspot = importValue(ctx, UI_EXTENSIONS, 'hubspot');
  let params = normalizeExpression(asString(step.parameters)) !== '' ? userExpr(ctx, step.parameters!) : null;
  if (params !== null && scanCode(params).identifiers.has('response')) {
    const name = hs.local.allocate('parameters');
    w.line(`const ${name} = ${params};`);
    params = name;
  }
  const options: Array<[string, JsNode]> = [];
  if (params !== null) options.push(['parameters', jsCode(asOperand(params))]);
  const propertiesToSend = Array.isArray(step.propertiesToSend) ? step.propertiesToSend.map(asString) : [];
  if (propertiesToSend.length) {
    options.push(['propertiesToSend', jsArray(propertiesToSend.map((p) => jsCode(quoteString(p))))]);
  }
  const usesResponse = responseUsed(step.resultState, step.onSuccess, hs);
  w.block('try {', () => {
    const args = [jsCode(quoteString(fn.uid)), ...(options.length ? [jsObject(options)] : [])];
    writeCall(w, usesResponse ? 'const response = await ' : 'await ', `${hubspot}.serverless`, args);
    emitResultAndSuccess(w, step.resultState, step.onSuccess, hs);
  }, catchClause(step.onError, hs));
  w.indent(() => emitErrorSteps(w, step.onError, hs));
  w.line('}');
}

/** Whether the parsed result is stored in state or read by the success steps. */
function responseUsed(resultState: string | undefined, onSuccess: ActionStep[] | undefined, hs: HandlerScope): boolean {
  if (resultState && hs.ctx.states.has(resultState)) return true;
  return collectStepCode(onSuccess ?? []).some((code) => scanCode(code).identifiers.has('response'));
}

function emitResultAndSuccess(w: CodeWriter, resultState: string | undefined, onSuccess: ActionStep[] | undefined, hs: HandlerScope): void {
  const state = resultState ? hs.ctx.states.get(resultState) : undefined;
  if (state) w.line(`${stateSetter(hs.ctx, state.name)}(response);`);
  emitSteps(w, onSuccess ?? [], hs);
}

function emitErrorSteps(w: CodeWriter, onError: ActionStep[] | undefined, hs: HandlerScope): void {
  if (asSteps(onError).length > 0) {
    emitSteps(w, onError, hs);
    return;
  }
  const logger = importValue(hs.ctx, UI_EXTENSIONS, 'logger');
  w.line(`${logger}.error(error instanceof Error ? error.message : String(error));`);
}

/**
 * Custom code is inlined in its own block. Code that uses `return` is wrapped in an async arrow
 * function so `return` only ends the custom step (as in the designer), not the whole handler.
 */
function emitCustom(w: CodeWriter, rawCode: string, hs: HandlerScope): void {
  const code = optionalContextAccess(asString(rawCode));
  const lines = dedentStatements(code);
  if (lines.every((l) => l.trim() === '')) return;
  const ids = noteUserCode(hs.ctx, code);
  // Custom code refers to `logger` / `hubspot` by name; a document name that shadows them wins.
  for (const name of ['logger', 'hubspot']) {
    if (ids.has(name) && !hs.ctx.shadowed.has(name)) importValue(hs.ctx, UI_EXTENSIONS, name);
  }
  if (ids.has('return')) {
    w.block('await (async () => {', () => w.lines(lines), '})();');
    return;
  }
  w.block('{', () => w.lines(lines));
}
