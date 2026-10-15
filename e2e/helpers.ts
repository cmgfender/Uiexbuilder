/// <reference lib="dom" />
import { expect, type Locator, type Page } from '@playwright/test';

/** Collected console errors / uncaught exceptions for one page. */
export interface ConsoleWatch {
  errors: string[];
}

/** Starts collecting console errors and page errors (call before navigation). */
export function watchConsole(page: Page): ConsoleWatch {
  const watch: ConsoleWatch = { errors: [] };
  page.on('console', (msg) => {
    if (msg.type() === 'error') watch.errors.push(msg.text());
  });
  page.on('pageerror', (err) => watch.errors.push(`pageerror: ${err.message}`));
  return watch;
}

/** Opens the editor on a fresh browser context (empty storage) and dismisses the welcome card. */
export async function openEditor(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(cardRoot(page)).toBeVisible();
  const dismiss = page.getByRole('region', { name: 'Welcome' }).getByRole('button', { name: 'Dismiss' });
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
}

export const cardRoot = (page: Page): Locator => page.getByTestId('card-root');
export const inspector = (page: Page): Locator => page.getByRole('complementary', { name: 'Inspector' });
export const leftSidebar = (page: Page): Locator => page.getByRole('complementary', { name: 'Components, layers, templates and data' });
export const layersTree = (page: Page): Locator => page.getByRole('tree', { name: 'Layers' });

/** Nodes of a component type rendered in the card (design or preview). */
export const cardNodes = (page: Page, type: string): Locator => cardRoot(page).locator(`[data-node-type="${type}"]:not([data-uiex-clone])`);

/** A row of the layers tree whose label starts with the given text. */
export function layerRow(page: Page, label: string | RegExp): Locator {
  return layersTree(page).getByRole('treeitem').filter({ has: page.locator('.ub-sh-lyr-label', { hasText: label }) });
}

export async function showLeftTab(page: Page, tab: 'Components' | 'Layers' | 'Templates' | 'Data'): Promise<void> {
  await leftSidebar(page).getByRole('tab', { name: tab, exact: true }).click();
}

export async function setMode(page: Page, mode: 'Design' | 'Preview'): Promise<void> {
  await page.getByRole('group', { name: 'Editor mode' }).getByRole('button', { name: mode, exact: true }).click();
  await expect(page.getByTestId('canvas')).toHaveClass(mode === 'Design' ? /ub-cv--design/ : /ub-cv--preview/);
}

/** Clicks a palette tile (click-to-add). */
export async function addFromPalette(page: Page, label: string): Promise<void> {
  await showLeftTab(page, 'Components');
  await leftSidebar(page).getByRole('button', { name: `Add ${label}`, exact: true }).first().click();
}

/** The node header title shown at the top of the inspector. */
export async function expectInspectorFor(page: Page, componentLabel: string): Promise<void> {
  await expect(inspector(page).locator('.ub-insp-head__title')).toContainText(componentLabel);
}

/**
 * Performs a native HTML5 drag & drop: dragstart on `source`, then dragenter / dragover (twice,
 * like a real pointer settling) / drop on whatever element is under the target point, then
 * dragend — all sharing one DataTransfer, exactly as the browser would.
 */
export async function html5Drag(
  page: Page,
  source: Locator,
  target: Locator,
  position?: { x: number; y: number } | 'center',
): Promise<void> {
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sb = await source.boundingBox();
  const tb = await target.boundingBox();
  if (!sb || !tb) throw new Error('html5Drag: source or target is not visible');
  const sx = sb.x + sb.width / 2;
  const sy = sb.y + sb.height / 2;
  const pos = !position || position === 'center' ? { x: tb.width / 2, y: tb.height / 2 } : position;
  const tx = tb.x + pos.x;
  const ty = tb.y + pos.y;
  const src = await source.elementHandle();
  const dt = await page.evaluateHandle(() => new DataTransfer());
  const fire = async (type: string, x: number, y: number, el?: unknown) =>
    page.evaluate(
      ({ type, x, y, el, dt }) => {
        const node = (el as Element | null) ?? document.elementFromPoint(x, y);
        if (!node) throw new Error(`html5Drag: no element at ${x},${y}`);
        node.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, dataTransfer: dt as DataTransfer }),
        );
      },
      { type, x, y, el: el ?? null, dt },
    );
  await fire('dragstart', sx, sy, src);
  await page.waitForTimeout(50);
  await fire('dragenter', tx, ty);
  await fire('dragover', tx, ty);
  await page.waitForTimeout(50);
  await fire('dragover', tx, ty);
  await page.waitForTimeout(50);
  await fire('drop', tx, ty);
  await fire('dragend', sx, sy, src);
  await dt.dispose();
}

/**
 * A real pointer drag (Chromium's native drag & drop): press on `source`, move in steps to the
 * point inside `target`, settle one more pixel (Chromium delivers dragover one move late), release.
 */
export async function mouseDrag(page: Page, source: Locator, target: Locator, position: { x: number; y: number }): Promise<void> {
  await source.scrollIntoViewIfNeeded();
  const sb = await source.boundingBox();
  const tb = await target.boundingBox();
  if (!sb || !tb) throw new Error('mouseDrag: source or target is not visible');
  const sx = sb.x + sb.width / 2;
  const sy = sb.y + sb.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 12, sy + 6);
  await page.mouse.move(tb.x + position.x, tb.y + position.y, { steps: 10 });
  await page.mouse.move(tb.x + position.x + 1, tb.y + position.y, { steps: 2 });
  await page.mouse.up();
}

/** Ctrl on Linux/Windows, Meta on macOS (the app accepts either for Mod shortcuts). */
export const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
