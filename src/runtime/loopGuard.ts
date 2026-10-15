/**
 * Loop protection for code the designer evaluates in the page (expressions, computed values,
 * custom code actions, helper code). User code runs synchronously on the main thread, so a
 * runaway `while (true) {}` would freeze the tab — and, for an autosaved project, every later
 * load. `guardLoops` rewrites `while (...)`, `do ... while (...)` and `for (...; ...; ...)` loops
 * so each iteration first calls `__uiexLoopGuard()`, which throws once synchronous code has kept
 * looping for LOOP_TIME_LIMIT_MS without returning to the event loop. The error surfaces like any
 * other (console, Problems, the node's error box) instead of hanging the editor.
 *
 * The guard is a global function so code compiled anywhere (`new Function`) can reach it.
 */
import { isPropertyName, matchingClose, nextSignificant, tokenize, type Token } from '../model/jsTokens';

export const LOOP_GUARD_NAME = '__uiexLoopGuard';
/** Synchronous looping allowed before the guard stops the code. */
export const LOOP_TIME_LIMIT_MS = 1500;

let windowStart = 0;
let count = 0;
let tripped = false;

function scheduleReset(): void {
  setTimeout(() => {
    windowStart = 0;
    count = 0;
    tripped = false;
  }, 0);
}

/** Message of the error a stopped loop throws. */
export const LOOP_STOPPED_MESSAGE = `A loop ran for more than ${LOOP_TIME_LIMIT_MS / 1000} s and was stopped (is it an infinite loop?)`;

/**
 * Called on every loop iteration of guarded code. Checks the clock every 1024 iterations; once a
 * synchronous run has looped for longer than the limit, it throws — and keeps throwing for the
 * rest of that run, so a render with many looping expressions stops once, not once per expression.
 */
export function loopGuard(): true {
  if (tripped) throw new Error(LOOP_STOPPED_MESSAGE);
  if ((++count & 0x3ff) !== 0) return true;
  const now = Date.now();
  if (windowStart === 0) {
    windowStart = now;
    scheduleReset();
    return true;
  }
  if (now - windowStart > LOOP_TIME_LIMIT_MS) {
    tripped = true;
    throw new Error(LOOP_STOPPED_MESSAGE);
  }
  return true;
}

if (typeof globalThis !== 'undefined' && !(LOOP_GUARD_NAME in globalThis)) {
  Object.defineProperty(globalThis, LOOP_GUARD_NAME, { value: loopGuard, configurable: true, writable: false, enumerable: false });
}

/**
 * Adds the loop guard to every `while` / `do-while` / C-style `for` loop of `code`
 * (`while (x)` -> `while (__uiexLoopGuard() && (x))`, `for (;;)` -> `for (; __uiexLoopGuard();)`).
 * `for...in` / `for...of` loops iterate finite collections and are left alone. Code without loops
 * is returned unchanged.
 */
export function guardLoops(code: string): string {
  if (!/\b(while|for)\b/.test(code)) return code;
  const tokens = tokenize(code);
  const before = new Map<number, string>();
  const after = new Map<number, string>();
  const add = (map: Map<number, string>, index: number, text: string) => map.set(index, (map.get(index) ?? '') + text);
  const call = `${LOOP_GUARD_NAME}()`;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'ident' || (t.text !== 'while' && t.text !== 'for') || isPropertyName(tokens, i)) continue;
    const open = nextSignificant(tokens, i + 1);
    if (open === -1 || tokens[open].text !== '(') continue; // `for await (...)`, a property named while, ...
    const close = matchingClose(tokens, open);
    if (close === -1) continue;
    if (t.text === 'while') {
      add(after, open, `${call} && (`);
      add(before, close, ')');
      continue;
    }
    const semis = topLevelSemicolons(tokens, open, close);
    if (semis.length !== 2) continue; // for...in / for...of
    const [first, second] = semis;
    const condition = tokens.slice(first + 1, second).some((x) => x.kind !== 'whitespace' && x.kind !== 'comment');
    if (condition) {
      add(after, first, ` ${call} && (`);
      add(before, second, ')');
    } else {
      add(after, first, ` ${call}`);
    }
  }
  if (before.size === 0 && after.size === 0) return code;
  return tokens.map((tok, idx) => `${before.get(idx) ?? ''}${tok.text}${after.get(idx) ?? ''}`).join('');
}

/** Indexes of `;` tokens directly inside the parentheses `open`..`close` (not nested). */
function topLevelSemicolons(tokens: Token[], open: number, close: number): number[] {
  const out: number[] = [];
  let depth = 0;
  for (let i = open + 1; i < close; i++) {
    const t = tokens[i];
    if (t.kind === 'templateHead') depth++;
    else if (t.kind === 'templateTail') depth--;
    else if (t.kind === 'punct' && (t.text === '(' || t.text === '[' || t.text === '{')) depth++;
    else if (t.kind === 'punct' && (t.text === ')' || t.text === ']' || t.text === '}')) depth--;
    else if (depth === 0 && t.kind === 'punct' && t.text === ';') out.push(i);
  }
  return out;
}
