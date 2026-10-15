import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Extension } from '../model/types';
import { ExpressionInput, TemplateInput, VariablePicker } from './controls';
import { ext, focusLikeBrowser, loadWith } from './testUtils';

function setup(): Extension {
  loadWith([], 'card', {
    state: [
      { id: 's1', name: 'count', type: 'number', initial: 2 },
      { id: 's2', name: 'contacts', type: 'array', initial: [] },
    ],
    dataSources: [{ id: 'd1', name: 'record', kind: 'crmProperties', properties: ['firstname'] }],
  });
  return ext();
}

function Expr({
  e,
  initial = '',
  statements,
  eventParams,
}: {
  e: Extension;
  initial?: string;
  statements?: boolean;
  eventParams?: string[];
}) {
  const [v, setV] = useState(initial);
  return (
    <>
      <ExpressionInput
        value={v}
        onChange={setV}
        ext={e}
        aria-label="expr"
        statements={statements}
        multiline={statements}
        eventParams={eventParams}
      />
      <output data-testid="value">{v}</output>
    </>
  );
}

function Tpl({
  e,
  initial = '',
  replaceableText,
  eventParams,
}: {
  e: Extension;
  initial?: string;
  replaceableText?: string;
  eventParams?: string[];
}) {
  const [v, setV] = useState(initial);
  return (
    <>
      <TemplateInput value={v} onChange={setV} ext={e} aria-label="tpl" replaceableText={replaceableText} eventParams={eventParams} />
      <output data-testid="value">{v}</output>
    </>
  );
}

describe('ExpressionInput', () => {
  let e: Extension;
  beforeEach(() => {
    e = setup();
  });

  it('autocompletes with the keyboard (type, ArrowDown, Enter)', async () => {
    render(<Expr e={e} />);
    const input = screen.getByLabelText('expr');
    await userEvent.type(input, 'co');
    const list = screen.getByRole('listbox');
    const options = within(list).getAllByRole('option');
    expect(options[0]).toHaveTextContent('count');
    expect(options[1]).toHaveTextContent('contacts');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('value')).toHaveTextContent('contacts');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('completes paths after a dot and accepts with Tab; Escape closes', async () => {
    render(<Expr e={e} />);
    const input = screen.getByLabelText('expr');
    await userEvent.type(input, 'record.');
    expect(within(screen.getByRole('listbox')).getAllByRole('option')[0]).toHaveTextContent('record.firstname');
    await userEvent.keyboard('{Tab}');
    expect(screen.getByTestId('value')).toHaveTextContent('record.firstname');
    await userEvent.type(input, ' + cou');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByTestId('value')).toHaveTextContent('record.firstname + cou');
  });

  it('ArrowUp wraps and clicking an option inserts it', async () => {
    render(<Expr e={e} initial="" />);
    const input = screen.getByLabelText('expr');
    await userEvent.type(input, 'context.user.f');
    await userEvent.keyboard('{ArrowUp}');
    const opts = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(opts[opts.length - 1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.mouseDown(within(screen.getByRole('listbox')).getByText('context.user.firstName'));
    expect(screen.getByTestId('value')).toHaveTextContent(/^context\.user\.firstName$/);
  });

  it('shows a live value preview and syntax errors', async () => {
    render(<Expr e={e} initial="count * 10" />);
    expect(await screen.findByText('= 20')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('expr'), { target: { value: 'count +' } });
    expect(await screen.findByText(/Syntax error/, undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByLabelText('expr')).toHaveAttribute('aria-invalid', 'true');
  });

  it('inserts from the variable picker', async () => {
    render(<Expr e={e} initial="1 + " />);
    const input = screen.getByLabelText('expr') as HTMLInputElement;
    input.setSelectionRange(4, 4);
    await userEvent.click(screen.getByRole('button', { name: 'Insert variable' }));
    const search = screen.getByLabelText('Search variables');
    await userEvent.type(search, 'cou');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('value')).toHaveTextContent('1 + count');
  });

  it('offers custom-code globals and setters in statements mode', async () => {
    render(<Expr e={e} statements />);
    const input = screen.getByLabelText('expr');
    await userEvent.type(input, 'actions.add');
    expect(within(screen.getByRole('listbox')).getByText('actions.addAlert')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await userEvent.clear(input);
    await userEvent.type(input, 'setC');
    expect(within(screen.getByRole('listbox')).getByText('setCount')).toBeInTheDocument();
  });

  it('suggests event params in handlers', async () => {
    render(<Expr e={e} eventParams={['value']} />);
    await userEvent.type(screen.getByLabelText('expr'), 'val');
    expect(within(screen.getByRole('listbox')).getAllByRole('option')[0]).toHaveTextContent('value');
  });
});

describe('TemplateInput', () => {
  let e: Extension;
  beforeEach(() => {
    e = setup();
  });

  it('opens autocomplete after {{ and wraps the insertion', async () => {
    render(<Tpl e={e} />);
    const input = screen.getByLabelText('tpl');
    await userEvent.type(input, 'Total: {{{{');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await userEvent.type(input, 'cou');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('value')).toHaveTextContent('Total: {{ count }}');
  });

  it('shows no "not defined" preview for event parameters (they exist when the action runs)', async () => {
    render(<Tpl e={e} initial="{{ error.message }}" eventParams={['event', 'error']} />);
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByText(/not defined/)).toBeNull();
    // Other unknown names still report their error.
    fireEvent.change(screen.getByLabelText('tpl'), { target: { value: '{{ nope }}' } });
    expect(await screen.findByText(/nope is not defined/)).toBeInTheDocument();
  });

  it('does not autocomplete plain text and previews interpolation', async () => {
    render(<Tpl e={e} initial="Count is {{ count }}!" />);
    expect(await screen.findByText('Count is 2!')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('tpl'), ' co');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('picker inserts {{ name }} at the cursor', async () => {
    render(<Tpl e={e} initial="Hi " />);
    const input = screen.getByLabelText('tpl') as HTMLInputElement;
    input.setSelectionRange(3, 3);
    await userEvent.click(screen.getByRole('button', { name: 'Insert {{ variable }}' }));
    await userEvent.click(within(screen.getByRole('listbox', { name: 'Variables' })).getByText('context.user.firstName'));
    expect(screen.getByTestId('value')).toHaveTextContent('Hi {{ context.user.firstName }}');
  });
});

describe('VariablePicker', () => {
  it('groups variables by kind and filters by search', async () => {
    const e = setup();
    const picked: string[] = [];
    render(<VariablePicker ext={e} onPick={(n) => picked.push(n)} hideSetters />);
    await userEvent.click(screen.getByRole('button', { name: 'Insert variable' }));
    const list = screen.getByRole('listbox', { name: 'Variables' });
    expect(within(list).getByRole('group', { name: 'State' })).toBeInTheDocument();
    expect(within(list).getByRole('group', { name: 'Record properties' })).toBeInTheDocument();
    expect(within(list).queryByRole('group', { name: 'Setters' })).toBeNull();
    await userEvent.type(screen.getByLabelText('Search variables'), 'firstn');
    await waitFor(() => expect(within(list).queryByRole('group', { name: 'State' })).toBeNull());
    await userEvent.keyboard('{Enter}');
    expect(picked).toEqual(['record.firstname']);
    act(() => undefined);
  });
});

describe('object completions in templates', () => {
  it('keeps the caret inside {{ }} after accepting an object so members can follow', async () => {
    const e = setup();
    render(<Tpl e={e} />);
    const input = screen.getByLabelText('tpl') as HTMLInputElement;
    await userEvent.type(input, '{{{{ rec');
    expect(within(screen.getByRole('listbox')).getAllByRole('option')[0]).toHaveTextContent('record');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('value').textContent).toBe('{{ record }}');
    expect(input.selectionStart).toBe(9);
    await userEvent.keyboard('.fi');
    expect(screen.getByTestId('value').textContent).toBe('{{ record.fi }}');
    expect(within(screen.getByRole('listbox')).getAllByRole('option')[0]).toHaveTextContent('record.firstname');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('value').textContent).toBe('{{ record.firstname }}');
    // A leaf value closes the segment: the caret is after the braces.
    expect(input.selectionStart).toBe(22);
  });

  it('closes the segment after a leaf value', async () => {
    const e = setup();
    render(<Tpl e={e} />);
    const input = screen.getByLabelText('tpl') as HTMLInputElement;
    await userEvent.type(input, '{{{{ cou');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('value').textContent).toBe('{{ count }}');
    expect(input.selectionStart).toBe(11);
  });
});

describe('variable picker insertion in text', () => {
  it('replaces the untouched default text, otherwise separates the variable with a space', async () => {
    const e = setup();
    render(<Tpl e={e} initial="Heading" replaceableText="Heading" />);
    const input = screen.getByLabelText('tpl') as HTMLInputElement;
    input.setSelectionRange(7, 7);
    await userEvent.click(screen.getByRole('button', { name: 'Insert {{ variable }}' }));
    await userEvent.click(within(screen.getByRole('listbox', { name: 'Variables' })).getByText('record.firstname'));
    expect(screen.getByTestId('value').textContent).toBe('{{ record.firstname }}');
    // Edited text: insert at the caret with a separating space.
    fireEvent.change(input, { target: { value: 'Hello' } });
    input.setSelectionRange(5, 5);
    await userEvent.click(screen.getByRole('button', { name: 'Insert {{ variable }}' }));
    await userEvent.click(within(screen.getByRole('listbox', { name: 'Variables' })).getByText('count'));
    expect(screen.getByTestId('value').textContent).toBe('Hello {{ count }}');
  });
});

describe('keyboard access to pickers', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = focusLikeBrowser();
    return () => restore();
  });

  it('opening moves focus to the search; arrows + Enter pick; Escape closes and refocuses the trigger', async () => {
    const e = setup();
    const picked: string[] = [];
    render(<VariablePicker ext={e} onPick={(n) => picked.push(n)} hideSetters />);
    const trigger = screen.getByRole('button', { name: 'Insert variable' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Variables in scope' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search variables')).toHaveFocus();
    // count, contacts (state) ...
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(picked).toEqual(['contacts']);

    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByLabelText('Search variables')).toHaveFocus();
    // Escape is consumed by the picker: window (global shortcuts: deselect) never sees it.
    const globalKeys = vi.fn();
    window.addEventListener('keydown', globalKeys);
    await userEvent.keyboard('{Escape}');
    window.removeEventListener('keydown', globalKeys);
    expect(screen.queryByLabelText('Search variables')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(globalKeys).not.toHaveBeenCalled();
  });
});

describe('ARIA roles of expression fields', () => {
  it('single-line fields are comboboxes; multi-line fields stay textboxes', async () => {
    const e = setup();
    const { unmount } = render(<Expr e={e} />);
    const input = screen.getByLabelText('expr');
    expect(input).toHaveAttribute('role', 'combobox');
    expect(input).toHaveAttribute('aria-expanded', 'false');
    unmount();

    render(<Expr e={e} statements />);
    const area = screen.getByLabelText('expr');
    expect(area.tagName).toBe('TEXTAREA');
    expect(area).not.toHaveAttribute('role');
    expect(area).not.toHaveAttribute('aria-expanded');
    expect(area).toHaveAttribute('aria-autocomplete', 'list');
    await userEvent.type(area, 'cou');
    const list = screen.getByRole('listbox');
    expect(area).toHaveAttribute('aria-controls', list.id);
    expect(area.getAttribute('aria-activedescendant')).toBe(`${list.id}-0`);
  });
});
