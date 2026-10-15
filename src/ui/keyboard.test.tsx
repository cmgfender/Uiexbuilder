import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, Menu, Tabs, tabPanelProps, tabbableElements } from './index';

describe('Dialog focus management', () => {
  it('traps Tab / Shift+Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">behind</button>
        <Dialog open onClose={() => {}} title="Settings" footer={<button type="button">Done</button>}>
          <input aria-label="Name" />
        </Dialog>
      </>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog).toHaveFocus();
    // Shift+Tab from the dialog itself wraps to its last control (not the page behind it).
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
    // Tab from the last control wraps to the first (the Close button in the header).
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('Name')).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'behind', hidden: true })).not.toHaveFocus();
  });

  it('keeps focus on an autofocused field instead of the dialog container', () => {
    render(
      <Dialog open onClose={() => {}} title="Rename">
        <input aria-label="Name" autoFocus />
      </Dialog>,
    );
    expect(screen.getByLabelText('Name')).toHaveFocus();
  });

  it('makes #root inert while open and restores focus to the opener', () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    const opener = document.createElement('button');
    opener.textContent = 'open';
    root.appendChild(opener);
    opener.focus();
    const { rerender } = render(
      <Dialog open onClose={() => {}} title="Settings">
        body
      </Dialog>,
    );
    expect(root).toHaveAttribute('inert');
    rerender(
      <Dialog open={false} onClose={() => {}} title="Settings">
        body
      </Dialog>,
    );
    expect(root).not.toHaveAttribute('inert');
    expect(opener).toHaveFocus();
    root.remove();
  });

  it('returns focus to the menu trigger when opened from a menu item', async () => {
    const user = userEvent.setup();
    function Host() {
      const [menu, setMenu] = useState(false);
      const [dialog, setDialog] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setMenu(true)}>
            Project
          </button>
          {menu && <Menu x={0} y={0} onClose={() => setMenu(false)} items={[{ label: 'Open…', onSelect: () => setDialog(true) }]} />}
          <Dialog open={dialog} onClose={() => setDialog(false)} title="Projects">
            list
          </Dialog>
        </>
      );
    }
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'Project' });
    await user.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Open…' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Projects' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('lists only reachable controls as tabbable', () => {
    render(
      <div data-testid="box">
        <button type="button">a</button>
        <button type="button" disabled>
          b
        </button>
        <button type="button" tabIndex={-1}>
          c
        </button>
        {/* React 18 has no boolean `inert` prop: set the attribute itself. */}
        <div {...{ inert: '' }}>
          <button type="button">d</button>
        </div>
        <input aria-label="e" />
      </div>,
    );
    expect(tabbableElements(screen.getByTestId('box')).map((el) => el.textContent || el.getAttribute('aria-label'))).toEqual(['a', 'e']);
  });
});

describe('Menu keyboard model', () => {
  it('focuses the first enabled item, moves with arrows / Home / End and returns focus on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            More
          </button>
          {open && (
            <Menu
              x={0}
              y={0}
              onClose={() => {
                onClose();
                setOpen(false);
              }}
              items={[
                { label: 'Disabled', disabled: true },
                { label: 'One' },
                { separator: true, label: '' },
                { label: 'Two' },
                { label: 'Three' },
              ]}
            />
          )}
        </>
      );
    }
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'More' });
    await user.click(trigger);
    const item = (name: string) => screen.getByRole('menuitem', { name });
    expect(item('One')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('Two')).toHaveFocus();
    await user.keyboard('{End}');
    expect(item('Three')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('One')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(item('Three')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(item('One')).toHaveFocus();
    await user.tab();
    expect(item('Two')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('returns focus to returnFocus (resolved when it closes) after an item runs', () => {
    const target = document.createElement('button');
    document.body.appendChild(target);
    const { rerender } = render(<Menu x={0} y={0} onClose={() => {}} returnFocus={() => target} items={[{ label: 'Go' }]} />);
    expect(screen.getByRole('menuitem', { name: 'Go' })).toHaveFocus();
    rerender(<></>);
    expect(target).toHaveFocus();
    target.remove();
  });
});

describe('Tabs keyboard model', () => {
  function Host() {
    const [value, setValue] = useState<'a' | 'b' | 'c'>('a');
    return (
      <>
        <Tabs
          aria-label="Sections"
          idBase="t"
          value={value}
          onChange={setValue}
          tabs={[
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Beta' },
            { value: 'c', label: 'Gamma' },
          ]}
        />
        <div {...tabPanelProps('t', value)}>panel {value}</div>
      </>
    );
  }

  it('is one Tab stop; arrows / Home / End move and activate; the panel is named by its tab', () => {
    render(<Host />);
    const tab = (name: string) => screen.getByRole('tab', { name });
    expect(tab('Alpha')).toHaveAttribute('tabindex', '0');
    expect(tab('Beta')).toHaveAttribute('tabindex', '-1');
    expect(tab('Alpha')).toHaveAttribute('aria-controls', 't-panel');
    expect(screen.getByRole('tabpanel', { name: 'Alpha' })).toHaveTextContent('panel a');

    act(() => tab('Alpha').focus());
    fireEvent.keyDown(tab('Alpha'), { key: 'ArrowRight' });
    expect(tab('Beta')).toHaveFocus();
    expect(tab('Beta')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Beta')).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tabpanel', { name: 'Beta' })).toHaveTextContent('panel b');
    fireEvent.keyDown(tab('Beta'), { key: 'End' });
    expect(tab('Gamma')).toHaveFocus();
    fireEvent.keyDown(tab('Gamma'), { key: 'ArrowRight' });
    expect(tab('Alpha')).toHaveFocus();
    fireEvent.keyDown(tab('Alpha'), { key: 'ArrowLeft' });
    expect(tab('Gamma')).toHaveAttribute('aria-selected', 'true');
  });
});
