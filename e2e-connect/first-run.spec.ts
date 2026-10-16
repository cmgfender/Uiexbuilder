/**
 * First-run experience with the HubSpot connector (production server + fake HubSpot portal
 * 12345678): Connect my HubSpot → sign in → where the card goes (custom objects listed) → a real
 * sample record and a starter from the portal's properties → the editor previews real data.
 */
import { expect, test, type Page } from '@playwright/test';
import { HUB_DOMAIN, PORTAL_ID, accountChip, cardRoot, snap, topBar, watchConsole } from './helpers';

/** The full-window first-run screen (its name follows the current step's heading). */
const firstRun = (page: Page) => page.getByTestId('first-run');
const tour = (page: Page) => page.locator('.ub-ob-tour');

test.describe('first-run experience (connected)', () => {
  test('connect path through all three steps lands in the editor with live data', async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto('/');
    const welcome = page.getByRole('dialog', { name: 'Build your own HubSpot cards' });
    await expect(welcome).toBeVisible();
    const connectChoice = welcome.getByRole('button', { name: /Connect my HubSpot/ });
    await expect(connectChoice).not.toHaveAttribute('aria-disabled', 'true');
    await snap(page, 'frx-01-welcome');
    await connectChoice.click();

    // Step 1: consent in place, then the HubSpot window.
    const setup = firstRun(page);
    await expect(setup.getByRole('heading', { name: 'Connect your HubSpot account' })).toBeFocused();
    await expect(setup).toContainText('It will never');
    await expect(setup.getByRole('button', { name: /Next/ })).toBeDisabled();
    await snap(page, 'frx-02-connect');
    const popupPromise = page.waitForEvent('popup');
    await setup.getByRole('button', { name: 'Connect HubSpot' }).click();
    const popup = await popupPromise;
    await expect(setup.getByText('Waiting for HubSpot…')).toBeVisible();
    await popup.waitForLoadState('domcontentloaded');
    const closed = popup.waitForEvent('close');
    await popup.getByRole('button', { name: 'Approve' }).click();
    await closed;
    await expect(setup.getByText(`Connected to ${HUB_DOMAIN}`)).toBeVisible();
    await expect(setup).toContainText(`Account ${PORTAL_ID}`);
    // The setup shows the result itself (no consent / result dialog from the top bar on top of it).
    await expect(page.getByRole('dialog', { name: 'Connect your HubSpot account' }).filter({ hasText: 'Continue to HubSpot' })).toHaveCount(0);
    await snap(page, 'frx-03-connected');
    await setup.getByRole('button', { name: /Next/ }).click();

    // Step 2: record types from the portal (custom objects by label) and the place on the page.
    await expect(setup.getByRole('heading', { name: 'Where should your card appear?' })).toBeVisible();
    await expect(setup.getByRole('radio', { name: /Projects/ })).toBeVisible();
    await expect(setup.getByRole('radio', { name: 'Contacts' })).toBeChecked();
    await expect(setup.getByRole('radio', { name: 'Middle of the record page' })).toBeChecked();
    await snap(page, 'frx-04-where');
    await setup.getByRole('button', { name: /Next/ }).click();

    // Step 3: a real record (search combobox) and starters built from the portal's properties.
    await expect(setup.getByRole('heading', { name: 'Pick a real record and a starting point' })).toBeVisible();
    // Real data by default: the most recently updated contact is already picked …
    await expect(setup.getByLabel('Previewing with Ada Lovelace')).toBeVisible();
    // … and another one is a search away.
    await setup.getByRole('button', { name: 'Change' }).click();
    await setup.getByRole('combobox', { name: 'Find a contact' }).fill('Grace');
    await setup.getByRole('option', { name: /Grace Hopper/ }).click();
    await expect(setup.getByLabel('Previewing with Grace Hopper')).toBeVisible();
    const overview = setup.getByRole('radio', { name: /Contact details/ });
    await expect(overview).toBeChecked();
    await expect(setup.getByText('Your real properties')).toBeVisible();
    await snap(page, 'frx-05-start');
    await setup.getByRole('button', { name: /Create my card/ }).click();

    // The editor: live data with the picked record, real values and the portal's custom properties.
    await expect(firstRun(page)).toHaveCount(0);
    await expect(accountChip(page)).toBeVisible();
    await expect(page.getByTestId('uiex-sample-record')).toContainText('Grace Hopper');
    await expect(page.getByRole('group', { name: 'Preview data' }).getByRole('button', { name: /Live/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(cardRoot(page)).toContainText('grace@cobolworks.com', { timeout: 15_000 });
    await expect(cardRoot(page)).toContainText('Favorite product');
    await expect(cardRoot(page)).toContainText('Professional');
    await expect(tour(page)).toContainText('Add components');
    await snap(page, 'frx-06-editor-tour');
    for (const title of ['Edit anything', 'Preview with real data', 'Publish to HubSpot']) {
      await tour(page).getByRole('button', { name: /Next/ }).click();
      await expect(tour(page)).toContainText(title);
      await snap(page, `frx-07-tour-${title.split(' ')[0].toLowerCase()}`);
    }
    await tour(page).getByRole('button', { name: /Got it/ }).click();
    await expect(tour(page)).toHaveCount(0);

    // A reload keeps the card, the live record and the sign-in; no welcome.
    await page.reload();
    await expect(topBar(page)).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Build your own HubSpot cards' })).toHaveCount(0);
    await expect(page.getByTestId('uiex-sample-record')).toContainText('Grace Hopper');
    expect(watch.errors).toEqual([]);
  });
});
