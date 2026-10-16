import { expect, test, type Page } from '@playwright/test';
import {
  HUB_DOMAIN,
  PORTAL_ID,
  accountChip,
  cardRoot,
  connectButton,
  connectHubSpot,
  disconnectHubSpot,
  leftSidebar,
  liveContactDocument,
  openEditor,
  setMode,
  showLeftTab,
  snap,
  topBar,
  watchConsole,
} from './helpers';

/** Imports the live-contact builder document (see liveContactDocument). */
async function importLiveContactCard(page: Page): Promise<void> {
  await page.getByLabel('Import .uiex.json file').setInputFiles(await liveContactDocument());
  await expect(topBar(page).getByRole('button', { name: 'Live Data Demo' })).toBeVisible();
  // Mock data first: the default mock record is "Ada".
  await expect(cardRoot(page).getByText('First name: Ada')).toBeVisible();
}

const previewData = (page: Page) => page.getByRole('group', { name: 'Preview data' });

/** Live data → pick a sample contact through the record picker (search + keyboard). */
async function pickSampleContact(page: Page, query: string, name: string, screenshot?: string): Promise<void> {
  await previewData(page).getByRole('button', { name: /Live/ }).click();
  const chip = page.getByRole('button', { name: 'Pick a sample record to preview with real data' });
  await expect(chip).toBeVisible();
  await chip.click();
  const picker = page.getByRole('dialog', { name: 'Sample record' });
  const search = picker.getByRole('combobox', { name: 'Find a contact' });
  await expect(search).toBeFocused();
  // Without a query it lists recently updated contacts from the portal.
  await expect(picker.getByRole('listbox', { name: 'Matching contacts' }).getByRole('option').first()).toBeVisible();
  if (screenshot) await snap(page, screenshot, { keepPointer: true });
  // Type and press Enter right away (before the search answers): it picks the first match of
  // this search, never a row of the list that was showing before.
  await search.fill(query);
  await search.press('Enter');
  await expect(picker).toBeHidden();
  await expect(page.getByRole('button', { name: new RegExp(`^Live data: ${name}`) })).toBeVisible();
}

test.describe('Connect HubSpot (fake portal)', () => {
  test('a: signs in through the HubSpot window and shows the connected account', async ({ page }) => {
    const watch = watchConsole(page);
    await openEditor(page);
    await expect(connectButton(page)).toBeVisible();
    await connectHubSpot(page, { screenshots: true });

    // The account menu explains what is connected, in plain language.
    await accountChip(page).click();
    const menu = page.getByRole('dialog', { name: 'HubSpot account' });
    await expect(menu).toContainText(HUB_DOMAIN);
    await expect(menu).toContainText(String(PORTAL_ID));
    await expect(menu).toContainText('jordan.lee@acmedemo.com');
    await expect(menu.getByRole('button', { name: 'Disconnect' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    // Still connected after a reload (encrypted HttpOnly cookie; the page never sees a token).
    await page.reload();
    await expect(accountChip(page)).toBeVisible();
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => c.name === 'uiex_session');
    expect(session?.httpOnly).toBe(true);
    expect(await page.evaluate(() => document.cookie)).not.toContain('uiex_session');
    expect(watch.errors).toEqual([]);
  });

  test('b: previews a real sample contact: record properties and associated deals', async ({ page }) => {
    const watch = watchConsole(page);
    await openEditor(page);
    await connectHubSpot(page);
    await importLiveContactCard(page);

    await pickSampleContact(page, 'Priya', 'Priya Patel', '02a-record-picker-open');
    await expect(cardRoot(page).getByText('First name: Priya')).toBeVisible();
    await expect(cardRoot(page).getByText('Email: priya@globex.io')).toBeVisible();
    const deals = cardRoot(page).locator('[data-node-type="TableBody"]');
    await expect(deals).toContainText('Globex – Onboarding package');
    await expect(deals).toContainText('Globex – Data migration');
    await expect(deals).toContainText('18000');
    await snap(page, '02-connected-topbar-record-picker');

    // The preview (interactive mode) shows the same real data.
    await setMode(page, 'Preview');
    await expect(cardRoot(page).getByText('First name: Priya')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Live data: Priya Patel/ })).toBeVisible();
    await snap(page, '03-live-preview');

    // The console logs the live requests.
    await setMode(page, 'Design');
    await page.getByRole('tab', { name: 'Console' }).click();
    await expect(page.getByText(/Live: GET contact properties/).first()).toBeVisible();

    // The choice survives a reload (only ids are remembered; the name is looked up again).
    await page.reload();
    await expect(cardRoot(page).getByText('First name: Priya')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Live data: Priya Patel/ })).toBeVisible();

    // Mock data again with one click.
    await previewData(page).getByRole('button', { name: /Mock/ }).click();
    await expect(cardRoot(page).getByText('First name: Ada')).toBeVisible();
    expect(watch.errors).toEqual([]);
  });

  test('c: the Data panel suggests the portal’s own (custom) properties', async ({ page }) => {
    const watch = watchConsole(page);
    await openEditor(page);
    await connectHubSpot(page);
    await importLiveContactCard(page);

    await showLeftTab(page, 'Data');
    const sources = leftSidebar(page).getByRole('list', { name: 'Data sources' });
    await sources.getByRole('button', { name: /^record/ }).click();
    const picker = leftSidebar(page).getByRole('combobox', { name: 'Properties' });
    await picker.click();
    await picker.fill('loyal');
    const suggestions = page.getByRole('listbox', { name: 'Property suggestions' });
    const loyalty = suggestions.getByRole('option', { name: /Loyalty points/ });
    await expect(loyalty).toBeVisible();
    await expect(loyalty).toContainText('Custom');
    await expect(loyalty).toContainText('loyalty_points');
    await snap(page, '04-custom-property-picker');
    await loyalty.click();
    await expect(leftSidebar(page).getByRole('button', { name: 'Remove loyalty_points' })).toBeVisible();
    expect(watch.errors).toEqual([]);
  });

  test('d: disconnecting goes back to mock data', async ({ page }) => {
    const watch = watchConsole(page);
    await openEditor(page);
    await connectHubSpot(page);
    await importLiveContactCard(page);
    await pickSampleContact(page, 'Priya', 'Priya Patel');
    await expect(cardRoot(page).getByText('First name: Priya')).toBeVisible();

    await disconnectHubSpot(page);
    await expect(cardRoot(page).getByText('First name: Ada')).toBeVisible();
    await expect(previewData(page)).toHaveCount(0);
    // Signed out on the server too: a reload stays disconnected.
    await page.reload();
    await expect(connectButton(page)).toHaveAttribute('data-status', 'disconnected');
    expect(watch.errors).toEqual([]);
  });
});
