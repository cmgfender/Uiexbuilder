import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ToastProvider } from '../ui';
import { LeftSidebar, RightSidebar } from './Sidebars';
import { LEFT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, loadLayout, persistLayoutChanges, useShell } from './shellStore';
import { resetEditor } from './testUtils';

describe('resizable sidebars', () => {
  beforeEach(() => {
    resetEditor();
    useShell.setState({ leftWidth: LEFT_WIDTH, rightWidth: 320, leftCollapsed: false, leftAutoCollapsed: false, rightCollapsed: false });
  });

  it('resizes with the keyboard within bounds and persists the width', () => {
    const stop = persistLayoutChanges();
    render(
      <ToastProvider>
        <LeftSidebar />
        <RightSidebar />
      </ToastProvider>,
    );
    const left = screen.getByRole('separator', { name: 'Resize left sidebar' });
    fireEvent.keyDown(left, { key: 'ArrowRight' });
    expect(useShell.getState().leftWidth).toBe(LEFT_WIDTH + 16);
    fireEvent.keyDown(left, { key: 'End' });
    expect(useShell.getState().leftWidth).toBe(SIDEBAR_MAX_WIDTH);
    expect(left).toHaveAttribute('aria-valuenow', String(SIDEBAR_MAX_WIDTH));
    fireEvent.doubleClick(left);
    expect(useShell.getState().leftWidth).toBe(LEFT_WIDTH);
    // The inspector widens when its handle moves left.
    const right = screen.getByRole('separator', { name: 'Resize inspector' });
    fireEvent.keyDown(right, { key: 'ArrowLeft', shiftKey: true });
    expect(useShell.getState().rightWidth).toBe(320 + 64);
    fireEvent.keyDown(right, { key: 'Home' });
    expect(useShell.getState().rightWidth).toBe(SIDEBAR_MIN_WIDTH);
    expect(loadLayout().rightWidth).toBe(SIDEBAR_MIN_WIDTH);
    stop();
  });
});
