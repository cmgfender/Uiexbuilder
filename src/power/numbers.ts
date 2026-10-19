/**
 * Reading numbers that are written as text: `toNumber("$48,000.00")` is 48000, so a filter such as
 * "Amount is more than 10000" works whether the value is a number, HubSpot's text ("48000") or a
 * formatted value ("$48,000.00", "45%", "(1,234)", "1.234,56 €").
 *
 * `toNumber(x)` is exactly `Number(x)` whenever that gives a number; only text Number() can't read
 * is parsed: currency symbols, letters, spaces and "%" are dropped, a minus sign or accounting
 * parentheses make it negative, and of the separators the last one is the decimal point unless it
 * only groups thousands ("1,234", "1.234.567"). Text with no digits stays NaN, so a check like
 * "more than 5" is false for it.
 *
 * The visual condition builder and the list shaper write `toNumber(…)` for every comparison with a
 * number. The preview runs `toNumber` below; generated code declares the same function from
 * `TO_NUMBER_HELPER_SOURCE` (like `toText`), so the exported card behaves exactly like the preview.
 * Pure and dependency-free.
 */

/** Name of the helper in expressions and generated code. */
export const TO_NUMBER = 'toNumber';

const PARENTHESES_RE = /^\(.*\)$/;
const LEADING_MINUS_RE = /^[^\d]*[-−]/;
const TRAILING_MINUS_RE = /[-−]$/;
const NOT_DIGIT_OR_SEPARATOR_RE = /[^\d.,]/g;
const DIGIT_RE = /\d/;
const SEPARATORS_RE = /[.,]/g;

/** The number a value shows (see the module comment); NaN when it shows none. */
export function toNumber(value: unknown): number {
  const n = Number(value);
  if (!Number.isNaN(n) || typeof value !== 'string') return n;
  const text = value.trim();
  const negative = PARENTHESES_RE.test(text) || LEADING_MINUS_RE.test(text) || TRAILING_MINUS_RE.test(text);
  const digits = text.replace(NOT_DIGIT_OR_SEPARATOR_RE, '');
  if (!DIGIT_RE.test(digits)) return NaN;
  const dot = digits.lastIndexOf('.');
  const comma = digits.lastIndexOf(',');
  const last = Math.max(dot, comma);
  const parts = last === -1 ? [digits] : digits.split(digits.charAt(last));
  // Both kinds: the last one is the decimal point ("1,234.56", "1.234,56"). One kind: it is the
  // decimal point when it appears once, except a comma before exactly three digits ("1,234").
  const decimal = last !== -1 && ((dot !== -1 && comma !== -1) || (parts.length === 2 && !(last === comma && parts[1].length === 3)));
  const whole = (decimal ? digits.slice(0, last) : digits).replace(SEPARATORS_RE, '');
  const fraction = decimal ? digits.slice(last + 1) : '';
  const parsed = Number(`${whole || '0'}.${fraction || '0'}`);
  return negative ? -parsed : parsed;
}

/**
 * Source of the `toNumber` helper emitted into generated extensions when an expression uses it
 * (mirrors `toNumber` above line for line; a test runs both on the same values).
 */
export const TO_NUMBER_HELPER_SOURCE = `const toNumber = (value: unknown): number => {
  // Number(value), or the number a formatted text shows: "$48,000.00" → 48000, "45%" → 45,
  // "(1,234)" → -1234, "1.234,56 €" → 1234.56.
  const n = Number(value);
  if (!Number.isNaN(n) || typeof value !== 'string') return n;
  const text = value.trim();
  const negative = /^\\(.*\\)$/.test(text) || /^[^\\d]*[-\\u2212]/.test(text) || /[-\\u2212]$/.test(text);
  const digits = text.replace(/[^\\d.,]/g, '');
  if (!/\\d/.test(digits)) return NaN;
  const dot = digits.lastIndexOf('.');
  const comma = digits.lastIndexOf(',');
  const last = Math.max(dot, comma);
  const parts = last === -1 ? [digits] : digits.split(digits.charAt(last));
  const decimal = last !== -1 && ((dot !== -1 && comma !== -1) || (parts.length === 2 && !(last === comma && parts[1].length === 3)));
  const whole = (decimal ? digits.slice(0, last) : digits).replace(/[.,]/g, '');
  const fraction = decimal ? digits.slice(last + 1) : '';
  const parsed = Number(\`\${whole || '0'}.\${fraction || '0'}\`);
  return negative ? -parsed : parsed;
};`;

/** `toNumber(<code>)` — the call the builders write around a value compared with a number. */
export function toNumberCall(code: string): string {
  return `${TO_NUMBER}(${code})`;
}
