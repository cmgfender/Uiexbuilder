import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '../model/store';
import { Inspector } from '../inspector/Inspector';
import { ext, loadWith, nodeById, selectTop } from '../inspector/testUtils';
import { DataPanel } from '../panels/DataPanel';
import { ToastProvider } from '../ui';
import { parseShape, shapeToExpr } from './shape';

const DEALS = [
  { toObjectId: 1, properties: { dealname: 'Renewal', amount: '48000', closedate: '2026-09-21T00:00:00Z' } },
  { toObjectId: 2, properties: { dealname: 'Upgrade', amount: '12500', closedate: '2026-09-04T00:00:00Z' } },
  { toObjectId: 3, properties: { dealname: 'Pilot', amount: '7800', closedate: '' } },
];

function setup() {
  loadWith([{ type: 'Text', text: '{{ deal.properties.dealname }}', repeat: { items: 'deals', itemName: 'deal', indexName: 'index' } }], 'card', {
    dataSources: [
      { id: 'd1', kind: 'associations', name: 'deals', toObjectType: '0-3', properties: ['dealname', 'amount', 'closedate'], pageLength: 25 },
    ],
  });
  useEditor.getState().updateMock((m) => {
    m.dataSources.d1 = DEALS;
  });
  useEditor.setState({ past: [], future: [] });
}

const shapeOf = (name: string) => parseShape(ext().computed!.find((c) => c.name === name)!.expr)!;

describe('shaping a repeated list', () => {
  beforeEach(() => {
    setup();
    useEditor.setState({ rightPanel: 'advanced' });
  });

  it('filters, sorts, limits and formats the rows without code', async () => {
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(screen.getByRole('button', { name: /Filter, sort & limit/ }));
    expect(nodeById(node.id).repeat?.items).toBe('dealsView');
    expect(shapeOf('dealsView')).toEqual({ source: 'deals' });
    // Creating the list and repeating over it is one undo step.
    expect(useEditor.getState().past).toHaveLength(1);

    const editor = screen.getByRole('group', { name: 'dealsView: filter and sort' });
    expect(within(editor).getByText('3 of 3 rows right now')).toBeInTheDocument();

    await userEvent.selectOptions(within(editor).getByLabelText('Sort by'), 'amount');
    expect(shapeOf('dealsView').sort).toEqual({ field: ['properties', 'amount'], dir: 'desc', as: 'number' });

    await userEvent.selectOptions(within(editor).getByLabelText('How many rows'), 'first');
    const limit = within(editor).getByLabelText('Number of rows to show');
    await userEvent.clear(limit);
    await userEvent.type(limit, '2');
    expect(shapeOf('dealsView').limit).toBe(2);
    expect(within(editor).getByText('2 of 3 rows right now')).toBeInTheDocument();

    // The filter offers the rows' fields; CRM numbers compare as numbers.
    await userEvent.click(within(editor).getByRole('button', { name: 'Add a filter' }));
    const subject = within(editor).getByLabelText('Check 1: what to check');
    await userEvent.selectOptions(subject, within(subject).getByRole('option', { name: /^amount — “48000” in row 1/ }));
    expect(within(editor).getByLabelText('Check 1: comparison')).toHaveDisplayValue('is more than');
    await userEvent.clear(within(editor).getByLabelText('Check 1: value'));
    await userEvent.type(within(editor).getByLabelText('Check 1: value'), '10000');
    expect(shapeOf('dealsView').filter).toBe('Number(row.properties.amount) > 10000');

    await userEvent.click(within(editor).getByRole('button', { name: 'Format a field' }));
    expect(shapeOf('dealsView').formats).toEqual([
      { name: 'amountFormatted', field: ['properties', 'amount'], kind: 'currency', currency: 'USD' },
    ]);
    const table = within(editor).getByRole('table');
    expect(within(table).getAllByRole('row').map((r) => r.textContent)).toEqual([
      'dealnameamountamountFormatted',
      'Renewal48000$48,000',
      'Upgrade12500$12,500',
    ]);
    expect(within(editor).getByText('{{ deal.amountFormatted }}')).toBeInTheDocument();
  });

  it('is not offered for a nested list a computed value cannot see', async () => {
    useEditor.getState().updateNode(selectTop().id, { repeat: { items: 'deal.lineItems', itemName: 'li', indexName: 'i' } });
    render(<Inspector />);
    expect(screen.queryByRole('button', { name: /Filter, sort & limit/ })).toBeNull();
  });
});

describe('shaped lists in the Data panel', () => {
  beforeEach(setup);

  it('“Filter & sort” on a list source adds a shaped list and edits it under Computed', async () => {
    render(
      <ToastProvider>
        <DataPanel />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /^deals/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Filter & sort' }));
    expect(ext().computed?.map((c) => c.name)).toEqual(['dealsView']);
    const editor = await screen.findByRole('group', { name: 'dealsView: filter and sort' });
    await userEvent.selectOptions(within(editor).getByLabelText('Sort by'), 'dealname');
    expect(shapeOf('dealsView').sort).toEqual({ field: ['properties', 'dealname'], dir: 'desc', as: 'text' });
    // Again: opens the same list instead of adding another.
    await userEvent.click(screen.getByRole('button', { name: 'Filter & sort' }));
    expect(ext().computed).toHaveLength(1);

    // Code view and back.
    await userEvent.click(screen.getByRole('button', { name: 'dealsView: edit as code' }));
    expect(screen.getByLabelText('Expression of dealsView')).toHaveValue(shapeToExpr(shapeOf('dealsView')));
    await userEvent.click(screen.getByRole('button', { name: 'Use the list editor' }));
    expect(screen.getByRole('group', { name: 'dealsView: filter and sort' })).toBeInTheDocument();
  });

  it('the computed header adds a shaped list from a list', async () => {
    render(
      <ToastProvider>
        <DataPanel />
      </ToastProvider>,
    );
    await userEvent.click(screen.getAllByRole('button', { name: 'Filter or sort a list' })[0]);
    expect(ext().computed?.[0]).toMatchObject({ name: 'dealsView', expr: '[...(deals ?? [])]' });
  });
});
