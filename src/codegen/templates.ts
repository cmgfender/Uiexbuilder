/**
 * `{{ expression }}` template strings -> generated code. Mirrors src/model/template.ts exactly:
 *  1. no template            -> the plain string
 *  2. exactly one segment    -> the raw value of the expression       (value semantics)
 *  3. text mixed with segments -> a string, each segment through toText()
 *  4. literal arrays/objects -> rules 1-3 applied to every string at any depth (see
 *                               JsxRenderer.typedLiteral, which also casts by the prop's type)
 *  5. text children          -> always a string (a single segment still goes through toText)
 */
import { hasTemplate, parseTemplate, singleExpression } from '../model/template';
import type { GenContext } from './context';
import { noteUserCode, useHelper } from './context';
import {
  asOperand,
  escapeTemplateLiteralText,
  isJsxTextFragmentSafe,
  isJsxTextSafe,
  normalizeExpression,
  quoteString,
} from './printer';

/** Coerces a document field that should be a string (documents may be hand-edited). */
export function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? '' : String(value);
}

/** A user expression ready to embed: normalised and recorded in the context. */
export function userExpr(ctx: GenContext, code: string): string {
  const normalized = normalizeExpression(asString(code));
  noteUserCode(ctx, normalized);
  return normalized === '' ? 'undefined' : normalized;
}

function toTextCall(ctx: GenContext, code: string): string {
  return `${useHelper(ctx, 'toText')}(${asOperand(userExpr(ctx, code))})`;
}

/** Template literal for a mixed template (rule 3). */
function templateLiteral(ctx: GenContext, str: string): string {
  let out = '`';
  for (const part of parseTemplate(str)) {
    if (part.kind === 'text') out += escapeTemplateLiteralText(part.value);
    else out += `\${${toTextCall(ctx, part.code)}}`;
  }
  return `${out}\``;
}

export type TemplateCode =
  /** A plain string (no expression segments). */
  | { origin: 'literal'; code: string; text: string }
  /** A single segment: the raw value of the expression (it has the expression's type). */
  | { origin: 'expr'; code: string }
  /** Text mixed with segments: a template literal (a string). */
  | { origin: 'interpolated'; code: string };

/** Value semantics (rules 1-3): props, data source options. */
export function templateValue(ctx: GenContext, value: string): TemplateCode {
  const str = asString(value);
  if (!hasTemplate(str)) return { code: quoteString(str), origin: 'literal', text: str };
  const single = singleExpression(str);
  if (single !== null) return { code: userExpr(ctx, single), origin: 'expr' };
  const parts = parseTemplate(str);
  if (!parts.some((p) => p.kind === 'expr')) {
    const text = parts.map((p) => (p.kind === 'text' ? p.value : '')).join('');
    return { code: quoteString(text), origin: 'literal', text };
  }
  return { code: templateLiteral(ctx, str), origin: 'interpolated' };
}

/**
 * Text semantics: always a string (action arguments such as alert messages, URLs, log messages).
 * A single segment is passed through toText so the result is a string like the runtime's.
 */
export function templateText(ctx: GenContext, value: string): string {
  const str = asString(value);
  if (!hasTemplate(str)) return quoteString(str);
  const parts = parseTemplate(str);
  if (!parts.some((p) => p.kind === 'expr')) return quoteString(parts.map((p) => (p.kind === 'text' ? p.value : '')).join(''));
  // Exactly one segment and nothing else: toText(expr). Otherwise (including whitespace around a
  // single segment, which interpolation keeps) a template literal.
  const only = parts[0];
  if (parts.length === 1 && only.kind === 'expr') return toTextCall(ctx, only.code);
  return templateLiteral(ctx, str);
}

/**
 * JSX children for text content (rule 5). Returns the children source on one line, e.g.
 * `Hello {toText(name)}!` or `{'  padded  '}`; `{''}` for empty text so required `children`
 * props are always present.
 */
export function textChildren(ctx: GenContext, text: string | undefined): string {
  const str = asString(text);
  if (!hasTemplate(str)) {
    if (str === '') return "{''}";
    return isJsxTextSafe(str) ? str : `{${quoteString(str)}}`;
  }
  const parts = parseTemplate(str);
  if (!parts.some((p) => p.kind === 'expr')) {
    const plain = parts.map((p) => (p.kind === 'text' ? p.value : '')).join('');
    if (plain === '') return "{''}";
    return isJsxTextSafe(plain) ? plain : `{${quoteString(plain)}}`;
  }
  const first = parts[0];
  const last = parts[parts.length - 1];
  const edgesSafe =
    (first.kind === 'expr' || first.value.trimStart() === first.value) &&
    (last.kind === 'expr' || last.value.trimEnd() === last.value);
  const textsSafe = parts.every((p) => p.kind === 'expr' || isJsxTextFragmentSafe(p.value));
  if (edgesSafe && textsSafe) {
    return parts.map((p) => (p.kind === 'text' ? p.value : `{${toTextCall(ctx, p.code)}}`)).join('');
  }
  return `{${templateLiteral(ctx, str)}}`;
}
