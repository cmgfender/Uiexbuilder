/**
 * "Safe" expressions: what the designer still evaluates for a project whose code is not trusted
 * (see model/trust.ts). A safe expression cannot run code or reach anything outside the
 * extension's own data:
 *  - no calls (`f()`, `a.b()`, `a?.()`), tagged templates, `new`, functions / arrow functions or
 *    classes, so no helper, global function or getter-defining literal can execute;
 *  - no assignment, `++` / `--` or `delete`;
 *  - every free identifier is a scope name (state, data, context, computed values, repeat items,
 *    handler params) or a harmless global constant — never `window`, `document`, `localStorage`,
 *    `fetch`, ... so values from outside the document cannot be read (and leaked through, say, an
 *    image URL).
 * Member access, literals, arithmetic, comparison, logical and conditional operators, template
 * literals, spread and array / object literals are allowed: `{{ contact.firstname }}`,
 * `count > 0`, `deals.length`, `` `${a} ${b}` `` keep working while the code is paused.
 */
import { isPropertyName, nextSignificant, prevSignificant, tokenize, type Token } from '../model/jsTokens';

/** Globals a safe expression may name (read-only constants and namespaces; calls are blocked anyway). */
const SAFE_GLOBALS = new Set(['undefined', 'NaN', 'Infinity', 'Math', 'Number', 'String', 'Boolean', 'Array', 'Object', 'JSON', 'Date']);
/** Keywords allowed as operators / literals. */
const OPERATOR_KEYWORDS = new Set(['typeof', 'void', 'in', 'instanceof', 'true', 'false', 'null', 'this']);
const BLOCKED_PUNCT = new Set([
  '=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^=', '&&=', '||=', '??=', '++', '--', '=>', ';',
]);
const RESERVED = new Set([
  'function', 'class', 'new', 'import', 'export', 'await', 'yield', 'async', 'delete', 'super', 'debugger', 'with', 'var', 'let',
  'const', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'throw', 'try', 'catch', 'finally',
  'break', 'continue', 'arguments', 'eval', 'get', 'set', 'static', 'enum',
]);

function isCallee(prev: Token | undefined): boolean {
  if (!prev) return false;
  if (prev.kind === 'ident') return !OPERATOR_KEYWORDS.has(prev.text);
  if (prev.kind === 'punct') return prev.text === ')' || prev.text === ']' || prev.text === '?.';
  return prev.kind === 'string' || prev.kind === 'template' || prev.kind === 'templateTail' || prev.kind === 'number' || prev.kind === 'regex';
}

const cache = new Map<string, boolean>();

/** Whether `code` is a safe expression for a scope with these names (see module comment). */
export function isSafeExpression(code: string, scopeNames: Iterable<string>): boolean {
  const names = scopeNames instanceof Set ? (scopeNames as Set<string>) : new Set(scopeNames);
  const key = `${[...names].sort().join(',')}\u0000${code}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const result = check(code, names);
  if (cache.size > 2000) cache.clear();
  cache.set(key, result);
  return result;
}

function check(code: string, names: Set<string>): boolean {
  const tokens = tokenize(code);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === 'whitespace' || t.kind === 'comment' || t.kind === 'number' || t.kind === 'string' || t.kind === 'regex') continue;
    const p = prevSignificant(tokens, i - 1);
    const prev = p === -1 ? undefined : tokens[p];
    if (t.kind === 'template' || t.kind === 'templateHead') {
      // Tagged template: tag`...` calls the tag.
      if (isCallee(prev)) return false;
      continue;
    }
    if (t.kind === 'templateMiddle' || t.kind === 'templateTail') continue;
    if (t.kind === 'punct') {
      if (BLOCKED_PUNCT.has(t.text)) return false;
      if (t.text === '(' && isCallee(prev)) {
        // `toText(x)` (the interpolation helper, see expr.ts) only formats a value: allowed.
        const callee = p === -1 ? -1 : p;
        const before = callee > 0 ? prevSignificant(tokens, callee - 1) : -1;
        const member = before !== -1 && (tokens[before].text === '.' || tokens[before].text === '?.');
        if (prev?.kind === 'ident' && prev.text === 'toText' && !member && names.has('toText')) continue;
        return false;
      }
      continue;
    }
    // Identifiers
    if (isPropertyName(tokens, i)) continue;
    if (OPERATOR_KEYWORDS.has(t.text)) continue;
    if (RESERVED.has(t.text)) return false;
    // Object literal key (`{ a: 1 }`, `{ x, b: 2 }`): not a reference.
    const n = nextSignificant(tokens, i + 1);
    if (n !== -1 && tokens[n].text === ':' && prev && (prev.text === '{' || prev.text === ',')) continue;
    if (names.has(t.text) || SAFE_GLOBALS.has(t.text)) continue;
    return false;
  }
  return true;
}
