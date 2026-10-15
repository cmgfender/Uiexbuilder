/**
 * A small, forgiving TypeScript-aware tokenizer plus the source transforms used for helper code
 * (Extension.helpers). It is deliberately not a full parser — just enough structure (bracket
 * matching, parameter lists, type positions) for these jobs:
 *
 *  - stripTypeScript(code)        TypeScript -> JavaScript for the designer preview: removes
 *                                 parameter / return / variable / class property annotations,
 *                                 optional markers (`a?: T`), `as` / `satisfies` casts, non-null
 *                                 assertions (`x!.y`), generic parameters and call type arguments,
 *                                 `type` / `interface` declarations, access modifiers and (optionally)
 *                                 `export` keywords. Removed text becomes spaces (line breaks are kept,
 *                                 so error positions still line up).
 *  - annotateUntypedParams(code)  adds `: any` to function parameters without a type annotation, so
 *                                 plain JavaScript helpers type-check under `strict` in the exported
 *                                 project (noImplicitAny).
 *  - topLevelDeclarations(code)   names declared at the top level (function / class / const / let / var).
 *
 * Every function is pure and never throws: on input it cannot make sense of (unbalanced brackets)
 * the code is returned unchanged.
 */

export type TokenKind = 'ident' | 'punct' | 'string' | 'template' | 'regex' | 'number';

export interface Token {
  kind: TokenKind;
  value: string;
  start: number;
  end: number;
  /** A line break precedes the token (since the previous token). */
  nl: boolean;
}

// Longest first. `>>`, `>>=` and `>>>=` are intentionally absent so nested generics close one `>`
// at a time (`Array<Array<T>>`).
const PUNCTUATORS = [
  '...', '===', '!==', '**=', '<<=', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<',
];

const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await', 'instanceof',
]);

/** Reserved words (never identifiers of values, never the end of an expression). */
const KEYWORDS = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export',
  'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'return', 'switch',
  'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'await', 'of',
]);

/** Keywords that can end an expression (`this as any`, `null!`). */
const VALUE_KEYWORDS = new Set(['this', 'super', 'null', 'true', 'false', 'undefined']);

const IDENT_START = /[A-Za-z_$ -￿]/;
const IDENT_PART = /[A-Za-z0-9_$ -￿]/;

function regexAllowed(prev: Token | null): boolean {
  if (!prev) return true;
  if (prev.kind === 'punct') return prev.value !== ')' && prev.value !== ']';
  if (prev.kind === 'ident') return REGEX_KEYWORDS.has(prev.value);
  return false;
}

/**
 * Lexes `code` from `pos`. With `untilBrace`, stops after the `}` that closes a template literal
 * interpolation and returns the index after it. Tokens are appended to `out` when given.
 */
function lex(code: string, pos: number, untilBrace: boolean, out: Token[] | null): number {
  const n = code.length;
  let i = pos;
  let depth = 0;
  let prev: Token | null = null;
  let nl = false;
  while (i < n) {
    const ch = code[i];
    if (ch === '\n') {
      nl = true;
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r' || /\s/.test(ch)) {
      i++;
      continue;
    }
    const next = code[i + 1];
    if (ch === '/' && next === '/') {
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      const e = code.indexOf('*/', i + 2);
      const end = e === -1 ? n : e + 2;
      if (code.slice(i, end).includes('\n')) nl = true;
      i = end;
      continue;
    }
    const start = i;
    let kind: TokenKind;
    if (ch === '"' || ch === "'") {
      i++;
      while (i < n && code[i] !== ch && code[i] !== '\n') {
        if (code[i] === '\\') i++;
        i++;
      }
      i = Math.min(n, i + 1);
      kind = 'string';
    } else if (ch === '`') {
      i = readTemplate(code, i + 1);
      kind = 'template';
    } else if (ch === '/' && regexAllowed(prev)) {
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
      i = Math.min(n, i + 1);
      while (i < n && /[a-z]/i.test(code[i])) i++;
      kind = 'regex';
    } else if (IDENT_START.test(ch) || ch === '#') {
      i++;
      while (i < n && IDENT_PART.test(code[i])) i++;
      kind = 'ident';
    } else if (/[0-9]/.test(ch) || (ch === '.' && next !== undefined && /[0-9]/.test(next))) {
      i++;
      while (i < n && /[0-9A-Za-z_.]/.test(code[i])) {
        // Exponent sign: 1e-3
        if ((code[i] === 'e' || code[i] === 'E') && (code[i + 1] === '-' || code[i + 1] === '+') && !/^0[xob]/i.test(code.slice(start, i))) {
          i += 2;
          continue;
        }
        i++;
      }
      kind = 'number';
    } else {
      kind = 'punct';
      let matched = ch;
      for (const p of PUNCTUATORS) {
        if (code.startsWith(p, i)) {
          // `?.5` is a conditional followed by a number, not optional chaining.
          if (p === '?.' && /[0-9]/.test(code[i + 2] ?? '')) continue;
          matched = p;
          break;
        }
      }
      i += matched.length;
      if (untilBrace) {
        if (matched === '{') depth++;
        else if (matched === '}') {
          if (depth === 0) return i;
          depth--;
        }
      }
    }
    const tok: Token = { kind, value: code.slice(start, i), start, end: i, nl };
    nl = false;
    out?.push(tok);
    prev = tok;
  }
  return i;
}

/** `i` is just after an opening backtick; returns the index after the closing backtick. */
function readTemplate(code: string, i: number): number {
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '`') return i + 1;
    if (ch === '$' && code[i + 1] === '{') {
      i = lex(code, i + 2, true, null);
      continue;
    }
    i++;
  }
  return n;
}

/** Tokenizes code (comments and whitespace are skipped; template literals are single tokens). */
export function tokenize(code: string): Token[] {
  const out: Token[] = [];
  lex(code, 0, false, out);
  return out;
}

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set([')', ']', '}']);

/** Index of the matching bracket for every bracket token, or null when brackets do not balance. */
function matchBrackets(tokens: Token[]): Int32Array | null {
  const match = new Int32Array(tokens.length).fill(-1);
  const stack: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'punct') continue;
    if (OPENERS[t.value]) stack.push(i);
    else if (CLOSERS.has(t.value)) {
      const open = stack.pop();
      if (open === undefined || OPENERS[tokens[open].value] !== t.value) return null;
      match[open] = i;
      match[i] = open;
    }
  }
  return stack.length ? null : match;
}

// ---------------------------------------------------------------------------
// Transformer
// ---------------------------------------------------------------------------

type BraceKind = 'object' | 'block' | 'class';

/** Tokens after which `{` starts an object literal (or a destructuring pattern / type literal). */
const OBJECT_BRACE_AFTER = new Set([
  '=', '(', ',', ':', '?', '[', '!', '&&', '||', '??', '...', '+', '-', '*', '/', '%', '<', '>', '<=', '>=', '==',
  '===', '!=', '!==', '+=', '-=', '*=', '/=', '%=', '&&=', '||=', '??=', '|', '&', 'return', 'yield', 'await',
  'typeof', 'in', 'of', 'case', 'throw', 'new', 'void', 'delete',
]);

/** Tokens after which `<` starts generic parameters of an arrow function. */
const EXPR_START = new Set(['=', '(', ',', ':', '?', '=>', '[', '{', 'return', '&&', '||', '??', 'async', 'export', 'default']);

/** Punctuation that may appear inside type arguments `<...>` (outside nested brackets). */
const TYPE_PUNCT = new Set(['<', '>', ',', '.', '|', '&', '?', ':', '=', '=>', '...', '-', '[', ']', '(', ')', '{', '}']);

/** Identifiers that cannot start a type. */
const NOT_TYPE_START = new Set([
  'return', 'function', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'throw',
  'try', 'catch', 'finally', 'var', 'let', 'class', 'export', 'import', 'in', 'instanceof', 'of', 'as', 'satisfies',
  'extends', 'implements', 'with', 'delete', 'yield', 'await',
]);

const PARAM_MODIFIERS = new Set(['public', 'private', 'protected', 'readonly', 'override']);
const MEMBER_MODIFIERS = new Set(['public', 'private', 'protected', 'readonly', 'abstract', 'override', 'declare']);
/** Words that may precede a method name in object literals / class bodies. */
const METHOD_PREFIX = new Set(['async', 'get', 'set', 'static', '*', ...MEMBER_MODIFIERS]);
/** Identifiers followed by `(` that are never method names. */
const NOT_METHOD = new Set([...KEYWORDS, 'function', 'catch', 'super']);

type Mode = 'strip' | 'annotate';

interface TransformOptions {
  /** Strip mode: remove `export` / `export default` in front of declarations. */
  stripExport?: boolean;
}

class Transformer {
  private readonly T: Token[];
  private readonly match: Int32Array;
  private readonly removed: Uint8Array;
  private readonly ranges: Array<[number, number]> = [];
  private readonly inserts: Array<[number, string]> = [];
  private readonly braceKinds = new Map<number, BraceKind>();
  private readonly paramsDone = new Set<number>();

  constructor(
    private readonly code: string,
    tokens: Token[],
    match: Int32Array,
    private readonly mode: Mode,
    private readonly opts: TransformOptions,
  ) {
    this.T = tokens;
    this.match = match;
    this.removed = new Uint8Array(tokens.length);
  }

  // ---- token helpers

  private val(i: number): string | undefined {
    return this.T[i]?.value;
  }

  private isPunct(i: number, v: string): boolean {
    const t = this.T[i];
    return !!t && t.kind === 'punct' && t.value === v;
  }

  private isIdent(i: number, v?: string): boolean {
    const t = this.T[i];
    return !!t && t.kind === 'ident' && (v === undefined || t.value === v);
  }

  /** Index of the previous token that has not been removed (-1 at the start). */
  private prevIdx(i: number): number {
    let j = i - 1;
    while (j >= 0 && this.removed[j]) j--;
    return j;
  }

  /** The token ends an expression (a cast / non-null assertion may follow). */
  private isExprEnd(j: number): boolean {
    const t = this.T[j];
    if (!t) return false;
    if (t.kind === 'ident') return !KEYWORDS.has(t.value) || VALUE_KEYWORDS.has(t.value);
    if (t.kind === 'punct') return t.value === ')' || t.value === ']' || t.value === '}';
    return true;
  }

  private atStatementStart(i: number): boolean {
    const p = this.prevIdx(i);
    if (p < 0) return true;
    const pv = this.T[p];
    if (pv.kind === 'punct' && (pv.value === ';' || pv.value === '}' || pv.value === '{')) return true;
    return this.T[i].nl && this.isExprEnd(p);
  }

  private remove(a: number, b: number): void {
    if (b <= a || this.mode !== 'strip') return;
    for (let k = a; k < b; k++) this.removed[k] = 1;
    this.ranges.push([this.T[a].start, this.T[b - 1].end]);
  }

  // ---- types

  /** Skips `<...>` type arguments starting at `i`; returns the index after `>` or -1. */
  private skipAngle(i: number): number {
    let depth = 0;
    for (let j = i; j < this.T.length && j < i + 500; j++) {
      const t = this.T[j];
      if (t.kind === 'punct') {
        if (t.value === '<') depth++;
        else if (t.value === '>') {
          depth--;
          if (depth === 0) return j + 1;
        } else if (OPENERS[t.value]) {
          const c = this.match[j];
          if (c < 0) return -1;
          j = c;
        } else if (CLOSERS.has(t.value) || !TYPE_PUNCT.has(t.value)) {
          // A closer here belongs to an enclosing bracket: this `<` is a comparison.
          return -1;
        }
      } else if (t.kind === 'regex') return -1;
    }
    return -1;
  }

  /** Parses a type starting at `i`; returns the index after it (`i` when there is no type). */
  private parseType(i: number): number {
    let j = i;
    if (this.isPunct(j, '|') || this.isPunct(j, '&')) j++;
    const first = this.parseTypeMember(j);
    if (first === j) return i;
    j = first;
    while (this.isPunct(j, '|') || this.isPunct(j, '&')) {
      const m = this.parseTypeMember(j + 1);
      if (m === j + 1) break;
      j = m;
    }
    // Conditional type: A extends B ? C : D
    if (this.isIdent(j, 'extends')) {
      const b = this.parseType(j + 1);
      if (b > j + 1 && this.isPunct(b, '?')) {
        const c = this.parseType(b + 1);
        if (c > b + 1 && this.isPunct(c, ':')) {
          const d = this.parseType(c + 1);
          if (d > c + 1) return d;
        }
      }
    }
    return j;
  }

  private parseTypeMember(i: number): number {
    let j = i;
    while (this.isIdent(j) && ['keyof', 'readonly', 'unique', 'infer', 'asserts'].includes(this.val(j)!) && this.T[j + 1] && !this.isPunct(j + 1, ',')) {
      j++;
    }
    const k = this.parseTypePrimary(j);
    if (k === j) return i;
    j = k;
    // Array / indexed access postfix (not across a line break: `x as T\n[1].forEach`).
    while (this.isPunct(j, '[') && !this.T[j].nl) {
      const c = this.match[j];
      if (c < 0) break;
      j = c + 1;
    }
    // Type predicate: `value is string`
    if (this.isIdent(j, 'is') && !this.T[j].nl) {
      const m = this.parseType(j + 1);
      if (m > j + 1) j = m;
    }
    return j;
  }

  private parseTypePrimary(i: number): number {
    const t = this.T[i];
    if (!t) return i;
    if (t.kind === 'ident') {
      if (NOT_TYPE_START.has(t.value)) return i;
      if (t.value === 'new') {
        if (this.isPunct(i + 1, '(')) {
          const c = this.match[i + 1];
          if (c >= 0 && this.isPunct(c + 1, '=>')) {
            const r = this.parseType(c + 2);
            return r > c + 2 ? r : i;
          }
        }
        return i;
      }
      if (t.value === 'typeof') {
        const r = this.parseTypePrimary(i + 1);
        return r > i + 1 ? r : i;
      }
      let j = i + 1;
      while (this.isPunct(j, '.') && this.isIdent(j + 1)) j += 2;
      if (this.isPunct(j, '<') && !this.T[j].nl) {
        const k = this.skipAngle(j);
        if (k > 0) j = k;
      }
      return j;
    }
    if (t.kind === 'punct') {
      if (t.value === '(') {
        const c = this.match[i];
        if (c < 0) return i;
        if (this.isPunct(c + 1, '=>')) {
          const r = this.parseType(c + 2);
          return r > c + 2 ? r : c + 1;
        }
        return c + 1;
      }
      if (t.value === '<') {
        const k = this.skipAngle(i);
        if (k > 0 && this.isPunct(k, '(')) {
          const c = this.match[k];
          if (c >= 0 && this.isPunct(c + 1, '=>')) {
            const r = this.parseType(c + 2);
            return r > c + 2 ? r : i;
          }
        }
        return i;
      }
      if (t.value === '{' || t.value === '[') {
        const c = this.match[i];
        return c < 0 ? i : c + 1;
      }
      if (t.value === '-' && this.T[i + 1]?.kind === 'number') return i + 2;
      return i;
    }
    // string / number / template literal types
    if (t.kind === 'regex') return i;
    return i + 1;
  }

  // ---- parameters

  /** The `(` at `i` opens an arrow function's parameter list. */
  private isArrowParen(i: number): { returnType: [number, number] | null } | null {
    const c = this.match[i];
    if (c < 0) return null;
    if (this.isPunct(c + 1, '=>')) return { returnType: null };
    if (this.isPunct(c + 1, ':')) {
      const k = this.parseType(c + 2);
      if (k > c + 2 && this.isPunct(k, '=>')) return { returnType: [c + 1, k] };
    }
    return null;
  }

  /** Handles annotations inside the parameter list opened at `open`. */
  private processParams(open: number, opts: { catchClause?: boolean } = {}): void {
    if (this.paramsDone.has(open)) return;
    this.paramsDone.add(open);
    const close = this.match[open];
    if (close < 0) return;
    let j = open + 1;
    let state: 'start' | 'after' | 'default' = 'start';
    let rest = false;
    while (j < close) {
      if (this.removed[j]) {
        j++;
        continue;
      }
      const t = this.T[j];
      if (state === 'start') {
        if (t.kind === 'ident' && PARAM_MODIFIERS.has(t.value) && (this.isIdent(j + 1) || this.isPunct(j + 1, '{') || this.isPunct(j + 1, '['))) {
          this.remove(j, j + 1);
          j++;
          continue;
        }
        if (t.kind === 'punct' && t.value === '...') {
          rest = true;
          j++;
          continue;
        }
        let patEnd: number;
        if (t.kind === 'ident') patEnd = j + 1;
        else if (t.kind === 'punct' && (t.value === '{' || t.value === '[') && this.match[j] > 0) patEnd = this.match[j] + 1;
        else {
          state = 'after';
          j++;
          continue;
        }
        const isThis = t.kind === 'ident' && t.value === 'this';
        j = patEnd;
        let insertAt = this.T[j - 1].end;
        if (this.isPunct(j, '?')) {
          this.remove(j, j + 1);
          insertAt = this.T[j].end;
          j++;
        }
        if (this.isPunct(j, ':')) {
          const k = this.parseType(j + 1);
          if (k > j + 1) {
            this.remove(j, k);
            j = k;
          } else j++;
        } else if (this.mode === 'annotate' && !opts.catchClause && !isThis) {
          this.inserts.push([insertAt, rest ? ': any[]' : ': any']);
        }
        state = 'after';
        continue;
      }
      if (state === 'after') {
        if (t.kind === 'punct' && t.value === ',') {
          state = 'start';
          rest = false;
        } else if (t.kind === 'punct' && t.value === '=') state = 'default';
        j++;
        continue;
      }
      // default value expression
      if (t.kind === 'punct' && t.value === ',') {
        state = 'start';
        rest = false;
        j++;
      } else if (t.kind === 'punct' && OPENERS[t.value] && this.match[j] > 0) {
        j = this.match[j] + 1;
      } else j++;
    }
  }

  /** Removes a return type annotation `: T` that starts at `colon` and must be followed by `{`. */
  private removeReturnTypeBeforeBody(colon: number): void {
    if (!this.isPunct(colon, ':')) return;
    const k = this.parseType(colon + 1);
    if (k > colon + 1 && this.isPunct(k, '{')) this.remove(colon, k);
  }

  // ---- main pass

  run(): string {
    const T = this.T;
    const stack: number[] = [];
    for (let i = 0; i < T.length; i++) {
      if (this.removed[i]) continue;
      const t = T[i];
      const p = this.prevIdx(i);
      const prev = p >= 0 ? T[p] : null;

      if (t.kind === 'punct') {
        if (t.value === '{') {
          if (!this.braceKinds.has(i)) {
            const kind: BraceKind = prev && OBJECT_BRACE_AFTER.has(prev.value) && prev.kind !== 'string' ? 'object' : 'block';
            this.braceKinds.set(i, kind);
          }
          stack.push(i);
          continue;
        }
        if (t.value === '[') {
          stack.push(i);
          continue;
        }
        if (t.value === '(') {
          this.handleParen(i, p, stack);
          stack.push(i);
          continue;
        }
        if (t.value === ')' || t.value === ']' || t.value === '}') {
          stack.pop();
          continue;
        }
        if (this.mode === 'strip' && t.value === '<') {
          this.handleAngle(i, p);
          continue;
        }
        if (this.mode === 'strip' && t.value === '!' && prev && this.isExprEnd(p) && prev.kind !== 'string' && prev.end === t.start) {
          const next = T[i + 1];
          if (!next || next.nl || ['.', '?.', ')', ']', ',', ';', '[', '}', ':'].includes(next.value)) this.remove(i, i + 1);
        }
        continue;
      }

      if (t.kind !== 'ident') continue;
      const v = t.value;
      if (prev && prev.kind === 'punct' && (prev.value === '.' || prev.value === '?.')) continue;

      if (this.mode === 'annotate') {
        // Bare arrow parameter: `x => ...` -> `(x: any) => ...`
        if (this.isPunct(i + 1, '=>') && !T[i + 1].nl && !KEYWORDS.has(v) && !VALUE_KEYWORDS.has(v)) {
          this.inserts.push([t.start, '('], [t.end, ': any)']);
        }
      }

      if (v === 'function') {
        let j = i + 1;
        if (this.isPunct(j, '*')) j++;
        if (this.isIdent(j)) j++;
        if (this.isPunct(j, '<')) {
          const k = this.skipAngle(j);
          if (k > 0) {
            this.remove(j, k);
            j = k;
          }
        }
        if (this.isPunct(j, '(')) {
          this.processParams(j);
          if (this.mode === 'strip') this.removeReturnTypeBeforeBody(this.match[j] + 1);
        }
        continue;
      }

      if (v === 'class') {
        this.handleClass(i);
        continue;
      }

      if (this.mode !== 'strip') continue;

      const statementStart = this.atStatementStart(i);
      if (v === 'export' && this.opts.stripExport && statementStart) {
        let j = i + 1;
        if (this.isIdent(j, 'default') && (this.isIdent(j + 1, 'function') || this.isIdent(j + 1, 'class') || this.isIdent(j + 1, 'async'))) j++;
        if (this.isIdent(j) && ['function', 'const', 'let', 'var', 'class', 'async', 'type', 'interface', 'enum', 'default'].includes(this.val(j)!)) {
          if (this.val(j) !== 'default') this.remove(i, j);
        }
        continue;
      }
      if ((v === 'type' || v === 'interface') && statementStart && this.isIdent(i + 1) && !this.isPunct(i + 1, '=')) {
        if (this.handleTypeDeclaration(i)) continue;
      }
      if (v === 'declare' && statementStart && this.isIdent(i + 1)) {
        // `declare const x: T;` -> drop the whole statement
        let j = i + 1;
        while (j < T.length && !this.isPunct(j, ';') && !(j > i + 1 && T[j].nl)) {
          if (this.isPunct(j, '{') || this.isPunct(j, '(') || this.isPunct(j, '[')) j = this.match[j];
          if (j < 0) break;
          j++;
        }
        if (j > 0) {
          this.remove(i, Math.min(T.length, this.isPunct(j, ';') ? j + 1 : j));
          continue;
        }
      }
      if (v === 'const' || v === 'let' || v === 'var') {
        this.handleVariable(i);
        continue;
      }
      if ((v === 'as' || v === 'satisfies') && prev && this.isExprEnd(p) && T[i + 1] && !this.isPunct(i + 1, ',') && !this.isPunct(i + 1, ')')) {
        const k = this.parseType(i + 1);
        if (k > i + 1) this.remove(i, k);
        continue;
      }
      // Class members: modifiers and property annotations.
      const enclosing = stack.length ? stack[stack.length - 1] : -1;
      if (enclosing >= 0 && this.braceKinds.get(enclosing) === 'class' && (statementStart || (prev && prev.kind === 'punct' && prev.value === '{'))) {
        if (MEMBER_MODIFIERS.has(v) && (this.isIdent(i + 1) || this.isPunct(i + 1, '['))) {
          this.remove(i, i + 1);
          continue;
        }
        let j = i + 1;
        if (this.isPunct(j, '?') || this.isPunct(j, '!')) j++;
        if (this.isPunct(j, ':')) {
          const k = this.parseType(j + 1);
          if (k > j + 1) this.remove(i + 1, k);
        }
      }
    }
    return this.output();
  }

  private handleParen(i: number, p: number, stack: number[]): void {
    if (this.paramsDone.has(i)) return;
    const T = this.T;
    const prev = p >= 0 ? T[p] : null;
    if (prev && prev.kind === 'ident' && prev.value === 'catch') {
      this.processParams(i, { catchClause: true });
      return;
    }
    const arrow = this.isArrowParen(i);
    if (arrow) {
      this.processParams(i);
      if (arrow.returnType) this.remove(arrow.returnType[0], arrow.returnType[1]);
      return;
    }
    // Method shorthand in an object literal or class body: `name(params) {` / `name(params): T {`
    if (!prev || prev.kind !== 'ident' || NOT_METHOD.has(prev.value)) return;
    const enclosing = stack.length ? stack[stack.length - 1] : -1;
    const kind = enclosing >= 0 ? this.braceKinds.get(enclosing) : undefined;
    if (kind !== 'object' && kind !== 'class') return;
    let b = this.prevIdx(p);
    while (b >= 0 && METHOD_PREFIX.has(T[b].value) && b > enclosing) b = this.prevIdx(b);
    const before = b >= 0 ? T[b] : null;
    if (!before || !(before.value === '{' || before.value === ',' || before.value === ';' || before.value === '}' || T[p].nl)) return;
    const c = this.match[i];
    if (c < 0 || !(this.isPunct(c + 1, '{') || this.isPunct(c + 1, ':'))) return;
    this.processParams(i);
    if (this.mode === 'strip') this.removeReturnTypeBeforeBody(c + 1);
  }

  private handleAngle(i: number, p: number): void {
    const T = this.T;
    const prev = p >= 0 ? T[p] : null;
    const k = this.skipAngle(i);
    if (k < 0 || !this.isPunct(k, '(')) return;
    // Generic arrow function: `<T,>(x: T) => x`
    if (!prev || EXPR_START.has(prev.value)) {
      if (this.isArrowParen(k)) this.remove(i, k);
      return;
    }
    // Call / method type arguments written without a space: `fn<T>(x)`, `obj.get<T>(x)`.
    if (prev.kind === 'ident' && !KEYWORDS.has(prev.value) && prev.end === T[i].start && !T[k].nl) this.remove(i, k);
  }

  private handleClass(i: number): void {
    const T = this.T;
    let j = i + 1;
    if (this.isIdent(j) && !this.isIdent(j, 'extends') && !this.isIdent(j, 'implements')) j++;
    if (this.isPunct(j, '<')) {
      const k = this.skipAngle(j);
      if (k > 0) {
        this.remove(j, k);
        j = k;
      }
    }
    // Heritage clauses up to the class body.
    let guard = 0;
    while (j < T.length && !this.isPunct(j, '{') && guard++ < 200) {
      if (this.isIdent(j, 'implements')) {
        let k = j + 1;
        while (k < T.length && !this.isPunct(k, '{')) {
          if (this.isPunct(k, '<')) {
            const e = this.skipAngle(k);
            if (e < 0) return;
            k = e;
          } else k++;
        }
        this.remove(j, k);
        j = k;
        break;
      }
      if (this.isPunct(j, '<') && j > 0 && T[j - 1].kind === 'ident') {
        const k = this.skipAngle(j);
        if (k > 0) {
          this.remove(j, k);
          j = k;
          continue;
        }
      }
      if (this.isPunct(j, '(') || this.isPunct(j, '[')) {
        j = this.match[j] + 1;
        continue;
      }
      j++;
    }
    if (this.isPunct(j, '{')) this.braceKinds.set(j, 'class');
  }

  private handleTypeDeclaration(i: number): boolean {
    const T = this.T;
    const kw = T[i].value;
    let j = i + 2;
    if (this.isPunct(j, '<')) {
      const k = this.skipAngle(j);
      if (k < 0) return false;
      j = k;
    }
    if (kw === 'type') {
      if (!this.isPunct(j, '=')) return false;
      const k = this.parseType(j + 1);
      if (k === j + 1) return false;
      this.remove(i, this.isPunct(k, ';') ? k + 1 : k);
      return true;
    }
    // interface Name [extends A, B<C>] { ... }
    let guard = 0;
    while (j < T.length && !this.isPunct(j, '{') && guard++ < 200) {
      if (this.isPunct(j, '<')) {
        const k = this.skipAngle(j);
        if (k < 0) return false;
        j = k;
      } else if (T[j].kind === 'ident' || this.isPunct(j, ',') || this.isPunct(j, '.')) j++;
      else return false;
    }
    if (!this.isPunct(j, '{')) return false;
    const close = this.match[j];
    if (close < 0) return false;
    this.remove(i, close + 1);
    return true;
  }

  private handleVariable(i: number): void {
    const j = i + 1;
    let afterName = -1;
    if (this.isIdent(j)) afterName = j + 1;
    else if ((this.isPunct(j, '{') || this.isPunct(j, '[')) && this.match[j] > 0) afterName = this.match[j] + 1;
    if (afterName < 0) return;
    let colon = afterName;
    if (this.isPunct(colon, '!') && this.isPunct(colon + 1, ':')) colon++;
    if (!this.isPunct(colon, ':')) return;
    const k = this.parseType(colon + 1);
    if (k > colon + 1) this.remove(afterName, k);
  }

  private output(): string {
    const code = this.code;
    if (this.mode === 'annotate') {
      if (!this.inserts.length) return code;
      const sorted = this.inserts.map((ins, idx) => ({ pos: ins[0], text: ins[1], idx })).sort((a, b) => a.pos - b.pos || a.idx - b.idx);
      let out = '';
      let last = 0;
      for (const ins of sorted) {
        out += code.slice(last, ins.pos) + ins.text;
        last = ins.pos;
      }
      return out + code.slice(last);
    }
    if (!this.ranges.length) return code;
    const chars = code.split('');
    for (const [a, b] of this.ranges) {
      for (let k = a; k < b; k++) if (chars[k] !== '\n' && chars[k] !== '\r') chars[k] = ' ';
    }
    return chars.join('');
  }
}

function transform(code: string, mode: Mode, opts: TransformOptions = {}): string {
  if (typeof code !== 'string' || !code.trim()) return typeof code === 'string' ? code : '';
  try {
    const tokens = tokenize(code);
    const match = matchBrackets(tokens);
    if (!match) return code;
    return new Transformer(code, tokens, match, mode, opts).run();
  } catch {
    return code;
  }
}

/**
 * Removes TypeScript-only syntax so the code can run as JavaScript (see the module comment).
 * `stripExport` also removes `export` / `export default` in front of declarations (needed to run
 * module-level helper code inside a function body).
 */
export function stripTypeScript(code: string, opts: { stripExport?: boolean } = {}): string {
  return transform(code, 'strip', opts);
}

/** Adds `: any` to untyped function parameters (`function f(a, { b })` -> `function f(a: any, { b }: any)`). */
export function annotateUntypedParams(code: string): string {
  return transform(code, 'annotate');
}

/**
 * Names declared at the top level of `code`: `function f`, `async function f`, `function* f`,
 * `class C`, `const|let|var x` (including later declarators `const a = 1, b = 2`). `export` is
 * allowed in front. TypeScript `type` / `interface` names are not values and are not listed.
 */
export function topLevelDeclarations(code: string | undefined): string[] {
  if (!code || typeof code !== 'string') return [];
  let tokens: Token[];
  try {
    tokens = tokenize(code);
  } catch {
    return [];
  }
  const names: string[] = [];
  const add = (name: string | undefined) => {
    if (name && !KEYWORDS.has(name) && !names.includes(name)) names.push(name);
  };
  let depth = 0;
  /** Inside a top-level `const` / `let` / `var` statement (later declarators count too). */
  let inDeclaration = false;
  const statementStart = (i: number): boolean => {
    if (i === 0) return true;
    const prev = tokens[i - 1];
    if (prev.kind === 'punct' && (prev.value === ';' || prev.value === '}')) return true;
    if (prev.kind === 'ident' && (prev.value === 'export' || prev.value === 'default' || prev.value === 'async')) return true;
    return tokens[i].nl;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind === 'punct') {
      if (t.value === '{' || t.value === '(' || t.value === '[') depth++;
      else if (t.value === '}' || t.value === ')' || t.value === ']') depth = Math.max(0, depth - 1);
      else if (depth === 0 && t.value === ';') inDeclaration = false;
      else if (depth === 0 && inDeclaration && t.value === ',' && tokens[i + 1]?.kind === 'ident') {
        const after = tokens[i + 2];
        if (!after || after.value === '=' || after.value === ',' || after.value === ';' || after.value === ':' || after.nl) add(tokens[i + 1].value);
      }
      continue;
    }
    if (depth !== 0 || t.kind !== 'ident') continue;
    if (!statementStart(i)) continue;
    if (t.nl || i === 0) inDeclaration = false;
    if (t.value === 'function') {
      let j = i + 1;
      if (tokens[j]?.value === '*') j++;
      if (tokens[j]?.kind === 'ident') add(tokens[j].value);
    } else if (t.value === 'class') {
      if (tokens[i + 1]?.kind === 'ident') add(tokens[i + 1].value);
    } else if (t.value === 'const' || t.value === 'let' || t.value === 'var') {
      inDeclaration = true;
      if (tokens[i + 1]?.kind === 'ident') add(tokens[i + 1].value);
    }
  }
  return names;
}
