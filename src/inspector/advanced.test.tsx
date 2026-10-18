import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '../model/store';
import { repeatPresets } from './AdvancedTab';
import { nodeJsx } from './clipboard';
import { Inspector } from './Inspector';
import { ext, loadWith, nodeById, selectTop } from './testUtils';

describe('Advanced tab', () => {
  beforeEach(() => {
    loadWith([{ type: 'Text', text: 'Hi {{ count }}' }], 'card', {
      state: [
        { id: 's1', name: 'count', type: 'number', initial: 0 },
        { id: 's2', name: 'items', type: 'array', initial: ['a', 'b', 'c'] },
      ],
      dataSources: [{ id: 'd1', name: 'record', kind: 'crmProperties', properties: ['firstname'] }],
    });
    useEditor.setState({ rightPanel: 'advanced' });
  });

  it('sets a condition with live result and presets', async () => {
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(screen.getByRole('button', { name: 'Show when: edit as code' }));
    const input = screen.getByLabelText('Visibility condition');
    fireEvent.change(input, { target: { value: 'count > 0' } });
    expect(nodeById(node.id).condition).toBe('count > 0');
    expect(screen.getByText('Currently: hidden')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'count === 0' } });
    expect(screen.getByText('Currently: shown')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Condition presets'), 'while record is loading');
    expect(nodeById(node.id).condition).toBe('recordLoading');
    // The tab shows a dot when a condition is set.
    expect(screen.getByRole('tab', { name: /Advanced/ }).querySelector('.ub-insp-tabdot')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Visibility condition'), { target: { value: '' } });
    expect(nodeById(node.id).condition).toBeUndefined();
  });

  it('configures a repeat with validated identifiers and a live count', async () => {
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(screen.getByRole('checkbox', { name: /Repeat for each item/ }));
    expect(nodeById(node.id).repeat).toEqual({ items: 'items', itemName: 'item', indexName: 'index' });
    expect(screen.getByText('3 items right now')).toBeInTheDocument();
    const itemName = screen.getByLabelText('Item name');
    await userEvent.clear(itemName);
    await userEvent.type(itemName, 'count');
    expect(screen.getByText(/already used/)).toBeInTheDocument();
    expect(nodeById(node.id).repeat?.itemName).not.toBe('count');
    await userEvent.clear(itemName);
    await userEvent.type(itemName, 'row');
    expect(nodeById(node.id).repeat?.itemName).toBe('row');
    fireEvent.change(screen.getByLabelText('Repeat items'), { target: { value: 'count' } });
    expect(screen.getByText(/Not a list/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: /Repeat for each item/ }));
    expect(nodeById(node.id).repeat).toBeUndefined();
  });

  it('toggles designer flags', async () => {
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(screen.getByRole('checkbox', { name: /Hidden in designer/ }));
    expect(nodeById(node.id).hiddenInDesigner).toBe(true);
    await userEvent.click(screen.getByRole('checkbox', { name: /Locked/ }));
    expect(nodeById(node.id).locked).toBe(true);
    await userEvent.click(screen.getByRole('checkbox', { name: /Locked/ }));
    expect(nodeById(node.id).locked).toBeUndefined();
    expect(within(screen.getByText('Node id').parentElement!).getByText(node.id)).toBeInTheDocument();
  });
});

describe('Copy JSX', () => {
  it('generates JSX for a single node', () => {
    loadWith([
      { type: 'Button', props: { variant: 'primary' }, text: 'Save' },
      { type: 'Text', text: 'Other' },
    ]);
    const node = selectTop();
    const jsx = nodeJsx(useEditor.getState().project, ext(), node.id);
    expect(jsx).toContain('<Button');
    expect(jsx).toContain('Save');
    expect(jsx).not.toContain('Other');
  });
});

describe('repeat sources', () => {
  it('prefer a computed list derived from another list and include array data', () => {
    loadWith([], 'card', {
      state: [
        { id: 's1', name: 'items', type: 'array', initial: [] },
        { id: 's2', name: 'search', type: 'string', initial: '' },
      ],
      computed: [
        { id: 'c0', name: 'letters', expr: "['a']" },
        { id: 'c1', name: 'filtered', expr: 'items.filter((i) => matches(i, search))' },
        { id: 'c2', name: 'title', expr: "'x'" },
      ],
      dataSources: [
        { id: 'd1', name: 'api', kind: 'fetch', url: 'https://x.test', method: 'GET', runOnMount: true },
        { id: 'd2', name: 'single', kind: 'fetch', url: 'https://x.test/1', method: 'GET', runOnMount: true },
      ],
    });
    const scope = { items: [], search: '', letters: ['a'], filtered: [], title: 'x', api: [{ id: 1 }], single: { id: 1 } };
    expect(repeatPresets(ext(), scope).map((p) => p.expr)).toEqual(['filtered', 'items', 'api ?? []', 'letters']);
    // Without live values only declared lists are known.
    expect(repeatPresets(ext()).map((p) => p.expr)).toEqual(['items']);
  });

  it('a new repeat defaults to the filtered list', async () => {
    loadWith([{ type: 'Text', text: 'Row' }], 'card', {
      state: [
        { id: 's1', name: 'items', type: 'array', initial: ['apple', 'banana'] },
        { id: 's2', name: 'search', type: 'string', initial: 'an' },
      ],
      computed: [{ id: 'c1', name: 'filtered', expr: 'items.filter((i) => i.includes(search))' }],
    });
    useEditor.setState({ rightPanel: 'advanced' });
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(screen.getByRole('checkbox', { name: /Repeat for each item/ }));
    expect(nodeById(node.id).repeat?.items).toBe('filtered');
    expect(screen.getByText('1 item right now')).toBeInTheDocument();
    const chips = within(screen.getByLabelText('Lists')).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['filtered', 'items']);
  });
});
