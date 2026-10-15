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
