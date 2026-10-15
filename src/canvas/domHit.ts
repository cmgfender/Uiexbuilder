/**
 * DOM adapter for the canvas: finds node elements (runtime DOM contract: data-node-id,
 * data-uiex-clone, data-drop-placeholder-for, ...) and builds the hit chain consumed by the pure
 * drop-target computation in ./dropTarget.ts.
 */
import type { NodeId } from '../model/types';
import {
  detectAxis,
  inferAxisFromRects,
  unionRect,
  type Axis,
  type ChildBox,
  type HitLevel,
  type PlaceholderHit,
  type Point,
  type Rect,
} from './dropTarget';

export const NODE_SELECTOR = '[data-node-id]';
export const PLACEHOLDER_SELECTOR = '[data-drop-placeholder-for]';
/** Builder chrome inside the stage (storyboard titles, empty-state buttons, inline editor). */
export const CHROME_ATTR = 'data-cv-chrome';
/** The card's `.hsp-root` element (the extension root's children render inside it). */
export const CARD_ROOT_ATTR = 'data-cv-card-root';
/** Storyboard frame bodies (overlay content rendered inline). */
export const STORYBOARD_ATTR = 'data-cv-storyboard';
/**
 * Frame text around the card (card title, app caption, record tabs, storyboard titles) that the
 * selection chrome should avoid covering, like the components themselves.
 */
export const OBSTACLE_ATTR = 'data-cv-obstacle';

export function toRect(r: DOMRect | Rect): Rect {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

export function rectOf(el: Element): Rect {
  return toRect(el.getBoundingClientRect());
}

export function isEmptyRect(r: Rect): boolean {
  return r.width <= 0 && r.height <= 0;
}

/** Escapes a value for use inside a double-quoted attribute selector. */
export function attrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function nodeSelector(id: NodeId): string {
  return `[data-node-id="${attrValue(id)}"]`;
}

function asElement(target: EventTarget | Node | null): Element | null {
  if (!target) return null;
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

/** Nearest node element at or above `target`, staying inside `boundary`. */
export function closestNodeElement(target: EventTarget | Node | null, boundary?: Element | null): HTMLElement | null {
  const el = asElement(target)?.closest<HTMLElement>(NODE_SELECTOR) ?? null;
  if (!el) return null;
  if (boundary && !boundary.contains(el)) return null;
  return el;
}

/** Whether the event target is builder chrome that handles its own pointer events. */
export function isChromeTarget(target: EventTarget | null): boolean {
  return !!asElement(target)?.closest(`[${CHROME_ATTR}]`);
}

export function nodeIdOf(el: Element): NodeId {
  return el.getAttribute('data-node-id') ?? '';
}

/** The first rendered element of a node (repeat copies come after the original in DOM order). */
export function findNodeElement(scope: ParentNode | null | undefined, id: NodeId | null | undefined): HTMLElement | null {
  if (!scope || !id) return null;
  return scope.querySelector<HTMLElement>(nodeSelector(id));
}

export function findNodeElements(scope: ParentNode | null | undefined, id: NodeId): HTMLElement[] {
  if (!scope) return [];
  return Array.from(scope.querySelectorAll<HTMLElement>(nodeSelector(id)));
}

/**
 * Node elements whose nearest node-element ancestor is `owner` (direct node children). For the
 * card root (no data-node-id) these are the elements with no node ancestor inside `container`.
 */
export function childNodeElements(container: Element): HTMLElement[] {
  const owner = container.hasAttribute('data-node-id') ? container : null;
  const out: HTMLElement[] = [];
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(NODE_SELECTOR))) {
    const parent = el.parentElement?.closest(NODE_SELECTOR) ?? null;
    if (owner ? parent === owner : !parent || !container.contains(parent)) out.push(el);
  }
  return out;
}

/** Groups child elements by node id (repeat copies) into one box each, in DOM order. */
export function groupChildBoxes(elements: HTMLElement[]): ChildBox[] {
  const byId = new Map<NodeId, Rect>();
  for (const el of elements) {
    const id = nodeIdOf(el);
    const r = rectOf(el);
    const prev = byId.get(id);
    if (!prev) byId.set(id, r);
    else if (isEmptyRect(prev)) byId.set(id, r);
    else if (!isEmptyRect(r)) byId.set(id, unionRect(prev, r));
  }
  return Array.from(byId, ([id, rect]) => ({ id, rect }));
}

/** Layout axis of a container's children: computed style of their DOM parent, refined by rects. */
export function axisOfChildren(container: Element, children: HTMLElement[]): Axis {
  const host = children[0]?.parentElement ?? container;
  const view = host.ownerDocument?.defaultView;
  const cs = view ? view.getComputedStyle(host) : null;
  const display = cs?.display ?? '';
  const axis = detectAxis({
    display,
    flexDirection: cs?.flexDirection,
    flexWrap: cs?.flexWrap,
    tagName: host.tagName,
  });
  if (axis === 'vertical' && (display === 'block' || display === '' || display === 'inline' || display === 'inline-block')) {
    const inferred = inferAxisFromRects(children.map(rectOf));
    if (inferred) return inferred;
  }
  return axis;
}

/** A hit level whose children / axis are measured lazily (only when the algorithm needs them). */
export function makeHitLevel(el: Element, nodeId: NodeId): HitLevel {
  let elements: HTMLElement[] | null = null;
  let boxes: ChildBox[] | null = null;
  let axis: Axis | null = null;
  const kids = () => (elements ??= childNodeElements(el));
  return {
    nodeId,
    rect: rectOf(el),
    get children() {
      return (boxes ??= groupChildBoxes(kids()));
    },
    get childAxis() {
      return (axis ??= axisOfChildren(el, kids()));
    },
  };
}

export interface HitInput {
  target: EventTarget | null;
  point: Point;
  /** Element containing the card and the storyboard (delegation surface). */
  surface: Element;
  rootId: NodeId;
}

export interface HitResult {
  chain: HitLevel[];
  placeholder: PlaceholderHit | null;
}

/**
 * Hit chain for the element under the pointer: node elements from the deepest up, plus the
 * extension root level when the pointer is over the card (or the stage around it). Inside the
 * storyboard the chain ends at the overlay node.
 */
export function buildHitChain({ target, surface, rootId }: HitInput): HitResult {
  const chain: HitLevel[] = [];
  const els: Element[] = [];
  let el = closestNodeElement(target, surface);
  while (el) {
    chain.push(makeHitLevel(el, nodeIdOf(el)));
    els.push(el);
    el = closestNodeElement(el.parentElement, surface);
  }

  const targetEl = asElement(target);
  const inStoryboard = !!targetEl?.closest(`[${STORYBOARD_ATTR}]`);
  const cardRoot = surface.querySelector(`[${CARD_ROOT_ATTR}]`);
  if (!inStoryboard && cardRoot) {
    const outsideNodes = chain.length === 0;
    if (outsideNodes || cardRoot.contains(els[els.length - 1])) chain.push(makeHitLevel(cardRoot, rootId));
  }

  let placeholder: PlaceholderHit | null = null;
  const phEl = targetEl?.closest<HTMLElement>(PLACEHOLDER_SELECTOR) ?? null;
  if (phEl && surface.contains(phEl) && (els.length === 0 || els[0].contains(phEl))) {
    const parentId = phEl.getAttribute('data-drop-placeholder-for') ?? '';
    const slot = phEl.getAttribute('data-drop-slot') || undefined;
    if (parentId) placeholder = { parentId, ...(slot ? { slot } : {}), rect: rectOf(phEl) };
  }
  return { chain, placeholder };
}

/** Deepest node element inside `container` whose box contains the point (excluding container). */
export function deepestNodeAt(container: Element, point: Point): HTMLElement | null {
  let found: HTMLElement | null = null;
  for (const el of Array.from(container.querySelectorAll<HTMLElement>(NODE_SELECTOR))) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) continue;
    if (point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom) found = el;
  }
  return found;
}
