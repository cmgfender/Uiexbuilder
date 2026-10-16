/**
 * A short coach-mark tour of the editor (4 steps): add components (palette), edit (inspector),
 * preview with real data (Mock | Live switch and sample record, or the Preview button), publish to
 * HubSpot (top-bar button). Each step is a small popover next to the part it explains, with a ring
 * around that part. It never blocks the editor: no backdrop, the page stays usable, focus is only
 * moved to the popover when a step opens. "Next" / "Skip tour"; Escape inside it skips too.
 * Replayable from Help › Take the tour.
 *
 * Anchors are marked with `data-tour="…"` in the shell, canvas toolbar and connect controls.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check } from 'lucide-react';
import { useConnection } from '../connect/store';
import { showLeftTab, showRightTab } from '../shell/shellStore';
import { TOUR_STEP_COUNT, useOnboarding } from './store';
import './onboarding.css';

type Side = 'right' | 'left' | 'bottom' | 'top';

export interface TourStepDef {
  id: 'palette' | 'inspector' | 'preview' | 'publish';
  /** The first selector that finds a visible element is the anchor. */
  selectors: string[];
  side: Side;
  title: string;
  body: (connected: boolean) => string;
  /** Makes the anchor visible (opens a sidebar tab). */
  prepare?: () => void;
}

export const TOUR_STEPS: TourStepDef[] = [
  {
    id: 'palette',
    selectors: ['[data-tour="palette"]'],
    side: 'right',
    title: 'Add components',
    body: () => 'Drag text, buttons, tables, forms and more onto your card — or click one to add it. Templates has ready-made blocks.',
    prepare: () => showLeftTab('components'),
  },
  {
    id: 'inspector',
    selectors: ['[data-tour="inspector"]'],
    side: 'left',
    title: 'Edit anything',
    body: () => 'Click any part of your card, then change its text, look and what it does here. No code needed.',
    prepare: () => showRightTab('properties'),
  },
  {
    id: 'preview',
    selectors: ['[data-tour="preview-data"]', '[data-tour="preview-mode"]'],
    side: 'bottom',
    title: 'Preview with real data',
    body: (connected) =>
      connected
        ? 'Switch between Mock and Live data, and pick the HubSpot record your card shows. Press Preview (top bar) to click through it like in HubSpot.'
        : 'Press Preview to try your card the way it works in HubSpot. Connect HubSpot (top right) to see it with your real records.',
  },
  {
    id: 'publish',
    selectors: ['[data-tour="publish"]'],
    side: 'bottom',
    title: 'Publish to HubSpot',
    body: () => 'When your card looks right, publish it to your HubSpot account. A short guide walks you through it — no terminal needed.',
  },
];

if (TOUR_STEPS.length !== TOUR_STEP_COUNT) throw new Error('TOUR_STEPS and TOUR_STEP_COUNT disagree');

const GAP = 12;
const MARGIN = 8;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function findAnchor(selectors: string[]): HTMLElement | null {
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function sameBox(a: Box | null, b: Box | null): boolean {
  return !!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

/**
 * Where the popover goes for an anchor box: on the preferred side when it fits, else the opposite
 * side, else below / above; always inside the window. Also where its arrow points.
 */
export function placeTour(anchor: Box | null, size: { width: number; height: number }, preferred: Side, viewport: { width: number; height: number }) {
  const { width: w, height: h } = size;
  if (!anchor) {
    return { top: Math.max(MARGIN, (viewport.height - h) / 2), left: Math.max(MARGIN, (viewport.width - w) / 2), side: null as Side | null, arrow: 0 };
  }
  const fits = (side: Side) => {
    switch (side) {
      case 'right':
        return anchor.left + anchor.width + GAP + w <= viewport.width - MARGIN;
      case 'left':
        return anchor.left - GAP - w >= MARGIN;
      case 'bottom':
        return anchor.top + anchor.height + GAP + h <= viewport.height - MARGIN;
      case 'top':
        return anchor.top - GAP - h >= MARGIN;
    }
  };
  const opposite: Record<Side, Side> = { right: 'left', left: 'right', bottom: 'top', top: 'bottom' };
  const order: Side[] = [preferred, opposite[preferred], 'bottom', 'top', 'right', 'left'];
  const side = order.find(fits) ?? preferred;
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));
  let top: number;
  let left: number;
  let arrow: number;
  if (side === 'right' || side === 'left') {
    // Tall anchors (sidebars): point at their lower part, so the tip sits beside the canvas below
    // the card (cards start at the top of the canvas) instead of covering the card itself.
    const target = anchor.height > 240 ? anchor.top + Math.round(anchor.height * 0.75) : anchor.top + anchor.height / 2;
    top = clamp(target - 28, MARGIN, viewport.height - h - MARGIN);
    left = side === 'right' ? anchor.left + anchor.width + GAP : anchor.left - GAP - w;
    arrow = clamp(target - top, 14, h - 14);
  } else {
    const target = anchor.left + anchor.width / 2;
    left = clamp(target - w / 2, MARGIN, viewport.width - w - MARGIN);
    top = side === 'bottom' ? anchor.top + anchor.height + GAP : anchor.top - GAP - h;
    arrow = clamp(target - left, 14, w - 14);
  }
  left = clamp(left, MARGIN, viewport.width - w - MARGIN);
  top = clamp(top, MARGIN, viewport.height - h - MARGIN);
  return { top, left, side, arrow };
}

export function Tour() {
  const active = useOnboarding((s) => s.tour.active);
  const step = useOnboarding((s) => s.tour.step);
  const firstRunOpen = useOnboarding((s) => s.open);
  if (!active || firstRunOpen) return null;
  return <TourPopover key={step} index={step} />;
}

function TourPopover({ index }: { index: number }) {
  const def = TOUR_STEPS[index];
  const connected = useConnection((s) => s.status === 'connected' && s.info.connected);
  const ref = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<Box | null>(null);
  const [size, setSize] = useState({ width: 320, height: 170 });
  const titleId = `ub-ob-tour-title-${def.id}`;

  useEffect(() => {
    def.prepare?.();
  }, [def]);

  // Follow the anchor (sidebars resize, panels open, the window changes size).
  useEffect(() => {
    const measure = () => {
      const el = findAnchor(def.selectors);
      const r = el?.getBoundingClientRect();
      const box = r ? { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) } : null;
      setAnchor((prev) => (sameBox(prev, box) || (prev === null && box === null) ? prev : box));
    };
    measure();
    const timer = setInterval(measure, 250);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(timer);
      window.removeEventListener('resize', measure);
    };
  }, [def]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = { width: el.offsetWidth || 320, height: el.offsetHeight || 170 };
    setSize((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
  });

  // Each step announces itself: focus moves to the popover (not trapped there).
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  const viewport = { width: window.innerWidth || 1280, height: window.innerHeight || 800 };
  const place = placeTour(anchor, size, def.side, viewport);
  const last = index === TOUR_STEPS.length - 1;
  const onboarding = useOnboarding.getState();

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    e.stopPropagation();
    onboarding.endTour('skipped');
  };

  const ring = anchor
    ? {
        top: Math.max(3, anchor.top + 3),
        left: Math.max(3, anchor.left + 3),
        width: Math.max(0, Math.min(anchor.width - 6, viewport.width - 6 - Math.max(3, anchor.left + 3))),
        height: Math.max(0, Math.min(anchor.height - 6, viewport.height - 6 - Math.max(3, anchor.top + 3))),
      }
    : null;

  const arrowStyle =
    place.side === 'right'
      ? { left: -6, top: place.arrow - 6 }
      : place.side === 'left'
        ? { right: -6, top: place.arrow - 6 }
        : place.side === 'bottom'
          ? { top: -6, left: place.arrow - 6 }
          : place.side === 'top'
            ? { bottom: -6, left: place.arrow - 6 }
            : null;

  return createPortal(
    <>
      {ring && <div className="ub-ob-tour-ring" style={ring} aria-hidden data-testid="tour-ring" />}
      <div
        ref={ref}
        className="ub-ob-tour"
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-body`}
        tabIndex={-1}
        style={{ top: place.top, left: place.left }}
        onKeyDown={onKeyDown}
        data-tour-step={def.id}
        // Never blocks the editor: global shortcuts keep working while a tip is shown.
        data-uiex-nonblocking=""
      >
        {arrowStyle && <span className="ub-ob-tour__arrow" style={arrowStyle} aria-hidden />}
        <div className="ub-ob-tour__count">
          Tip {index + 1} of {TOUR_STEPS.length}
        </div>
        <h2 className="ub-ob-tour__title" id={titleId}>
          {def.title}
        </h2>
        <p className="ub-ob-tour__body" id={`${titleId}-body`}>
          {def.body(connected)}
        </p>
        <div className="ub-ob-tour__foot">
          <span className="ub-ob-tour__dots" aria-hidden>
            {TOUR_STEPS.map((s, i) => (
              <span key={s.id} className={i === index ? 'ub-ob-tour__dot--on' : undefined} />
            ))}
          </span>
          {!last && (
            <button type="button" className="ub-ob-tour__skip" onClick={() => onboarding.endTour('skipped')}>
              Skip tour
            </button>
          )}
          <button type="button" className="ub-ob-tour__next" onClick={() => onboarding.nextTourStep()}>
            {last ? (
              <>
                <Check size={14} aria-hidden /> Got it
              </>
            ) : (
              <>
                Next <ArrowRight size={14} aria-hidden />
              </>
            )}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
