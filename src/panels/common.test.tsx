import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { ChipInput, type ChipInputProps } from './common';
import { propertyNameWarning } from './crmProperties';

const SUGGESTIONS = [
  { value: 'firstname', detail: 'First name' },
  { value: 'lastname', detail: 'Last name' },
  { value: 'lifecyclestage', detail: 'Lifecycle stage' },
  { value: 'email', detail: 'Email' },
];

function Harness({ initial = [], onValues, ...rest }: Partial<ChipInputProps> & { initial?: string[]; onValues?: (v: string[]) => void }) {
  const [values, setValues] = useState<string[]>(initial);
  return (
    <>
      <ChipInput
        aria-label="Properties"
        suggestions={SUGGESTIONS}
        {...rest}
        values={values}
        onChange={(v) => {
          setValues(v);
          onValues?.(v);
        }}
      />
      <span data-testid="values">{values.join(',')}</span>
    </>
  );
}

function setup(props: Parameters<typeof Harness>[0] = {}) {
  render(<Harness {...props} />);
  const input = screen.getByRole('combobox', { name: 'Properties' });
  const values = () => screen.getByTestId('values').textContent;
  return { input, values };
}

describe('<ChipInput> suggestions', () => {
  it('highlights the first suggestion for typed text and adds it on Enter', () => {
    const { input, values } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'life' } });
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy();
    expect(screen.getByRole('option', { name: /lifecyclestage/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(values()).toBe('lifecyclestage');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('takes the highlighted suggestion on Tab as well', () => {
    const { input, values } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'em' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(values()).toBe('email');
  });

  it('puts an exact match first', () => {
    const { input } = setup({ suggestions: [{ value: 'amount_in_home_currency' }, { value: 'amount' }] });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'amount' } });
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('amount');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('values').textContent).toBe('amount');
  });

  it('adds the text as typed with Shift+Enter, or Escape then Enter', () => {
    const { input, values } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'life' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(values()).toBe('life');
    fireEvent.change(input, { target: { value: 'first' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(values()).toBe('life,first');
  });

  it('adds text that matches no suggestion on Enter', () => {
    const { input, values } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'my_custom_score' } });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(values()).toBe('my_custom_score');
  });

  it('does not add anything on Tab or Enter with an empty field', () => {
    const onValues = vi.fn();
    const { input } = setup({ onValues });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Tab' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onValues).not.toHaveBeenCalled();
  });

  it('keeps half-typed text as a draft on blur instead of saving it', () => {
    const { input, values } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'life' } });
    fireEvent.blur(input);
    expect(values()).toBe('');
    expect((input as HTMLInputElement).value).toBe('life');
    expect(screen.getByRole('status')).toHaveTextContent('“life” was not added');
    // Text that matches no suggestion is still added when leaving the field.
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'my_custom_score' } });
    fireEvent.blur(input);
    expect(values()).toBe('my_custom_score');
  });

  it('adds typed text on blur when there are no suggestions (e.g. secret names)', () => {
    const { input, values } = setup({ suggestions: [] });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'API_KEY' } });
    fireEvent.blur(input);
    expect(values()).toBe('API_KEY');
  });
});

describe('<ChipInput> warnings', () => {
  it('flags likely property typos and replaces them in one click', () => {
    setup({ initial: ['firstname', 'life', 'my_custom_score'], warn: (v) => propertyNameWarning(v, ['contacts']) });
    const warnings = screen.getByRole('list', { name: 'Warnings' });
    expect(warnings).toHaveTextContent('“life” isn’t a standard contacts property — did you mean “lifecyclestage” (Lifecycle stage)?');
    expect(warnings.querySelectorAll('li')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Use “lifecyclestage”' }));
    expect(screen.getByTestId('values').textContent).toBe('firstname,lifecyclestage,my_custom_score');
    expect(screen.queryByRole('list', { name: 'Warnings' })).toBeNull();
  });
});
