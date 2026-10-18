import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '../model/store';
import type { AddAlertAction, Project, SetStateAction } from '../model/types';
import { executeActions, type ActionHost } from '../runtime/actions';
import { Inspector } from './Inspector';
import { parseRules } from './rules';
import { ext, loadWith, nodeById, selectTop } from './testUtils';

function stepOf<T>(id: string): T {
  return nodeById(id).events!.onClick[0] as T;
}

function pick(select: HTMLElement, name: RegExp) {
  return userEvent.selectOptions(select, within(select).getByRole('option', { name }));
}

describe('Rules in actions', () => {
  beforeEach(() => {
    loadWith([{ type: 'Button', text: 'Check' }], 'card', {
      state: [
        { id: 's1', name: 'score', type: 'number', initial: 72 },
        { id: 's2', name: 'label', type: 'string', initial: '' },
      ],
    });
    useEditor.setState({ rightPanel: 'events' });
  });

  it('picks the alert type by thresholds and stores it as an expression', async () => {
    const node = selectTop();
    useEditor.getState().setEvent(node.id, 'onClick', [{ id: 'a1', type: 'addAlert', alertType: 'success', title: '', message: 'Score checked' }]);
    render(<Inspector />);
    const field = document.querySelector<HTMLElement>('[data-action-field="type"]')!;
    await userEvent.click(within(field).getByRole('button', { name: 'Use rules for Type' }));
    // Nothing to compare yet: the step keeps its fixed type.
    expect(stepOf<AddAlertAction>(node.id).alertTypeExpr).toBeUndefined();
    await pick(within(field).getByLabelText('Based on'), /^score/);
    await userEvent.clear(within(field).getByLabelText('Rule 1 value to compare with'));
    await userEvent.type(within(field).getByLabelText('Rule 1 value to compare with'), '80');
    await userEvent.selectOptions(within(field).getByLabelText('Otherwise result'), 'Warning');
    const step = stepOf<AddAlertAction>(node.id);
    expect(step.alertTypeExpr).toBe('(score) >= 80 ? "success" : "warning"');
    expect(within(field).getByText(/Right now: 72/)).toBeInTheDocument();
    expect(screen.getByText(/type by rules/)).toBeInTheDocument();

    await userEvent.click(within(field).getByRole('button', { name: 'Stop using rules for Type' }));
    expect(stepOf<AddAlertAction>(node.id)).toMatchObject({ alertType: 'warning' });
    expect(stepOf<AddAlertAction>(node.id).alertTypeExpr).toBeUndefined();
  });

  it('picks the alert message and a variable’s new value by rules', async () => {
    const node = selectTop();
    useEditor.getState().setEvent(node.id, 'onClick', [
      { id: 'a1', type: 'addAlert', alertType: 'info', title: '', message: 'Fine' },
      { id: 'a2', type: 'setState', state: 'label', value: "'Low'" },
    ]);
    render(<Inspector />);
    const [message, value] = [
      document.querySelector<HTMLElement>('[data-action-field="message"]')!,
      document.querySelector<HTMLElement>('[data-action-field="value"]')!,
    ];
    await userEvent.click(within(message).getByRole('button', { name: 'Use rules for Message' }));
    await pick(within(message).getByLabelText('Based on'), /^score/);
    const msg = stepOf<AddAlertAction>(node.id).message;
    expect(msg).toBe('{{ (score) >= 50 ? "Fine" : "Fine" }}');

    await userEvent.click(within(value).getByRole('button', { name: 'Use rules for New value' }));
    await pick(within(value).getByLabelText('Based on'), /^score/);
    const otherwise = within(value).getByLabelText('Otherwise result');
    await userEvent.clear(otherwise);
    await userEvent.type(otherwise, 'High');
    const set = nodeById(node.id).events!.onClick[1] as SetStateAction;
    expect(parseRules(set.value)).toEqual({ subject: 'score', cases: [{ op: '>=', when: 50, then: 'Low' }], otherwise: 'High' });
    // Switching off keeps the "Otherwise" value as a plain value.
    await userEvent.click(within(value).getByRole('button', { name: 'Stop using rules for New value' }));
    expect((nodeById(node.id).events!.onClick[1] as SetStateAction).value).toBe('"High"');
  });

  it('runs in the preview', async () => {
    const alerts: Array<{ type: string; message: string }> = [];
    const state: Record<string, unknown> = { score: 91 };
    const host: ActionHost = {
      getProject: () => useEditor.getState().project as Project,
      getExtension: () => ext(),
      hasState: (n) => n in state,
      setState: (n, v) => {
        state[n] = v;
      },
      addAlert: (a) => alerts.push(a),
      log: () => undefined,
      openIframeModal: () => undefined,
      closeOverlay: () => undefined,
      runDataSource: async () => undefined,
      isActive: () => true,
    };
    await executeActions(
      [
        { id: 'a', type: 'addAlert', alertType: 'info', alertTypeExpr: '(score) >= 80 ? "success" : "warning"', title: '', message: '{{ (score) >= 80 ? "Great" : "Keep going" }}' },
        { id: 'b', type: 'setState', state: 'score', value: '(score) >= 80 ? 100 : 0' },
      ],
      { score: 91 },
      host,
    );
    expect(alerts).toEqual([expect.objectContaining({ type: 'success', message: 'Great' })]);
    expect(state.score).toBe(100);
  });
});

describe('rules of an alert type are code like any other', () => {
  it('are renamed with the variable they read, and validated', async () => {
    const { renameReferences, findUsages } = await import('../panels/findUsages');
    const { validateProject } = await import('../model/validate');
    loadWith([{ type: 'Button', text: 'Go' }], 'card', { state: [{ id: 's1', name: 'score', type: 'number', initial: 1 }] });
    const node = selectTop();
    useEditor.getState().setEvent(node.id, 'onClick', [
      { id: 'a1', type: 'addAlert', alertType: 'info', alertTypeExpr: '(score) >= 80 ? "success" : "warning"', title: '', message: 'm' },
    ]);
    expect(findUsages(ext(), 'score')).toHaveLength(1);
    useEditor.getState().commit((d) => {
      renameReferences(d.extensions[0] as never, 'score', 'points');
    });
    expect(stepOf<AddAlertAction>(node.id).alertTypeExpr).toBe('(points) >= 80 ? "success" : "warning"');
    const issues = validateProject(useEditor.getState().project).filter((i) => i.field === 'event:onClick');
    expect(issues.map((i) => i.rule)).toContain('unknown-name');
  });
});
