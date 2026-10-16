/**
 * First-run experience on the static builder (no HubSpot connector): the welcome on a first visit,
 * the sample-data path through the guided setup into the editor, the coach-mark tour (skip and
 * replay from Help) and no welcome on return visits.
 */
import { expect, test, type Page } from '@playwright/test';
import { cardNodes, cardRoot, firstRun, watchConsole } from './helpers';

const topBar = (page: Page) => page.getByRole('banner', { name: 'Editor top bar' });
const tour = (page: Page) => page.locator('.ub-ob-tour');

test.describe('first-run experience (static builder)', () => {
  test('first visit shows the welcome; Connect is unavailable here with a reason', async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto('/');
    const welcome = firstRun(page);
    await expect(welcome).toBeVisible();
    await expect(welcome.getByRole('heading', { name: 'Build your own HubSpot cards' })).toBeFocused();
    await expect(welcome).toContainText('no code, no terminal');
    const connect = welcome.getByRole('button', { name: /Connect my HubSpot/ });
    await expect(connect).toHaveAttribute('aria-disabled', 'true');
    await expect(welcome).toContainText('Not available in this copy of the builder');
    // The editor behind it can't be reached.
    await expect(page.locator('.ub-sh-viewport')).toHaveAttribute('inert', '');
    await page.waitForTimeout(300);
    expect(watch.errors).toEqual([]);
  });

  test('sample-data path: where the card goes → starting point → editor with the card and the tour', async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto('/');
    await firstRun(page).getByRole('button', { name: /Try it with sample data/ }).click();

    const setup = firstRun(page);
    await expect(setup.getByRole('heading', { name: 'Where should your card appear?' })).toBeFocused();
    await expect(setup.getByRole('list', { name: 'Setup progress: step 1 of 2' })).toBeVisible();
    // Keyboard: radio groups move with the arrow keys.
    await setup.getByRole('radio', { name: 'Contacts' }).focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(setup.getByRole('radio', { name: 'Deals' })).toBeChecked();
    await setup.getByRole('radio', { name: 'Right sidebar' }).check();
    await expect(setup.getByRole('radio', { name: 'Help desk' })).toBeDisabled();
    await setup.getByRole('button', { name: /Next/ }).click();

    await expect(setup.getByRole('heading', { name: 'Choose a starting point' })).toBeVisible();
    await expect(setup.getByRole('radio', { name: /Deal details/ })).toBeChecked();
    await setup.getByRole('button', { name: /Create my card/ }).click();

    // The editor, with the new card in the right place and the tour's first tip.
    await expect(firstRun(page)).toHaveCount(0);
    await expect(topBar(page).getByRole('button', { name: /Deal Details, Record sidebar/ })).toBeVisible();
    await expect(cardNodes(page, 'Heading')).toContainText('Difference Engine Expansion');
    await expect(cardRoot(page)).toContainText('Deal stage');
    await expect(tour(page)).toBeVisible();
    await expect(tour(page)).toContainText('Add components');
    await expect(page.getByTestId('tour-ring')).toBeVisible();
    // The tour doesn't block: the editor keeps working while it is open.
    await page.getByRole('group', { name: 'Editor mode' }).getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByTestId('canvas')).toHaveClass(/ub-cv--preview/);
    await page.getByRole('group', { name: 'Editor mode' }).getByRole('button', { name: 'Design', exact: true }).click();

    await tour(page).getByRole('button', { name: 'Skip tour' }).click();
    await expect(tour(page)).toHaveCount(0);
    // Code / Problems / Console start collapsed for new users.
    await expect(page.getByRole('tabpanel', { name: /Code|Problems|Console/ })).toHaveCount(0);

    // Replay from Help.
    await topBar(page).getByRole('button', { name: 'Help' }).click();
    await page.getByRole('menuitem', { name: 'Take the tour' }).click();
    await expect(tour(page)).toContainText('Add components');
    for (const title of ['Edit anything', 'Preview with real data', 'Publish to HubSpot']) {
      await tour(page).getByRole('button', { name: /Next/ }).click();
      await expect(tour(page)).toContainText(title);
    }
    await tour(page).getByRole('button', { name: /Got it/ }).click();
    await expect(tour(page)).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(watch.errors).toEqual([]);
  });

  test('the welcome is not shown on return visits, and Help › Getting started reopens it', async ({ page }) => {
    await page.goto('/');
    await firstRun(page).getByRole('button', { name: /Try it with sample data/ }).click();
    await firstRun(page).getByRole('radio', { name: 'Companies' }).check();
    await firstRun(page).getByRole('button', { name: /Next/ }).click();
    await firstRun(page).getByRole('button', { name: /Create my card/ }).click();
    await expect(firstRun(page)).toHaveCount(0);
    await expect(topBar(page)).toContainText('Saved locally');

    await page.reload();
    await expect(topBar(page)).toBeVisible();
    await expect(firstRun(page)).toHaveCount(0);
    // The card made by the setup is still open.
    await expect(topBar(page).getByRole('button', { name: /Company Details/ })).toBeVisible();
    // The tour started once; it isn't forced again.
    await expect(tour(page)).toHaveCount(0);

    await topBar(page).getByRole('button', { name: 'Help' }).click();
    await page.getByRole('menuitem', { name: 'Getting started' }).click();
    await expect(firstRun(page)).toBeVisible();
    await firstRun(page).getByRole('button', { name: /I know what I’m doing/ }).click();
    await expect(firstRun(page)).toHaveCount(0);
    await expect(topBar(page).getByRole('button', { name: /Company Details/ })).toBeVisible();
  });
});
