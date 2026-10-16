import { expect, test, type Page } from '@playwright/test';
import { addFromPalette, cardNodes, inspector, openEditor, MOD } from './helpers';

const topBar = (page: Page) => page.getByRole('banner', { name: 'Editor top bar' });

test.describe('shell: keyboard and focus', () => {
  test('dialogs trap focus and menus are keyboard operable, returning focus to their trigger', async ({ page }) => {
    await openEditor(page);
    // A dialog opened from a menu item: arrow keys in the menu, focus trapped, focus back on the trigger.
    const project = topBar(page).getByRole('button', { name: 'Project', exact: true });
    await project.click();
    await expect(page.getByRole('menuitem', { name: /New project/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: /Open/ })).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Projects' });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press(i % 3 === 0 ? 'Shift+Tab' : 'Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(project).toBeFocused();
  });

  test('Backspace / arrows on inspector controls never delete or reselect components', async ({ page }) => {
    await openEditor(page);
    await addFromPalette(page, 'Button');
    await inspector(page).getByRole('checkbox', { name: 'Disabled' }).focus();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('ArrowUp');
    await expect(cardNodes(page, 'Button')).toHaveCount(1);
    await expect(inspector(page).locator('.ub-insp-head__title')).toContainText('Button');
    // On the canvas the same keys edit the selection.
    await cardNodes(page, 'Button').click();
    await page.keyboard.press('Delete');
    await expect(cardNodes(page, 'Button')).toHaveCount(0);
  });

  test('the left sidebar starts as a rail in narrow windows and nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openEditor(page);
    const widths = await page.evaluate(() => {
      const vp = document.querySelector('.ub-sh-viewport')!;
      return { scroll: vp.scrollWidth, client: vp.clientWidth };
    });
    expect(widths.scroll).toBe(widths.client);
    await expect(topBar(page).getByRole('button', { name: 'Publish', exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole('button', { name: 'Show left sidebar' })).toBeVisible();
    await page.getByRole('button', { name: 'Show left sidebar' }).click();
    await expect(page.getByLabel('Search components')).toBeVisible();
  });
});

test.describe('shell: projects safety', () => {
  test('importing an older download of the open project asks before replacing it', async ({ page }, testInfo) => {
    await openEditor(page);
    await addFromPalette(page, 'Button');
    const text = inspector(page).getByRole('combobox', { name: 'Text content' });
    await text.fill('v1');
    await topBar(page).getByRole('button', { name: 'Project', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /Download \.uiex\.json/ }).click();
    const file = testInfo.outputPath('v1.uiex.json');
    await (await downloadPromise).saveAs(file);
    await text.fill('v2 - an hour of work');

    await page.getByLabel('Import .uiex.json file').setInputFiles(file);
    const prompt = page.getByRole('dialog', { name: 'This project is already saved here' });
    await expect(prompt).toBeVisible();
    await expect(prompt.getByRole('button', { name: 'Import as a copy' })).toBeFocused();
    await prompt.getByRole('button', { name: 'Import as a copy' }).click();
    await expect(cardNodes(page, 'Button')).toHaveText('v1');
    // The newer version is still saved, under the original project.
    const names = await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith('uiex-builder:project:'))
        .map((k) => {
          const p = JSON.parse(localStorage.getItem(k)!);
          const texts = Object.values(p.extensions[0].nodes as Record<string, { type: string; text?: string }>)
            .filter((n) => n.type === 'Button')
            .map((n) => n.text);
          return `${p.name}: ${texts.join(',')}`;
        })
        .sort(),
    );
    expect(names).toEqual(['my-ui-extensions-app (copy): v1', 'my-ui-extensions-app: v2 - an hour of work']);
  });

  test('a second tab never silently overwrites the project saved by the first', async ({ page, context }) => {
    await openEditor(page);
    await page.keyboard.press(`${MOD}+s`);
    const other = await context.newPage();
    await openEditor(other);
    await addFromPalette(page, 'Button');
    await inspector(page).getByRole('combobox', { name: 'Text content' }).fill('From tab A');
    await expect(topBar(page).getByText('Saved locally')).toBeVisible();

    const conflict = other.getByRole('dialog', { name: 'This project changed in another tab' });
    await expect(conflict).toBeVisible();
    await conflict.getByRole('button', { name: 'Load latest version' }).click();
    await expect(cardNodes(other, 'Button')).toHaveText('From tab A');
  });

  test('a document that crashes the editor shows the recovery screen, also after a reload', async ({ page }) => {
    // Simulate a render-time crash for one marker date (the restored project's save time).
    await page.addInitScript(() => {
      const original = Date.prototype.toLocaleTimeString;
      Date.prototype.toLocaleTimeString = function (...args: Parameters<Date['toLocaleTimeString']>) {
        if (this.getUTCFullYear() === 2099) throw new Error('Simulated render crash');
        return original.apply(this, args);
      };
    });
    await openEditor(page);
    // Save the project, then make its stored save time the crash marker.
    await page.keyboard.press(`${MOD}+s`);
    await page.evaluate(() => {
      const id = localStorage.getItem('uiex-builder:last-project');
      const key = `uiex-builder:project:${id}`;
      const project = JSON.parse(localStorage.getItem(key)!);
      localStorage.setItem(key, JSON.stringify({ ...project, updatedAt: '2099-01-01T00:00:00.000Z' }));
    });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'The editor ran into a problem' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'The editor ran into a problem last time' })).toBeVisible();
    await page.getByRole('button', { name: 'Start a blank project' }).click();
    await expect(page.getByTestId('canvas')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('canvas')).toBeVisible();
  });
});
