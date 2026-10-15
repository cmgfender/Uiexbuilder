/**
 * A small, lossless JavaScript tokenizer shared by the runtime (loop guards, the "safe expression"
 * check for untrusted documents) and codegen (source rewrites). Joining the `text` of every token
 * reproduces the input exactly, so callers can rewrite single tokens and re-join.
 *
 * It understands comments, string / template / regex literals (template substitutions are
 * tokenized like normal code), numbers, identifiers and multi-character punctuators. It is a
 * tokenizer, not a parser: regex-vs-division is decided by the previous significant token, as
 * every hand-written JS lexer does.
 */

export type TokenKind =
  | 'whitespace'
  | 'comment'
  | 'ident'
  | 'number'
  | 'string'
  /** A template literal without substitutions: `text`. */
  | 'template'
  /** `text${ — the start of a template literal with substitutions. */
  | 'templateHead'
  /** }text${ — between two substitutions. */
  | 'templateMiddle'
  /** }text` — the end of a template literal. */
  | 'templateTail'
  | 'regex'
  | 'punct';

export interface Token {
  kind: TokenKind;
  text: string;
  start: number;
}

const PUNCTUATORS = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=',
  '&=', '|=', '^=', '**', '<<', '>>',
];

/** Keywords after which a `/` starts a regular expression. */
const REGEX_AFTER_KEYWORDS = new Set([
  'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof',
]);

function isSignificant(t: Token): boolean {
  return t.kind !== 'whitespace' && t.kind !== 'comment';
}

/** Whether a `/` after `prev` (last significant token) starts a regex literal. */
function regexAllowed(prev: Token | undefined): boolean {
  if (!prev) return true;
  switch (prev.kind) {
    case 'number':
    case 'string':
    case 'template':
    case 'templateTail':
    case 'regex':
      return false;
    case 'ident':
      return REGEX_AFTER_KEYWORDS.has(prev.text);
    case 'punct':
      return !(prev.text === ')' || prev.text === ']' || prev.text === '}' || prev.text === '++' || prev.text === '--');
    default:
      return true;
  }
}

/** Tokenizes JavaScript source. Never throws: unterminated literals run to the end of input. */
export function tokenize(code: string): Token[] {
  const tokens: Token[] = [];
  const n = code.length;
  let i = 0;
  let prev: Token | undefined;
  /** Brace depth per open template substitution (to know which `}` resumes the template). */
  const templateDepths: number[] = [];
  let braceDepth = 0;

  const push = (kind: TokenKind, start: number, end: number) => {
    const t: Token = { kind, text: code.slice(start, end), start };
    tokens.push(t);
    if (isSignificant(t)) prev = t;
  };

  /** Reads template text from `i` (just after ` or }) up to and including ` or ${. */
  const readTemplate = (start: number, isHead: boolean) => {
    while (i < n) {
      const ch = code[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        i++;
        push(isHead ? 'template' : 'templateTail', start, Math.min(i, n));
        return;
      }
      if (ch === '$' && code[i + 1] === '{') {
        i += 2;
        push(isHead ? 'templateHead' : 'templateMiddle', start, i);
        templateDepths.push(braceDepth);
        return;
      }
      i++;
    }
    push(isHead ? 'template' : 'templateTail', start, n);
  };

  while (i < n) {
    const start = i;
    const ch = code[i];
    const next = code[i + 1];
    if (/\s/.test(ch)) {
      while (i < n && /\s/.test(code[i])) i++;
      push('whitespace', start, i);
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < n && code[i] !== '\n' && code[i] !== '\r' && code[i] !== ' ' && code[i] !== ' ') i++;
      push('comment', start, i);
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      push('comment', start, i);
      continue;
    }
    if (ch === '"' || ch === "'") {
      i++;
      while (i < n && code[i] !== ch) {
        if (code[i] === '\\') i++;
        else if (code[i] === '\n') break;
        i++;
      }
      i = Math.min(i + 1, n);
      push('string', start, i);
      continue;
    }
    if (ch === '`') {
      i++;
      readTemplate(start, true);
      continue;
    }
    if (ch === '}' && templateDepths.length > 0 && templateDepths[templateDepths.length - 1] === braceDepth) {
      templateDepths.pop();
      i++;
      readTemplate(start, false);
      continue;
    }
    if (ch === '/' && regexAllowed(prev)) {
      i++;
      let inClass = false;
      while (i < n && code[i] !== '\n') {
        const c = code[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        i++;
      }
      i = Math.min(i + 1, n);
      while (i < n && /[A-Za-z]/.test(code[i])) i++;
      push('regex', start, i);
      continue;
    }
    if (/[A-Za-z_$À-￿]/.test(ch) || (ch === '\\' && next === 'u')) {
      while (i < n && (/[A-Za-z0-9_$À-￿]/.test(code[i]) || (code[i] === '\\' && code[i + 1] === 'u'))) i += code[i] === '\\' ? 2 : 1;
      push('ident', start, i);
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && next !== undefined && /[0-9]/.test(next))) {
      while (i < n && /[0-9A-Za-z_.]/.test(code[i])) {
        // Exponent sign: 1e-5
        if ((code[i] === 'e' || code[i] === 'E') && (code[i + 1] === '-' || code[i + 1] === '+') && !/^0[xX]/.test(code.slice(start, i))) i += 2;
        else i++;
      }
      push('number', start, i);
      continue;
    }
    let punct = ch;
    for (const p of PUNCTUATORS) {
      if (code.startsWith(p, i)) {
        // `?.5` is a conditional followed by a number, not optional chaining.
        if (p === '?.' && /[0-9]/.test(code[i + 2] ?? '')) continue;
        punct = p;
        break;
      }
    }
    i += punct.length;
    if (punct === '{') braceDepth++;
    else if (punct === '}') braceDepth = Math.max(0, braceDepth - 1);
    push('punct', start, i);
  }
  return tokens;
}

/** Index of the next significant token at or after `from`, or -1. */
export function nextSignificant(tokens: Token[], from: number): number {
  for (let i = from; i < tokens.length; i++) if (isSignificant(tokens[i])) return i;
  return -1;
}

/** Index of the previous significant token at or before `from`, or -1. */
export function prevSignificant(tokens: Token[], from: number): number {
  for (let i = from; i >= 0; i--) if (isSignificant(tokens[i])) return i;
  return -1;
}

/**
 * Index of the token that closes the bracket at `open` (`(`, `[`, `{` or a template head /
 * middle whose substitution closes with the next template middle / tail), or -1 when unbalanced.
 */
export function matchingClose(tokens: Token[], open: number): number {
  const closing: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === 'templateHead') depth++;
    else if (t.kind === 'templateTail') depth--;
    else if (t.kind === 'punct' && closing[t.text]) depth++;
    else if (t.kind === 'punct' && (t.text === ')' || t.text === ']' || t.text === '}')) depth--;
    if (depth === 0) return i;
  }
  return -1;
}

/** True when the identifier token at `index` is a property name (`a.b`, `a?.b`), not a reference. */
export function isPropertyName(tokens: Token[], index: number): boolean {
  const p = prevSignificant(tokens, index - 1);
  return p !== -1 && tokens[p].kind === 'punct' && (tokens[p].text === '.' || tokens[p].text === '?.');
}
