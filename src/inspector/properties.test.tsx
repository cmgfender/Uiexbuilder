import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '../model/store';
import type { CloseOverlayAction } from '../model/types';
import { Inspector } from './Inspector';
import { confirmModalTemplate } from './overlayPresets';
import { ext, focusLikeBrowser, loadWith, nodeById, selectTop } from './testUtils';

function row(name: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-prop="${name}"]`);
  if (!el) throw new Error(`prop row ${name} not found`);
  return el;
}

describe('Properties tab', () => {
  beforeEach(() => {
    loadWith([]);
  });

  it('edits text content through the template input', async () => {
    loadWith([{ type: 'Text', text: 'Hi' }]);
    const node = selectTop();
    render(<Inspector />);
    const input = screen.getByLabelText('Text content');
    await userEvent.clear(input);
    await userEvent.type(input, 'Hello world');
    expect(nodeById(node.id).text).toBe('Hello world');
  });

  it('enum select stores values and unsets the HubSpot default', async () => {
    loadWith([{ type: 'Flex', props: { justify: 'center' }, children: [] }]);
    const node = selectTop();
    render(<Inspector />);
    const select = within(row('justify')).getByRole('combobox');
    await userEvent.selectOptions(select, within(select).getByRole('option', { name: 'Space between' }));
    expect(nodeById(node.id).props.justify).toBe('between');
    await userEvent.selectOptions(select, within(select).getByRole('option', { name: 'Start (default)' }));
    expect(nodeById(node.id).props).not.toHaveProperty('justify');
  });

  it('color choices show swatches as a radio group and unset the HubSpot default', async () => {
    loadWith([{ type: 'Button', props: { variant: 'primary' }, text: 'Go' }]);
    const node = selectTop();
    render(<Inspector />);
    const group = within(row('variant')).getByRole('radiogroup', { name: 'Style' });
    expect(within(group).getByRole('radio', { name: /Primary/ })).toBeChecked();
    expect(group.querySelectorAll('.ub-insp-swatch')).toHaveLength(4);
    await userEvent.click(within(group).getByRole('radio', { name: /Destructive/ }));
    expect(nodeById(node.id).props.variant).toBe('destructive');
    await userEvent.click(within(group).getByRole('radio', { name: /Secondary/ }));
    expect(nodeById(node.id).props).not.toHaveProperty('variant');
    // The exact HubSpot prop name stays visible next to the plain label.
    expect(within(row('variant')).getByText('variant')).toHaveClass('ub-insp-propname');
  });

  it('spacing and direction choices are radio groups with short, labelled options', async () => {
    loadWith([{ type: 'Flex', props: { direction: 'column', gap: 'small' }, children: [] }]);
    const node = selectTop();
    render(<Inspector />);
    const gap = within(row('gap')).getByRole('radiogroup', { name: 'Space between' });
    expect(within(gap).getByRole('radio', { name: 'S (small)' })).toBeChecked();
    await userEvent.click(within(gap).getByRole('radio', { name: 'L (large)' }));
    expect(nodeById(node.id).props.gap).toBe('large');
    const arrange = within(row('direction')).getByRole('radiogroup', { name: 'Arrange' });
    await userEvent.click(within(arrange).getByRole('radio', { name: /Side by side/ }));
    // Side by side is HubSpot's default: the prop is removed.
    expect(nodeById(node.id).props).not.toHaveProperty('direction');
  });

  it('segmented enum marks the default and stores choices', async () => {
    loadWith([{ type: 'Text', text: 'x' }]);
    const node = selectTop();
    render(<Inspector />);
    const group = within(row('variant')).getByRole('group');
    expect(within(group).getByRole('button', { name: /Body text/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(group).getByRole('button', { name: /Microcopy/ }));
    expect(nodeById(node.id).props.variant).toBe('microcopy');
    await userEvent.click(within(group).getByRole('button', { name: /Body text/ }));
    expect(nodeById(node.id).props).not.toHaveProperty('variant');
  });

  it('number fields store numbers and unset when cleared', async () => {
    loadWith([{ type: 'Image', props: { src: 'https://example.com/a.png' } }]);
    const node = selectTop();
    render(<Inspector />);
    const input = within(row('width')).getByRole('spinbutton');
    await userEvent.type(input, '120');
    expect(nodeById(node.id).props.width).toBe(120);
    await userEvent.clear(input);
    expect(nodeById(node.id).props).not.toHaveProperty('width');
  });

  it('boolean switch shows the default and only stores non-default values', async () => {
    loadWith([{ type: 'Text', text: 'x' }]);
    const node = selectTop();
    render(<Inspector />);
    const sw = within(row('inline')).getByRole('checkbox');
    expect(sw).not.toBeChecked();
    await userEvent.click(sw);
    expect(nodeById(node.id).props.inline).toBe(true);
    await userEvent.click(sw);
    expect(nodeById(node.id).props).not.toHaveProperty('inline');
  });

  it('object props store only the fields that are set', async () => {
    loadWith([{ type: 'Text', text: 'x' }]);
    const node = selectTop();
    render(<Inspector />);
    const format = row('format');
    const weight = within(format).getByRole('group', { name: 'Font weight' });
    await userEvent.click(within(weight).getByRole('button', { name: /^Bold/ }));
    expect(nodeById(node.id).props.format).toEqual({ fontWeight: 'bold' });
    await userEvent.click(within(format).getByRole('checkbox'));
    expect(nodeById(node.id).props.format).toEqual({ fontWeight: 'bold', italic: true });
    const transform = within(format).getByRole('combobox', { name: 'Capitals' });
    await userEvent.selectOptions(transform, 'UPPERCASE');
    expect(nodeById(node.id).props.format).toEqual({ fontWeight: 'bold', italic: true, textTransform: 'uppercase' });
    await userEvent.selectOptions(transform, 'None (default)');
    await userEvent.click(within(weight).getByRole('button', { name: /^Regular/ }));
    await userEvent.click(within(format).getByRole('checkbox'));
    expect(nodeById(node.id).props).not.toHaveProperty('format');
  });

  it('options editor adds, edits, reorders and removes options', async () => {
    loadWith([{ type: 'Select', props: { label: 'Pick', name: 'pick', options: [{ label: 'One', value: 'one' }] } }]);
    const node = selectTop();
    render(<Inspector />);
    const opts = row('options');
    await userEvent.click(within(opts).getByRole('button', { name: 'Add option' }));
    expect(nodeById(node.id).props.options).toEqual([
      { label: 'One', value: 'one' },
      { label: 'Option 2', value: 'option_2' },
    ]);
    const label2 = within(opts).getByLabelText('Option 2 label');
    await userEvent.clear(label2);
    await userEvent.type(label2, 'Two words');
    expect((nodeById(node.id).props.options as unknown[])[1]).toEqual({ label: 'Two words', value: 'two_words' });
    await userEvent.click(within(opts).getAllByRole('button', { name: 'Move up' })[1]);
    expect((nodeById(node.id).props.options as Array<{ value: string }>).map((o) => o.value)).toEqual(['two_words', 'one']);
    await userEvent.click(within(opts).getByRole('button', { name: 'Remove option One' }));
    expect(nodeById(node.id).props.options).toEqual([{ label: 'Two words', value: 'two_words' }]);
  });

  it('options bulk entry replaces the list', async () => {
    loadWith([{ type: 'Select', props: { label: 'Pick', name: 'pick', options: [] } }]);
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(within(row('options')).getByRole('button', { name: 'Paste lines' }));
    const ta = screen.getByLabelText('Options, one per line');
    fireEvent.change(ta, { target: { value: 'Red\nGreen | g' } });
    await userEvent.click(screen.getByRole('button', { name: 'Apply 2 options' }));
    expect(nodeById(node.id).props.options).toEqual([
      { label: 'Red', value: 'red' },
      { label: 'Green', value: 'g' },
    ]);
  });

  it('fx toggle converts literal <-> expression', async () => {
    loadWith([{ type: 'Button', props: { variant: 'primary' }, text: 'Go' }]);
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(within(row('variant')).getByRole('button', { name: /Use an expression for Style/ }));
    expect(nodeById(node.id).props.variant).toEqual({ $expr: '"primary"' });
    const expr = within(row('variant')).getByLabelText('Style expression');
    fireEvent.change(expr, { target: { value: '"destructive"' } });
    expect(nodeById(node.id).props.variant).toEqual({ $expr: '"destructive"' });
    await userEvent.click(within(row('variant')).getByRole('button', { name: /Use a fixed value for Style/ }));
    expect(nodeById(node.id).props.variant).toBe('destructive');
  });

  it('fx toggle keeps string templates and unset props start empty', async () => {
    loadWith([{ type: 'Image', props: { src: 'https://x.test/a.png', alt: 'Hello {{ name }}' } }]);
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(within(row('alt')).getByRole('button', { name: /Use an expression for Alt text/ }));
    // toText keeps interpolation's rendering (null -> '', objects -> JSON) in the expression.
    expect(nodeById(node.id).props.alt).toEqual({ $expr: '`Hello ${toText(name)}`' });
    await userEvent.click(within(row('alt')).getByRole('button', { name: /Use a fixed value/ }));
    expect(nodeById(node.id).props.alt).toBe('Hello {{ name }}');
    // Unset prop: fx mode without storing anything until typed.
    await userEvent.click(within(row('width')).getByRole('button', { name: /Use an expression for Width/ }));
    expect(nodeById(node.id).props).not.toHaveProperty('width');
    const input = within(row('width')).getByLabelText('Width expression');
    fireEvent.change(input, { target: { value: '100 * 2' } });
    expect(nodeById(node.id).props.width).toEqual({ $expr: '100 * 2' });
  });

  it('reset button removes a set prop', async () => {
    loadWith([{ type: 'Button', props: { variant: 'primary' }, text: 'Go' }]);
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(within(row('variant')).getByRole('button', { name: 'Reset Style to default' }));
    expect(nodeById(node.id).props).not.toHaveProperty('variant');
  });

  it('hides props whose visibleWhen fails', async () => {
    loadWith([{ type: 'Table', props: {}, children: [] }]);
    selectTop();
    render(<Inspector />);
    expect(document.querySelector('[data-prop="pageCount"]')).toBeNull();
    act(() => useEditor.getState().setProp(ext().nodes[ext().nodes[ext().rootId].children[0]].id, 'paginated', true));
    expect(document.querySelector('[data-prop="pageCount"]')).not.toBeNull();
  });

  it('creates and binds a new state variable', async () => {
    loadWith([{ type: 'Input', props: { label: 'First name', name: 'firstname' } }]);
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(screen.getByRole('button', { name: 'New variable' }));
    const v = ext().state.find((s) => s.name === 'firstname');
    expect(v).toMatchObject({ type: 'string', initial: '' });
    expect(nodeById(node.id).binding).toEqual({ state: 'firstname' });
    // The bound prop shows the binding instead of an editor; unbinding removes it.
    expect(within(row('value')).getByText('firstname')).toBeInTheDocument();
    await userEvent.click(within(row('value')).getByRole('button', { name: 'Unbind' }));
    expect(nodeById(node.id).binding).toBeUndefined();
  });

  it('binds to an existing compatible variable', async () => {
    loadWith([{ type: 'Checkbox', props: { name: 'agree' }, text: 'Agree' }], 'card', {
      state: [
        { id: 's1', name: 'agreed', type: 'boolean', initial: false },
        { id: 's2', name: 'title', type: 'string', initial: '' },
      ],
    });
    const node = selectTop();
    render(<Inspector />);
    const select = screen.getByLabelText('Bind value to state');
    expect(within(select).queryByRole('option', { name: /title/ })).toBeNull();
    await userEvent.selectOptions(select, 'agreed');
    expect(nodeById(node.id).binding).toEqual({ state: 'agreed' });
  });

  it('adds overlays to a trigger slot and children to containers', async () => {
    loadWith([
      { type: 'Button', text: 'Open' },
      { type: 'Flex', children: [] },
    ]);
    const button = selectTop(0);
    const { unmount } = render(<Inspector />);
    await userEvent.click(screen.getByRole('button', { name: 'Add modal' }));
    const modalId = nodeById(button.id).slots?.overlay?.[0];
    expect(modalId && nodeById(modalId).type).toBe('Modal');
    unmount();
    const flex = selectTop(1);
    render(<Inspector />);
    await userEvent.click(screen.getByRole('button', { name: /Add inside/ }));
    const dialog = screen.getByRole('dialog', { name: 'Add child component' });
    await userEvent.type(within(dialog).getByLabelText('Search components'), 'Heading');
    await userEvent.click(within(dialog).getByRole('option', { name: /Heading/ }));
    const childId = nodeById(flex.id).children[0];
    expect(nodeById(childId).type).toBe('Heading');
  });

  it('adds and removes custom props', async () => {
    loadWith([{ type: 'Text', text: 'x' }]);
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(screen.getByRole('button', { name: /Custom props/ }));
    await userEvent.type(screen.getByLabelText('Custom prop name'), 'data-foo');
    fireEvent.change(screen.getByLabelText('Custom prop JSON value'), { target: { value: '{"a": 1}' } });
    await userEvent.click(screen.getByRole('button', { name: 'Add prop' }));
    expect(nodeById(node.id).props['data-foo']).toEqual({ a: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Remove data-foo' }));
    expect(nodeById(node.id).props).not.toHaveProperty('data-foo');
  });

  it('edits the layer name in the header and duplicates via the menu', async () => {
    loadWith([{ type: 'Text', text: 'x' }]);
    const node = selectTop();
    render(<Inspector />);
    await userEvent.type(screen.getByLabelText('Layer name'), 'Intro');
    expect(nodeById(node.id).name).toBe('Intro');
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Duplicate/ }));
    expect(ext().nodes[ext().rootId].children).toHaveLength(2);
  });
});

describe('Extension settings (no selection)', () => {
  it('edits name, validates uid and file name, and manages object types', async () => {
    loadWith([]);
    render(<Inspector />);
    const name = screen.getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Deal helper');
    expect(ext().name).toBe('Deal helper');

    // Project-file details are tucked away until asked for.
    expect(screen.queryByLabelText('uid')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Advanced: project files/ }));
    const uid = screen.getByLabelText('uid');
    const before = ext().uid;
    // HubSpot uids allow letters, digits, _, - and . — but no spaces.
    await userEvent.type(uid, ' x');
    expect(screen.getByText(/no spaces/)).toBeInTheDocument();
    expect(ext().uid).toBe(before);
    await userEvent.clear(uid);
    await userEvent.type(uid, 'deal_helper');
    expect(ext().uid).toBe('deal_helper');

    const file = screen.getByLabelText('Component file name');
    await userEvent.clear(file);
    await userEvent.type(file, 'dealHelper');
    expect(screen.getByText(/PascalCase/)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Add object type'), 'deals');
    expect(ext().objectTypes).toEqual(['contacts', 'deals']);
    await userEvent.type(screen.getByLabelText('Custom object type'), 'p_projects{Enter}');
    expect(ext().objectTypes).toEqual(['contacts', 'deals', 'p_projects']);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Contacts' }));
    expect(ext().objectTypes).toEqual(['deals', 'p_projects']);

    await userEvent.selectOptions(screen.getByLabelText('Location'), 'crm.record.sidebar');
    expect(ext().location).toBe('crm.record.sidebar');
    expect(screen.getByText(/Only CRM action components/)).toBeInTheDocument();
  });
});

describe('Properties tab: binding, overlays, variables', () => {
  it('"New variable" creates and binds in one undo step', async () => {
    loadWith([{ type: 'Input', props: { label: 'Email', name: 'email' } }]);
    const node = selectTop();
    render(<Inspector />);
    const before = useEditor.getState().past.length;
    await userEvent.click(screen.getByRole('button', { name: 'New variable' }));
    expect(useEditor.getState().past.length).toBe(before + 1);
    act(() => useEditor.getState().undo());
    expect(ext().state).toEqual([]);
    expect(nodeById(node.id).binding).toBeUndefined();
  });

  it('explains when a text field updates its variable and can update while typing', async () => {
    loadWith([{ type: 'SearchInput', props: { label: 'Search', name: 'search' } }], 'card', {
      state: [
        { id: 's1', name: 'search', type: 'string', initial: '' },
        { id: 's2', name: 'query', type: 'string', initial: '' },
      ],
    });
    const node = selectTop();
    render(<Inspector />);
    expect(screen.queryByRole('checkbox', { name: 'Update while typing' })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Bind value to state'), 'search');
    expect(screen.getByText(/when the user presses Enter or leaves the field — not on every keystroke/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Update while typing' }));
    expect(nodeById(node.id).events?.onInput).toEqual([expect.objectContaining({ type: 'setState', state: 'search', value: 'value' })]);
    expect(screen.queryByText(/not on every keystroke/)).toBeNull();
    // Rebinding moves the live step to the new variable (one undo step); unbinding removes it.
    const before = useEditor.getState().past.length;
    await userEvent.selectOptions(screen.getByLabelText('Bind value to state'), 'query');
    expect(useEditor.getState().past.length).toBe(before + 1);
    expect(nodeById(node.id).events?.onInput).toEqual([expect.objectContaining({ state: 'query', value: 'value' })]);
    await userEvent.click(screen.getAllByRole('button', { name: 'Unbind' })[0]);
    expect(nodeById(node.id).binding).toBeUndefined();
    expect(nodeById(node.id).events).toBeUndefined();
  });

  it('offers no live toggle when onInput is not the bound value (Select search text)', () => {
    loadWith([{ type: 'Select', props: { label: 'Stage', name: 'stage', options: [{ label: 'A', value: 'a' }] } }], 'card', {
      state: [{ id: 's1', name: 'stage', type: 'any', initial: null }],
    });
    const node = selectTop();
    act(() => useEditor.getState().updateNode(node.id, { binding: { state: 'stage' } }));
    render(<Inspector />);
    expect(screen.queryByRole('checkbox', { name: 'Update while typing' })).toBeNull();
  });

  it('"Add confirmation" attaches a confirm modal titled after the button (first for destructive buttons)', async () => {
    loadWith([{ type: 'Button', props: { variant: 'destructive' }, text: 'Delete record' }]);
    const node = selectTop();
    render(<Inspector />);
    const overlayButtons = within(screen.getByRole('button', { name: 'Add modal' }).parentElement!).getAllByRole('button');
    expect(overlayButtons[0]).toHaveTextContent('Add confirmation');
    await userEvent.click(screen.getByRole('button', { name: 'Add confirmation' }));
    const modalId = nodeById(node.id).slots?.overlay?.[0];
    const modal = nodeById(modalId!);
    expect(modal).toMatchObject({ type: 'Modal', props: expect.objectContaining({ title: 'Delete record?', variant: 'danger' }) });
    const footer = ext().nodes[modal.children[1]];
    const [confirm, cancel] = footer.children.map((id) => ext().nodes[id]);
    expect(confirm).toMatchObject({ text: 'Delete record', props: { variant: 'destructive' } });
    expect(cancel.text).toBe('Cancel');
    for (const b of [confirm, cancel]) {
      expect(b.events?.onClick).toEqual([expect.objectContaining({ type: 'closeOverlay', overlayNodeId: modalId })]);
    }
    expect((confirm.events!.onClick[0] as CloseOverlayAction).overlayNodeId).toBe(modalId);
  });

  it('"Add confirmation" on a regular button is offered after the plain overlays', () => {
    loadWith([{ type: 'Button', text: 'Archive deal' }]);
    selectTop();
    render(<Inspector />);
    const buttons = within(screen.getByRole('button', { name: 'Add modal' }).parentElement!).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Add modal', 'Add panel', 'Add tooltip', 'Add confirmation']);
  });

  it('picking a variable replaces the component\'s untouched default text', async () => {
    loadWith([{ type: 'Heading', text: 'Heading' }], 'card', {
      dataSources: [{ id: 'd1', name: 'record', kind: 'crmProperties', properties: ['firstname'] }],
    });
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(within(document.querySelector<HTMLElement>('[data-prop="__text"]')!).getByRole('button', { name: 'Insert {{ variable }}' }));
    await userEvent.click(within(screen.getByRole('listbox', { name: 'Variables' })).getByText('record.firstname'));
    expect(nodeById(node.id).text).toBe('{{ record.firstname }}');
  });
});

describe('pickers from the keyboard', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = focusLikeBrowser();
    return () => restore();
  });

  it('"Add inside" moves focus into the component search; Escape closes and refocuses the button', async () => {
    loadWith([{ type: 'Flex', children: [] }]);
    const flex = selectTop();
    render(<Inspector />);
    const trigger = screen.getByRole('button', { name: /Add inside/ });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Add child component' });
    expect(within(dialog).getByLabelText('Search components')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Add child component' })).toBeNull();
    expect(trigger).toHaveFocus();
    // The component stays selected (the global Escape = deselect never ran).
    expect(useEditor.getState().selectedNodeId).toBe(flex.id);
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('Heading');
    await userEvent.keyboard('{Enter}');
    expect(nodeById(nodeById(flex.id).children[0]).type).toBe('Heading');
  });

  it('the icon picker focuses its search and closes on Escape', async () => {
    loadWith([{ type: 'Icon', props: { name: 'star' } }]);
    selectTop();
    render(<Inspector />);
    const trigger = screen.getByRole('button', { name: /^Icon/ });
    expect(trigger).toHaveTextContent('star');
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByLabelText('Search icons')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByLabelText('Search icons')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('the "More actions" menu shows the platform\'s shortcuts', async () => {
    loadWith([{ type: 'Text', text: 'x' }]);
    selectTop();
    render(<Inspector />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    // jsdom is not a Mac: Ctrl-based labels, no ⌘ / ⌫ symbols.
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Duplicate/ })).toHaveTextContent('Ctrl+D');
    expect(within(menu).getByRole('menuitem', { name: /^Copy(?! JSX| settings)/ })).toHaveTextContent('Ctrl+C');
    expect(within(menu).getByRole('menuitem', { name: /^Copy settings/ })).toHaveTextContent('Alt+Ctrl+C');
    expect(within(menu).getByRole('menuitem', { name: /Delete/ })).toHaveTextContent('Del');
    expect(menu.textContent).not.toMatch(/[⌘⌫]/);
  });
});

describe('confirmModalTemplate', () => {
  it('names, titles and labels the modal after a non-delete action', () => {
    const tpl = confirmModalTemplate('Archive deal', false)!;
    expect(tpl.props).toMatchObject({ id: 'confirm-archive-deal', title: 'Archive deal?' });
    expect(tpl.props).not.toHaveProperty('variant');
    const [body, footer] = tpl.children!;
    expect(body.children![0].text).toBe('Do you want to continue?');
    const [confirm, cancel] = footer.children!;
    expect(confirm).toMatchObject({ text: 'Archive deal', props: { variant: 'primary' } });
    expect(confirm.events!.onClick).toEqual([expect.objectContaining({ type: 'closeOverlay', overlayNodeId: '@confirm-archive-deal' })]);
    expect(cancel.events!.onClick).toEqual([expect.objectContaining({ type: 'closeOverlay', overlayNodeId: '@confirm-archive-deal' })]);
    // Dynamic text: generic wording.
    expect(confirmModalTemplate('{{ label }}', true)!.props).toMatchObject({ id: 'confirm', title: 'Are you sure?', variant: 'danger' });
  });
});
