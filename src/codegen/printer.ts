/**
 * Low-level printing helpers shared by the code generators: JS string / literal printing with
 * line-width aware layout, JSX escaping, a tiny JavaScript scanner used to analyse user
 * expressions (referenced identifiers, top-level operators, comments) and a JSON formatter that
 * matches the style of HubSpot's project templates.
 *
 * Everything here is pure and deterministic.
 */

/** Target line width (prettier's default) used for layout decisions. */
export const PRINT_WIDTH = 80;

/** Indentation unit of all generated code. */
export const INDENT = '  ';

export function indentLines(lines: string[], levels = 1): string[] {
  const pad = INDENT.repeat(levels);
  return lines.map((line) => (line === '' ? '' : pad + line));
}

/** True when `lines` is a single line that fits in the remaining width at column `col`. */
export function fitsOnLine(lines: string[], col: number, extra = 0): boolean {
  return lines.length === 1 && col + lines[0].length + extra <= PRINT_WIDTH;
}

// ---------------------------------------------------------------------------
// Identifiers & strings
// ---------------------------------------------------------------------------

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const RESERVED_WORDS = new Set(
  (
    'break case catch class const continue debugger default delete do else enum export extends false ' +
    'finally for function if import in instanceof new null return super switch this throw true try ' +
    'typeof var void while with yield let static implements interface package private protected public ' +
    'await'
  ).split(' '),
);

/** A syntactically valid, non-reserved JavaScript identifier. */
export function isIdentifierName(name: string): boolean {
  return IDENTIFIER_RE.test(name) && !RESERVED_WORDS.has(name);
}

/** Object literal key: bare when it is an identifier (or a canonical number), quoted otherwise. */
export function propertyKey(key: string): string {
  if (IDENTIFIER_RE.test(key)) return key;
  if (/^(0|[1-9][0-9]*)$/.test(key)) return key;
  return quoteString(key);
}

/**
 * JS string literal. Prefers single quotes (the templates' prettier config) unless the string
 * contains more single than double quotes, like prettier does.
 */
export function quoteString(value: string): string {
  const singles = (value.match(/'/g) ?? []).length;
  const doubles = (value.match(/"/g) ?? []).length;
  const quote = singles > doubles ? '"' : "'";
  let out = '';
  for (const ch of value) {
    switch (ch) {
      case '\\':
        out += '\\\\';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      case '\u2028':
        out += '\\u2028';
        break;
      case '\u2029':
        out += '\\u2029';
        break;
      default:
        if (ch === quote) out += `\\${ch}`;
        else if (ch < ' ') out += `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0')}`;
        else out += ch;
    }
  }
  return quote + out + quote;
}

/** Escapes text for the literal part of a template literal (backticks, `${` and backslashes). */
export function escapeTemplateLiteralText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/** Number literal (JSON numbers are always finite). */
export function printNumber(value: number): string {
  if (!Number.isFinite(value)) return 'undefined';
  return Object.is(value, -0) ? '0' : String(value);
}

// ---------------------------------------------------------------------------
// JSX escaping
// ---------------------------------------------------------------------------

/**
 * Text that can be emitted verbatim as JSX text: no JSX-special characters, no line breaks and no
 * leading/trailing whitespace (which JSX would trim when children sit on their own line).
 */
export function isJsxTextSafe(text: string): boolean {
  if (text === '' || text.trim() !== text) return false;
  return !/[{}<>&\r\n\t\u2028\u2029]/.test(text);
}

/** Like isJsxTextSafe, but edge whitespace is allowed (used for text between expressions). */
export function isJsxTextFragmentSafe(text: string): boolean {
  return !/[{}<>&\r\n\t\u2028\u2029]/.test(text);
}

/** `"value"` when the string can be a JSX attribute string, otherwise null (use `{'value'}`). */
export function jsxAttributeString(value: string): string | null {
  if (/["\\&\r\n\t\u2028\u2029]/.test(value)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(value)) return null;
  return `"${value}"`;
}

const JSX_ATTR_NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$-]*(?::[A-Za-z_$][A-Za-z0-9_$-]*)?$/;

export function isJsxAttributeName(name: string): boolean {
  return JSX_ATTR_NAME_RE.test(name);
}

// ---------------------------------------------------------------------------
// JavaScript scanner (for user expressions)
// ---------------------------------------------------------------------------

export interface CodeScan {
  /** Identifiers referenced by the code (excluding property names after `.` / `?.`). */
  identifiers: Set<string>;
  hasLineComment: boolean;
  /** A string or template literal spans several lines (re-indenting would change it). */
  hasMultilineLiteral: boolean;
  /** Top-level (bracket depth 0) syntax found in the code. */
  topComma: boolean;
  topConditional: boolean;
  topAssignment: boolean;
  topArrow: boolean;
}

const PUNCT_BEFORE_REGEX = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'yield', 'await']);

/**
 * A small, forgiving JavaScript tokenizer. It understands comments, string / template / regex
 * literals and bracket nesting — enough to find referenced identifiers and top-level operators
 * of user expressions without a full parser (which would be far too large for the browser bundle).
 */
export function scanCode(code: string): CodeScan {
  const result: CodeScan = {
    identifiers: new Set(),
    hasLineComment: false,
    hasMultilineLiteral: false,
    topComma: false,
    topConditional: false,
    topAssignment: false,
    topArrow: false,
  };
  let depth = 0;
  /** Brace depth at which each open template literal `${` started (to resume the template). */
  const templateStack: number[] = [];
  /** Last significant token: an identifier/keyword, a punctuation char, or '' at start. */
  let prev = '';
  let prevKind: 'ident' | 'punct' | 'value' | 'none' = 'none';
  let i = 0;
  const n = code.length;

  const readTemplate = (): void => {
    // `i` points just after a backtick or a closing `}` of `${ ... }`.
    const start = i;
    while (i < n) {
      const ch = code[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '`') {
        i++;
        if (code.slice(start, i).includes('\n')) result.hasMultilineLiteral = true;
        prevKind = 'value';
        prev = '`';
        return;
      }
      if (ch === '$' && code[i + 1] === '{') {
        if (code.slice(start, i).includes('\n')) result.hasMultilineLiteral = true;
        i += 2;
        templateStack.push(depth);
        depth++;
        prevKind = 'punct';
        prev = '{';
        return;
      }
      i++;
    }
  };

  while (i < n) {
    const ch = code[i];
    const next = code[i + 1];
    // Whitespace
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    // Comments
    if (ch === '/' && next === '/') {
      result.hasLineComment = true;
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    // Strings
    if (ch === '"' || ch === "'") {
      i++;
      while (i < n && code[i] !== ch) {
        if (code[i] === '\\') i++;
        else if (code[i] === '\n') break;
        i++;
      }
      i++;
      prevKind = 'value';
      prev = ch;
      continue;
    }
    if (ch === '`') {
      i++;
      readTemplate();
      continue;
    }
    // Regex literal (heuristic: a slash where an operand is expected)
    if (
      ch === '/' &&
      (prevKind === 'none' ||
        (prevKind === 'punct' && PUNCT_BEFORE_REGEX.has(prev)) ||
        (prevKind === 'ident' && KEYWORDS_BEFORE_REGEX.has(prev)))
    ) {
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
      i++;
      while (i < n && /[a-z]/i.test(code[i])) i++;
      prevKind = 'value';
      prev = '/';
      continue;
    }
    // Identifiers / keywords
    if (/[A-Za-z_$]/.test(ch)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_$]/.test(code[i])) i++;
      const word = code.slice(start, i);
      // Property access (`a.b`, `a?.b`) is not a reference — but spread (`...b`) is.
      let j = start - 1;
      while (j >= 0 && /\s/.test(code[j])) j--;
      const isMember = j >= 0 && code[j] === '.' && !(j >= 2 && code[j - 1] === '.' && code[j - 2] === '.');
      if (!isMember) result.identifiers.add(word);
      prevKind = 'ident';
      prev = word;
      continue;
    }
    // Numbers
    if (/[0-9]/.test(ch) || (ch === '.' && next !== undefined && /[0-9]/.test(next))) {
      while (i < n && /[0-9A-Za-z_.]/.test(code[i])) i++;
      prevKind = 'value';
      prev = '0';
      continue;
    }
    // Brackets
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      i++;
      prevKind = 'punct';
      prev = ch;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth = Math.max(0, depth - 1);
      i++;
      if (ch === '}' && templateStack.length > 0 && templateStack[templateStack.length - 1] === depth) {
        templateStack.pop();
        readTemplate();
        continue;
      }
      prevKind = ch === '}' ? 'punct' : 'value';
      prev = ch;
      continue;
    }
    // Operators
    if (depth === 0) {
      if (ch === ',') result.topComma = true;
      else if (ch === '?') {
        if (next !== '.' && next !== '?') result.topConditional = true;
        else if (next === '.' && code[i + 2] !== undefined && /[0-9]/.test(code[i + 2])) result.topConditional = true;
      } else if (ch === '=' && next === '>') result.topArrow = true;
      else if (ch === '=') {
        const before = code[i - 1];
        if (next !== '=' && !['=', '!', '<', '>'].includes(before)) result.topAssignment = true;
        // Compound assignments (+=, -=, ||=, ??= ...) also count.
        if (next !== '=' && ['+', '-', '*', '/', '%', '&', '|', '^'].includes(before)) result.topAssignment = true;
        if (next !== '=' && before === '?' && code[i - 2] === '?') result.topAssignment = true;
      }
    }
    // Skip multi-char operators as a unit so `?.`, `??`, `=>` are handled once.
    if ((ch === '?' && (next === '.' || next === '?')) || (ch === '=' && next === '>')) {
      i += 2;
    } else if (ch === '.' && next === '.' && code[i + 2] === '.') {
      i += 3;
    } else {
      i++;
    }
    prevKind = 'punct';
    prev = ch;
  }
  return result;
}

/** Removes `//` line comments that are outside string / template / regex literals. */
export function stripLineComments(code: string): string {
  if (!code.includes('//')) return code;
  if (!scanCode(code).hasLineComment) return code;
  // Re-scan character by character, copying everything except line comments.
  let out = '';
  let i = 0;
  const n = code.length;
  let quote: string | null = null;
  let templateDepth: number[] = [];
  let depth = 0;
  while (i < n) {
    const ch = code[i];
    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += code[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (quote === '`' && ch === '$' && code[i + 1] === '{') {
        out += '{';
        i += 2;
        templateDepth = [...templateDepth, depth];
        depth++;
        quote = null;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '/' && code[i + 1] === '/') {
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += code.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    if (ch === '{' || ch === '(' || ch === '[') depth++;
    if (ch === '}' || ch === ')' || ch === ']') {
      depth = Math.max(0, depth - 1);
      if (ch === '}' && templateDepth.length && templateDepth[templateDepth.length - 1] === depth) {
        templateDepth = templateDepth.slice(0, -1);
        out += ch;
        i++;
        quote = '`';
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Normalises a user expression for embedding: line comments are removed (they would swallow the
 * code that follows on the same line), surrounding whitespace and trailing semicolons are dropped.
 */
export function normalizeExpression(code: string): string {
  let out = stripLineComments(code).trim();
  while (out.endsWith(';')) out = out.slice(0, -1).trimEnd();
  return out;
}

const SIMPLE_CHAIN_RE = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\??\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

/** A bare identifier or property chain (`a`, `a.b`, `a?.b.c`). */
export function isSimpleChain(code: string): boolean {
  return SIMPLE_CHAIN_RE.test(code);
}

/**
 * Parenthesises an expression when it is used as an operand where a top-level comma would be
 * misread (JSX attribute, call argument, array element, property value, template interpolation).
 */
export function asOperand(code: string): string {
  return scanCode(code).topComma ? `(${code})` : code;
}

/** Parenthesises an expression used as the test of a conditional (`test ? a : b`). */
export function asConditionalTest(code: string): string {
  const scan = scanCode(code);
  return scan.topComma || scan.topConditional || scan.topAssignment || scan.topArrow ? `(${code})` : code;
}

/** Logical negation of an expression, adding parentheses unless it is a simple chain. */
export function negate(code: string): string {
  return isSimpleChain(code) ? `!${code}` : `!(${code})`;
}

// ---------------------------------------------------------------------------
// JS value layout (arrays / objects / code fragments)
// ---------------------------------------------------------------------------

/** A tiny JS expression tree used to lay out literals that mix JSON values and code. */
export type JsNode =
  | { kind: 'code'; code: string }
  | { kind: 'array'; items: JsNode[] }
  | { kind: 'object'; entries: Array<[string, JsNode]> };

export const jsCode = (code: string): JsNode => ({ kind: 'code', code });
export const jsArray = (items: JsNode[]): JsNode => ({ kind: 'array', items });
export const jsObject = (entries: Array<[string, JsNode]>): JsNode => ({ kind: 'object', entries });

/** Single-line rendering, or null when some part cannot be put on one line. */
function inlineJs(node: JsNode): string | null {
  switch (node.kind) {
    case 'code':
      return node.code.includes('\n') ? null : node.code;
    case 'array': {
      const parts: string[] = [];
      for (const item of node.items) {
        const s = inlineJs(item);
        if (s === null) return null;
        parts.push(s);
      }
      return `[${parts.join(', ')}]`;
    }
    case 'object': {
      if (node.entries.length === 0) return '{}';
      const parts: string[] = [];
      for (const [key, value] of node.entries) {
        const s = inlineJs(value);
        if (s === null) return null;
        parts.push(`${propertyKey(key)}: ${s}`);
      }
      return `{ ${parts.join(', ')} }`;
    }
  }
}

/**
 * Lays out a JS node. `indent` is the indentation (in columns) of the line the node starts on,
 * `col` the column of its first character and `suffix` the number of characters that follow it
 * on its last line. Returns lines relative to `indent`: continuation lines carry their own
 * relative indentation.
 */
export function printJs(node: JsNode, indent: number, col = indent, suffix = 0): string[] {
  const inline = inlineJs(node);
  if (inline !== null && col + inline.length + suffix <= PRINT_WIDTH) return [inline];
  const inner = indent + INDENT.length;
  switch (node.kind) {
    case 'code':
      return node.code.split('\n');
    case 'array': {
      if (node.items.length === 0) return ['[]'];
      const lines = ['['];
      for (const item of node.items) {
        const itemLines = printJs(item, inner, inner, 1);
        itemLines[itemLines.length - 1] += ',';
        lines.push(...indentLines(itemLines));
      }
      lines.push(']');
      return lines;
    }
    case 'object': {
      if (node.entries.length === 0) return ['{}'];
      const lines = ['{'];
      for (const [key, value] of node.entries) {
        const prefix = `${propertyKey(key)}: `;
        const valueLines = printJs(value, inner, inner + prefix.length, 1);
        valueLines[0] = prefix + valueLines[0];
        valueLines[valueLines.length - 1] += ',';
        lines.push(...indentLines(valueLines));
      }
      lines.push('}');
      return lines;
    }
  }
}

/**
 * Lays out a call `callee(arg, ...)` like prettier: on one line when it fits, otherwise hugging a
 * trailing object/array argument (`fn(a, {` ... `})`), otherwise one argument per line.
 * `indent`, `col` and `suffix` have the same meaning as in printJs.
 */
export function printCall(callee: string, args: JsNode[], indent: number, col = indent, suffix = 0): string[] {
  const inline = args.map(inlineJs);
  if (inline.every((a) => a !== null)) {
    const line = `${callee}(${inline.join(', ')})`;
    if (col + line.length + suffix <= PRINT_WIDTH) return [line];
  }
  const last = args[args.length - 1];
  if (last && last.kind !== 'code' && inline.slice(0, -1).every((a) => a !== null)) {
    const head = `${callee}(${[...inline.slice(0, -1), ''].join(', ')}`;
    if (col + head.length + 2 <= PRINT_WIDTH) {
      const lastLines = printJs(last, indent, col + head.length, suffix + 1);
      lastLines[0] = head + lastLines[0];
      lastLines[lastLines.length - 1] += ')';
      return lastLines;
    }
  }
  const inner = indent + INDENT.length;
  const lines = [`${callee}(`];
  for (const arg of args) {
    const argLines = printJs(arg, inner, inner, 1);
    argLines[argLines.length - 1] += ',';
    lines.push(...indentLines(argLines));
  }
  lines.push(')');
  return lines;
}

/** Writes `prefix` + call + `end` (e.g. `const x = ` ... `;`) into a writer. */
export function writeCall(w: CodeWriter, prefix: string, callee: string, args: JsNode[], end = ';'): void {
  const lines = printCall(callee, args, w.column, w.column + prefix.length, end.length);
  lines[0] = prefix + lines[0];
  lines[lines.length - 1] += end;
  w.lines(lines);
}

/** Joins lines produced by printJs into a string with continuation lines indented at `levels`. */
export function joinJs(lines: string[], levels: number): string {
  return [lines[0], ...indentLines(lines.slice(1), levels)].join('\n');
}

// ---------------------------------------------------------------------------
// JSON (project files)
// ---------------------------------------------------------------------------

/**
 * JSON.stringify with 2-space indentation, but arrays of primitives that fit on one line are kept
 * inline (`"objectTypes": ["contacts"]`) like HubSpot's templates. Always ends with a newline.
 */
export function formatJson(value: unknown): string {
  /** `indent`: indentation of the value's own line; `col`: column where the value starts. */
  const print = (v: unknown, indent: number, col: number): string => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
    const pad = ' '.repeat(indent);
    const inner = ' '.repeat(indent + 2);
    if (Array.isArray(v)) {
      if (v.length === 0) return '[]';
      const primitive = v.every((x) => x === null || typeof x !== 'object');
      if (primitive) {
        const inline = `[${v.map((x) => JSON.stringify(x)).join(', ')}]`;
        // +1 for a trailing comma
        if (col + inline.length + 1 <= PRINT_WIDTH) return inline;
      }
      return `[\n${v.map((x) => inner + print(x, indent + 2, indent + 2)).join(',\n')}\n${pad}]`;
    }
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    if (entries.length === 0) return '{}';
    return `{\n${entries
      .map(([k, x]) => {
        const key = `${JSON.stringify(k)}: `;
        return inner + key + print(x, indent + 2, indent + 2 + key.length);
      })
      .join(',\n')}\n${pad}}`;
  };
  return `${print(value, 0, 0)}\n`;
}

// ---------------------------------------------------------------------------
// Statement writer
// ---------------------------------------------------------------------------

/** Accumulates indented lines of statements. */
export class CodeWriter {
  private readonly out: string[] = [];
  private level = 0;

  constructor(initialLevel = 0) {
    this.level = initialLevel;
  }

  /** Current indentation column (spaces). */
  get column(): number {
    return this.level * INDENT.length;
  }

  line(text = ''): this {
    this.out.push(text === '' ? '' : INDENT.repeat(this.level) + text);
    return this;
  }

  /** Writes pre-laid-out lines; the first at the current level, the rest relative to it. */
  lines(lines: string[]): this {
    for (const l of lines) this.line(l);
    return this;
  }

  /** Writes `open`, runs `body` one level deeper, then writes `close`. */
  block(open: string, body: () => void, close = '}'): this {
    this.line(open);
    this.level++;
    body();
    this.level--;
    this.line(close);
    return this;
  }

  indent(body: () => void): this {
    this.level++;
    body();
    this.level--;
    return this;
  }

  toLines(): string[] {
    return [...this.out];
  }

  isEmpty(): boolean {
    return this.out.length === 0;
  }
}

/** Splits user statements into lines, removing their common indentation (unless unsafe). */
export function dedentStatements(code: string): string[] {
  const raw = code.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  const lines = raw.split('\n');
  while (lines.length && lines[0].trim() === '') lines.shift();
  if (scanCode(raw).hasMultilineLiteral) return lines;
  const indents = lines.filter((l) => l.trim() !== '').map((l) => /^[ \t]*/.exec(l)?.[0].length ?? 0);
  const common = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => (l.trim() === '' ? '' : l.slice(common)));
}
