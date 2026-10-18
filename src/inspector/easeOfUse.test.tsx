import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '../model/store';
import { isExpr } from '../model/types';
import { getComponent } from '../registry';
import { Inspector } from './Inspector';
import { nodeHints } from './nodeHints';
import { useInspectorPrefs } from './prefs';
import { componentGroupOrder, insideTitle } from './PropertiesTab';
import { propNameHint } from './PropRow';
import { parseRules } from './rules';
import { elsewhereHint, propMatches, queryWords } from './settingsFilter';
import { activeTipsFor, tipsFor } from './tips';
import { loadWith, nodeById, selectTop, topNode } from './testUtils';

function row(name: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-prop="${name}"]`);
  if (!el) throw new Error(`prop row ${name} not found`);
  return el;
}

/** Runs queued animation frames and timers used by "reveal" (two frames + a short timeout). */
async function flushReveal() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 120));
  });
}

beforeEach(() => {
  loadWith([]);
  useInspectorPrefs.setState({ showHelp: true });
});

describe('plain labels, prop names and help text', () => {
  it('shows the exact HubSpot prop name only when the label says something else', () => {
    expect(propNameHint({ label: 'Color', name: 'variant' })).toBe('variant');
    expect(propNameHint({ label: 'Max value', name: 'maxValue' })).toBeNull();
    expect(propNameHint({ label: 'Column width (px)', name: 'columnWidth' })).toBeNull();
    expect(propNameHint({ label: 'Test ID', name: 'testId' })).toBeNull();
  });

  it('shows each setting’s help text under it and links it to the field for screen readers', () => {
    loadWith([{ type: 'ProgressBar', props: { value: 3, maxValue: 5 } }]);
    selectTop();
    render(<Inspector />);
    const help = within(row('maxValue')).getByText(/The value that means complete/);
    const input = within(row('maxValue')).getByRole('spinbutton');
    expect(input).toHaveAttribute('aria-describedby', help.id);
    expect(within(row('maxValue')).getByText('maxValue')).toHaveClass('ub-insp-propname');
  });

  it('hides help text from the header menu (remembered)', async () => {
    loadWith([{ type: 'ProgressBar', props: { value: 3, maxValue: 5 } }]);
    selectTop();
    render(<Inspector />);
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Hide help text under settings/ }));
    expect(within(row('maxValue')).queryByText(/The value that means complete/)).toBeNull();
    expect(window.localStorage.getItem('uiex-builder:inspector-help')).toBe('off');
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Show help text under settings/ }));
    expect(within(row('maxValue')).getByText(/The value that means complete/)).toBeInTheDocument();
  });

  it('puts a progress bar’s color in its main settings and CRM components’ data first', () => {
    const bar = getComponent('ProgressBar')!;
    expect(bar.props.find((p) => p.name === 'variant')?.group).toBe('Content');
    expect(componentGroupOrder(getComponent('CrmPropertyList')!).slice(0, 2)).toEqual(['Content', 'Data']);
    expect(componentGroupOrder(getComponent('Flex')!)[0]).toBe('Content');
  });
});

describe('"Inside this …" for containers', () => {
  it('lists the children with what they do, one click from selecting them', async () => {
    loadWith([
      {
        type: 'Flex',
        props: { direction: 'column' },
        children: [
          {
            type: 'ProgressBar',
            props: { title: 'Progress', value: 3, maxValue: 5, variant: { $expr: '(3 / 5 * 100) >= 80 ? "success" : "danger"' } },
          },
          { type: 'Text', text: 'Status', condition: 'true' },
        ],
      },
    ]);
    const flex = selectTop();
    render(<Inspector />);
    const list = screen.getByRole('list', { name: 'Inside this layout box' });
    const items = within(list).getAllByRole('button');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Progress bar: Progress');
    expect(items[0]).toHaveTextContent('Color changes by rules');
    expect(items[1]).toHaveTextContent('Shown only sometimes');
    // Hovering a row outlines the component on the canvas.
    fireEvent.mouseEnter(items[0]);
    expect(useEditor.getState().hoveredNodeId).toBe(nodeById(flex.id).children[0]);
    await userEvent.click(items[0]);
    expect(useEditor.getState().selectedNodeId).toBe(nodeById(flex.id).children[0]);
  });

  it('says what to do when the container is empty', () => {
    loadWith([{ type: 'Flex', children: [] }]);
    selectTop();
    render(<Inspector />);
    expect(screen.getByText(/Drag components here from the left, or click/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add inside/ })).toBeEnabled();
  });

  it('names the section after the component', () => {
    expect(insideTitle(getComponent('Flex')!)).toBe('Inside this layout box');
    expect(insideTitle(getComponent('Tabs')!)).toBe('Inside these tabs');
  });
});

describe('node hints', () => {
  it('describes rules, data, links, conditions, repeats and actions in plain words', () => {
    const def = getComponent('Button');
    const hints = nodeHints(
      {
        id: 'n',
        type: 'Button',
        props: { variant: { $expr: '(x) >= 1 ? "primary" : "secondary"' }, disabled: { $expr: 'busy' } },
        children: [],
        text: 'Go',
        condition: 'ready',
        repeat: { items: 'deals', itemName: 'item', indexName: 'index' },
        events: { onClick: [{ id: 'a', type: 'addAlert', alertType: 'info', title: 'Hi', message: '' }] },
      },
      def,
    ).map((h) => h.text);
    expect(hints).toEqual([
      'Style changes by rules',
      'Disabled from data',
      'Shown only sometimes',
      'Repeats for each item in deals',
      'Runs actions on click',
    ]);
  });
});

describe('Filter settings', () => {
  it('matches labels, exact prop names, descriptions and choices', () => {
    const bar = getComponent('ProgressBar')!;
    const color = bar.props.find((p) => p.name === 'variant')!;
    expect(propMatches(color, queryWords('green'))).toBe(true);
    expect(propMatches(color, queryWords('variant'))).toBe(true);
    expect(propMatches(color, queryWords('percentages'))).toBe(true);
    expect(propMatches(color, queryWords('title'))).toBe(false);
    const max = bar.props.find((p) => p.name === 'maxValue')!;
    expect(propMatches(max, queryWords('max value'))).toBe(true);
  });

  it('points to Events or Advanced for what lives there', () => {
    expect(elsewhereHint('on click')?.tab).toBe('events');
    expect(elsewhereHint('hide when')?.tab).toBe('advanced');
    expect(elsewhereHint('color')).toBeNull();
  });

  it('filters the Properties tab, opens matching sections and clears with Escape', async () => {
    loadWith([{ type: 'Input', props: { label: 'Email', name: 'email' } }]);
    selectTop();
    render(<Inspector />);
    const filter = screen.getByRole('textbox', { name: 'Filter settings' });
    await userEvent.type(filter, 'error');
    expect(document.querySelector('[data-prop="error"]')).not.toBeNull();
    expect(document.querySelector('[data-prop="label"]')).toBeNull();
    await userEvent.clear(filter);
    await userEvent.type(filter, 'zzz nothing');
    expect(screen.getByRole('status')).toHaveTextContent('No settings match “zzz nothing”.');
    await userEvent.keyboard('{Escape}');
    expect(filter).toHaveValue('');
    expect(document.querySelector('[data-prop="label"]')).not.toBeNull();
  });

  it('"/" focuses the filter from anywhere in the inspector, also from another tab', () => {
    loadWith([{ type: 'Input', props: { label: 'Email', name: 'email' } }]);
    selectTop();
    render(<Inspector />);
    const tab = screen.getByRole('tab', { name: 'Properties' });
    tab.focus();
    fireEvent.keyDown(tab, { key: '/' });
    expect(screen.getByRole('textbox', { name: 'Filter settings' })).toHaveFocus();
    // Typed into a text field, "/" is just a character.
    const label = within(row('label')).getByRole('combobox');
    label.focus();
    fireEvent.keyDown(label, { key: '/' });
    expect(label).toHaveFocus();
  });

  it('is not shown for components with a few settings', () => {
    loadWith([{ type: 'Divider' }]);
    selectTop();
    render(<Inspector />);
    expect(screen.queryByRole('textbox', { name: 'Filter settings' })).toBeNull();
  });
});

describe('"You can also…" tips', () => {
  it('suggests the progress bar’s hidden power and leaves out what is already in use', () => {
    const bar = getComponent('ProgressBar')!;
    loadWith([{ type: 'ProgressBar', props: { value: 3, maxValue: 5 } }]);
    const node = topNode();
    const texts = tipsFor(bar, node).map((t) => t.text);
    expect(texts[0]).toMatch(/Change the color at different percentages/);
    expect(texts).toContain('Fill the bar from a CRM property or other data');
    expect(activeTipsFor(bar, node)).toEqual([]);
    const withRules = { ...node, props: { ...node.props, variant: { $expr: '(3 / 5 * 100) >= 80 ? "success" : "danger"' } } };
    expect(tipsFor(bar, withRules).map((t) => t.text).join()).not.toMatch(/Change the color/);
    expect(activeTipsFor(bar, withRules).map((t) => t.text)[0]).toMatch(/Change the color/);
  });

  it('offers color rules only for color-like variants', () => {
    loadWith([{ type: 'Text', text: 'x' }]);
    expect(tipsFor(getComponent('Text')!, topNode()).some((t) => t.action.kind === 'rules' && t.action.prop === 'variant')).toBe(false);
    loadWith([{ type: 'Tag', text: 'x' }]);
    expect(tipsFor(getComponent('Tag')!, topNode()).some((t) => t.action.kind === 'rules' && t.action.prop === 'variant')).toBe(true);
  });

  it('a tip switches on the progress bar’s color rules in one click', async () => {
    loadWith([{ type: 'ProgressBar', props: { title: 'Progress', value: 3, maxValue: 5 } }]);
    const node = selectTop();
    render(<Inspector />);
    await userEvent.click(screen.getByRole('button', { name: /Change the color at different percentages/ }));
    await flushReveal();
    const v = nodeById(node.id).props.variant;
    expect(isExpr(v) && parseRules(v.$expr)?.cases.map((c) => c.then)).toEqual(['success', 'warning']);
    expect(within(row('variant')).getByRole('group', { name: 'Color rules' })).toBeInTheDocument();
    // Now it is listed as on.
    expect(screen.getByRole('button', { name: /Change the color at different percentages.*On · edit/ })).toBeInTheDocument();
  });

  it('a tip opens the Advanced tab for "show it only when"', async () => {
    loadWith([{ type: 'Text', text: 'x' }]);
    selectTop();
    render(<Inspector />);
    await userEvent.click(screen.getByRole('button', { name: /Show it only when something is true/ }));
    expect(useEditor.getState().rightPanel).toBe('advanced');
  });
});
