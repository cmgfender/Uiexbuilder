/**
 * Where the selection chrome (label chip + quick toolbar) goes around the selected element.
 *
 * The chrome sits outside the selection outline so it never hides the component being edited,
 * where it covers the least of the *surrounding* content (sibling components, card header text…):
 * above by default (chip at the left corner, or next to the toolbar on the right), else below,
 * else split (chip above / toolbar below or the reverse). Only when neither side fits in the
 * visible area does the chip move inside the outline.
 * Pure geometry (overlay-layer coordinates), unit-tested without a browser.
 */

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const CHIP_H = 20;
export const TOOLBAR_H = 28;
/** Gap between the outline and the chrome. */
const GAP = 2;
/** Minimum space kept between the chip and the toolbar when they share a side. */
const CHIP_TOOLBAR_GAP = 6;
const EDGE = 4;

export type ChromeSide = 'above' | 'below' | 'inside';

export interface ChromePlacement {
  chip: Box & { side: ChromeSide };
  toolbar: Box & { side: ChromeSide };
  /** Area of surrounding content the chosen placement still covers (0 = nothing hidden). */
  covered: number;
}

export interface ChromeInput {
  /** Selection outline. */
  box: Box;
  chipWidth: number;
  toolbarWidth: number;
  /** Visible size of the overlay layer (chrome outside it would be clipped). */
  viewport: { width: number; height: number };
  /** Boxes of content around the selection (never the selection, its ancestors or descendants). */
  obstacles: Box[];
}

const right = (b: Box) => b.left + b.width;
const bottom = (b: Box) => b.top + b.height;

export function intersectionArea(a: Box, b: Box): number {
  const w = Math.min(right(a), right(b)) - Math.max(a.left, b.left);
  const h = Math.min(bottom(a), bottom(b)) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return intersectionArea(a, b) > 0;
}

function coveredBy(rect: Box, obstacles: Box[]): number {
  let sum = 0;
  for (const o of obstacles) sum += intersectionArea(rect, o);
  return sum;
}

type ChipAlign = 'start' | 'end';

/** In order of preference; the first that hides nothing wins, else the one hiding the least. */
const CANDIDATES: Array<[ChromeSide, ChromeSide, ChipAlign]> = [
  ['above', 'above', 'start'],
  ['above', 'above', 'end'],
  ['below', 'below', 'start'],
  ['below', 'below', 'end'],
  ['above', 'below', 'start'],
  ['below', 'above', 'start'],
];

export function placeSelectionChrome({ box, chipWidth, toolbarWidth, viewport, obstacles }: ChromeInput): ChromePlacement {
  const vw = viewport.width > 0 ? viewport.width : Infinity;
  const vh = viewport.height > 0 ? viewport.height : Infinity;
  const maxLeft = Math.max(EDGE, vw - toolbarWidth - EDGE);
  const clampLeft = (left: number) => Math.min(Math.max(EDGE, left), maxLeft);

  const chipTop = (side: ChromeSide): number => {
    if (side === 'above') return box.top - CHIP_H - GAP;
    if (side === 'below') return bottom(box) + GAP;
    // Inside: stay in view while the outline is partly scrolled out.
    const top = Math.max(box.top, 0) + GAP;
    return top + CHIP_H <= bottom(box) ? top : box.top + GAP;
  };
  const toolbarTop = (side: ChromeSide): number => {
    if (side === 'above') return box.top - TOOLBAR_H - GAP;
    if (side === 'below') return bottom(box) + GAP;
    return Math.max(box.top, 0) + GAP;
  };
  const fits = (side: ChromeSide, h: number): boolean =>
    side === 'above' ? box.top - h - GAP >= 0 : side === 'below' ? bottom(box) + GAP + h <= vh : true;

  const build = (chipSide: ChromeSide, toolbarSide: ChromeSide, align: ChipAlign): ChromePlacement | null => {
    // Toolbar right-aligned with the outline.
    let toolbarLeft = clampLeft(right(box) - toolbarWidth);
    let chipLeft = box.left;
    if (chipSide === toolbarSide) {
      if (align === 'end') {
        // Chip right before the toolbar (keeps the outline's left corner free).
        chipLeft = toolbarLeft - CHIP_TOOLBAR_GAP - chipWidth;
        if (chipLeft <= box.left) return null; // same as 'start'
      } else {
        // Never over the chip.
        toolbarLeft = clampLeft(Math.max(toolbarLeft, box.left + chipWidth + CHIP_TOOLBAR_GAP));
      }
    } else if (align === 'end') {
      return null;
    }
    const chip = { left: chipLeft, top: chipTop(chipSide), width: chipWidth, height: CHIP_H, side: chipSide };
    const toolbar = { left: toolbarLeft, top: toolbarTop(toolbarSide), width: toolbarWidth, height: TOOLBAR_H, side: toolbarSide };
    return { chip, toolbar, covered: coveredBy(chip, obstacles) + coveredBy(toolbar, obstacles) };
  };

  let best: ChromePlacement | null = null;
  for (const [chipSide, toolbarSide, align] of CANDIDATES) {
    if (!fits(chipSide, CHIP_H) || !fits(toolbarSide, TOOLBAR_H)) continue;
    const p = build(chipSide, toolbarSide, align);
    if (!p) continue;
    if (p.covered === 0) return p;
    if (!best || p.covered < best.covered) best = p;
  }
  if (best) return best;
  // No room outside the outline (it fills the view): chip inside, toolbar wherever it fits.
  const toolbarSide: ChromeSide = fits('below', TOOLBAR_H) ? 'below' : fits('above', TOOLBAR_H) ? 'above' : 'inside';
  return build('inside', toolbarSide, 'start')!;
}
