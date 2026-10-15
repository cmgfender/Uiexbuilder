/**
 * A small fuzzy matcher for the command palette. Matches are ranked in tiers:
 *
 *   exact  >  prefix  >  word start  >  all words at word starts  >  acronym (every character at a
 *   word start)  >  substring  >  all words anywhere  >  subsequence (scored by word-start hits,
 *   runs of consecutive characters and gaps)
 *
 * so "but" ranks "Button" above "Insert Button" above "Attribute", and "ib" still finds
 * "Insert Button". Matching is case-insensitive; `indices` are the matched character positions in
 * the text (for highlighting).
 */

export interface FuzzyMatch {
  score: number;
  /** Positions of the matched characters in the text, ascending. */
  indices: number[];
}

export const SCORE = {
  exact: 1000,
  prefix: 900,
  wordStart: 700,
  wordsAtStarts: 600,
  acronym: 560,
  substring: 500,
  wordsAnywhere: 420,
  subsequenceMax: 400,
  subsequenceMin: 100,
} as const;

const isAlnum = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);
const isUpper = (ch: string | undefined) => !!ch && ch !== ch.toLowerCase() && ch === ch.toUpperCase();

/** Whether position `i` of `text` starts a word (after a separator, or a camelCase hump). */
export function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1];
  const ch = text[i];
  if (!isAlnum(prev)) return isAlnum(ch);
  return isUpper(ch) && !isUpper(prev);
}

const range = (start: number, length: number) => Array.from({ length }, (_, k) => start + k);

/** First occurrence of `needle` in `hay` that starts a word, or -1. */
function wordStartIndex(hay: string, original: string, needle: string): number {
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i === -1) return -1;
    if (isWordStart(original, i)) return i;
    from = i + 1;
  }
}

/**
 * Best subsequence alignment of `q` in `t` (lowercased), preferring word starts and consecutive
 * runs. Returns the normalised quality (0..1] and the matched indices, or null.
 */
function subsequence(q: string, t: string, original: string): { quality: number; indices: number[] } | null {
  const m = q.length;
  const n = t.length;
  if (m === 0 || m > n) return null;
  // Quick reject: not a subsequence at all.
  for (let i = 0, j = 0; i < m; i++, j++) {
    while (j < n && t[j] !== q[i]) j++;
    if (j >= n) return null;
  }
  const WORD = 8;
  const RUN = 5;
  const BASE = 1;
  const GAP = 0.15;
  const MAX = (BASE + WORD + RUN) * m;
  // best[i][j]: best score with q[i] matched at t[j]; prev[i][j]: position of q[i-1].
  // A gap of g characters costs g * GAP, so max over k < j-1 of best[i-1][k] - GAP * (j-k-1)
  // is a running maximum of best[i-1][k] + GAP * k (O(m·n) overall).
  const best: Float64Array[] = [];
  const prev: Int32Array[] = [];
  for (let i = 0; i < m; i++) {
    const row = new Float64Array(n).fill(-Infinity);
    const back = new Int32Array(n).fill(-1);
    const prevRow = i > 0 ? best[i - 1] : null;
    let runMax = -Infinity;
    let runK = -1;
    for (let j = i; j < n; j++) {
      // Fold k = j - 2 into the running maximum (k = j - 1 is the consecutive case).
      if (prevRow && j - 2 >= 0 && prevRow[j - 2] > -Infinity && prevRow[j - 2] + GAP * (j - 2) > runMax) {
        runMax = prevRow[j - 2] + GAP * (j - 2);
        runK = j - 2;
      }
      if (t[j] !== q[i]) continue;
      const own = BASE + (isWordStart(original, j) ? WORD : 0);
      if (!prevRow) {
        row[j] = own - j * 0.05;
        continue;
      }
      let bestVal = -Infinity;
      let bestK = -1;
      if (prevRow[j - 1] > -Infinity) {
        bestVal = prevRow[j - 1] + RUN;
        bestK = j - 1;
      }
      if (runK >= 0) {
        const v = runMax - GAP * (j - 1);
        if (v > bestVal) {
          bestVal = v;
          bestK = runK;
        }
      }
      if (bestK >= 0) {
        row[j] = bestVal + own;
        back[j] = bestK;
      }
    }
    best.push(row);
    prev.push(back);
  }
  const last = best[m - 1];
  let end = -1;
  for (let j = 0; j < n; j++) if (last[j] > -Infinity && (end === -1 || last[j] > last[end])) end = j;
  if (end === -1) return null;
  const indices: number[] = [];
  for (let i = m - 1, j = end; i >= 0; i--) {
    indices.unshift(j);
    j = prev[i][j];
  }
  return { quality: Math.max(0.01, Math.min(1, last[end] / MAX)), indices };
}

/** Matches `query` against `text`; null when it does not match at all. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();
  if (t === q) return { score: SCORE.exact, indices: range(0, text.length) };
  if (t.startsWith(q)) return { score: SCORE.prefix - Math.min(text.length, 200) * 0.1, indices: range(0, q.length) };
  const ws = wordStartIndex(t, text, q);
  if (ws > 0) return { score: SCORE.wordStart - Math.min(ws, 100) * 0.5 - Math.min(text.length, 200) * 0.05, indices: range(ws, q.length) };

  const tokens = q.split(' ').filter(Boolean);
  if (tokens.length > 1) {
    // Every word of the query at a word start (any order): "but ins" -> "Insert Button".
    const starts = tokens.map((tok) => wordStartIndex(t, text, tok));
    if (starts.every((s) => s >= 0)) {
      const indices = [...new Set(tokens.flatMap((tok, k) => range(starts[k], tok.length)))].sort((a, b) => a - b);
      return { score: SCORE.wordsAtStarts - Math.min(text.length, 200) * 0.05, indices };
    }
  }
  const compact = q.replace(/ /g, '');
  const seq = subsequence(compact, t, text);
  // Acronym: every character at a word start ("sp" -> "Show problems") beats a plain substring.
  if (seq && seq.indices.length > 1 && seq.indices.every((i) => isWordStart(text, i))) {
    return { score: SCORE.acronym - Math.min(text.length, 200) * 0.05, indices: seq.indices };
  }
  const sub = t.indexOf(q);
  if (sub >= 0) return { score: SCORE.substring - Math.min(sub, 100) * 0.5, indices: range(sub, q.length) };
  if (tokens.length > 1) {
    const positions = tokens.map((tok) => t.indexOf(tok));
    if (positions.every((p) => p >= 0)) {
      const indices = [...new Set(tokens.flatMap((tok, k) => range(positions[k], tok.length)))].sort((a, b) => a - b);
      return { score: SCORE.wordsAnywhere - Math.min(text.length, 200) * 0.05, indices };
    }
  }
  if (!seq) return null;
  return {
    score: SCORE.subsequenceMin + (SCORE.subsequenceMax - SCORE.subsequenceMin) * seq.quality,
    indices: seq.indices,
  };
}

/** Splits text into plain / highlighted parts for rendering a match. */
export function highlightParts(text: string, indices: number[]): Array<{ text: string; hit: boolean }> {
  if (!indices.length) return [{ text, hit: false }];
  const set = new Set(indices);
  const parts: Array<{ text: string; hit: boolean }> = [];
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else parts.push({ text: text[i], hit });
  }
  return parts;
}
