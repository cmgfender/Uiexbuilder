/**
 * Small, token-based rewrites of user code for the generated TypeScript (see model/jsTokens).
 *
 *  - optionalContextAccess: HubSpot types some context members as optional (`context.extension`,
 *    `context.variables`, `context.user.locale` / `language`, `extension.appName` / `cardTitle`).
 *    Member access through them gets `?.` so expressions such as `context.extension.appName`
 *    type-check under `strict` (they are `undefined`-safe at runtime too).
 *  - inferValueType: a conservative static type of an expression (literals, state variables,
 *    simple arithmetic / comparisons), used to cast set-state values that cannot type-check.
 */
import { isPropertyName, matchingClose, nextSignificant, tokenize, type Token } from '../model/jsTokens';

/** Optional members of HubSpot's extension context types, as paths below `context`. */
const OPTIONAL_CONTEXT_PATHS = new Set([
  'variables',
  'extension',
  'extension.appName',
  'extension.cardTitle',
  'user.locale',
  'user.language',
]);

/** Adds `?.` after optional context members that are accessed further (`context.extension?.appName`). */
export function optionalContextAccess(code: string): string {
  if (!code.includes('context')) return code;
  const tokens = tokenize(code);
  const edits = new Map<number, string>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'ident' || t.text !== 'context' || isPropertyName(tokens, i)) continue;
    const path: string[] = [];
    let j = i;
    for (;;) {
      const dot = nextSignificant(tokens, j + 1);
      if (dot === -1 || tokens[dot].kind !== 'punct' || (tokens[dot].text !== '.' && tokens[dot].text !== '?.')) break;
      const name = nextSignificant(tokens, dot + 1);
      if (name === -1 || tokens[name].kind !== 'ident') break;
      path.push(tokens[name].text);
      j = name;
      if (!OPTIONAL_CONTEXT_PATHS.has(path.join('.'))) continue;
      const after = nextSignificant(tokens, name + 1);
      if (after === -1 || tokens[after].kind !== 'punct') break;
      if (tokens[after].text === '.') edits.set(after, '?.');
      else if (tokens[after].text === '[') edits.set(after, '?.[');
    }
  }
  if (edits.size === 0) return code;
  return tokens.map((tok, idx) => edits.get(idx) ?? tok.text).join('');
}

/** A TypeScript type as the generated code declares it (`string`, `number | null`, `any[]`, ...). */
export type InferredType = string | null;

const COMPARISON = new Set(['===', '!==', '==', '!=', '<', '>', '<=', '>=', 'instanceof', 'in']);
const ARITHMETIC = new Set(['+', '-', '*', '/', '%', '**']);

function significant(tokens: Token[]): Token[] {
  return tokens.filter((t) => t.kind !== 'whitespace' && t.kind !== 'comment');
}

/** Type of a single operand (literal or known identifier), or null when unknown. */
function operandType(toks: Token[], known: (name: string) => InferredType): InferredType {
  if (toks.length === 0) return null;
  // Unary minus / plus on a number.
  if (toks.length === 2 && toks[0].kind === 'punct' && (toks[0].text === '-' || toks[0].text === '+') && toks[1].kind === 'number') return 'number';
  if (toks.length === 2 && toks[0].kind === 'punct' && toks[0].text === '!') return 'boolean';
  if (toks.length !== 1) {
    const first = toks[0];
    if (first.kind === 'punct' && (first.text === '[' || first.text === '{')) {
      const all = toks;
      const close = matchingClose(all, 0);
      if (close === all.length - 1) return first.text === '[' ? 'any[]' : 'object';
    }
    if (first.kind === 'templateHead') {
      const close = matchingClose(toks, 0);
      if (close === toks.length - 1) return 'string';
    }
    if (first.kind === 'punct' && first.text === '(' && matchingClose(toks, 0) === toks.length - 1) {
      return operandType(toks.slice(1, -1), known);
    }
    return null;
  }
  const t = toks[0];
  switch (t.kind) {
    case 'string':
    case 'template':
      return 'string';
    case 'number':
      return 'number';
    case 'ident':
      if (t.text === 'true' || t.text === 'false') return 'boolean';
      if (t.text === 'null') return 'null';
      if (t.text === 'undefined') return 'undefined';
      return known(t.text);
    default:
      return null;
  }
}

/**
 * Conservative static type of an expression: literals, identifiers whose type `known` reports,
 * `!x`, a single top-level comparison, and arithmetic over known operands. Null when unsure.
 */
export function inferValueType(code: string, known: (name: string) => InferredType): InferredType {
  const toks = significant(tokenize(code));
  if (toks.length === 0) return null;
  // Split at top-level binary operators.
  const operands: Token[][] = [[]];
  const operators: string[] = [];
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === 'templateHead') depth++;
    else if (t.kind === 'templateTail') depth--;
    else if (t.kind === 'punct' && (t.text === '(' || t.text === '[' || t.text === '{')) depth++;
    else if (t.kind === 'punct' && (t.text === ')' || t.text === ']' || t.text === '}')) depth--;
    const prevIsOperand = operands[operands.length - 1].length > 0;
    const isOp = (t.kind === 'punct' || (t.kind === 'ident' && (t.text === 'instanceof' || t.text === 'in'))) &&
      depth === 0 && prevIsOperand && (ARITHMETIC.has(t.text) || COMPARISON.has(t.text) || ['&&', '||', '??', '?', ':', ',', '=', '=>'].includes(t.text) || t.text.endsWith('='));
    if (isOp) {
      operators.push(t.text);
      operands.push([]);
    } else {
      operands[operands.length - 1].push(t);
    }
  }
  if (operators.length === 0) return operandType(operands[0], known);
  if (operators.some((op) => !ARITHMETIC.has(op) && !COMPARISON.has(op))) return null;
  const comparisons = operators.filter((op) => COMPARISON.has(op));
  if (comparisons.length === 1 && operators.length === 1) return 'boolean';
  if (comparisons.length > 0) return null;
  const types = operands.map((o) => operandType(o, known));
  if (types.some((t) => t === null)) return null;
  if (operators.every((op) => op === '+') && types.some((t) => t === 'string')) return 'string';
  if (types.every((t) => t === 'number')) return 'number';
  return null;
}

/**
 * Whether a value of type `source` can be passed to a setter of `useState<target>` without a type
 * error. Unknown sources are assumed to fit (most are `any`: responses, data, computed values).
 */
export function fitsStateType(source: InferredType, target: string): boolean {
  if (source === null || target === 'any') return true;
  if (source === target) return true;
  const parts = target.split('|').map((p) => p.trim());
  return parts.includes(source);
}
