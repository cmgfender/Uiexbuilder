import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { connectButton, openEditor, topBar, watchConsole } from './helpers';

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

  test('connector running but HubSpot sign-in not set up: explains what the host must add', async ({ page }) => {
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
    await expect(note).toContainText('isn\'t set up yet');
    await expect(note).toContainText('HUBSPOT_CLIENT_ID');
    await expect(note.getByRole('link', { name: /Open the setup checklist/ })).toHaveAttribute('href', '/setup.html');
    await page.keyboard.press('Escape');

    // Deploy to HubSpot still works without sign-in (personal access key only).
    await topBar(page).getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /Export/ });
    await dialog.getByRole('tab', { name: 'Deploy to HubSpot' }).click();
    await expect(dialog.getByLabel('Paste your key')).toBeVisible();
    expect(watch.errors).toEqual([]);
  });
});
