import { expect, test, type Page } from '@playwright/test';
import { addFromPalette, cardNodes, cardRoot, inspector, layerRow, leftSidebar, openEditor, setMode, showLeftTab, watchConsole } from './helpers';

/**
 * Power features without code: show-when conditions, filtering / sorting / limiting a list,
 * Rules on an action's values, Copy / Paste settings and editing several components at once.
 * Everything is saved as plain expressions, so the generated card is ordinary TSX.
 */

async function insertAssociatedRecords(page: Page) {
  await showLeftTab(page, 'Templates');
  await leftSidebar(page).getByRole('button', { name: /Associated records/ }).first().click();
  await showLeftTab(page, 'Layers');
}

test('show a component only when a check is true, built from choices', async ({ page }) => {
  const watch = watchConsole(page);
  await openEditor(page);
  await insertAssociatedRecords(page);
  await layerRow(page, /^Heading: Associated deals/).click();
  await inspector(page).getByRole('tab', { name: /Advanced/ }).click();

  const showWhen = inspector(page).getByRole('group', { name: 'Show when', exact: true });
  await showWhen.getByRole('button', { name: 'Add a condition' }).click();
  const what = showWhen.getByLabel('Check 1: what to check', { exact: true });
  await what.selectOption({ label: 'associatedDeals — array of associated deals' });
  const comparison = showWhen.getByLabel('Check 1: comparison');
  await comparison.selectOption('empty');
  await expect(inspector(page).getByText('Currently: hidden')).toBeVisible();
  await comparison.selectOption('notEmpty');
  await expect(inspector(page).getByText('Currently: shown')).toBeVisible();

  // Saved as a plain, readable expression (the Code view shows it).
  await showWhen.getByRole('button', { name: 'Show when: edit as code' }).click();
  await expect(inspector(page).getByLabel('Visibility condition')).toHaveValue(/associatedDeals/);
  expect(watch.errors).toEqual([]);
});

test('filter, sort and limit a repeated list with a live preview of the rows', async ({ page }) => {
  const watch = watchConsole(page);
  await openEditor(page);
  await insertAssociatedRecords(page);
  await layerRow(page, /^Table body/).click();
  // The table body lists what is inside it: one click selects the repeated row.
  await inspector(page).getByRole('button', { name: /Table row.*Repeats for each item/ }).click();
  await inspector(page).getByRole('tab', { name: /Advanced/ }).click();
  await inspector(page).getByRole('button', { name: /Filter, sort & limit/ }).click();

  const shape = inspector(page).getByRole('group', { name: /filter and sort$/ });
  await expect(shape).toContainText('3 of 3 rows right now');
  await shape.getByLabel('Sort by').selectOption({ label: 'Amount' });
  await expect(shape.getByLabel('Sort order')).toHaveValue(/:desc$/);
  await shape.getByLabel('How many rows').selectOption('first');
  await shape.getByLabel('Number of rows to show').fill('2');
  await expect(shape).toContainText('2 of 3 rows right now');

  // The card repeats over the shaped list: two rows now, in Design and Preview.
  const bodyRows = () => cardRoot(page).locator('[data-node-type="TableBody"] [data-node-type="TableRow"]');
  await expect(bodyRows()).toHaveCount(2);
  await setMode(page, 'Preview');
  await expect(bodyRows()).toHaveCount(2);
  expect(watch.errors).toEqual([]);
});

test('copy settings onto another component, and edit several at once', async ({ page }) => {
  const watch = watchConsole(page);
  await openEditor(page);
  await addFromPalette(page, 'Tag');
  await addFromPalette(page, 'Tag');
  const tags = cardNodes(page, 'Tag');
  await expect(tags).toHaveCount(2);

  // Give the first tag a color, then copy its settings onto the second one.
  await tags.first().click();
  const color = inspector(page).locator('[data-prop="variant"]');
  await color.getByRole('radio', { name: /^Green/ }).check();
  await inspector(page).getByRole('tab', { name: /Advanced/ }).click();
  await inspector(page).getByRole('button', { name: 'Copy settings' }).click();
  await tags.nth(1).click();
  await inspector(page).getByRole('tab', { name: /Advanced/ }).click();
  await inspector(page).getByRole('button', { name: 'Paste settings' }).click();
  await inspector(page).getByRole('tab', { name: /Properties/ }).click();
  await expect(inspector(page).locator('[data-prop="variant"]').getByRole('radio', { name: /^Green/ })).toBeChecked();

  // Shift-click selects both: the inspector edits what they share.
  await tags.first().click({ modifiers: ['Shift'] });
  await expect(inspector(page).getByText('2 components selected')).toBeVisible();
  await expect(page.getByTestId('canvas-multi-outline')).toHaveCount(1);
  await inspector(page).locator('[data-prop="variant"]').getByRole('radio', { name: /^Yellow/ }).check();
  await setMode(page, 'Preview');
  await expect(cardRoot(page).locator('.hsp-tag-warning')).toHaveCount(2);
  expect(watch.errors).toEqual([]);
});

test('with several selected, the toolbar’s trash button deletes all of them', async ({ page }) => {
  const watch = watchConsole(page);
  await openEditor(page);
  for (let i = 0; i < 3; i++) await addFromPalette(page, 'Tag');
  const tags = cardNodes(page, 'Tag');
  await expect(tags).toHaveCount(3);
  await tags.nth(0).click();
  await tags.nth(1).click({ modifiers: ['Shift'] });
  await tags.nth(2).click({ modifiers: ['Shift'] });
  await expect(inspector(page).getByText('3 components selected')).toBeVisible();
  await page.getByRole('toolbar', { name: 'Tag actions' }).getByRole('button', { name: 'Delete 3 selected' }).click();
  await expect(tags).toHaveCount(0);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(tags).toHaveCount(3);
  expect(watch.errors).toEqual([]);
});

test('Rules on an action: the alert type follows a value', async ({ page }) => {
  const watch = watchConsole(page);
  await openEditor(page);
  await addFromPalette(page, 'Button');
  await inspector(page).getByRole('tab', { name: /Events/ }).click();
  await inspector(page).getByRole('button', { name: 'Add action' }).first().click();
  await page.getByRole('menuitem', { name: /Show alert/ }).click();
  await inspector(page).getByRole('button', { name: 'Use rules for Type' }).click();
  const rules = inspector(page).getByRole('group', { name: 'Type rules' });
  await expect(rules).toBeVisible();
  const basedOn = rules.getByLabel(/Based on/);
  await basedOn.selectOption({ label: await basedOn.locator('option', { hasText: 'context.user.firstName' }).first().innerText() });
  await expect(rules.getByText(/Right now:/)).toBeVisible();

  await setMode(page, 'Preview');
  await cardNodes(page, 'Button').first().click();
  await expect(page.getByRole('region', { name: 'Alerts' }).getByRole('alert')).toContainText('Saved successfully');
  expect(watch.errors).toEqual([]);
});
