import { describe, expect, it } from 'vitest';
import { CHIP_H, TOOLBAR_H, boxesIntersect, intersectionArea, placeSelectionChrome, type Box } from './chromePlacement';

const B = (left: number, top: number, width: number, height: number): Box => ({ left, top, width, height });
const VIEW = { width: 1000, height: 800 };
const base = { chipWidth: 60, toolbarWidth: 168, viewport: VIEW };

describe('placeSelectionChrome', () => {
  it('sits above the outline when nothing is there (chip left, toolbar right, never overlapping)', () => {
    const box = B(100, 200, 400, 40);
    const p = placeSelectionChrome({ ...base, box, obstacles: [] });
    expect(p.chip).toMatchObject({ side: 'above', left: 100, top: 200 - CHIP_H - 2 });
    expect(p.toolbar).toMatchObject({ side: 'above', left: 500 - 168, top: 200 - TOOLBAR_H - 2 });
    expect(p.covered).toBe(0);
    // Narrow selection: the toolbar moves right of the chip instead of over it.
    const narrow = placeSelectionChrome({ ...base, box: B(100, 200, 90, 40), obstacles: [] });
    expect(narrow.toolbar.left).toBe(100 + 60 + 6);
    expect(boxesIntersect(narrow.chip, narrow.toolbar)).toBe(false);
  });

  it('moves below when the content above would be hidden (e.g. a value or a button label)', () => {
    // A "Lifecycle stage: customer" value right above a newly added Button.
    const value = B(100, 170, 200, 24);
    const box = B(100, 200, 110, 40);
    const p = placeSelectionChrome({ ...base, box, obstacles: [value] });
    expect(p.chip.side).toBe('below');
    expect(p.toolbar.side).toBe('below');
    expect(p.chip.top).toBe(242);
    expect(p.covered).toBe(0);
  });

  it('splits chip and toolbar when only that hides nothing (card header text above-right)', () => {
    const appCaption = B(380, 160, 120, 20);
    const next = B(100, 244, 200, 20); // content below-left, wider than the chip
    const box = B(100, 190, 400, 50);
    const p = placeSelectionChrome({ ...base, box, obstacles: [appCaption, next] });
    expect(p.chip.side).toBe('above');
    expect(p.toolbar.side).toBe('below');
    expect(p.covered).toBe(0);
  });

  it('slides the chip next to the toolbar when only the left corner is taken (a Submit button below a new field)', () => {
    const emailInput = B(100, 120, 600, 72); // full-width field right above
    const submit = B(100, 248, 100, 40); // button below-left
    const box = B(100, 200, 600, 40);
    const p = placeSelectionChrome({ ...base, box, obstacles: [emailInput, submit] });
    expect(p.chip.side).toBe('below');
    expect(p.toolbar.side).toBe('below');
    expect(p.chip.left).toBe(700 - 168 - 6 - 60);
    expect(p.covered).toBe(0);
  });

  it('when every side hides something, picks the one hiding the least', () => {
    const above = B(0, 150, 1000, 50); // a tall block right above
    const below = B(0, 242, 1000, 4); // a thin divider below
    const box = B(100, 200, 400, 40);
    const p = placeSelectionChrome({ ...base, box, obstacles: [above, below] });
    expect(p.chip.side).toBe('below');
    expect(p.toolbar.side).toBe('below');
    expect(p.covered).toBeGreaterThan(0);
  });

  it('respects the visible area: no room above (top of the view) or below (bottom of the view)', () => {
    const top = placeSelectionChrome({ ...base, box: B(100, 10, 400, 40), obstacles: [] });
    expect(top.chip.side).toBe('below');
    expect(top.toolbar.side).toBe('below');
    const bottom = placeSelectionChrome({ ...base, box: B(100, 760, 400, 30), obstacles: [B(100, 700, 400, 58)] });
    // Below does not fit, so it stays above even though that covers something.
    expect(bottom.chip.side).toBe('above');
    expect(bottom.toolbar.side).toBe('above');
  });

  it('a selection that fills the view keeps the chip inside its top-left corner, in view', () => {
    const p = placeSelectionChrome({ ...base, box: B(50, -100, 800, 1000), obstacles: [] });
    expect(p.chip).toMatchObject({ side: 'inside', left: 50, top: 2 });
    expect(p.toolbar.side).toBe('inside');
    expect(p.toolbar.top).toBe(2);
    expect(p.toolbar.left).toBeGreaterThan(p.chip.left + 60);
  });

  it('keeps the toolbar inside the viewport horizontally', () => {
    const p = placeSelectionChrome({ ...base, viewport: { width: 300, height: 800 }, box: B(200, 200, 400, 40), obstacles: [] });
    expect(p.toolbar.left + 168).toBeLessThanOrEqual(300 - 4);
  });
});

describe('geometry helpers', () => {
  it('intersection area and test', () => {
    expect(intersectionArea(B(0, 0, 10, 10), B(5, 5, 10, 10))).toBe(25);
    expect(intersectionArea(B(0, 0, 10, 10), B(10, 0, 10, 10))).toBe(0);
    expect(boxesIntersect(B(0, 0, 10, 10), B(9, 9, 1, 1))).toBe(true);
  });
});
