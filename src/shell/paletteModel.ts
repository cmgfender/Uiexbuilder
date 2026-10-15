/**
 * Palette search and "recently used" tracking (pure logic + a tiny localStorage-backed store).
 */
import { useSyncExternalStore } from 'react';
import type { ComponentDef } from '../registry/types';
import { PREF_KEYS, readPref, writePref } from './prefs';

export const MAX_RECENT = 8;

/** Lower-cased search terms of a query. */
export function searchTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Relevance of a component for the query terms (0 = no match). Every term must match one of the
 * label, type, keywords, category or description; label hits rank highest.
 */
export function componentScore(def: ComponentDef, terms: string[]): number {
  if (terms.length === 0) return 1;
  const label = def.label.toLowerCase();
  const type = def.type.toLowerCase();
  const keywords = (def.keywords ?? []).map((k) => k.toLowerCase());
  const category = def.category.toLowerCase();
  const description = def.description.toLowerCase();
  let score = 0;
  for (const term of terms) {
    let best = 0;
    if (label === term || type === term) best = 100;
    else if (label.startsWith(term) || label.split(/\s+/).some((w) => w.startsWith(term))) best = 60;
    else if (label.includes(term)) best = 40;
    else if (type.includes(term)) best = 35;
    else if (keywords.some((k) => k.startsWith(term))) best = 25;
    else if (keywords.some((k) => k.includes(term))) best = 18;
    else if (category.includes(term)) best = 10;
    // Descriptions are long: only whole-word prefixes of longer terms count (avoids noise like "con" -> "icon").
    else if (term.length >= 4 && descriptionWords(description).some((w) => w.startsWith(term))) best = 5;
    if (best === 0) return 0;
    score += best;
  }
  return score;
}

function descriptionWords(description: string): string[] {
  return description.split(/[^a-z0-9]+/).filter(Boolean);
}

/** Components matching the query, best first (stable for ties). */
export function searchComponents(defs: ComponentDef[], query: string): ComponentDef[] {
  const terms = searchTerms(query);
  return defs
    .map((def, i) => ({ def, i, score: componentScore(def, terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.def);
}

export interface TextSegment {
  text: string;
  match: boolean;
}

/** Splits `text` into segments, marking case-insensitive occurrences of any term. */
export function highlightSegments(text: string, terms: string[]): TextSegment[] {
  if (!terms.length || !text) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const marks = new Array<boolean>(text.length).fill(false);
  for (const term of terms) {
    let from = 0;
    while (term && from < lower.length) {
      const at = lower.indexOf(term, from);
      if (at === -1) break;
      for (let i = at; i < at + term.length; i++) marks[i] = true;
      from = at + term.length;
    }
  }
  const out: TextSegment[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.match === marks[i]) last.text += text[i];
    else out.push({ text: text[i], match: marks[i] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recently used components
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();
let recentCache: string[] | null = null;

function readRecent(): string[] {
  if (recentCache) return recentCache;
  const raw = readPref<unknown>(PREF_KEYS.recentComponents, []);
  recentCache = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : [];
  return recentCache;
}

export function getRecentComponents(): string[] {
  return readRecent();
}

/** Moves `type` to the front of the recently used list (max MAX_RECENT). */
export function recordRecentComponent(type: string): void {
  const next = [type, ...readRecent().filter((t) => t !== type)].slice(0, MAX_RECENT);
  recentCache = next;
  writePref(PREF_KEYS.recentComponents, next);
  listeners.forEach((l) => l());
}

/** Clears the in-memory cache (tests). */
export function resetRecentComponentsCache(): void {
  recentCache = null;
  listeners.forEach((l) => l());
}

export function useRecentComponents(): string[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readRecent,
    readRecent,
  );
}
