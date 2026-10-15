import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as connect from '../connect';
import { hasChoices } from './portal';
import { connectFakePortal, disconnectFakePortal } from './portalTestUtils';
import { PropertyPicker } from './PropertyPicker';

vi.mock('../connect', async (importOriginal) => {
  const { mockConnect } = await import('./portalTestUtils');
  return mockConnect(await importOriginal());
});

function Multi({ initial = [], objectTypes = ['contacts'], onChange }: { initial?: string[]; objectTypes?: string[]; onChange?: (v: string[]) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <PropertyPicker
      multiple
      aria-label="Properties"
      objectTypes={objectTypes}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

function Single({ initial = '', objectTypes = ['deals'], onChange, accept }: { initial?: string; objectTypes?: string[]; onChange?: (v: string) => void; accept?: Parameters<typeof PropertyPicker>[0]['accept'] }) {
  const [value, setValue] = useState(initial);
  return (
    <PropertyPicker
      aria-label="Property"
      objectTypes={objectTypes}
      value={value}
      accept={accept}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

function input(name = 'Properties'): HTMLElement {
  return screen.getByRole('combobox', { name });
}

function listbox(): HTMLElement {
  return screen.getByRole('listbox', { name: 'Property suggestions' });
}

describe('<PropertyPicker> connected to HubSpot', () => {
  beforeEach(() => connectFakePortal(connect));
  afterEach(() => disconnectFakePortal(connect));

  it('suggests the account’s properties with labels, types, groups and custom badges', () => {
    render(<Multi />);
    fireEvent.focus(input());
    expect(screen.getByText('Your HubSpot properties')).toBeInTheDocument();
    const list = listbox();
    const groups = within(list).getAllByRole('group').map((g) => g.getAttribute('aria-label'));
    expect(groups).toEqual(['Contact information', 'Preferences']);
    const custom = within(list).getByRole('option', { name: /Favorite color/ });
    expect(custom).toHaveTextContent('favorite_color');
    expect(custom).toHaveTextContent('Custom');
    // Hidden properties stay out of the browse list; built-in-only names are not suggested.
    expect(within(list).queryByRole('option', { name: /hs_internal_score/ })).toBeNull();
    expect(within(list).queryByRole('option', { name: /jobtitle/ })).toBeNull();
  });

  it('searches by label or internal name and adds the internal name', () => {
    const onChange = vi.fn();
    render(<Multi onChange={onChange} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'Renewal' } });
    const options = within(listbox()).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Renewal date');
    expect(input()).toHaveAttribute('aria-activedescendant', options[0].id);
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['renewal_date']);
    // The chip shows the label and the internal name.
    const chip = document.querySelector('[data-property="renewal_date"]')!;
    expect(chip).toHaveTextContent('Renewal date');
    expect(chip).toHaveTextContent('renewal_date');

    fireEvent.change(input(), { target: { value: 'favorite_' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['renewal_date', 'favorite_color']);
  });

  it('moves through suggestions with the arrow keys and closes the list with Escape', () => {
    const onChange = vi.fn();
    render(<Multi onChange={onChange} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'name' } });
    const options = within(listbox()).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining('firstname'), expect.stringContaining('lastname')]);
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    expect(input()).toHaveAttribute('aria-activedescendant', options[1].id);
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['lastname']);
    fireEvent.change(input(), { target: { value: 'e' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('flags names that are not in the account and offers a near match', () => {
    const onChange = vi.fn();
    render(<Multi initial={['firstname', 'firstnmae', 'jobtitle']} onChange={onChange} />);
    const warnings = screen.getByRole('list', { name: 'Property warnings' });
    expect(within(warnings).getAllByRole('listitem')).toHaveLength(2);
    expect(warnings).toHaveTextContent('firstnmae: Not found in your portal');
    expect(warnings).toHaveTextContent('jobtitle: Not found in your portal');
    expect(document.querySelector('[data-property="jobtitle"]')).toHaveClass('ub-pn-chip--warn');
    expect(document.querySelector('[data-property="firstname"]')).not.toHaveClass('ub-pn-chip--warn');
    fireEvent.click(within(warnings).getByRole('button', { name: /Use “firstname”/ }));
    expect(onChange).toHaveBeenLastCalledWith(['firstname', 'jobtitle']);
  });

  it('does not report names while the account’s properties are loading', () => {
    disconnectFakePortal(connect);
    connectFakePortal(connect, { loading: true });
    render(<Multi initial={['mystery_field']} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading your HubSpot properties…');
    expect(screen.queryByText(/Not found in your portal/)).toBeNull();
  });

  it('falls back to common properties when an object type can’t be read', () => {
    render(<Multi objectTypes={['tickets']} />);
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t load your HubSpot properties');
    fireEvent.focus(input());
    expect(within(listbox()).getByRole('option', { name: /hs_pipeline_stage/ })).toBeInTheDocument();
  });

  it('suggests custom object properties', () => {
    render(<Multi objectTypes={['p_projects']} />);
    fireEvent.focus(input());
    expect(within(listbox()).getByRole('option', { name: /Budget/ })).toHaveTextContent('Custom');
  });

  it('single mode: maps a typed label to its internal name, reverts with Escape and warns about unknown names', () => {
    const onChange = vi.fn();
    render(<Single onChange={onChange} />);
    const field = input('Property');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'Deal stage' } });
    fireEvent.blur(field);
    expect(onChange).toHaveBeenLastCalledWith('dealstage');
    expect(field).toHaveValue('dealstage');
    // The label and type are shown under the name.
    expect(screen.getByText('Deal stage')).toBeInTheDocument();

    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'something' } });
    fireEvent.keyDown(field, { key: 'Escape' }); // closes the list
    fireEvent.keyDown(field, { key: 'Escape' }); // reverts the text
    expect(field).toHaveValue('dealstage');

    fireEvent.change(field, { target: { value: 'closedat' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('closedat');
    expect(screen.getByText('Not found in your portal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use “closedate”' }));
    expect(onChange).toHaveBeenLastCalledWith('closedate');
  });

  it('single mode: rejects text that can’t be a property name', () => {
    const onChange = vi.fn();
    render(<Single initial="amount" onChange={onChange} />);
    const field = input('Property');
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: 'not a name!' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('internal property name');
    expect(onChange).not.toHaveBeenCalled();
    // Nothing matches, so Escape reverts right away.
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(field).toHaveValue('amount');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('only suggests properties the field accepts (e.g. dropdowns)', () => {
    render(<Single objectTypes={['contacts']} accept={hasChoices} />);
    fireEvent.focus(input('Property'));
    const names = within(listbox())
      .getAllByRole('option')
      .map((o) => o.querySelector('.ub-pp-option__name')?.textContent);
    expect(names.sort()).toEqual(['favorite_color', 'lifecyclestage']);
  });
});

describe('<PropertyPicker> without HubSpot', () => {
  beforeEach(() => disconnectFakePortal(connect));

  it('suggests the built-in common properties and invites connecting', () => {
    render(<Multi />);
    fireEvent.focus(input());
    expect(screen.getByText(/connect HubSpot to see your own/)).toBeInTheDocument();
    fireEvent.change(input(), { target: { value: 'jobt' } });
    fireEvent.mouseDown(within(listbox()).getByRole('option', { name: /jobtitle/ }));
    expect(document.querySelector('[data-property="jobtitle"]')).toHaveTextContent('Job title');
  });

  it('only warns about likely typos of common properties (custom names are fine)', () => {
    render(<Multi initial={['my_custom_field', 'firstnmae']} />);
    const warnings = screen.getByRole('list', { name: 'Property warnings' });
    expect(within(warnings).getAllByRole('listitem')).toHaveLength(1);
    expect(warnings).toHaveTextContent('did you mean “firstname”');
    expect(screen.queryByText(/Not found in your portal/)).toBeNull();
  });

  it('adds names typed with commas or pasted as a list and removes chips with Backspace', () => {
    const onChange = vi.fn();
    render(<Multi onChange={onChange} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'email,phone,' } });
    expect(onChange).toHaveBeenLastCalledWith(['email', 'phone']);
    fireEvent.paste(input(), { clipboardData: { getData: () => 'city\nzip' } });
    expect(onChange).toHaveBeenLastCalledWith(['email', 'phone', 'city', 'zip']);
    act(() => {
      fireEvent.keyDown(input(), { key: 'Backspace' });
    });
    expect(onChange).toHaveBeenLastCalledWith(['email', 'phone', 'city']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove phone' }));
    expect(onChange).toHaveBeenLastCalledWith(['email', 'city']);
  });
});
