import { expect, test, type Page } from '@playwright/test';
import { DEMO_ACCESS_KEY, HUB_DOMAIN, PORTAL_ID, accountChip, connectButton, connectHubSpot, openEditor, snap, topBar, watchConsole } from './helpers';

/**
 * When HubSpot says no: every problem is easy to see and to fix.
 *  - Sign-in: HubSpot shows install refusals (Acceptable Use Policy not signed, not allowed to
 *    install apps …) INSIDE its window and never comes back — the builder asks "What did HubSpot
 *    show?" and gives the fix (and a note for whoever set up the builder). A blocked window is one
 *    click from signing in in this tab.
 *  - Publish: the key is checked before anything is uploaded — a key without "Developer
 *    projects", a key from another account, a HubSpot 403 — each with its fix, and Check again /
 *    Try again keep the key and the project.
 * The fake HubSpot plays HubSpot's side: its consent page links to the install refusals, and its
 * personal access key page can remove / add back the key's "Developer projects" permission.
 */

/** The other account the fake HubSpot knows (server/fake-hubspot/projects.ts FAKE_OTHER_PORTAL_ID). */
const OTHER_PORTAL_ID = 87654321;

async function openSignInWindow(page: Page) {
  await expect(connectButton(page)).toHaveAttribute('data-status', 'disconnected');
  await connectButton(page).click();
  const consent = page.getByRole('dialog', { name: 'Connect your HubSpot account' });
  const popupPromise = page.waitForEvent('popup');
  await consent.getByRole('button', { name: 'Continue to HubSpot' }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  return popup;
}

async function openPublish(page: Page) {
  await topBar(page).getByRole('button', { name: 'Publish', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish to HubSpot' });
  await expect(dialog.getByLabel('Paste your key')).toBeVisible();
  return dialog;
}

/** Turns the demo key's "Developer projects" permission on or off on the fake HubSpot (its key page form). */
async function setDeveloperProjects(page: Page, fakeOrigin: string, on: boolean) {
  await page.request.post(`${fakeOrigin}/personal-access-key/${PORTAL_ID}/permissions`, { form: { developerProjects: on ? 'on' : 'off' }, maxRedirects: 0 });
}

test.describe('Sign-in: when HubSpot says no', () => {
  test('HubSpot refuses to install the app (Acceptable Use Policy): "What did HubSpot show?" gives the fix and a note', async ({ page, context }) => {
    const watch = watchConsole(page);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openEditor(page);
    const popup = await openSignInWindow(page);
    // HubSpot shows the refusal inside its window and never returns to the builder.
    await popup.getByRole('link', { name: 'The app could not be installed' }).click();
    await expect(popup.getByText(/the app developer has not signed the acceptable use policy/)).toBeVisible();
    // The person reads it for a while, then closes the window.
    await page.waitForTimeout(4500);
    await popup.close();

    const dialog = page.getByRole('dialog', { name: 'HubSpot was not connected' });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    const choices = dialog.getByRole('group', { name: 'What did HubSpot show?' });
    await expect(choices.getByRole('radio')).toHaveCount(5);
    await snap(page, 'tr-01-what-did-hubspot-show');
    await choices.getByRole('radio', { name: /acceptable use policy/ }).check();
    const fix = dialog.getByRole('region', { name: /needs to sign HubSpot’s Acceptable Use Policy/ });
    await expect(fix).toContainText('Fixed by whoever set up this builder');
    await expect(fix).toContainText('Begin publishing');
    await expect(fix.getByRole('link', { name: /Setup checklist/ })).toHaveAttribute('href', /\/setup\.html$/);
    await fix.getByRole('button', { name: 'Copy a note for whoever set up this builder' }).click();
    await expect(fix.getByRole('status')).toContainText(/Copied|selected/);
    const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    if (copied) expect(copied).toContain('acceptable use policy');
    await fix.getByRole('button', { name: /Show the note|Hide the note/ }).first().click();
    await snap(page, 'tr-02-aup-fix');

    // Once it's fixed, Try again goes back to HubSpot (not the main button for a host-side problem).
    const again = page.waitForEvent('popup');
    await dialog.getByRole('button', { name: 'Try again' }).click();
    const second = await again;
    await second.waitForLoadState('domcontentloaded');
    const closed = second.waitForEvent('close');
    await second.getByRole('button', { name: 'Approve' }).click();
    await closed;
    await expect(accountChip(page)).toBeVisible();
    expect(watch.errors).toEqual([]);
  });

  test('a blocked HubSpot window: one click continues in this tab and comes back connected', async ({ page }) => {
    await openEditor(page);
    // The browser blocks the pop-up.
    await page.evaluate(() => {
      window.open = () => null;
    });
    await connectButton(page).click();
    await page.getByRole('dialog', { name: 'Connect your HubSpot account' }).getByRole('button', { name: 'Continue to HubSpot' }).click();
    const blocked = page.getByRole('dialog', { name: 'Your browser blocked the HubSpot window' });
    await expect(blocked).toBeVisible();
    await expect(blocked).toContainText('nothing happened yet');
    // Nothing happened behind the person's back: still in the builder.
    expect(new URL(page.url()).pathname).toBe('/');
    await snap(page, 'tr-03-popup-blocked');
    await blocked.getByRole('button', { name: 'Continue in this tab' }).click();
    await page.waitForURL(/\/oauth\/authorize/);
    await page.getByRole('button', { name: 'Approve' }).click();
    // Back in the builder, connected (the address loses the sign-in result again).
    await expect(accountChip(page)).toContainText(`${HUB_DOMAIN} · ${PORTAL_ID}`, { timeout: 15_000 });
    expect(new URL(page.url()).search).not.toContain('uiex_auth');
  });
});

test.describe('Publish: the key is checked before anything is uploaded', () => {
  test('a key without "Developer projects": the fix with its account’s key page, then Check again and publish', async ({ page }) => {
    await openEditor(page);
    await connectHubSpot(page);
    const dialog = await openPublish(page);
    const keyLink = dialog.getByRole('link', { name: /Open HubSpot’s key page/ });
    const fakeOrigin = new URL((await keyLink.getAttribute('href')) ?? '').origin;
    try {
      // In HubSpot, the key's Developer projects permission was left out.
      const keyPagePromise = page.waitForEvent('popup');
      await keyLink.click();
      const keyPage = await keyPagePromise;
      await keyPage.getByRole('button', { name: 'Remove Developer projects from this key' }).click();
      await expect(keyPage.locator('#perm')).toContainText('not included');
      const key = (await keyPage.locator('#k').textContent())?.trim() ?? '';
      expect(key).toBe(DEMO_ACCESS_KEY);
      await keyPage.close();

      // Pasted: checked by itself, before anything is uploaded.
      await dialog.getByLabel('Paste your key').fill(key);
      const problem = dialog.getByRole('alert', { name: /missing the “Developer projects” permission/ });
      await expect(problem).toBeVisible({ timeout: 15_000 });
      await expect(problem).toContainText(`Key for Acme Demo (fake) (account ${PORTAL_ID}) — the account you’re connected to`);
      await expect(dialog.getByRole('button', { name: /Fix the key first/ })).toBeVisible();
      await snap(page, 'tr-04-key-missing-permission');
      // Publish doesn't upload while the key can't publish.
      await dialog.getByRole('button', { name: 'Publish to HubSpot' }).click();
      await expect(problem).toBeVisible();
      await expect(dialog.getByRole('list', { name: 'Publish progress' })).toHaveCount(0);

      // The fix: the key page of the key's own account, add the permission, Check again.
      const fixPagePromise = page.waitForEvent('popup');
      await problem.getByRole('link', { name: /Open the key page for Acme Demo/ }).click();
      const fixPage = await fixPagePromise;
      expect(new URL(fixPage.url()).pathname).toBe(`/personal-access-key/${PORTAL_ID}`);
      await fixPage.getByRole('button', { name: 'Add Developer projects to this key' }).click();
      await expect(fixPage.locator('#perm')).toContainText('✓');
      await fixPage.close();
      await problem.getByRole('button', { name: 'Check again' }).click();
      await expect(dialog.getByText(/Key checked: it belongs to Acme Demo \(fake\)/)).toBeVisible();
      await expect(dialog.getByLabel('Paste your key')).toHaveValue(key);

      await dialog.getByRole('button', { name: 'Publish to HubSpot' }).click();
      await expect(dialog.getByRole('region', { name: 'Finish in HubSpot' })).toBeVisible({ timeout: 60_000 });
    } finally {
      await setDeveloperProjects(page, fakeOrigin, true);
    }
  });

  test('a key from another HubSpot account: both accounts and both ways out', async ({ page }) => {
    await openEditor(page);
    await connectHubSpot(page);
    const dialog = await openPublish(page);
    const href = (await dialog.getByRole('link', { name: /Open HubSpot’s key page/ }).getAttribute('href')) ?? '';
    // The admin copied the key of another account they have.
    const other = await page.context().newPage();
    await other.goto(`${new URL(href).origin}/personal-access-key/${OTHER_PORTAL_ID}`);
    const otherKey = (await other.locator('#k').textContent())?.trim() ?? '';
    await other.close();

    await dialog.getByLabel('Paste your key').fill(otherKey);
    const problem = dialog.getByRole('alert', { name: /This key is for a different HubSpot account/ });
    await expect(problem).toBeVisible({ timeout: 15_000 });
    await expect(problem).toContainText(`Other Co (fake) (account ${OTHER_PORTAL_ID})`);
    await expect(problem).toContainText(`${HUB_DOMAIN} (account ${PORTAL_ID})`);
    await expect(problem.getByRole('link', { name: new RegExp(`Open the key page for ${HUB_DOMAIN.replace('.', '\\.')}`) })).toHaveAttribute('href', new RegExp(`/personal-access-key/${PORTAL_ID}$`));
    await expect(problem.getByRole('button', { name: 'Switch HubSpot account' })).toBeVisible();
    await snap(page, 'tr-05-key-other-account');

    // The right key fixes it.
    await dialog.getByLabel('Paste your key').fill(DEMO_ACCESS_KEY);
    await expect(dialog.getByText(/Key checked: it belongs to Acme Demo/)).toBeVisible({ timeout: 15_000 });
    await expect(problem).toHaveCount(0);
  });

  test('HubSpot refuses the upload (403): its own words, the fix and Try again', async ({ page }) => {
    await openEditor(page);
    await connectHubSpot(page);
    const dialog = await openPublish(page);
    // The fake HubSpot refuses uploads for keys that contain "no-dev-tools" (the user may not use developer tools).
    await dialog.getByLabel('Paste your key').fill('CiRuYTEt-fake-key-no-dev-tools-0000000001');
    await expect(dialog.getByText(/Key checked: it belongs to/)).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Publish to HubSpot' }).click();
    const problem = dialog.getByRole('alert', { name: /HubSpot refused to take the project/ });
    await expect(problem).toBeVisible({ timeout: 30_000 });
    await expect(problem).toContainText('HubSpot said: “The user does not have permission to use developer tools in this account.”');
    await expect(problem.getByRole('button', { name: 'Copy a note for your Super Admin' })).toBeVisible();
    await expect(problem.getByRole('button', { name: 'Try again' })).toBeVisible();
    await snap(page, 'tr-06-forbidden');
  });
});
