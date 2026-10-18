import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '../model/store';
import { ToastProvider } from '../ui';
import { Inspector } from './Inspector';
import { MultiInspector } from './power-MultiInspector';
import { loadWith, nodeById, selectTop, topNode } from './testUtils';

const renderMulti = (ids: string[]) =>
  render(
    <ToastProvider>
      <MultiInspector ids={ids} />
    </ToastProvider>,
  );

describe('editing several components at once', () => {
  beforeEach(() =>
    loadWith([
      { type: 'Button', props: { variant: 'primary', size: 'sm' }, text: 'Save' },
      { type: 'Button', props: { variant: 'secondary', size: 'sm' }, text: 'Cancel' },
      { type: 'Link', props: { href: 'https://x.test' }, text: 'Docs' },
    ]),
  );

  it('shows what they share and changes it on all of them', async () => {
    const ids = [topNode(0).id, topNode(1).id];
    useEditor.getState().selectMany(ids);
    renderMulti(ids);
    expect(screen.getByText('2 components selected')).toBeInTheDocument();
    expect(screen.getByText('All Button')).toBeInTheDocument();
    const variant = document.querySelector<HTMLElement>('[data-prop="variant"]')!;
    expect(within(variant).getByText('Different on each')).toBeInTheDocument();
    const text = screen.getByLabelText('Text');
    fireEvent.change(text, { target: { value: 'Go' } });
    expect(ids.map((id) => nodeById(id).text)).toEqual(['Go', 'Go']);
    await userEvent.click(within(variant).getByRole('button', { name: /^Reset .* on all$/ }));
    expect(ids.every((id) => nodeById(id).props.variant === undefined)).toBe(true);
    // One click selects only that component.
    await userEvent.click(within(screen.getByRole('list', { name: 'Selected components' })).getAllByRole('button')[1]);
    expect(useEditor.getState()).toMatchObject({ selectedNodeId: ids[1], selectedNodeIds: [] });
  });

  it('pastes copied settings onto the selected components of that type', async () => {
    const ids = [topNode(1).id, topNode(2).id];
    useEditor.getState().copySettings(topNode(0).id);
    useEditor.getState().selectMany(ids);
    renderMulti(ids);
    await userEvent.click(screen.getByRole('button', { name: /Paste settings \(1 of 2\)/ }));
    expect(nodeById(ids[0])).toMatchObject({ props: { variant: 'primary', size: 'sm' }, text: 'Save' });
    expect(nodeById(ids[1]).props).toEqual({ href: 'https://x.test' });
    expect(screen.getByText('Button, Link')).toBeInTheDocument();
  });
});

describe('Advanced › Reuse settings', () => {
  it('copies settings from one component and pastes them onto another', async () => {
    loadWith([
      { type: 'Tag', props: { variant: 'success' }, text: 'Won' },
      { type: 'Tag', text: 'Open' },
    ]);
    useEditor.setState({ rightPanel: 'advanced' });
    selectTop(0);
    const view = render(
      <ToastProvider>
        <Inspector />
      </ToastProvider>,
    );
    expect(screen.getByRole('button', { name: 'Paste settings' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Copy settings' }));
    selectTop(1);
    view.rerender(
      <ToastProvider>
        <Inspector />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Paste settings' }));
    expect(topNode(1)).toMatchObject({ props: { variant: 'success' }, text: 'Won' });
  });
});
