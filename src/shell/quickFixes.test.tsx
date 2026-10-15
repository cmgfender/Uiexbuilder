import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { createExtension, createProject } from '../model/factory';
import { selectActiveExtension, useEditor } from '../model/store';
import { validateProject } from '../model/validate';
import { ToastProvider } from '../ui';
import { ProblemsPanel } from './ProblemsPanel';
import { runValidation } from './problems';
import { quickFixFor } from './quickFixes';
import { resetEditor } from './testUtils';

const issues = () => validateProject(useEditor.getState().project);
const issue = (rule: string) => issues().find((i) => i.rule === rule);

describe('quick fixes', () => {
  it('adds a missing scope and permitted URL in one undo step each', () => {
    const ext = createExtension({
      name: 'Card',
      content: [{ type: 'Image', props: { src: 'https://img.example.com/logo.png', alt: 'Logo' } }],
    });
    ext.dataSources.push({ id: 'd1', kind: 'crmProperties', name: 'contact', properties: ['email'] });
    const project = createProject('Fix App', [ext]);
    project.app.requiredScopes = [];
    resetEditor(project);

    const scope = issue('missing-scope');
    expect(scope?.subject).toBeTruthy();
    const scopeFix = quickFixFor(scope!, useEditor.getState().project)!;
    expect(scopeFix.label).toBe('Add scope');
    expect(scopeFix.apply()).toMatch(/Added the/);
    expect(useEditor.getState().project.app.requiredScopes).toContain(scope!.subject);
    expect(issues().filter((i) => i.rule === 'missing-scope' && i.subject === scope!.subject)).toEqual([]);

    const url = issue('missing-permitted-url');
    expect(url?.subject).toBe('https://img.example.com');
    quickFixFor(url!, useEditor.getState().project)!.apply();
    expect(useEditor.getState().project.app.permittedUrls.img).toEqual(['https://img.example.com']);
    useEditor.getState().undo();
    expect(useEditor.getState().project.app.permittedUrls.img).toEqual([]);
  });

  it('renames an invalid project and creates a missing bound state variable', () => {
    const ext = createExtension({ name: 'Card', content: [{ type: 'Input', props: { label: 'Email', name: 'email' }, binding: { state: 'email' } }] });
    const project = createProject('Fix App', [ext]);
    project.name = 'Fix App!';
    resetEditor(project);

    const nameFix = quickFixFor(issue('project-name')!, useEditor.getState().project)!;
    expect(nameFix.label).toBe('Use “fix-app”');
    nameFix.apply();
    expect(useEditor.getState().project.name).toBe('fix-app');

    const state = issue('unknown-state')!;
    expect(state.subject).toBe('email');
    const fix = quickFixFor(state, useEditor.getState().project)!;
    expect(fix.label).toBe('Create “email”');
    fix.apply();
    expect(selectActiveExtension(useEditor.getState()).state).toMatchObject([{ name: 'email', type: 'string', initial: '' }]);
    expect(issue('unknown-state')).toBeUndefined();
  });

  it('replaces a misspelt name with the suggestion in one undo step', () => {
    const ext = createExtension({ name: 'Card', content: [{ type: 'Text', text: 'Email: {{ recrd.email }}' }, { type: 'Text', text: '{{ recrd.firstname }}' }] });
    ext.dataSources.push({ id: 'd1', kind: 'crmProperties', name: 'record', properties: ['email', 'firstname'] });
    resetEditor(createProject('Fix App', [ext]));
    const typo = issue('unknown-name')!;
    expect([typo.subject, typo.suggestion]).toEqual(['recrd', 'record']);
    const fix = quickFixFor(typo, useEditor.getState().project)!;
    expect(fix.label).toBe('Use “record”');
    expect(fix.apply()).toBe('Replaced “recrd” with “record”.');
    const texts = Object.values(selectActiveExtension(useEditor.getState()).nodes).map((n) => n.text).filter(Boolean);
    expect(texts).toEqual(expect.arrayContaining(['Email: {{ record.email }}', '{{ record.firstname }}']));
    expect(issue('unknown-name')).toBeUndefined();
    useEditor.getState().undo();
    expect(issue('unknown-name')?.subject).toBe('recrd');
  });

  it('binds the variable the store actually created when the name is taken', () => {
    const ext = createExtension({ name: 'Card', content: [{ type: 'Input', props: { label: 'Email', name: 'email' }, binding: { state: 'email' } }] });
    ext.computed = [{ id: 'c1', name: 'email', expr: "'x'" }];
    resetEditor(createProject('Fix App', [ext]));
    // The bound name is a computed value, so the new state variable gets another name.
    const st = issue('unknown-state')!;
    const fix = quickFixFor(st, useEditor.getState().project)!;
    const pastBefore = useEditor.getState().past.length;
    expect(fix.apply()).toMatch(/now bound to the new state variable “email2”/);
    const after = selectActiveExtension(useEditor.getState());
    const input = Object.values(after.nodes).find((n) => n.type === 'Input')!;
    expect(after.state.map((s) => s.name)).toContain(input.binding!.state);
    expect(useEditor.getState().past.length).toBe(pastBefore + 1);
  });

  it('adds the likely origin of a dynamic URL and fixes a property typo', () => {
    const ext = createExtension({ name: 'Card', content: [{ type: 'Image', props: { src: '{{ logo }}', alt: 'Logo' } }] });
    ext.state.push({ id: 's1', name: 'logo', type: 'string', initial: 'https://cdn.acme.io/logo.png' });
    ext.dataSources.push({ id: 'd1', kind: 'crmProperties', name: 'record', properties: ['email', 'lifecyclestag'] });
    resetEditor(createProject('Fix App', [ext]));
    const origin = issue('dynamic-url-origin')!;
    quickFixFor(origin, useEditor.getState().project)!.apply();
    expect(useEditor.getState().project.app.permittedUrls.img).toEqual(['https://cdn.acme.io']);
    expect(issue('dynamic-url-origin')).toBeUndefined();

    const typo = issues().find((i) => i.rule === 'data-source-properties' && i.subject === 'lifecyclestag')!;
    const fix = quickFixFor(typo, useEditor.getState().project)!;
    expect(fix.label).toBe('Use “lifecyclestage”');
    fix.apply();
    expect(selectActiveExtension(useEditor.getState()).dataSources[0]).toMatchObject({ properties: ['email', 'lifecyclestage'] });
  });

  it('offers no fix when a human has to decide', () => {
    resetEditor(createProject('Fix App', [createExtension({ name: 'Card', content: [{ type: 'Input', props: { name: 'x' } }] })]));
    const required = issue('required-prop');
    expect(required).toBeDefined();
    expect(quickFixFor(required!, useEditor.getState().project)).toBeNull();
  });

  it('shows a Fix button in the problems panel', () => {
    const project = createProject('Fix App', [createExtension({ name: 'Card' })]);
    project.name = 'Bad Name';
    resetEditor(project);
    runValidation(useEditor.getState().project);
    render(
      <ToastProvider>
        <ProblemsPanel />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Use “bad-name”/ }));
    expect(useEditor.getState().project.name).toBe('bad-name');
    expect(screen.getByRole('status')).toHaveTextContent('Renamed the project to “bad-name”.');
  });
});
