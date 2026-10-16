/**
 * The usability journey of a brand-new, non-technical admin (production server + fake HubSpot
 * portal 12345678), as role-played in the usability pass:
 *   1. connect, accept the defaults, start from "Contact summary" → a real contact's name, email
 *      and lifecycle stage with a working "Copy email" button, previewed with live data;
 *   2. add a table of the contact's associated deals with a loading state (one block);
 *   3. publish with the in-app guide and follow the "Finish in HubSpot" checklist;
 *   4. come back the next day (reload) and carry on.
 * Each task stays within a handful of clicks and never needs scrolling to find the next button.
 */
import { expect, test, type Page } from '@playwright/test';
import { DEMO_ACCESS_KEY, HUB_DOMAIN, PORTAL_ID, cardRoot, snap, topBar, watchConsole } from './helpers';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const firstRun = (page: Page) => page.getByTestId('first-run');

test('usability journey: real contact card, associated deals, publish and the checklist, next day', async ({ page, context }) => {
  const watch = watchConsole(page);
  await page.goto('/');

  // ---- Task 1: connect, then 4 clicks to the card and 2 to try it ------------------------------
  await page.getByRole('button', { name: /Connect my HubSpot/ }).click();
  const setup = firstRun(page);
  const popupPromise = page.waitForEvent('popup');
  await setup.getByRole('button', { name: 'Connect HubSpot' }).click();
  const popup = await popupPromise;
  const closed = popup.waitForEvent('close');
  await popup.getByRole('button', { name: 'Approve' }).click();
  await closed;
  await expect(setup.getByText(`Connected to ${HUB_DOMAIN}`)).toBeVisible();
  await setup.getByRole('button', { name: /^Next/ }).click();
  await setup.getByRole('button', { name: /^Next/ }).click();
  // Real data by default: the most recently updated contact is picked already.
  await expect(setup.getByLabel('Previewing with Ada Lovelace')).toBeVisible();
  await setup.getByRole('radio', { name: /Contact summary/ }).click();
  await setup.getByRole('button', { name: /Create my card/ }).click();
  await expect(firstRun(page)).toHaveCount(0);
  // Nothing is selected: the inspector shows the card's settings, not an expression.
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toContainText('Select a component to edit its properties.');
  await expect(cardRoot(page)).toContainText('Ada Lovelace');
  await expect(cardRoot(page)).toContainText('ada@analyticalengines.com');
  await expect(cardRoot(page)).toContainText('Customer');
  await page.locator('.ub-ob-tour').getByRole('button', { name: /Skip tour/ }).click();
  await snap(page, 'ux-01-contact-card');

  await topBar(page).getByRole('button', { name: 'Preview', exact: true }).click();
  await cardRoot(page).getByRole('button', { name: 'Copy email' }).click();
  await expect(cardRoot(page).getByText('Email copied')).toBeVisible();
  // One confirmation, not two (the card shows its own alert).
  await expect(cardRoot(page).getByText('Copied to clipboard (preview)')).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('ada@analyticalengines.com');

  // ---- Task 2: one block adds the associated deals, at the end of the card ----------------------
  await page.getByRole('button', { name: 'Exit preview' }).click();
  await page.getByRole('tab', { name: 'Templates' }).click();
  await page.getByRole('button', { name: /^Associated records:/ }).click();
  const block = cardRoot(page).locator('[data-node-type="Flex"]').filter({ hasText: 'Associated deals' }).last();
  await expect(block).toContainText('Analytical Engines – Enterprise plan', { timeout: 15_000 });
  // Its loading state is part of the card (shown striped while it isn't showing).
  await expect(block.locator('[data-node-type="LoadingSpinner"]')).toHaveCount(1);
  // It went after the buttons, not into the name's column at the top.
  const order = await cardRoot(page)
    .locator(':scope > [data-node-id] > [data-node-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-type')));
  expect(order.slice(-2)).toEqual(['ButtonRow', 'Flex']);
  await snap(page, 'ux-02-associated-deals');

  // ---- Task 3: publish; the button is always in view; the checklist links tick themselves -------
  await topBar(page).getByRole('button', { name: 'Publish', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish to HubSpot' });
  const publish = dialog.getByRole('button', { name: 'Publish to HubSpot', exact: true });
  await expect(publish).toBeInViewport();
  await dialog.getByLabel('Paste your key').fill(DEMO_ACCESS_KEY);
  await publish.click();
  const checklist = dialog.getByRole('region', { name: 'Finish in HubSpot' });
  await expect(checklist).toBeVisible({ timeout: 60_000 });
  await expect(dialog).toContainText('Published! “Contact Summary” is in HubSpot.');
  await expect(checklist.getByText('Go to Data Management → Objects → Contacts.')).toBeVisible();
  for (const [name, heading] of [
    [/Install the app/, 'Install your app'],
    [/Open HubSpot settings/, 'Settings'],
    [/Open your sample record/, 'Ada Lovelace'],
  ] as const) {
    const opened = context.waitForEvent('page');
    await checklist.getByRole('link', { name }).click();
    const tab = await opened;
    // The demo's HubSpot pages are stand-ins, never an error.
    await expect(tab.getByRole('heading', { name: heading })).toBeVisible();
    await tab.close();
  }
  await expect(checklist).toContainText('3 of 3 done');
  await expect(checklist).toContainText('All done — your card is live in HubSpot.');
  await snap(page, 'ux-03-published');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);

  // ---- Task 4: the next day ----------------------------------------------------------------------
  await page.reload();
  await expect(topBar(page)).toBeVisible();
  await expect(page.getByTestId('uiex-sample-record')).toContainText('Ada Lovelace');
  await expect(cardRoot(page)).toContainText('Analytical Engines – Enterprise plan', { timeout: 15_000 });
  const heading = cardRoot(page).locator('[data-node-type="Heading"]').filter({ hasText: 'Associated deals' });
  await heading.dblclick();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Open deals');
  await page.keyboard.press('Enter');
  await expect(cardRoot(page)).toContainText('Open deals');
  await topBar(page).getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /Last published .* to acmedemo\.com · Finish in HubSpot: 3 of 3 done/ })).toBeVisible();
  await expect(dialog).toContainText('You’ve changed your cards since then');
  // The key steps are one click away for someone who has done this before.
  await expect(dialog.getByRole('region', { name: 'How to get a personal access key' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /How do I get my key\?/ })).toBeVisible();
  await expect(dialog.getByText(new RegExp(`Publishing to acmedemo\\.com \\(account ${PORTAL_ID}\\)`))).toBeVisible();
  await snap(page, 'ux-04-next-day');
  expect(watch.errors).toEqual([]);
});
