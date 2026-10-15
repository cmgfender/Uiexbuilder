import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { createExtension, createProject } from '../model/factory';
import { selectActiveExtension, useEditor } from '../model/store';
import { ToastProvider } from '../ui';
import { CodeEditor } from './CodeEditor';
import { ComputedSection, HelpersSection } from './sections';
import { usePowerUi } from './uiStore';

const ext = () => selectActiveExtension(useEditor.getState());

beforeEach(() => {
  const card = createExtension({ name: 'Card', content: [{ type: 'Text', name: 'label', text: 'Total {{ total }}' }] });
  card.state = [{ id: 's1', name: 'count', type: 'number', initial: 4 }];
  useEditor.getState().loadProject(createProject('Sections', [card]));
});

const renderComputed = () =>
  render(
    <ToastProvider>
      <ComputedSection />
    </ToastProvider>,
  );

describe('ComputedSection', () => {
  it('shows an empty state and adds a computed value with its name focused', async () => {
    const user = userEvent.setup();
    renderComputed();
    expect(screen.getByText('No computed values')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add a computed value' }));
    expect(ext().computed).toHaveLength(1);
    const name = screen.getByLabelText('Name');
    expect(name).toHaveValue('computed');
    expect(name).toHaveFocus();
  });

  it('edits the expression and shows the live value', async () => {
    const user = userEvent.setup();
    useEditor.getState().addComputed({ name: 'total', expr: '' });
    renderComputed();
    await user.click(screen.getByRole('button', { name: /total/ }));
    const expr = screen.getByLabelText('Expression of total');
    await user.type(expr, 'count * 10');
    expect(ext().computed![0].expr).toBe('count * 10');
    expect(screen.getByText('Value now').nextSibling).toHaveTextContent('40');
    // Collapsed header shows the value too.
    await user.click(screen.getByRole('button', { name: /total/, expanded: true }));
    expect(screen.getByText('= 40')).toBeInTheDocument();
  });

  it('shows evaluation errors', async () => {
    const user = userEvent.setup();
    useEditor.getState().addComputed({ name: 'bad', expr: 'nope.value' });
    renderComputed();
    expect(screen.getByText('error')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /bad/ }));
    expect(screen.getByText(/nope is not defined/)).toBeInTheDocument();
  });

  it('renames with validation and updates references', async () => {
    const user = userEvent.setup();
    useEditor.getState().addComputed({ name: 'total', expr: 'count' });
    renderComputed();
    await user.click(screen.getByRole('button', { name: /total/ }));
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'count');
    expect(screen.getByText(/Already used by state variable/)).toBeInTheDocument();
    await user.clear(name);
    await user.type(name, 'sum{Enter}');
    expect(ext().computed![0].name).toBe('sum');
    const label = Object.values(ext().nodes).find((n) => n.name === 'label')!;
    expect(label.text).toBe('Total {{ sum }}');
    expect(await screen.findByText(/updated 1 reference/)).toBeInTheDocument();
  });

  it('refuses a new name that a local name would capture where the value is used', async () => {
    const user = userEvent.setup();
    const card = createExtension({
      name: 'Card',
      content: [{ type: 'Input', name: 'inp', props: { label: 'N', name: 'n' }, events: { onChange: [{ id: 'a1', type: 'log', level: 'info', message: '{{ total }}' }] } }],
    });
    useEditor.getState().loadProject(createProject('Sections', [card]));
    useEditor.getState().addComputed({ name: 'total', expr: '1' });
    renderComputed();
    await user.click(screen.getByRole('button', { name: /total/ }));
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'value');
    expect(screen.getByText(/“value” already means something else/)).toBeInTheDocument();
    await user.type(name, '{Enter}');
    expect(ext().computed![0].name).toBe('total');
  });

  it('reorders, edits the description and deletes (confirming when used)', async () => {
    const user = userEvent.setup();
    useEditor.getState().addComputed({ name: 'a', expr: '1' });
    useEditor.getState().addComputed({ name: 'total', expr: '2' });
    renderComputed();
    const items = screen.getAllByRole('listitem');
    await user.click(within(items[0]).getByRole('button', { name: 'Move down' }));
    expect(ext().computed!.map((c) => c.name)).toEqual(['total', 'a']);
    expect(within(screen.getAllByRole('listitem')[0]).getByRole('button', { name: 'Move up' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /^total/ }));
    await user.type(screen.getByLabelText('Description'), 'Sum');
    expect(ext().computed![0].description).toBe('Sum');

    // `total` is used by the Text node: deleting asks first.
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('is used in 1 place');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(ext().computed).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete anyway' }));
    expect(ext().computed!.map((c) => c.name)).toEqual(['a']);
  });

  it('expands and focuses a computed value requested by the command palette', async () => {
    renderComputed();
    let id = '';
    act(() => {
      id = useEditor.getState().addComputed({ name: 'fromPalette' }).id;
      usePowerUi.getState().revealComputed(id);
    });
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus());
    expect(usePowerUi.getState().revealComputedId).toBeNull();
  });
});

describe('HelpersSection', () => {
  const renderHelpers = () =>
    render(
      <ToastProvider>
        <HelpersSection />
      </ToastProvider>,
    );

  it('starts collapsed while empty; inserting examples expands it and lists the helper names', async () => {
    const user = userEvent.setup();
    renderHelpers();
    expect(screen.queryByLabelText('Helper code')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Helpers/ }));
    await user.click(screen.getByRole('button', { name: 'Insert examples' }));
    expect(ext().helpers).toContain('function formatMoney');
    await waitFor(() => expect(screen.getByText('formatMoney')).toBeInTheDocument());
    expect(screen.getByText('daysUntil')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Insert example helpers' }));
    expect(await screen.findByText('The example helpers are already there')).toBeInTheDocument();
  });

  it('the header action inserts examples and expands a collapsed section', async () => {
    const user = userEvent.setup();
    renderHelpers();
    await user.click(screen.getByRole('button', { name: 'Insert example helpers' }));
    expect(screen.getByLabelText('Helper code')).toHaveValue(ext().helpers);
  });

  it('edits code with a syntax check', async () => {
    useEditor.getState().setHelpers('// my helpers');
    renderHelpers();
    const editor = screen.getByLabelText('Helper code');
    fireEvent.change(editor, { target: { value: 'function f( {' } });
    expect(ext().helpers).toBe('function f( {');
    expect(await screen.findByText(/Syntax error/)).toBeInTheDocument();
    expect(editor).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(editor, { target: { value: 'const rate: number = 2;\nfunction twice(v) { return v * rate; }' } });
    await waitFor(() => expect(screen.getByText('twice')).toBeInTheDocument());
    expect(screen.getByText('rate')).toBeInTheDocument();
    expect(screen.queryByText(/Syntax error/)).toBeNull();
  });

  it('indents with Tab and lets Escape + Tab leave the editor', () => {
    useEditor.getState().setHelpers('a');
    renderHelpers();
    const editor = screen.getByLabelText('Helper code') as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(0, 0);
    fireEvent.keyDown(editor, { key: 'Tab' });
    expect(ext().helpers).toBe('  a');
    fireEvent.keyDown(editor, { key: 'Escape' });
    const ev = fireEvent.keyDown(editor, { key: 'Tab' });
    expect(ev).toBe(true); // not prevented
    expect(ext().helpers).toBe('  a');
  });
});

describe('HelpersSection: focus requests and the large editor', () => {
  const renderHelpers = () =>
    render(
      <ToastProvider>
        <input aria-label="Elsewhere" />
        <HelpersSection />
      </ToastProvider>,
    );

  it('expands, focuses the editor for a pending request (made before the panel mounted) and handles it once', async () => {
    usePowerUi.getState().focusHelpers();
    const view = renderHelpers();
    await waitFor(() => expect(screen.getByLabelText('Helper code')).toHaveFocus());
    expect(usePowerUi.getState().helpersFocusPending).toBe(false);
    // Re-mounting the Data panel later does not steal focus again.
    view.unmount();
    renderHelpers();
    screen.getByLabelText('Elsewhere').focus();
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByLabelText('Elsewhere')).toHaveFocus();
  });

  it('focuses the editor when asked while mounted and collapsed (the code is empty)', async () => {
    renderHelpers();
    expect(screen.queryByLabelText('Helper code')).toBeNull();
    screen.getByLabelText('Elsewhere').focus();
    act(() => usePowerUi.getState().focusHelpers());
    await waitFor(() => expect(screen.getByLabelText('Helper code')).toHaveFocus());
  });

  it('opens the helpers in a large highlighted editor bound to the same code', async () => {
    const user = userEvent.setup();
    useEditor.getState().setHelpers('const rate = 2;');
    renderHelpers();
    const opener = screen.getByRole('button', { name: 'Open helpers in a large editor' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: /Helper functions/ });
    const editor = within(dialog).getByLabelText('Helper code (large editor)');
    expect(editor).toHaveFocus();
    expect(editor).toHaveValue('const rate = 2;');
    // Highlighted copy with line numbers.
    expect(dialog.querySelector('.ub-pw-ed__hl .token.keyword')).not.toBeNull();
    fireEvent.change(editor, { target: { value: 'const rate = 3;\nfunction twice(v: number) { return v * rate; }' } });
    expect(ext().helpers).toBe('const rate = 3;\nfunction twice(v: number) { return v * rate; }');
    expect(dialog.querySelector('.ub-pw-ed__gutter')?.textContent).toBe('1\n2');
    await waitFor(() => expect(within(dialog).getByText('twice')).toBeInTheDocument());
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByLabelText('Helper code')).toHaveValue(ext().helpers);
    expect(opener).toHaveFocus();
  });
});

describe('ComputedSection: large editor', () => {
  it('edits the expression in a large editor with the live value', async () => {
    const user = userEvent.setup();
    useEditor.getState().addComputed({ name: 'total', expr: 'count' });
    renderComputed();
    await user.click(screen.getByRole('button', { name: /total/ }));
    await user.click(screen.getByRole('button', { name: 'Open total in a large editor' }));
    const dialog = screen.getByRole('dialog', { name: /Computed value/ });
    const editor = within(dialog).getByLabelText('Expression of total (large editor)');
    expect(editor).toHaveFocus();
    await user.type(editor, ' * 3');
    expect(ext().computed![0].expr).toBe('count * 3');
    expect(within(dialog).getByText('Value now').nextSibling).toHaveTextContent('12');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('handleCodeKeyDown', () => {
  function Editor() {
    const code = useEditor((s) => selectActiveExtension(s).helpers ?? '');
    return <CodeEditor aria-label="Code" value={code} onChange={(v) => useEditor.getState().setHelpers(v)} />;
  }

  it('keeps indentation on Enter, indents after an opening bracket and outdents a closing one', async () => {
    useEditor.getState().setHelpers('function f() {');
    render(<Editor />);
    const editor = screen.getByLabelText('Code') as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(14, 14);
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(ext().helpers).toBe('function f() {\n  ');
    await waitFor(() => expect(editor.selectionStart).toBe(17));
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(ext().helpers).toBe('function f() {\n  \n  ');
    await waitFor(() => expect(editor.selectionStart).toBe(20));
    fireEvent.keyDown(editor, { key: '}' });
    expect(ext().helpers).toBe('function f() {\n  \n}');
    // Shift+Tab outdents the selected lines.
    editor.setSelectionRange(0, editor.value.length);
    fireEvent.keyDown(editor, { key: 'Tab' });
    expect(ext().helpers).toBe('  function f() {\n    \n  }');
    editor.setSelectionRange(0, editor.value.length);
    fireEvent.keyDown(editor, { key: 'Tab', shiftKey: true });
    expect(ext().helpers).toBe('function f() {\n  \n}');
  });
});
