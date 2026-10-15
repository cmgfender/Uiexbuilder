import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useEditor } from '../model/store';
import type { Issue } from '../model/validate';
import { Inspector } from './Inspector';
import { loadWith, selectTop } from './testUtils';

const issues: Issue[] = [];
vi.mock('../model/validate', () => ({
  validateProject: () => issues,
}));

describe('Node problems', () => {
  it('lists issues for the selected node and navigates to the related tab', async () => {
    loadWith([{ type: 'Button', text: 'Go' }, { type: 'Text', text: 'x' }]);
    const node = selectTop();
    issues.splice(
      0,
      issues.length,
      { id: 'a', severity: 'warning', message: 'On click does nothing', rule: 'r', nodeId: node.id, field: 'event:onClick' },
      { id: 'b', severity: 'error', message: 'Variant is invalid', rule: 'r', nodeId: node.id, field: 'variant' },
      { id: 'c', severity: 'error', message: 'Other node problem', rule: 'r', nodeId: 'n_other' },
    );
    render(<Inspector />);
    const list = screen.getByRole('list', { name: 'Problems with this component' });
    const items = list.querySelectorAll('button');
    // Errors first, other nodes' issues excluded.
    expect(Array.from(items).map((b) => b.textContent)).toEqual(['Variant is invalid', 'On click does nothing']);
    expect(items[0]).toHaveClass('is-error');
    await userEvent.click(screen.getByRole('button', { name: 'On click does nothing' }));
    expect(useEditor.getState().rightPanel).toBe('events');
  });
});
