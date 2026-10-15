/**
 * Imported documents do not run code until trusted, and runaway loops in evaluated code are
 * stopped instead of freezing the tab.
 */
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createExtension, createProject } from '../model/factory';
import { loadSavedProject, parseProjectJson, saveProject, serializeProject } from '../model/persistence';
import { useEditor } from '../model/store';
import { codeExecutionAllowed, isProjectTrusted, resetCodeTrustForTests, setActiveCodeProject, trustProject } from '../model/trust';
import type { Project } from '../model/types';
import { CODE_PAUSED_MESSAGE, evaluate, runStatements } from './expr';
import { guardLoops, LOOP_STOPPED_MESSAGE } from './loopGuard';
import { isSafeExpression } from './safeExpression';
import { buildScopeWithDiagnostics, createInitialScope, initialStateValues, resolveDataSources } from './scope';
import { byName, renderDoc } from './testing';

const beacon = (tag: string) => `fetch('http://localhost:4199/${tag}', { method: 'POST', body: localStorage.length })`;

/** A document whose helpers, computed value, condition, prop expression, text and repeat all call fetch. */
function hostileProject(): Project {
  const ext = createExtension({
    name: 'Looks normal',
    content: [
      { type: 'Heading', name: 'h', text: 'Hello {{ contact.firstname }}', condition: `(${beacon('condition')}, true)`, props: { inline: { $expr: `(${beacon('propexpr')}, false)` } } },
      { type: 'Text', name: 't', text: `Total {{ ${beacon('text')} && 1 }} for {{ count + 1 }}` },
      { type: 'Text', name: 'r', text: '{{ item }}', repeat: { items: `(${beacon('repeat')}, [1, 2])`, itemName: 'item', indexName: 'i' } },
    ],
  });
  ext.state = [{ id: 's1', name: 'count', type: 'number', initial: 41 }];
  ext.dataSources = [{ id: 'd1', kind: 'crmProperties', name: 'contact', properties: ['firstname'] }];
  ext.helpers = `const x = ${beacon('helpers')};\nfunction double(n) { return n * 2; }`;
  ext.computed = [{ id: 'c1', name: 'leak', expr: beacon('computed') }];
  return createProject('Imported', [ext]);
}

let calls: string[] = [];
const originalFetch = globalThis.fetch;
beforeEach(() => {
  window.localStorage.clear();
  resetCodeTrustForTests();
  calls = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response('{}');
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  setActiveCodeProject(null);
});

describe('untrusted (imported) projects', () => {
  it('opening an imported document runs none of its code; trusting it does', async () => {
    const parsed = parseProjectJson(serializeProject(hostileProject()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const project = parsed.project;
    useEditor.getState().loadProject(project);
    expect(isProjectTrusted(project.id)).toBe(false);
    expect(codeExecutionAllowed()).toBe(false);
    const ext = project.extensions[0];

    const design = renderDoc(project, ext, { mode: 'design' });
    createInitialScope(project, ext);
    design.unmount();
    const r = renderDoc(project, ext, { mode: 'preview' });
    await act(async () => {
      await new Promise((res) => setTimeout(res, 20));
    });
    expect(calls).toEqual([]);

    // Safe parts still render; paused code shows as source text.
    const t = r.nodes(byName(ext, 't').id)[0];
    expect(t).toHaveTextContent('for 42');
    expect(t).toHaveTextContent(`{{ ${beacon('text')} && 1 }}`);
    expect(screen.getByRole('region', { name: 'Paused code' })).toHaveTextContent('Code in this imported project is paused');

    await userEvent.click(screen.getByRole('button', { name: 'Trust and run code' }));
    expect(isProjectTrusted(project.id)).toBe(true);
    await act(async () => {
      await new Promise((res) => setTimeout(res, 20));
    });
    expect(calls.length).toBeGreaterThan(0);
    expect(screen.queryByRole('region', { name: 'Paused code' })).toBeNull();
  });

  it('stays untrusted after saving and reloading', () => {
    const parsed = parseProjectJson(serializeProject(hostileProject()));
    if (!parsed.ok) throw new Error(parsed.error);
    saveProject(parsed.project);
    resetCodeTrustForTests();
    const again = loadSavedProject(parsed.project.id)!;
    useEditor.getState().loadProject(again);
    expect(codeExecutionAllowed()).toBe(false);
    trustProject(again.id);
    resetCodeTrustForTests();
    expect(isProjectTrusted(again.id)).toBe(true);
  });

  it('does not run helper code, computed values or custom code while paused', async () => {
    const parsed = parseProjectJson(serializeProject(hostileProject()));
    if (!parsed.ok) throw new Error(parsed.error);
    useEditor.getState().loadProject(parsed.project);
    const ext = parsed.project.extensions[0];
    const { scope, diagnostics } = buildScopeWithDiagnostics({
      project: parsed.project,
      extension: ext,
      stateValues: initialStateValues(ext.state),
      setters: {},
      dataSources: resolveDataSources(ext, {}),
    });
    expect(scope.double).toBeUndefined();
    expect(diagnostics).toEqual({ helpersError: null, computedErrors: {} });
    expect(evaluate('count * 2', scope)).toEqual({ ok: true, value: 82 });
    expect(evaluate(beacon('x'), scope)).toMatchObject({ ok: false, blocked: true, error: CODE_PAUSED_MESSAGE });
    await expect(runStatements('await fetch("http://localhost:4199/custom")', scope)).rejects.toThrow(CODE_PAUSED_MESSAGE);
    expect(calls).toEqual([]);
  });

  it('projects created in this browser are trusted', () => {
    const project = createProject('Mine');
    useEditor.getState().loadProject(project);
    expect(codeExecutionAllowed()).toBe(true);
  });
});

describe('safe expressions', () => {
  const names = ['contact', 'count', 'items', 'deals', 'a', 'b', 'context'];
  it.each([
    'contact.firstname',
    "count > 0 ? 'many' : 'none'",
    '`${a} and ${b}`',
    '[...items, 1]',
    '{ total: count, label: a }',
    'deals.length && deals[0].properties.amount',
    'Math.PI * count',
    "context['user'].firstName",
    'typeof a === "string"',
    '!count',
  ])('allows %s', (code) => expect(isSafeExpression(code, names)).toBe(true));

  it('allows the toText formatting helper (fx toggle output), only as a plain call', () => {
    const withToText = [...names, 'toText'];
    expect(isSafeExpression('`Owner: ${toText(contact.owner)}`', withToText)).toBe(true);
    expect(isSafeExpression('toText(a)', names)).toBe(false);
    expect(isSafeExpression('a.toText(b)', withToText)).toBe(false);
    // evaluate() provides toText even while code is paused.
    expect(evaluate('`x ${toText(a)} y`', { a: null })).toEqual({ ok: true, value: 'x  y' });
  });

  it.each([
    "fetch('https://x')",
    'localStorage',
    'window.name',
    'document.cookie',
    'a.toUpperCase()',
    'a?.()',
    'new Date()',
    '(() => 1)',
    'count = 1',
    'count++',
    'String.raw`x`',
    '{ get x() { return 1 } }',
    'delete a.b',
    '{ [localStorage]: 1 }',
    '{ localStorage }',
    "import('x')",
    'items.map(i => i)',
    'globalThis',
  ])('blocks %s', (code) => expect(isSafeExpression(code, names)).toBe(false));
});

describe('malformed trees', () => {
  it('a cyclic tree renders an error box instead of recursing forever', () => {
    const project = createProject('Cycle');
    const ext = project.extensions[0];
    const root = ext.nodes[ext.rootId];
    const flex = root.children[0];
    ext.nodes[flex].children.push(flex);
    const r = renderDoc(project, ext, { mode: 'design' });
    expect(r.container.querySelector('.hsp-rt-error')).toHaveTextContent('nested too deeply');
  });
});

describe('loop guard', () => {
  it('instruments while / do-while / for loops but not for-of, strings or properties', () => {
    expect(guardLoops('while (x) y();')).toBe('while (__uiexLoopGuard() && (x)) y();');
    expect(guardLoops('do { i++ } while (i < 3)')).toBe('do { i++ } while (__uiexLoopGuard() && (i < 3))');
    expect(guardLoops('for (let i = 0; i < n; i++) {}')).toBe('for (let i = 0; __uiexLoopGuard() && ( i < n); i++) {}');
    expect(guardLoops('for (;;) {}')).toBe('for (; __uiexLoopGuard();) {}');
    expect(guardLoops('for (const x of xs) {}')).toBe('for (const x of xs) {}');
    expect(guardLoops("'while (true) {}' + a.while")).toBe("'while (true) {}' + a.while");
  });

  it('stops an infinite loop in an expression instead of hanging', () => {
    useEditor.getState().loadProject(createProject('Mine'));
    const started = Date.now();
    const r = evaluate('(() => { while (true) {} })()', {});
    expect(r).toEqual({ ok: false, error: LOOP_STOPPED_MESSAGE });
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('stops an infinite loop in helper code', async () => {
    const project = createProject('Loop');
    const ext = project.extensions[0];
    ext.helpers = 'const x = (() => { while (true) {} })();';
    useEditor.getState().loadProject(project);
    // A new macrotask ends the previous synchronous run (the guard resets between runs).
    await new Promise((res) => setTimeout(res, 0));
    const { diagnostics } = buildScopeWithDiagnostics({ project, extension: ext, stateValues: {}, setters: {}, dataSources: {} });
    expect(diagnostics.helpersError).toBe(LOOP_STOPPED_MESSAGE);
  });
});
