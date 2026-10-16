import { expect, test, type Page } from '@playwright/test';
import { DEMO_ACCESS_KEY, PORTAL_ID, connectHubSpot, openEditor, snap, topBar, watchConsole } from './helpers';

async function openDeployTab(page: Page) {
  await topBar(page).getByRole('button', { name: 'Publish', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish to HubSpot' });
  // With a connector that can publish, the Publish dialog opens on its Publish to HubSpot tab.
  await expect(dialog.getByRole('tab', { name: 'Publish to HubSpot' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByLabel('Paste your key')).toBeVisible();
  return dialog;
}

test.describe('Publish to HubSpot (beta, fake portal)', () => {
  test('e: publishes with a personal access key: key page link, progress, then the Finish in HubSpot checklist', async ({ page }) => {
    const watch = watchConsole(page);
    await openEditor(page);
    await connectHubSpot(page);
    const dialog = await openDeployTab(page);
    await expect(dialog).toContainText(String(PORTAL_ID));

    // Step 1 of the wizard, followed literally: the direct link opens the (fake) HubSpot personal
    // access key page of the connected account (the page the HubSpot CLI opens), which shows the key.
    await expect(dialog.getByRole('list', { name: 'Publish steps' }).locator('[aria-current="step"]')).toContainText('Get your key');
    const guide = dialog.getByRole('region', { name: 'How to get a personal access key' });
    await expect(guide).toBeVisible();
    await expect(guide).toContainText('Developer projects');
    await snap(page, '04a-publish-key-step');
    const keyPagePromise = page.waitForEvent('popup');
    await dialog.getByRole('link', { name: /Open HubSpot’s key page/ }).click();
    const keyPage = await keyPagePromise;
    await keyPage.waitForLoadState('domcontentloaded');
    expect(new URL(keyPage.url()).pathname).toBe(`/personal-access-key/${PORTAL_ID}`);
    const shownKey = (await keyPage.locator('#k').textContent())?.trim() ?? '';
    expect(shownKey).toBe(DEMO_ACCESS_KEY);
    await keyPage.close();

    await dialog.getByLabel('Paste your key').fill(shownKey);
    await dialog.getByRole('button', { name: 'Publish to HubSpot' }).click();

    const progress = dialog.getByRole('list', { name: 'Publish progress' });
    await expect(progress).toBeVisible();
    await expect(progress.locator('[aria-current="step"]')).toBeVisible();
    await snap(page, '05-deploy-progress');

    const checklist = dialog.getByRole('region', { name: 'Finish in HubSpot' });
    await expect(checklist).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByRole('status').filter({ hasText: /It’s in the HubSpot account/ })).toContainText(String(PORTAL_ID));
    const projectLink = dialog.getByRole('link', { name: /Open project in HubSpot/ });
    await expect(projectLink).toBeVisible();
    expect(await projectLink.getAttribute('href')).toContain(String(PORTAL_ID));
    // Direct links for each step in HubSpot; ticks are remembered.
    await expect(checklist.getByRole('link', { name: /Open HubSpot settings/ })).toHaveAttribute('href', new RegExp(`/settings/${PORTAL_ID}$`));
    await expect(checklist.getByText(/Record Customization tab/)).toBeVisible();
    await checklist.getByRole('checkbox', { name: 'Install the app in your account' }).check();
    await expect(checklist).toContainText('1 of 3 done');
    await snap(page, '06-deploy-success');
    expect(watch.errors).toEqual([]);
  });

  test('e: deploying needs a HubSpot sign-in first', async ({ page }) => {
    await openEditor(page);
    await topBar(page).getByRole('button', { name: 'Publish', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Publish to HubSpot' });
    const signIn = dialog.getByRole('region', { name: 'Connect HubSpot first' });
    await expect(signIn).toBeVisible();
    await expect(signIn).toContainText('Your cards are published to the HubSpot account you’re connected to');
    await expect(dialog.getByLabel('Paste your key')).toHaveCount(0);
    await snap(page, '05a-deploy-connect-first');
  });

  test('e: a failed HubSpot build shows the log and points back to the builder', async ({ page }) => {
    await openEditor(page);
    await connectHubSpot(page);
    const dialog = await openDeployTab(page);
    // The fake HubSpot fails the build for keys that contain "fail-build".
    await dialog.getByLabel('Paste your key').fill('CiRuYTEtZmFrZS1rZXk-fail-build-00000000001');
    await dialog.getByRole('button', { name: 'Publish to HubSpot' }).click();

    const alert = dialog.getByRole('alert').filter({ hasText: 'The publish didn’t finish' });
    await expect(alert).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByRole('log', { name: 'Publish log' })).toBeVisible();
    await expect(dialog.getByRole('list', { name: 'Publish progress' }).getByText(/failed/)).toHaveCount(1);
    // What to do next, in plain words.
    await expect(dialog.getByRole('region', { name: 'What to do next' })).toContainText('not something you did');
    // A build problem isn't fixed by retrying: the builder file can go to whoever looks after the builder.
    await expect(dialog.getByRole('button', { name: /Download builder file/ })).toBeVisible();
    await snap(page, '07-deploy-failure');

    await dialog.getByRole('button', { name: 'Back' }).click();
    await expect(dialog.getByLabel('Paste your key')).toBeVisible();
  });

  test('e: a wrong key is explained next to the key field', async ({ page }) => {
    await openEditor(page);
    await connectHubSpot(page);
    const dialog = await openDeployTab(page);
    const keyField = dialog.getByLabel('Paste your key');
    // Not shaped like a key at all: caught before anything is sent.
    await keyField.fill('fail-build');
    await dialog.getByRole('button', { name: 'Publish to HubSpot' }).click();
    await expect(dialog.getByRole('alert')).toContainText('doesn\'t look like a personal access key');
    await expect(dialog.getByRole('alert').getByRole('link', { name: 'Open the key page in HubSpot' })).toBeVisible();
    // A private app token (pat-…) instead of a personal access key: said right away, and again
    // when HubSpot refuses it.
    await keyField.fill(['pat', 'na1', '11111111-2222-3333-4444-555555555555'].join('-'));
    await expect(dialog).toContainText('This looks like a private app access token');
    await dialog.getByRole('button', { name: 'Publish to HubSpot' }).click();
    await expect(dialog.getByRole('alert')).toContainText('This looks like a private app access token', { timeout: 30_000 });
    // Shaped like a key, but HubSpot refuses it.
    await keyField.fill('CiRuYTEtbm90LWEtcmVhbC1rZXktMDAwMDAwMDA');
    await dialog.getByRole('button', { name: 'Publish to HubSpot' }).click();
    await expect(dialog.getByRole('alert')).toContainText('HubSpot didn\'t accept this personal access key', { timeout: 30_000 });
    await expect(keyField).toBeVisible();
    await snap(page, '07a-deploy-wrong-key');
  });
});
