import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as connect from '../connect';
import { useEditor } from '../model/store';
import type { JsonValue } from '../model/types';
import { connectFakePortal, disconnectFakePortal } from '../panels/portalTestUtils';
import { Inspector } from './Inspector';
import { ext, loadWith, nodeById, selectTop } from './testUtils';

// A fake connected HubSpot account behind the catalog hooks (the connection store stays real).
vi.mock('../connect', async (importOriginal) => {
  const { mockConnect } = await import('../panels/portalTestUtils');
  return mockConnect(await importOriginal());
});

function row(name: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-prop="${name}"]`);
  if (!el) throw new Error(`prop row ${name} not found`);
  return el;
}

function pickFirstSuggestion(field: HTMLElement, query: string) {
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: query } });
  fireEvent.keyDown(field, { key: 'Enter' });
}

function historyLength(): number {
  return useEditor.getState().past.length;
}

describe('Inspector with a connected HubSpot account', () => {
  beforeEach(() => connectFakePortal(connect));
  afterEach(() => disconnectFakePortal(connect));

  it('CRM property lists suggest the account’s properties (custom ones included) and flag unknown names', () => {
    loadWith([{ type: 'CrmPropertyList', props: { properties: ['firstname', 'jobtitle'] } }], 'card', { objectTypes: ['contacts'] });
    const node = selectTop();
    render(<Inspector />);
    const field = within(row('properties')).getByRole('combobox', { name: 'Properties' });
    fireEvent.focus(field);
    const list = screen.getByRole('listbox', { name: 'Property suggestions' });
    expect(within(list).getByRole('option', { name: /Favorite color/ })).toHaveTextContent('Custom');
    pickFirstSuggestion(field, 'Favorite');
    expect(nodeById(node.id).props.properties).toEqual(['firstname', 'jobtitle', 'favorite_color']);
    // jobtitle is a common HubSpot property, but this account doesn't have it.
    const warnings = within(row('properties')).getByRole('list', { name: 'Property warnings' });
    expect(warnings).toHaveTextContent('jobtitle: Not found in your portal');
    expect(warnings).not.toHaveTextContent('favorite_color');
  });

  it('uses the component’s own object type (incl. custom objects) for its property fields', () => {
    loadWith([{ type: 'CrmAssociationTable', props: { objectTypeId: '0-3', propertyColumns: ['dealname'] } }], 'card', { objectTypes: ['contacts'] });
    const node = selectTop();
    render(<Inspector />);
    const columns = within(row('propertyColumns')).getByRole('combobox', { name: 'Property columns' });
    fireEvent.focus(columns);
    expect(within(screen.getByRole('listbox', { name: 'Property suggestions' })).getByRole('option', { name: /Contract tier/ })).toBeInTheDocument();
    fireEvent.keyDown(columns, { key: 'Escape' });

    // The object type select lists the account's custom objects.
    const select = within(row('objectTypeId')).getByRole('combobox', { name: 'Object type ID' });
    const customGroup = select.querySelector('optgroup[label="Your custom objects"]');
    expect(customGroup).not.toBeNull();
    expect(within(customGroup as HTMLElement).getByRole('option', { name: 'Projects (2-555)' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: '2-555' } });
    expect(nodeById(node.id).props.objectTypeId).toBe('2-555');

    const after = within(row('propertyColumns')).getByRole('combobox', { name: 'Property columns' });
    pickFirstSuggestion(after, 'Budget');
    expect(nodeById(node.id).props.propertyColumns).toEqual(['dealname', 'budget']);
    // dealname isn't a property of the custom object.
    expect(within(row('propertyColumns')).getByRole('list', { name: 'Property warnings' })).toHaveTextContent('dealname: Not found in your portal');
  });

  it('imports a dropdown property’s choices into a Select’s options as one undo step', () => {
    loadWith([{ type: 'Select', props: { label: 'Color', name: 'color', options: [{ label: 'One', value: 'one' }] } }], 'card', { objectTypes: ['contacts'] });
    const node = selectTop();
    render(<Inspector />);
    const before = nodeById(node.id).props.options as JsonValue;
    fireEvent.click(within(row('options')).getByRole('button', { name: 'Import from HubSpot property…' }));
    const panel = screen.getByRole('group', { name: 'Import options from a HubSpot property' });
    const picker = within(panel).getByRole('combobox', { name: 'Property to import options from' });
    // Only properties with choices are offered.
    fireEvent.focus(picker);
    const names = within(screen.getByRole('listbox', { name: 'Property suggestions' }))
      .getAllByRole('option')
      .map((o) => o.querySelector('.ub-pp-option__name')?.textContent)
      .sort();
    expect(names).toEqual(['favorite_color', 'lifecyclestage']);
    pickFirstSuggestion(picker, 'Favorite');
    // Hidden choices are skipped.
    expect(within(panel).getByRole('status')).toHaveTextContent('2 options: Red, Blue');

    const steps = historyLength();
    fireEvent.click(within(panel).getByRole('button', { name: 'Replace 1 option' }));
    // HubSpot's Select options have no description field, so choice descriptions are left out.
    expect(nodeById(node.id).props.options).toEqual([
      { label: 'Red', value: 'red' },
      { label: 'Blue', value: 'blue' },
    ]);
    expect(screen.queryByRole('group', { name: 'Import options from a HubSpot property' })).toBeNull();
    expect(historyLength()).toBe(steps + 1);
    act(() => useEditor.getState().undo());
    expect(nodeById(node.id).props.options).toEqual(before);
  });

  it('imports choices from another object’s property (e.g. a deal stage list)', () => {
    loadWith([{ type: 'ToggleGroup', props: { name: 'stage', options: [] } }], 'card', { objectTypes: ['contacts'] });
    const node = selectTop();
    render(<Inspector />);
    fireEvent.click(within(row('options')).getByRole('button', { name: 'Import from HubSpot property…' }));
    const panel = screen.getByRole('group', { name: 'Import options from a HubSpot property' });
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Import from object' }), { target: { value: '0-3' } });
    pickFirstSuggestion(within(panel).getByRole('combobox', { name: 'Property to import options from' }), 'Deal stage');
    fireEvent.click(within(panel).getByRole('button', { name: 'Add these options' }));
    const options = nodeById(node.id).props.options as Array<{ label: string; value: string }>;
    expect(options.map((o) => [o.label, o.value])).toEqual([
      ['Appointment scheduled', 'appointmentscheduled'],
      ['Closed won', 'closedwon'],
    ]);
  });

  it('offers the account’s custom objects in the card’s object types', () => {
    loadWith([], 'card', { objectTypes: ['contacts'] });
    render(<Inspector />);
    const select = screen.getByRole('combobox', { name: 'Add one of your custom objects' });
    expect(within(select).getByRole('option', { name: 'Projects (p_projects)' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'p_projects' } });
    expect(ext().objectTypes).toEqual(['contacts', 'p_projects']);
    // The chip shows the object's label; once added it is no longer offered.
    expect(screen.getByRole('button', { name: 'Remove Projects' })).toBeInTheDocument();
    expect(within(screen.getByRole('combobox', { name: 'Add one of your custom objects' })).queryByRole('option', { name: /Projects/ })).toBeNull();
  });

  it('fills a step indicator with a pipeline’s stages in order', () => {
    loadWith([{ type: 'StepIndicator', props: { stepNames: ['A', 'B'], currentStep: 0 } }]);
    const node = selectTop();
    render(<Inspector />);
    fireEvent.click(within(row('stepNames')).getByRole('button', { name: 'Use stages from pipeline…' }));
    const panel = screen.getByRole('group', { name: 'Use stages from a pipeline' });
    expect(within(within(panel).getByRole('list', { name: 'Stages' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Qualified',
      'Contract sent',
      'Closed won',
    ]);
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Pipeline' }), { target: { value: 'renewals' } });
    expect(within(panel).getByRole('list', { name: 'Stages' })).toHaveTextContent('Due');
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Pipeline' }), { target: { value: 'default' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Use 3 stages' }));
    expect(nodeById(node.id).props.stepNames).toEqual(['Qualified', 'Contract sent', 'Closed won']);
  });

  it('adds a CrmStatistics statistic with a number property picker', () => {
    loadWith([{ type: 'CrmStatistics', props: { objectTypeId: '0-3', statistics: [] } }]);
    const node = selectTop();
    render(<Inspector />);
    fireEvent.click(within(row('statistics')).getByRole('button', { name: 'Add a statistic' }));
    const panel = screen.getByRole('group', { name: 'Add a statistic' });
    const picker = within(panel).getByRole('combobox', { name: 'Statistic property' });
    fireEvent.focus(picker);
    // Sums need a number property.
    const names = within(screen.getByRole('listbox', { name: 'Property suggestions' }))
      .getAllByRole('option')
      .map((o) => o.querySelector('.ub-pp-option__name')?.textContent);
    expect(names).toEqual(['amount']);
    fireEvent.mouseDown(within(screen.getByRole('listbox', { name: 'Property suggestions' })).getByRole('option', { name: /Amount/ }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Add statistic' }));
    expect(nodeById(node.id).props.statistics).toEqual([{ label: 'Sum of amount', statisticType: 'SUM', propertyName: 'amount' }]);
  });
});

describe('Inspector without HubSpot', () => {
  beforeEach(() => disconnectFakePortal(connect));

  it('keeps the built-in suggestions and hides account-only helpers', () => {
    loadWith([{ type: 'CrmPropertyList', props: { properties: ['firstname', 'my_custom_field'] } }], 'card', { objectTypes: ['contacts'] });
    selectTop();
    render(<Inspector />);
    const field = within(row('properties')).getByRole('combobox', { name: 'Properties' });
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'jobt' } });
    expect(within(screen.getByRole('listbox', { name: 'Property suggestions' })).getByRole('option', { name: /jobtitle/ })).toBeInTheDocument();
    // Without an account, names can't be checked: custom names are fine.
    expect(screen.queryByText(/Not found in your portal/)).toBeNull();
    // No custom objects to offer in the object type select.
    const select = within(row('objectTypeId')).getByRole('combobox', { name: 'Object type ID' });
    expect(select.querySelector('optgroup[label="Your custom objects"]')).toBeNull();
  });

  it('has no HubSpot import buttons for options and steps', () => {
    loadWith([
      { type: 'Select', props: { label: 'Color', name: 'color', options: [] } },
      { type: 'StepIndicator', props: { stepNames: ['A'], currentStep: 0 } },
    ]);
    selectTop(0);
    const view = render(<Inspector />);
    expect(within(row('options')).queryByRole('button', { name: 'Import from HubSpot property…' })).toBeNull();
    view.unmount();
    selectTop(1);
    render(<Inspector />);
    expect(within(row('stepNames')).queryByRole('button', { name: 'Use stages from pipeline…' })).toBeNull();
  });

  it('does not offer custom objects in the card’s object types', () => {
    loadWith([], 'card', { objectTypes: ['contacts'] });
    render(<Inspector />);
    expect(screen.queryByRole('combobox', { name: 'Add one of your custom objects' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Add object type' })).toBeInTheDocument();
  });
});
