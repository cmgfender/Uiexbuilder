/**
 * Plain-language notes about what a component does beyond its plain settings ("Color changes by
 * rules", "Shown only sometimes", "Repeats for each item in deals"), for the inspector's
 * "Inside this …" list and anywhere a short summary of a component helps.
 */
import { singleExpression } from '../model/template';
import { isExpr, type UINode } from '../model/types';
import type { ComponentDef } from '../registry/types';
import { parseRules, rulesOf } from './rules';

export type NodeHintKind = 'rules' | 'data' | 'condition' | 'repeat' | 'binding' | 'events';

export interface NodeHint {
  kind: NodeHintKind;
  text: string;
}

function shorten(text: string, max = 28): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** What the node does that its settings alone don't show, most telling first. */
export function nodeHints(node: UINode, def: ComponentDef | undefined): NodeHint[] {
  const hints: NodeHint[] = [];
  const props = def?.props ?? [];
  for (const p of props) {
    const v = node.props[p.name];
    if (rulesOf(v)) hints.push({ kind: 'rules', text: `${p.label} changes by rules` });
  }
  const textCode = typeof node.text === 'string' ? singleExpression(node.text) : null;
  if (textCode !== null && parseRules(textCode)) hints.push({ kind: 'rules', text: 'Text changes by rules' });
  const computed = props.filter((p) => isExpr(node.props[p.name]) && !rulesOf(node.props[p.name]));
  if (computed.length === 1) hints.push({ kind: 'data', text: `${computed[0].label} from data` });
  else if (computed.length > 1) hints.push({ kind: 'data', text: `${computed.length} settings from data` });
  if (node.binding?.state) hints.push({ kind: 'binding', text: `Linked to ${node.binding.state}` });
  if (node.condition?.trim()) hints.push({ kind: 'condition', text: 'Shown only sometimes' });
  if (node.repeat) hints.push({ kind: 'repeat', text: `Repeats for each item in ${shorten(node.repeat.items, 20)}` });
  const events = (def?.events ?? []).filter((e) => (node.events?.[e.name]?.length ?? 0) > 0);
  if (events.length === 1) hints.push({ kind: 'events', text: `Runs actions ${events[0].label.toLowerCase()}` });
  else if (events.length > 1) hints.push({ kind: 'events', text: `Runs actions on ${events.length} events` });
  return hints;
}
