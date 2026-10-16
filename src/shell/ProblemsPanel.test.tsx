import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createExtension, createProject } from '../model/factory';
import { useEditor } from '../model/store';
import type { Issue } from '../model/validate';
import { ToastProvider } from '../ui';
import { useDialogs } from './dialogs';
import { ProblemsPanel } from './ProblemsPanel';
import { navigateToIssue, rightTabForField, runValidation, useProblems } from './problems';
import { useShell } from './shellStore';
import { resetEditor } from './testUtils';
import { useDataReveal } from '../panels/reveal';
import { usePowerUi } from '../power/uiStore';

function setupTwoExtensions() {
  const a = createExtension({ name: 'Alpha', content: [{ type: 'Button', name: 'Save button', text: 'Save' }] });
  const b = createExtension({ name: 'Beta', content: [{ type: 'Text', name: 'Body', text: 'x' }], existing: [a] });
  const project = createProject('Problem App', [a, b]);
  resetEditor(project);
  const btn = a.nodes[a.rootId].children[0];
  const body = b.nodes[b.rootId].children[0];
  return { a, b, btn, body, project };
}

describe('problem navigation', () => {
  it('maps fields to inspector tabs', () => {
    expect(rightTabForField('event:onClick')).toBe('events');
    expect(rightTabForField('condition')).toBe('advanced');
    expect(rightTabForField('repeat')).toBe('advanced');
    expect(rightTabForField('binding')).toBe('advanced');
    expect(rightTabForField('label')).toBe('properties');
    expect(rightTabForField(undefined)).toBe('properties');
  });

  it('switches extension, selects the node and opens the right inspector tab', () => {
    const { b, body } = setupTwoExtensions();
    useShell.getState().setRightCollapsed(true);
    useEditor.getState().setMode('preview');
    navigateToIssue({ id: '1', severity: 'error', message: 'm', rule: 'r', extensionId: b.id, nodeId: body, field: 'event:onClick' });
    const s = useEditor.getState();
    expect(s.activeExtensionId).toBe(b.id);
    expect(s.selectedNodeId).toBe(body);
    expect(s.rightPanel).toBe('events');
    expect(s.mode).toBe('design');
    expect(useShell.getState().rightCollapsed).toBe(false);

    navigateToIssue({ id: '2', severity: 'warning', message: 'm', rule: 'r', extensionId: b.id, nodeId: body, field: 'condition' });
    expect(useEditor.getState().rightPanel).toBe('advanced');
  });

  it('opens app / function dialogs and the data panel for non-node issues', () => {
    const { a } = setupTwoExtensions();
    navigateToIssue({ id: '1', severity: 'error', message: 'm', rule: 'r', field: 'app.requiredScopes' });
    expect(useDialogs.getState().current).toBe('appSettings');
    useDialogs.getState().close();

    navigateToIssue({ id: '2', severity: 'error', message: 'm', rule: 'r', field: 'function:f_123' });
    expect(useDialogs.getState()).toMatchObject({ current: 'functions', arg: 'f_123' });
    useDialogs.getState().close();

    navigateToIssue({ id: '3', severity: 'error', message: 'm', rule: 'r', extensionId: a.id, field: 'state:s_1' });
    expect(useEditor.getState().leftPanel).toBe('data');
    expect(useDataReveal.getState().target).toEqual({ kind: 'state', id: 's_1' });
    navigateToIssue({ id: '3b', severity: 'error', message: 'm', rule: 'r', extensionId: a.id, field: 'computed:c_1' });
    expect(usePowerUi.getState().revealComputedId).toBe('c_1');
    useDataReveal.setState({ target: null });
    usePowerUi.getState().revealComputed(null);

    navigateToIssue({ id: '4', severity: 'error', message: 'm', rule: 'r', extensionId: a.id, field: 'uid' });
    expect(useDialogs.getState()).toMatchObject({ current: 'extensionSettings', arg: a.id });
  });

  it('runValidation stores counts', () => {
    resetEditor();
    runValidation(useEditor.getState().project);
    expect(useProblems.getState().failure).toBeNull();
    expect(useProblems.getState().errors).toBe(useProblems.getState().issues.filter((i) => i.severity === 'error').length);
  });
});

describe('<ProblemsPanel>', () => {
  function renderPanel() {
    return render(
      <ToastProvider>
        <ProblemsPanel />
      </ToastProvider>,
    );
  }

  it('shows the empty state when everything is fine', () => {
    resetEditor();
    renderPanel();
    expect(screen.getByText('No problems — ready to publish')).toBeInTheDocument();
  });

  it('groups problems by extension with counts and navigates on click', () => {
    const { a, b, btn, body } = setupTwoExtensions();
    const issues: Issue[] = [
      { id: 'i1', severity: 'error', message: 'Button needs a label', rule: 'required-prop', extensionId: a.id, nodeId: btn, field: 'text' },
      { id: 'i2', severity: 'warning', message: 'Unknown variable “total”', rule: 'unknown-ref', extensionId: b.id, nodeId: body, field: 'condition' },
      { id: 'i3', severity: 'warning', message: 'Missing support email', rule: 'app-support', field: 'app.support' },
    ];
    useProblems.getState().setIssues(issues);
    renderPanel();

    expect(screen.getByRole('button', { name: /All/ })).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: /Errors/ })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /Warnings/ })).toHaveTextContent('2');
    const alpha = screen.getByRole('region', { name: 'Alpha' });
    const beta = screen.getByRole('region', { name: 'Beta' });
    expect(within(alpha).getByText('Button needs a label')).toBeInTheDocument();
    expect(within(alpha).getByText('Save button')).toBeInTheDocument();
    expect(within(beta).getByText('Unknown variable “total”')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Project & app' })).toBeInTheDocument();

    fireEvent.click(within(beta).getByText('Unknown variable “total”'));
    expect(useEditor.getState().activeExtensionId).toBe(b.id);
    expect(useEditor.getState().selectedNodeId).toBe(body);
    expect(useEditor.getState().rightPanel).toBe('advanced');

    fireEvent.click(screen.getByRole('button', { name: /Errors/ }));
    expect(screen.queryByText('Unknown variable “total”')).toBeNull();
    expect(screen.getByText('Button needs a label')).toBeInTheDocument();
  });
});
