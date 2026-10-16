import { expect, test, type Page } from '@playwright/test';
import { DEMO_ACCESS_KEY, PORTAL_ID, connectHubSpot, openEditor, snap, topBar, watchConsole } from './helpers';

async function openDeployTab(page: Page) {
  await topBar(page).getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /Export/ });
  await dialog.getByRole('tab', { name: 'Deploy to HubSpot' }).click();
  await expect(dialog.getByLabel('Paste your key')).toBeVisible();
  return dialog;
}

test.describe('Deploy to HubSpot (beta, fake portal)', () => {
  test('e: deploys with a personal access key: progress, then success with a project link', async ({ page }) => {
    const watch = watchConsole(page);
    await openEditor(page);
    await connectHubSpot(page);
    const dialog = await openDeployTab(page);
    await expect(dialog).toContainText(String(PORTAL_ID));

    // Plain-language help for getting the key.
    await dialog.getByRole('button', { name: /How do I get this\?/ }).click();
    await expect(dialog.getByRole('region', { name: 'How to get a personal access key' })).toBeVisible();

    await dialog.getByLabel('Paste your key').fill(DEMO_ACCESS_KEY);
    await dialog.getByRole('button', { name: 'Deploy to HubSpot' }).click();

    const progress = dialog.getByRole('list', { name: 'Deploy progress' });
    await expect(progress).toBeVisible();
    await expect(progress.locator('[aria-current="step"]')).toBeVisible();
    await snap(page, '05-deploy-progress');

    await expect(dialog.getByText('Next steps')).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByRole('status').filter({ hasText: /is deployed to HubSpot account/ })).toContainText(String(PORTAL_ID));
    const projectLink = dialog.getByRole('link', { name: /Open project in HubSpot/ });
    await expect(projectLink).toBeVisible();
    expect(await projectLink.getAttribute('href')).toContain(String(PORTAL_ID));
    await snap(page, '06-deploy-success');
    expect(watch.errors).toEqual([]);
  });

  test('e: a failed HubSpot build shows the log and lets the admin try again', async ({ page }) => {
    await openEditor(page);
    const dialog = await openDeployTab(page);
    // Not connected: the deploy goes to the account the key belongs to.
    await expect(dialog).toContainText(/HubSpot account your personal access key belongs to/);
    // The fake HubSpot fails the build for keys that contain "fail-build".
    await dialog.getByLabel('Paste your key').fill('pat-na1-fake-fail-build-00000000001');
    await dialog.getByRole('button', { name: 'Deploy to HubSpot' }).click();

    const alert = dialog.getByRole('alert').filter({ hasText: 'The deploy didn’t finish' });
    await expect(alert).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByRole('log', { name: 'Deploy log' })).toBeVisible();
    await expect(dialog.getByRole('list', { name: 'Deploy progress' }).getByText(/failed/)).toHaveCount(1);
    await snap(page, '07-deploy-failure');

    await dialog.getByRole('button', { name: 'Back' }).click();
    await expect(dialog.getByLabel('Paste your key')).toBeVisible();
  });

  test('e: a wrong key is explained next to the key field', async ({ page }) => {
    await openEditor(page);
    const dialog = await openDeployTab(page);
    const keyField = dialog.getByLabel('Paste your key');
    // Not shaped like a key at all: caught before anything is sent.
    await keyField.fill('fail-build');
    await dialog.getByRole('button', { name: 'Deploy to HubSpot' }).click();
    await expect(dialog.getByRole('alert')).toContainText('doesn\'t look like a personal access key');
    await expect(dialog.getByRole('alert').getByRole('link', { name: 'Open the key page in HubSpot' })).toBeVisible();
    // Shaped like a key, but HubSpot refuses it.
    await keyField.fill('pat-na1-not-a-real-key');
    await dialog.getByRole('button', { name: 'Deploy to HubSpot' }).click();
    await expect(dialog.getByRole('alert')).toContainText('HubSpot didn\'t accept this personal access key', { timeout: 30_000 });
    await expect(keyField).toBeVisible();
  });
});
