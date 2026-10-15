import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dialog, Menu } from './index';

describe('Dialog', () => {
  it('closes on Escape and on backdrop click', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Settings">
        <input aria-label="Name" />
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.querySelector('.ub-dialog-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('stays open when a widget inside handles Escape (preventDefault)', () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Settings">
        <input aria-label="Search" onKeyDown={(e) => e.key === 'Escape' && e.preventDefault()} />
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByLabelText('Search'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('only closes the topmost of stacked dialogs', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <>
        <Dialog open onClose={outer} title="Outer">
          outer
        </Dialog>
        <Dialog open onClose={inner} title="Inner">
          <button type="button">ok</button>
        </Dialog>
      </>,
    );
    fireEvent.keyDown(screen.getByText('ok'), { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('keeps focus while typing even when the parent passes a new onClose every render', async () => {
    function Host() {
      const [text, setText] = useState('');
      return (
        <Dialog open onClose={() => setText('')} title="Rename">
          <input aria-label="Name" value={text} onChange={(e) => setText(e.target.value)} />
        </Dialog>
      );
    }
    render(<Host />);
    const input = screen.getByLabelText('Name');
    await userEvent.click(input);
    await userEvent.keyboard('hello');
    expect(input).toHaveValue('hello');
    expect(input).toHaveFocus();
  });

  it('a menu inside a dialog consumes Escape without closing the dialog', () => {
    const onClose = vi.fn();
    const onMenuClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Settings">
        <Menu x={0} y={0} items={[{ label: 'One' }]} onClose={onMenuClose} />
      </Dialog>,
    );
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'One' }), { key: 'Escape' });
    expect(onMenuClose).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
