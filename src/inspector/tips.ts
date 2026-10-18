/**
 * "You can also…" tips for the selected component: short, plain-language pointers to power the
 * settings themselves don't show (Rules for thresholds, CRM data, actions, show when, repeat).
 * Component-specific tips come from the registry (`ComponentDef.tips`); generic ones are added
 * here from what the component supports. Each tip names what it does when clicked (`TipAction`).
 */
import { hasTemplate, singleExpression } from '../model/template';
import { isExpr, type UINode } from '../model/types';
import type { ComponentDef, ComponentTip, TipAction } from '../registry/types';
import { isPropVisible } from './propValue';
import { parseRules, rulesOf, supportsRules } from './rules';

function textHasRules(text: string | undefined): boolean {
  const code = typeof text === 'string' ? singleExpression(text) : null;
  return code !== null && !!parseRules(code);
}

export const MAX_TIPS = 4;

function sameAction(a: TipAction, b: TipAction): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Whether the tip's capability is already in use on the node (then the tip is not shown). */
export function tipInUse(node: UINode, action: TipAction): boolean {
  switch (action.kind) {
    case 'rules':
      return action.prop === '__text' ? textHasRules(node.text) : !!rulesOf(node.props[action.prop]);
    case 'data':
      return action.prop === '__text' ? hasTemplate(node.text ?? '') : isExpr(node.props[action.prop]);
    case 'event':
      return (node.events?.[action.event]?.length ?? 0) > 0;
    case 'condition':
      return !!node.condition?.trim();
    case 'repeat':
      return !!node.repeat;
    case 'binding':
      return !!node.binding?.state;
    case 'overlay':
      return Object.values(node.slots ?? {}).some((ids) => ids.length > 0);
    default:
      return false;
  }
}

/** Whether the action can apply to this component (the prop exists and is shown, …). */
function applicable(def: ComponentDef, node: UINode, action: TipAction): boolean {
  switch (action.kind) {
    case 'rules':
    case 'data': {
      if (action.prop === '__text') return def.children.mode === 'text';
      const p = def.props.find((x) => x.name === action.prop);
      if (!p || !isPropVisible(p, node.props) || p.bindable === false) return false;
      return action.kind === 'data' || supportsRules(p);
    }
    case 'event':
      return !!def.events?.some((e) => e.name === action.event);
    case 'binding':
      return !!def.valueBinding;
    case 'overlay':
      return !!def.slots?.length;
    case 'condition':
    case 'repeat':
      return !def.overlay && !def.slotOnly;
    default:
      return false;
  }
}

const EVENT_TIPS: Record<string, string> = {
  onClick: 'Do something when it’s clicked',
  onChange: 'Do something when the value changes',
  onSubmit: 'Do something with the answers when the form is sent',
  onSelectedChange: 'Do something when another tab is picked',
};

/** Generic tips from what the component supports (after the registry's own tips). */
function genericTips(def: ComponentDef): ComponentTip[] {
  const tips: ComponentTip[] = [];
  if (def.children.mode === 'text') {
    tips.push({ text: 'Show a CRM property or other data in the text', action: { kind: 'data', prop: '__text' } });
    tips.push({ text: 'Show different text depending on a value', action: { kind: 'rules', prop: '__text' } });
  }
  // Only color-like variants (their choices have swatches): "pick the color by a value".
  const variant = def.props.find((p) => p.name === 'variant' && p.type.kind === 'enum' && p.type.options.some((o) => o.swatch));
  if (variant) {
    tips.push({
      text: `Pick the ${variant.label.toLowerCase()} by a value, e.g. a deal stage`,
      action: { kind: 'rules', prop: 'variant' },
    });
  }
  const ev = def.events?.find((e) => EVENT_TIPS[e.name]);
  if (ev) tips.push({ text: EVENT_TIPS[ev.name], action: { kind: 'event', event: ev.name } });
  if (def.slots?.some((s) => s.name === 'overlay')) {
    tips.push({ text: 'Open a pop-up, a side panel or a tooltip from it', action: { kind: 'overlay' } });
  }
  tips.push({ text: 'Show it only when something is true', action: { kind: 'condition' } });
  tips.push({ text: 'Repeat it for each item in a list', action: { kind: 'repeat' } });
  return tips;
}

/**
 * The tips to show for a node: registry tips first, then generic ones, without duplicates,
 * leaving out what doesn't apply or is already in use, at most `MAX_TIPS`.
 */
export function tipsFor(def: ComponentDef, node: UINode): ComponentTip[] {
  const out: ComponentTip[] = [];
  for (const tip of [...(def.tips ?? []), ...genericTips(def)]) {
    if (out.some((t) => sameAction(t.action, tip.action))) continue;
    if (!applicable(def, node, tip.action) || tipInUse(node, tip.action)) continue;
    out.push(tip);
    if (out.length >= MAX_TIPS) break;
  }
  return out;
}

/**
 * The component's own tips (registry) that are already in use, e.g. a progress bar whose color
 * already changes by percentage: the inspector lists them as "on", one click from their settings.
 */
export function activeTipsFor(def: ComponentDef, node: UINode): ComponentTip[] {
  return (def.tips ?? []).filter((tip) => applicable(def, node, tip.action) && tipInUse(node, tip.action));
}
