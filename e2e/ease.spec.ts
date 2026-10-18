import { expect, test } from '@playwright/test';
import { addFromPalette, cardNodes, cardRoot, expectInspectorFor, inspector, leftSidebar, openEditor, showLeftTab, watchConsole } from './helpers';

test.describe('editor ease of use', () => {
  test('a block selects its main component; its wrapper shows what is inside, one click away', async ({ page }) => {
    const consoleWatch = watchConsole(page);
    await openEditor(page);
    await showLeftTab(page, 'Templates');
    await leftSidebar(page).getByRole('button', { name: /^Progress tracker/ }).click();

    // The progress bar is selected (not the layout box around it), with its color rules in view.
    await expectInspectorFor(page, 'Progress bar');
    await expect(page.getByText(/Its progress bar is selected/)).toBeVisible();
    const color = inspector(page).locator('[data-prop="variant"]');
    await expect(color.getByRole('group', { name: 'Color rules' })).toBeVisible();
    await expect(inspector(page).getByRole('button', { name: /Change the color at different percentages.*On · edit/ })).toBeVisible();

    // The wrapper lists what is inside, and the canvas outlines each child.
    await inspector(page).getByRole('button', { name: 'Select parent' }).first().click();
    await expectInspectorFor(page, 'Layout box');
    const inside = inspector(page).getByRole('list', { name: 'Inside this layout box' });
    await expect(inside.getByRole('button')).toHaveCount(2);
    await expect(inside.getByRole('button').first()).toContainText('Color changes by rules');
    await expect(page.getByTestId('canvas-child-outline')).toHaveCount(2);
    await expect(page.getByTestId('canvas-selection-chip')).toContainText('2 inside');
    await inside.getByRole('button').first().click();
    await expectInspectorFor(page, 'Progress bar');

    // "/" jumps to Filter settings; a choice's name finds its setting.
    await inspector(page).getByRole('tab', { name: 'Properties' }).focus();
    await page.keyboard.press('/');
    const filter = inspector(page).getByRole('textbox', { name: 'Filter settings' });
    await expect(filter).toBeFocused();
    await page.keyboard.type('green');
    await expect(inspector(page).locator('[data-prop]')).toHaveCount(1);
    await expect(color).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(filter).toHaveValue('');
    expect(consoleWatch.errors.filter((e) => !/503|Failed to load resource/.test(e))).toEqual([]);
  });

  test('a tip switches on rules for a tag color; colors are picked from swatches', async ({ page }) => {
    await openEditor(page);
    await addFromPalette(page, 'Tag');
    await expectInspectorFor(page, 'Tag');
    const colors = inspector(page).getByRole('radiogroup', { name: 'Color' });
    await colors.getByRole('radio', { name: /Green/ }).check();
    await expect(cardNodes(page, 'Tag').first()).toHaveClass(/success/);
    await inspector(page).getByRole('button', { name: /Pick the color by a value/ }).click();
    await expect(inspector(page).locator('[data-prop="variant"]').getByRole('group', { name: 'Color rules' })).toBeVisible();
    await expect(cardRoot(page)).toBeVisible();
  });
});
