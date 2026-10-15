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
import { noteUserCode, setterName, UI_EXTENSIONS } from './context';
import {
  asOperand,
  CodeWriter,
  dedentStatements,
  jsArray,
  jsCode,
  jsObject,
  negate,
  normalizeExpression,
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
        w.line(`// Set state: unknown state variable ${quoteString(step.state)}.`);
        return;
      }
      const value = normalizeExpression(asString(step.value)) === '' ? 'undefined' : userExpr(ctx, step.value);
      w.line(`${setterName(state.name)}(${asOperand(value)});`);
      return;
    }
    case 'addAlert': {
      const entries: Array<[string, JsNode]> = [['type', jsCode(quoteString(asString(step.alertType) || 'info'))]];
      if (asString(step.title).trim() !== '') entries.push(['title', jsCode(templateText(ctx, step.title))]);
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
      ctx.imports.add(UI_EXTENSIONS, 'logger');
      const level = ['info', 'warn', 'error', 'debug'].includes(step.level) ? step.level : 'info';
      w.line(`logger.${level}(${asOperand(templateText(ctx, step.message))});`);
      return;
    }
    case 'if': {
      const hasThen = asSteps(step.then).length > 0;
      const hasElse = asSteps(step.else).length > 0;
      const cond = userExpr(ctx, step.condition);
      if (!hasThen && !hasElse) return;
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
  ctx.imports.add(UI_EXTENSIONS, 'hubspot');
  let url = templateText(ctx, step.url);
  let body = normalizeExpression(asString(step.body)) !== '' ? userExpr(ctx, step.body!) : null;
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
  const options: Array<[string, JsNode]> = [['method', jsCode(quoteString(asString(step.method) || 'GET'))]];
  if (body !== null) options.push(['body', jsCode(asOperand(body))]);
  const usesResponse = responseUsed(step.resultState, step.onSuccess, hs);
  w.block('try {', () => {
    writeCall(w, `const ${res} = await `, 'hubspot.fetch', [jsCode(asOperand(url)), jsObject(options)]);
    w.block(`if (!${res}.ok) {`, () => {
      w.line(`throw new Error(\`Request failed with status \${${res}.status}\`);`);
    });
    if (usesResponse) w.line(`const response = await ${res}.json();`);
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
  ctx.imports.add(UI_EXTENSIONS, 'hubspot');
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
    writeCall(w, usesResponse ? 'const response = await ' : 'await ', 'hubspot.serverless', args);
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
  if (state) w.line(`${setterName(state.name)}(response);`);
  emitSteps(w, onSuccess ?? [], hs);
}

function emitErrorSteps(w: CodeWriter, onError: ActionStep[] | undefined, hs: HandlerScope): void {
  if (asSteps(onError).length > 0) {
    emitSteps(w, onError, hs);
    return;
  }
  hs.ctx.imports.add(UI_EXTENSIONS, 'logger');
  w.line('logger.error(error instanceof Error ? error.message : String(error));');
}

/**
 * Custom code is inlined in its own block. Code that uses `return` is wrapped in an async arrow
 * function so `return` only ends the custom step (as in the designer), not the whole handler.
 */
function emitCustom(w: CodeWriter, rawCode: string, hs: HandlerScope): void {
  const code = asString(rawCode);
  const lines = dedentStatements(code);
  if (lines.every((l) => l.trim() === '')) return;
  const ids = noteUserCode(hs.ctx, code);
  if (ids.has('logger')) hs.ctx.imports.add(UI_EXTENSIONS, 'logger');
  if (ids.has('hubspot')) hs.ctx.imports.add(UI_EXTENSIONS, 'hubspot');
  if (ids.has('return')) {
    w.block('await (async () => {', () => w.lines(lines), '})();');
    return;
  }
  w.block('{', () => w.lines(lines));
}
