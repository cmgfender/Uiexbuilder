import { expect, test } from '@playwright/test';
import { openEditor, watchConsole } from './helpers';

/**
 * The builder on static hosting (here `vite preview`): no HubSpot connector behind it. Connect
 * HubSpot explains that it needs the hosted version; everything else keeps working on mock data.
 * The connected flows are covered by e2e-connect/ (npm run e2e:connect).
 */
test.describe('without the HubSpot connector (static hosting)', () => {
  test('Connect HubSpot says it is available on the hosted version, with no console errors', async ({ page }) => {
    const watch = watchConsole(page);
    await openEditor(page);
    const topBar = page.getByRole('banner', { name: 'Editor top bar' });
    const button = topBar.getByRole('button', { name: 'Connect HubSpot' });
    await expect(button).toHaveAttribute('data-status', 'unavailable');
    await expect(button).toHaveAttribute('title', 'Available on the hosted version');
    // Muted but operable: a click (or Enter) explains why, so it is not announced as disabled.
    await expect(button).not.toHaveAttribute('aria-disabled');

    await button.click();
    const note = page.getByRole('dialog', { name: 'About Connect HubSpot' });
    await expect(note).toBeVisible();
    await expect(note).toContainText('Connecting to HubSpot is available on the hosted version.');
    await expect(note.getByRole('link', { name: /How to host the builder/ })).toHaveAttribute('href', /docs\/HOSTING\.md$/);
    await page.keyboard.press('Escape');
    await expect(note).toBeHidden();

    // No live-data controls without a connection; the preview keeps its mock data.
    await expect(page.getByRole('group', { name: 'Preview data' })).toHaveCount(0);

    // Deploy to HubSpot falls back to the CLI steps.
    await topBar.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /Export/ });
    await dialog.getByRole('tab', { name: 'Deploy to HubSpot' }).click();
    await expect(dialog.getByText('Deploying from the builder isn’t available here')).toBeVisible();

    await page.waitForTimeout(300);
    expect(watch.errors).toEqual([]);
  });
});
