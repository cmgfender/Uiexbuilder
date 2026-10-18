/**
 * "Filter settings" in the Properties tab: which settings match what the person typed. A setting
 * matches when every word of the query appears in its label, its exact HubSpot prop name, its
 * description, its group or one of its choices ("green" finds a progress bar's Color).
 */
import type { PropDef } from '../registry/types';
import { optionLabel } from './propValue';

/** Show the filter box from this many settings on (the component's props plus its sections). */
export const FILTER_MIN_SETTINGS = 8;

export function queryWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every word appears somewhere in the haystacks (case-insensitive). */
export function matchesWords(words: string[], haystacks: Array<string | undefined>): boolean {
  if (words.length === 0) return true;
  const text = haystacks.filter(Boolean).join('\n').toLowerCase();
  return words.every((w) => text.includes(w));
}

/** The words a prop can be found by. */
export function propSearchText(def: PropDef): string[] {
  const out: Array<string | undefined> = [def.label, def.name, def.description, def.group ?? 'Content'];
  // camelCase prop names are also found by their words ("maxValue" by "max value").
  out.push(def.name.replace(/([a-z])([A-Z])/g, '$1 $2'));
  if (def.type.kind === 'enum') for (const o of def.type.options) out.push(optionLabel(o), String(o.value));
  if (def.type.kind === 'object') for (const f of def.type.fields) out.push(f.label, f.name, f.description);
  return out.filter((x): x is string => !!x);
}

export function propMatches(def: PropDef, words: string[]): boolean {
  return matchesWords(words, propSearchText(def));
}

/**
 * Where to look when nothing in Properties matches: what happens on a click lives under Events;
 * showing something only sometimes or once per item, under Advanced.
 */
export function elsewhereHint(query: string): { tab: 'events' | 'advanced'; label: string } | null {
  const q = query.toLowerCase();
  if (/(click|event|action|submit|when .*(press|chang)|on ?change|handler|run)/.test(q)) {
    return { tab: 'events', label: 'Actions (what happens on a click or a change) are under Events.' };
  }
  if (/(hide|hidden|show when|only when|condition|visib|repeat|loop|each|list of|for every)/.test(q)) {
    return { tab: 'advanced', label: 'Showing it only sometimes, or once per item of a list, is under Advanced.' };
  }
  return null;
}
