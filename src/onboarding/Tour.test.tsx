import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { resetConnectionForTests, useConnection } from '../connect/store';
import { connectedInfo, healthFixture } from '../connect/testUtils';
import { isOverlayOpen } from '../shell/shortcuts';
import { TOUR_STEPS, Tour, placeTour } from './Tour';
import { resetOnboardingForTests, tourSeen, useOnboarding } from './store';

const VIEWPORT = { width: 1440, height: 900 };

describe('placeTour', () => {
  it('puts the popover on the preferred side with its arrow pointing at the anchor', () => {
    const palette = { top: 52, left: 0, width: 280, height: 848 };
    const p = placeTour(palette, { width: 320, height: 170 }, 'right', VIEWPORT);
    expect(p.side).toBe('right');
    expect(p.left).toBe(280 + 12);
    // Tall anchors: their lower part, so the tip doesn't cover the card at the top of the canvas.
    expect(p.top).toBeGreaterThan(560);
    expect(p.top + 170).toBeLessThanOrEqual(VIEWPORT.height - 8);
  });

  it('flips to the other side, stays inside the window, and centres without an anchor', () => {
    const publish = { top: 8, left: 1340, width: 90, height: 34 };
    const p = placeTour(publish, { width: 320, height: 170 }, 'bottom', VIEWPORT);
    expect(p.side).toBe('bottom');
    expect(p.left + 320).toBeLessThanOrEqual(VIEWPORT.width - 8);
    expect(p.arrow).toBeGreaterThan(200);
    const inspector = { top: 52, left: 1120, width: 320, height: 848 };
    expect(placeTour(inspector, { width: 320, height: 170 }, 'right', VIEWPORT).side).toBe('left');
    const none = placeTour(null, { width: 320, height: 170 }, 'right', VIEWPORT);
    expect(none.side).toBeNull();
    expect(none.left).toBe((VIEWPORT.width - 320) / 2);
  });
});

describe('<Tour>', () => {
  beforeEach(() => {
    localStorage.clear();
    resetOnboardingForTests();
    resetConnectionForTests();
  });
  afterEach(() => {
    resetOnboardingForTests();
    resetConnectionForTests();
    localStorage.clear();
  });

  function layout() {
    return render(
      <>
        <aside data-tour="palette">Components</aside>
        <aside data-tour="inspector">Inspector</aside>
        <div data-tour="preview-mode">Design | Preview</div>
        <button type="button" data-tour="publish">
          Publish
        </button>
        <Tour />
      </>,
    );
  }

  it('shows nothing until it starts, then four tips with Next / Skip tour', () => {
    layout();
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => useOnboarding.getState().startTour());
    const tip = screen.getByRole('dialog', { name: 'Add components' });
    expect(tip).toHaveTextContent('Tip 1 of 4');
    expect(tip).toHaveFocus();
    // Non-blocking: no modal, the page stays usable.
    expect(tip).toHaveAttribute('aria-modal', 'false');
    expect(screen.getByRole('button', { name: 'Publish' })).not.toBeDisabled();
    for (const title of TOUR_STEPS.slice(1).map((s) => s.title)) {
      fireEvent.click(screen.getByRole('button', { name: /Next/ }));
      expect(screen.getByRole('dialog', { name: title })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Skip tour' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Got it/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(tourSeen()).toBe(true);
  });

  it('explains real data when connected, and how to connect when not', () => {
    layout();
    act(() => {
      useOnboarding.getState().startTour();
      useOnboarding.getState().nextTourStep();
      useOnboarding.getState().nextTourStep();
    });
    expect(screen.getByRole('dialog', { name: 'Preview with real data' })).toHaveTextContent('Connect HubSpot (top right)');
    act(() => useConnection.setState({ status: 'connected', health: healthFixture(), info: connectedInfo() }));
    expect(screen.getByRole('dialog', { name: 'Preview with real data' })).toHaveTextContent('Switch between Mock and Live data');
  });

  it('Skip tour and Escape end it; it can be replayed', () => {
    layout();
    act(() => useOnboarding.getState().startTour());
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => useOnboarding.getState().startTour());
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Add components' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => useOnboarding.getState().startTour());
    expect(screen.getByRole('dialog', { name: 'Add components' })).toBeInTheDocument();
  });

  it('never blocks the editor’s keyboard shortcuts', () => {
    layout();
    act(() => useOnboarding.getState().startTour());
    expect(screen.getByRole('dialog', { name: 'Add components' })).toBeInTheDocument();
    expect(isOverlayOpen()).toBe(false);
  });

  it('waits while the first-run screen is open', () => {
    layout();
    act(() => {
      useOnboarding.setState({ open: true });
      useOnboarding.getState().startTour();
    });
    expect(screen.queryByRole('dialog', { name: 'Add components' })).toBeNull();
  });
});
