/**
 * Event action model for the inspector (pure): the catalog of action kinds shown in the
 * "+ Add action" menu, smart defaults for new steps, plain-language summaries and list helpers.
 */
import type { LucideIcon } from 'lucide-react';
import {
  AppWindow,
  Bell,
  ClipboardCopy,
  Code,
  DatabaseZap,
  GitBranch,
  Globe,
  RefreshCw,
  RotateCw,
  ScrollText,
  Server,
  Variable,
  X,
} from 'lucide-react';
import { newId } from '../model/ids';
import { buildParentIndex, cloneActions } from '../model/tree';
import type { ActionStep, ActionType, Extension, NodeId, Project, StateVar } from '../model/types';
import { getComponent } from '../registry';
import { describeCondition, parseCondition } from './power-conditions';
import { listScopeVariables } from './scope';

export type ActionGroup = 'State' | 'Feedback' | 'HubSpot' | 'Data' | 'Logic' | 'Advanced';
export const ACTION_GROUP_ORDER: ActionGroup[] = ['State', 'Feedback', 'HubSpot', 'Data', 'Logic', 'Advanced'];

export interface ActionKindInfo {
  type: ActionType;
  label: string;
  description: string;
  group: ActionGroup;
  icon: LucideIcon;
}

export const ACTION_KINDS: ActionKindInfo[] = [
  { type: 'setState', label: 'Set variable', description: 'Change the value of a state variable.', group: 'State', icon: Variable },
  { type: 'addAlert', label: 'Show alert', description: 'Show a success, info, warning or error banner.', group: 'Feedback', icon: Bell },
  {
    type: 'copyToClipboard',
    label: 'Copy to clipboard',
    description: 'Copy text to the user’s clipboard.',
    group: 'Feedback',
    icon: ClipboardCopy,
  },
  { type: 'log', label: 'Log', description: 'Write a message to the console (for debugging).', group: 'Feedback', icon: ScrollText },
  {
    type: 'refreshObjectProperties',
    label: 'Refresh record properties',
    description: 'Reload the property values shown on the record page.',
    group: 'HubSpot',
    icon: RefreshCw,
  },
  { type: 'reloadPage', label: 'Reload page', description: 'Reload the whole HubSpot page.', group: 'HubSpot', icon: RotateCw },
  {
    type: 'openIframeModal',
    label: 'Open iframe modal',
    description: 'Open a web page in a HubSpot modal.',
    group: 'HubSpot',
    icon: AppWindow,
  },
  { type: 'closeOverlay', label: 'Close overlay', description: 'Close an open modal or panel.', group: 'HubSpot', icon: X },
  { type: 'runDataSource', label: 'Refresh data source', description: 'Fetch a data source again.', group: 'Data', icon: DatabaseZap },
  { type: 'fetch', label: 'Fetch URL', description: 'Call an external API with hubspot.fetch.', group: 'Data', icon: Globe },
  { type: 'runFunction', label: 'Run app function', description: 'Call a serverless app function.', group: 'Data', icon: Server },
  { type: 'if', label: 'If / else', description: 'Run different actions depending on a condition.', group: 'Logic', icon: GitBranch },
  { type: 'custom', label: 'Custom code', description: 'Write JavaScript statements (power users).', group: 'Advanced', icon: Code },
];

const BY_TYPE = new Map(ACTION_KINDS.map((k) => [k.type, k]));

export function actionKindInfo(type: ActionType): ActionKindInfo | undefined {
  return BY_TYPE.get(type);
}

/** Action kinds available in an extension (record refresh only exists on CRM cards). */
export function availableActionKinds(ext: Extension): ActionKindInfo[] {
  return ACTION_KINDS.filter((k) => !(k.type === 'refreshObjectProperties' && ext.kind !== 'card'));
}

export interface ActionContext {
  project: Project;
  ext: Extension;
  /** The node whose event is edited. */
  nodeId: NodeId | null;
  /** Names in scope from the event handler (and enclosing fetch / function callbacks). */
  eventParams: string[];
  /**
   * The fetch / app function callback the list belongs to (nearest one; If/else branches inherit
   * it). New steps in an `onError` list default to reporting the failure.
   */
  branch?: 'onSuccess' | 'onError';
}

/** Modal / Panel nodes of the extension (closeOverlay targets). */
export function overlayNodes(ext: Extension): Array<{ id: NodeId; label: string }> {
  const out: Array<{ id: NodeId; label: string }> = [];
  for (const n of Object.values(ext.nodes)) {
    const def = getComponent(n.type);
    if (!def?.overlay) continue;
    const title = typeof n.props.title === 'string' && n.props.title.trim() ? n.props.title.trim() : null;
    const idProp = typeof n.props[def.overlay.idProp] === 'string' ? String(n.props[def.overlay.idProp]) : n.id;
    out.push({ id: n.id, label: `${def.label}: ${n.name || title || idProp}` });
  }
  return out;
}

/** The Modal/Panel that contains `nodeId` (a Close button inside a modal closes that modal). */
export function enclosingOverlay(ext: Extension, nodeId: NodeId | null): NodeId | null {
  if (!nodeId) return null;
  const index = buildParentIndex(ext);
  let cur: NodeId | undefined = nodeId;
  const seen = new Set<NodeId>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const n = ext.nodes[cur];
    if (n && getComponent(n.type)?.overlay) return cur;
    cur = index.get(cur)?.parentId;
  }
  return null;
}

/**
 * Sensible value for a set-variable step on `v`: the event's value, a toggle / increment, else an
 * empty value of the variable's type (never blank — a blank value is `undefined`, which a typed
 * setter rejects in the exported TypeScript).
 */
export function defaultSetValue(v: StateVar | undefined, eventParams: string[]): string {
  if (!v) return '';
  if (eventParams.includes('value') && v.type !== 'boolean') return 'value';
  if (v.type === 'boolean') return eventParams.includes('checked') ? 'checked' : `!${v.name}`;
  if (v.type === 'number') return `${v.name} + 1`;
  return emptyValueOf(v.type);
}

/** Source of an "empty" value of a state type: '' / 0 / false / [] / {} / null. */
export function emptyValueOf(type: StateVar['type']): string {
  switch (type) {
    case 'string':
      return "''";
    case 'number':
      return '0';
    case 'boolean':
      return 'false';
    case 'array':
      return '[]';
    case 'object':
      return '{}';
    default:
      return 'null';
  }
}

/** Alert reporting the failure, for steps added to an onError list (`error` is an Error). */
const ERROR_ALERT = { alertType: 'danger', title: 'Something went wrong', message: '{{ error.message }}' } as const;

/** Variable names worth copying by default (an email address, phone number, link...). */
const COPYABLE_RE = /(?:^|\.)[\w$]*(?:email|phone|mobile|url|website|domain|link|address)[\w$]*$/i;

/**
 * Default text of a "Copy to clipboard" step: the first copy-worthy record property / variable in
 * scope (e.g. `{{ record.email }}`), else ''. The signed-in user's own context values are skipped.
 */
export function defaultCopyText(ctx: Pick<ActionContext, 'ext' | 'nodeId' | 'eventParams'>): string {
  const vars = listScopeVariables(ctx.ext, ctx.nodeId, ctx.eventParams);
  const rank = (kind: string) => (kind === 'property' ? 0 : kind === 'repeat' ? 1 : kind === 'state' || kind === 'computed' ? 2 : 3);
  const pick = vars
    .filter((v) => ['property', 'repeat', 'state', 'computed', 'param'].includes(v.kind) && COPYABLE_RE.test(v.name))
    .sort((a, b) => rank(a.kind) - rank(b.kind))[0];
  return pick ? `{{ ${pick.name} }}` : '';
}

/** A new step of the given type with smart defaults for this context. */
export function createStep(type: ActionType, ctx: ActionContext): ActionStep {
  const id = newId('a');
  switch (type) {
    case 'setState': {
      const v = ctx.ext.state[0];
      return { id, type, state: v?.name ?? '', value: defaultSetValue(v, ctx.eventParams) };
    }
    case 'addAlert':
      if (ctx.branch === 'onError') return { id, type, ...ERROR_ALERT };
      return { id, type, alertType: 'success', title: '', message: 'Saved successfully' };
    case 'refreshObjectProperties':
      return { id, type };
    case 'reloadPage':
      return { id, type };
    case 'openIframeModal':
      return { id, type, uri: 'https://example.com', title: 'Details', width: 640, height: 480 };
    case 'closeOverlay':
      return { id, type, overlayNodeId: enclosingOverlay(ctx.ext, ctx.nodeId) ?? overlayNodes(ctx.ext)[0]?.id ?? '' };
    case 'copyToClipboard':
      return { id, type, text: defaultCopyText(ctx) };
    case 'runDataSource':
      return { id, type, dataSourceId: ctx.ext.dataSources[0]?.id ?? '' };
    // Requests start with an error alert so a failure is never silent (or reported as success).
    case 'fetch':
      return { id, type, url: 'https://api.example.com/items', method: 'GET', onError: [{ id: newId('a'), type: 'addAlert', ...ERROR_ALERT }] };
    case 'runFunction':
      return { id, type, functionId: ctx.project.functions[0]?.id ?? '', onError: [{ id: newId('a'), type: 'addAlert', ...ERROR_ALERT }] };
    case 'log':
      if (ctx.branch === 'onError') return { id, type, level: 'error', message: '{{ error.message }}' };
      return { id, type, level: 'info', message: '' };
    case 'if':
      return { id, type, condition: '', then: [], else: [] };
    case 'custom':
      return { id, type, code: '' };
    default: {
      const never: never = type;
      throw new Error(`Unknown action type ${String(never)}`);
    }
  }
}

/** Deep copy with fresh ids (for "Duplicate"). */
export function duplicateStep(step: ActionStep): ActionStep {
  return cloneActions([step])[0];
}

/** Total number of steps including nested branches/callbacks. */
export function countSteps(steps: ActionStep[] | undefined): number {
  let n = 0;
  for (const s of steps ?? []) {
    n++;
    if (s.type === 'if') n += countSteps(s.then) + countSteps(s.else);
    if (s.type === 'fetch' || s.type === 'runFunction') n += countSteps(s.onSuccess) + countSteps(s.onError);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Plain-language summaries
// ---------------------------------------------------------------------------

function clip(s: string, max = 40): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const ALERT_WORDS: Record<string, string> = {
  success: 'a success',
  info: 'an info',
  warning: 'a warning',
  danger: 'an error',
  tip: 'a tip',
};

/** One short phrase describing a step, e.g. "set count to count + 1". */
export function summarizeStep(step: ActionStep, ctx: Pick<ActionContext, 'ext' | 'project'>): string {
  switch (step.type) {
    case 'setState':
      return step.state ? `set ${step.state} to ${step.value.trim() ? clip(step.value, 32) : '(empty)'}` : 'set a variable (choose one)';
    case 'addAlert': {
      const text = step.title || step.message;
      const kind = step.alertTypeExpr?.trim() ? 'an' : (ALERT_WORDS[step.alertType] ?? 'an');
      return `show ${kind} alert${text ? ` “${clip(text, 30)}”` : ''}${step.alertTypeExpr?.trim() ? ' (type by rules)' : ''}`;
    }
    case 'refreshObjectProperties':
      return 'refresh the record’s properties';
    case 'reloadPage':
      return 'reload the page';
    case 'openIframeModal':
      return `open ${step.uri ? clip(step.uri, 36) : 'a page'} in a modal`;
    case 'closeOverlay': {
      const o = overlayNodes(ctx.ext).find((x) => x.id === step.overlayNodeId);
      return o ? `close ${o.label}` : 'close an overlay (choose one)';
    }
    case 'copyToClipboard':
      return step.text ? `copy “${clip(step.text, 30)}”` : 'copy text to the clipboard';
    case 'runDataSource': {
      const ds = ctx.ext.dataSources.find((d) => d.id === step.dataSourceId);
      return ds ? `refresh ${ds.name}` : 'refresh a data source (choose one)';
    }
    case 'fetch':
      return `${step.method} ${step.url ? clip(step.url, 36) : '(no URL)'}${step.resultState ? ` into ${step.resultState}` : ''}`;
    case 'runFunction': {
      const fn = ctx.project.functions.find((f) => f.id === step.functionId);
      return fn ? `run ${fn.uid}${step.resultState ? ` into ${step.resultState}` : ''}` : 'run an app function (choose one)';
    }
    case 'log':
      return `log${step.message ? ` “${clip(step.message, 30)}”` : ' a message'}`;
    case 'if': {
      const n = step.then.length;
      const e = step.else.length;
      const set = step.condition.trim() ? parseCondition(step.condition) : null;
      const cond = set && set.groups.length ? clip(describeCondition(set), 40) : step.condition.trim() ? clip(step.condition, 28) : '(no condition)';
      return `if ${cond} → ${n} action${n === 1 ? '' : 's'}${e ? `, else ${e}` : ''}`;
    }
    case 'custom': {
      const first = step.code.split('\n').find((l) => l.trim() && !l.trim().startsWith('//'));
      return first ? `run code: ${clip(first, 30)}` : 'run custom code';
    }
    default:
      return 'action';
  }
}

/** "When clicked → set count to count + 1 → show a success alert". */
export function summarizeHandler(eventLabel: string, steps: ActionStep[], ctx: Pick<ActionContext, 'ext' | 'project'>): string {
  const when = eventWhen(eventLabel);
  if (!steps.length) return `${when}: nothing happens yet`;
  return [when, ...steps.map((s) => summarizeStep(s, ctx))].join(' → ');
}

/** "On click" -> "When clicked", "On change" -> "When changed", others "When <label>". */
export function eventWhen(label: string): string {
  const raw = label.replace(/^on\s+/i, '').trim();
  const lower = raw.toLowerCase();
  const special: Record<string, string> = {
    click: 'clicked',
    change: 'changed',
    input: 'typing',
    blur: 'focus leaves',
    focus: 'focused',
    submit: 'submitted',
    open: 'opened',
    close: 'closed',
  };
  return `When ${special[lower] ?? lower}`;
}
