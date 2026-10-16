import { expect, test } from '@playwright/test';
import { addFromPalette, cardNodes, inspector, openEditor, setMode, watchConsole } from './helpers';

test('progress bar color by percentage with Rules', async ({ page }) => {
  const consoleWatch = watchConsole(page);
  await openEditor(page);
  await addFromPalette(page, 'Progress bar');
  const bar = cardNodes(page, 'ProgressBar').first();
  await bar.click();

  const color = inspector(page).locator('[data-prop="variant"]');
  await color.getByRole('button', { name: 'Use rules for Color' }).click();
  await expect(color.getByRole('group', { name: 'Color rules' })).toBeVisible();
  await expect(color.getByLabel(/Based on/).locator('option:checked')).toHaveText('This bar’s percentage');
  await expect(color.getByText(/Right now: 60 →/)).toBeVisible();
  await color.scrollIntoViewIfNeeded();
  if (process.env.RULES_SCREENSHOT) await page.screenshot({ path: process.env.RULES_SCREENSHOT });

  // 3 of 5 = 60%: yellow with the default rules; at 5 of 5 the bar turns green.
  await expect(bar.locator('.hsp-progress-fill')).toHaveClass(/hsp-progress-warning/);
  const value = inspector(page).locator('[data-prop="value"]').getByRole('spinbutton');
  await value.fill('5');
  await setMode(page, 'Preview');
  await expect(cardNodes(page, 'ProgressBar').first().locator('.hsp-progress-fill')).toHaveClass(/hsp-progress-success/);
  expect(consoleWatch.errors).toEqual([]);
});
