// @vitest-environment node
/**
 * The action builder's default steps must export as type-correct TypeScript (ARCHITECTURE §6):
 * a fresh "Set variable" step on any state type, a "Fetch URL" / "Run app function" step with its
 * default error alert and a "Copy to clipboard" step.
 */
import { describe, expect, it } from 'vitest';
import { generateExtensionSource } from '../codegen';
import { createAppFunction, createExtension, createProject } from '../model/factory';
import type { ActionStep, StateVar } from '../model/types';
import { validateProject } from '../model/validate';
import { formatDiagnostics, scratchDir, typecheck, writeFiles } from '../test/typecheck';
import { createStep, defaultSetValue, type ActionContext } from './actionModel';

const STATES: StateVar[] = [
  { id: 's1', name: 'label', type: 'string', initial: '' },
  { id: 's2', name: 'rows', type: 'array', initial: [] },
  { id: 's3', name: 'info', type: 'object', initial: {} },
  { id: 's4', name: 'anything', type: 'any', initial: null },
  { id: 's5', name: 'count', type: 'number', initial: 0 },
  { id: 's6', name: 'open', type: 'boolean', initial: false },
];

describe('default action steps', () => {
  it('generate code that type-checks under strict and validates without problems', () => {
    const ext = createExtension({ kind: 'card', name: 'Defaults', objectTypes: ['contacts'], content: [{ type: 'Button', text: 'Go' }] });
    ext.state = STATES.map((s) => ({ ...s }));
    ext.dataSources = [{ id: 'd1', name: 'record', kind: 'crmProperties', properties: ['firstname', 'email'] }];
    const project = createProject('Defaults App', [ext]);
    project.app.permittedUrls = { ...project.app.permittedUrls, fetch: ['https://api.example.com'] };
    project.functions = [createAppFunction([], 'doWork')];
    const buttonId = ext.nodes[ext.rootId].children[0];
    const ctx: ActionContext = { project, ext, nodeId: buttonId, eventParams: ['event'] };

    const steps: ActionStep[] = [];
    for (const v of ext.state) {
      // Exactly what the Events tab creates when this variable is the first one.
      const step = createStep('setState', { ...ctx, ext: { ...ext, state: [v] } });
      expect(step).toMatchObject({ state: v.name, value: defaultSetValue(v, ['event']) });
      expect((step as { value: string }).value.trim()).not.toBe('');
      steps.push(step);
    }
    steps.push(createStep('fetch', ctx), createStep('runFunction', ctx), createStep('copyToClipboard', ctx));
    expect(steps.at(-1)).toMatchObject({ type: 'copyToClipboard', text: '{{ record.email }}' });
    ext.nodes[buttonId].events = { onClick: steps };

    const issues = validateProject(project).filter((i) => i.severity !== 'info' && i.nodeId === buttonId);
    expect(issues.map((i) => `${i.rule}: ${i.message}`)).toEqual([]);

    const source = generateExtensionSource(project, ext);
    expect(source).not.toMatch(/set\w+\(undefined\)/);
    const dir = scratchDir('inspector-action-defaults');
    const paths = writeFiles(dir, [{ path: 'Defaults.tsx', contents: source }]);
    expect(formatDiagnostics(typecheck(paths))).toBe('');
  }, 60_000);

  it('"Update while typing" on a bound search input type-checks and validates', () => {
    const ext = createExtension({
      kind: 'card',
      name: 'Live',
      objectTypes: ['contacts'],
      content: [{ type: 'SearchInput', props: { label: 'Search', name: 'search' }, binding: { state: 'search' } }],
    });
    ext.state = [{ id: 's1', name: 'search', type: 'string', initial: '' }];
    const project = createProject('Live App', [ext]);
    const inputId = ext.nodes[ext.rootId].children[0];
    ext.nodes[inputId].events = { onInput: [{ id: 'a1', type: 'setState', state: 'search', value: 'value' }] };
    expect(validateProject(project).filter((i) => i.severity !== 'info' && i.nodeId === inputId)).toEqual([]);
    const source = generateExtensionSource(project, ext);
    expect(source).toMatch(/onInput=/);
    const dir = scratchDir('inspector-live-binding');
    expect(formatDiagnostics(typecheck(writeFiles(dir, [{ path: 'Live.tsx', contents: source }])))).toBe('');
  }, 60_000);
});
