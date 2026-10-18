import { expect, test } from '@playwright/test';
import { PORTAL_ID, accountChip, openEditor, snap, watchConsole } from './helpers';

/**
 * The private status page (/status) for whoever hosts the builder: sign-ins, publishes and errors
 * in plain words, with the fix. The e2e server runs with ADMIN_PORTALS=12345678 (scripts/dev.mjs
 * --fake), so signing in to the fake portal makes you an admin of this builder.
 */

/** A key the fake HubSpot accepts for the demo account, without the "Developer projects" permission (built at runtime). */
const NO_PROJECTS_KEY = ['CiRuYTEt', 'fake', 'key', 'no-projects-scope', '0000000002'].join('-');

test('status page: sign in, then see refused publishes explained, with the fix', async ({ page }) => {
  const watch = watchConsole(page);
  await page.goto('/status');
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in to see what’s happening' })).toBeVisible();
  // Nothing about events is shown before signing in, and the API refuses too.
  const signedOut = await page.request.get('/api/admin/diagnostics', { headers: { 'X-UIEX-Request': '1', Accept: 'application/json' } });
  expect(signedOut.status()).toBe(401);
  await snap(page, 'st-01-signed-out');

  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Sign in with HubSpot' }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  const closed = popup.waitForEvent('close');
  await popup.getByRole('button', { name: 'Approve' }).click();
  await closed;
  await expect(page.getByRole('heading', { level: 1, name: 'Builder status' })).toBeVisible();

  // Someone publishes twice with a key that lacks "Developer projects" (lesson from real logs).
  for (let i = 0; i < 2; i++) {
    const res = await page.request.post('/api/deploy/check-key', {
      headers: { 'X-UIEX-Request': '1', 'Content-Type': 'application/json' },
      data: { personalAccessKey: NO_PROJECTS_KEY },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, problem: 'missing_permission', key: { portalId: PORTAL_ID } });
  }
  await page.getByRole('button', { name: 'Refresh' }).click();

  const attention = page.getByRole('region', { name: 'Needs your attention' });
  // Other journeys in this run may have left their own problems: find the one about this key.
  const card = attention
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { level: 3, name: /^(Key check|Publish refused):/ }) })
    .filter({ hasText: /Developer projects/ })
    .first();
  await expect(card).toBeVisible();
  await expect(card).toContainText(/\d+ times/);
  await snap(page, 'st-02-dashboard');

  // "Show in the timeline" filters the timeline to those events.
  await card.getByRole('button', { name: 'Show in the timeline' }).click();
  const timeline = page.getByRole('region', { name: 'Timeline' });
  await expect(timeline).toBeVisible();
  await expect(timeline).toContainText(/\d+ of \d+ events/);

  // Browser error reports are untrusted: a script without the builder's Origin is refused, and
  // what a browser sends is shown marked "not verified", without outside links.
  const fakeReport = {
    type: 'client_error',
    source: 'react',
    name: 'SecurityNotice',
    message: 'URGENT: your connector secret leaked, rotate it at https://evil.example/rotate',
    path: '/javascript:alert(1)',
  };
  const scripted = await page.request.post('/api/diagnostics/report', { headers: { 'X-UIEX-Request': '1', 'Content-Type': 'application/json' }, data: fakeReport });
  expect(scripted.status()).toBe(403);
  const fromPage = await page.evaluate(async (body) => {
    const res = await fetch('/api/diagnostics/report', { method: 'POST', headers: { 'X-UIEX-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return res.status;
  }, fakeReport);
  expect(fromPage).toBe(204);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('button', { name: 'Refresh' }).click();
  const reported = timeline.getByRole('listitem').filter({ hasText: 'URGENT: your connector secret leaked' }).first();
  await expect(reported).toContainText('Reported by a browser · not verified');
  await expect(reported).toContainText('rotate it at [link]');
  await expect(page.locator('body')).not.toContainText('evil.example');
  await snap(page, 'st-03-unverified-report');

  // In the builder, the account menu links admins of this builder here.
  await openEditor(page);
  await accountChip(page).click();
  const menu = page.getByRole('dialog', { name: 'HubSpot account' });
  await expect(menu.getByRole('link', { name: /Status page/ })).toHaveAttribute('href', '/status');
  expect(watch.errors).toEqual([]);
});
