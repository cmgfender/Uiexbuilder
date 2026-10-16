import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { connectButton, openEditor, snap, topBar, watchConsole } from './helpers';

const INDEX_HTML = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.html'), 'utf8');

/**
 * The regular build (the one with a connector) in the two "can't connect yet" situations a host can
 * end up in. Simulated by answering /api in the browser; the rest of the app is the real server.
 */
test.describe('hosting states', () => {
  test('regular build on a static host that answers /api with index.html: unavailable, no console errors', async ({ page }) => {
    const watch = watchConsole(page);
    await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: INDEX_HTML }));
    await openEditor(page);
    const button = connectButton(page);
    await expect(button).toHaveAttribute('data-status', 'unavailable');
    await expect(button).toHaveAttribute('title', 'Available on the hosted version');
    await button.press('Enter');
    const note = page.getByRole('dialog', { name: 'About Connect HubSpot' });
    await expect(note).toContainText('Connecting to HubSpot is available on the hosted version.');
    await page.keyboard.press('Escape');
    await expect(note).toBeHidden();
    await expect(button).toBeFocused();
    await expect(page.getByRole('group', { name: 'Preview data' })).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(watch.errors).toEqual([]);
  });

  test('connector running but HubSpot sign-in not set up: points the admin to whoever set it up', async ({ page }) => {
    const watch = watchConsole(page);
    await page.route('**/api/health', async (route) => {
      const real = await route.fetch();
      const body = (await real.json()) as Record<string, unknown>;
      await route.fulfill({ response: real, json: { ...body, oauthConfigured: false, features: { crm: false, fetchProxy: false, deploy: true } } });
    });
    await openEditor(page);
    const button = connectButton(page);
    await expect(button).toHaveAttribute('data-status', 'not-configured');
    await button.click();
    const note = page.getByRole('dialog', { name: 'About Connect HubSpot' });
    await expect(note).toContainText('HubSpot sign-in isn\'t switched on yet');
    await expect(note).toContainText('keep building with mock data');
    // Admins don't see server setting names; the setup checklist has them.
    await expect(note).not.toContainText('HUBSPOT_CLIENT_ID');
    await expect(note.getByRole('link', { name: /Open the setup checklist/ })).toHaveAttribute('href', '/setup.html');
    await page.keyboard.press('Escape');

    // While sign-in isn't set up (first-time setup: deploying the connector app itself), Deploy to
    // HubSpot works with the personal access key alone.
    await topBar(page).getByRole('button', { name: 'Publish', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Publish to HubSpot' });
    await dialog.getByRole('tab', { name: 'Publish to HubSpot' }).click();
    await expect(dialog.getByLabel('Paste your key')).toBeVisible();
    expect(watch.errors).toEqual([]);
  });

  test('SESSION_SECRET still missing: the deploy tab and the setup page say what to do', async ({ page }) => {
    const watch = watchConsole(page);
    await page.route('**/api/health', async (route) => {
      const real = await route.fetch();
      const body = (await real.json()) as Record<string, unknown>;
      await route.fulfill({
        response: real,
        json: {
          ...body,
          oauthConfigured: false,
          missingSettings: ['HUBSPOT_CLIENT_ID', 'HUBSPOT_CLIENT_SECRET', 'SESSION_SECRET'],
          features: { crm: false, fetchProxy: false, deploy: false, deployUnavailableReason: 'session_secret' },
        },
      });
    });
    await openEditor(page);
    await topBar(page).getByRole('button', { name: 'Publish', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Publish to HubSpot' });
    await dialog.getByRole('tab', { name: 'Publish to HubSpot' }).click();
    await expect(dialog).toContainText('SESSION_SECRET');
    await expect(dialog.getByRole('link', { name: /setup checklist/i })).toHaveAttribute('href', '/setup.html');
    await expect(dialog).not.toContainText('turned off deploying');
    await snap(page, '09-deploy-needs-session-secret');

    await page.goto('/setup.html');
    const warning = page.locator('#deploy-warning');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('Deploy to HubSpot needs SESSION_SECRET first');
    await expect(warning.getByRole('link', { name: 'Make one here' })).toHaveAttribute('href', '/secret.html');
    await expect(page.locator('#status-detail')).toContainText('Still missing: HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET, SESSION_SECRET');
    await expect(page.getByText('Acceptable Use Policy', { exact: true })).toBeVisible();
    await snap(page, '10-setup-page-session-secret');
    expect(watch.errors).toEqual([]);
  });
});
