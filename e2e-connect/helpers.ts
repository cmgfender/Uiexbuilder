/// <reference lib="dom" />
/**
 * Shared steps for the "Connect HubSpot" end-to-end suite (see playwright.connect.config.ts).
 * The server behind the tests is the production Node server + the fake HubSpot portal
 * 12345678 (acmedemo.com) from server/fake-hubspot/seed.ts.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { expect, type Locator, type Page } from '@playwright/test';

export { cardRoot, leftSidebar, openEditor, setMode, showLeftTab, watchConsole } from '../e2e/helpers';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PORTAL_ID = 12345678;
export const HUB_DOMAIN = 'acmedemo.com';
/** The fake's demo personal access key (server/fake-hubspot/handler.ts FAKE_PERSONAL_ACCESS_KEY). */
export const DEMO_ACCESS_KEY = 'CiRuYTEtZmFrZS1kZW1vLWtleS1hY21lZGVtby0wMDAwMDAwMRIYdWlleC1kZW1vLWZha2UtcGFrLTAwMDAwMQ';

export const topBar = (page: Page): Locator => page.getByRole('banner', { name: 'Editor top bar' });
export const connectButton = (page: Page): Locator => topBar(page).getByRole('button', { name: 'Connect HubSpot' });
export const accountChip = (page: Page): Locator =>
  topBar(page).getByRole('button', { name: new RegExp(`^Connected to HubSpot: ${HUB_DOMAIN.replace('.', '\\.')}, account ${PORTAL_ID}`) });

/** Writes a screenshot when CONNECT_SCREENSHOTS=<dir> is set (the visual check of the main screens). */
export async function snap(page: Page, name: string, opts: { keepPointer?: boolean } = {}): Promise<void> {
  const dir = process.env.CONNECT_SCREENSHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  if (!opts.keepPointer) await page.mouse.move(2, 2); // no hover styles / tooltips in the picture
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/**
 * The full first-time sign-in: Connect HubSpot → consent explainer → HubSpot window (fake
 * authorize page) → Approve → the window closes and the top bar shows the connected account.
 */
export async function connectHubSpot(page: Page, opts: { screenshots?: boolean } = {}): Promise<void> {
  const button = connectButton(page);
  await expect(button).toHaveAttribute('data-status', 'disconnected');
  await button.click();

  const consent = page.getByRole('dialog', { name: 'Connect your HubSpot account' });
  await expect(consent).toBeVisible();
  await expect(consent).toContainText('read-only');
  await consent.getByRole('button', { name: 'Exact permissions HubSpot will ask for' }).click();
  await expect(consent).toContainText('Only if your account has them');
  if (opts.screenshots) await snap(page, '01-consent-dialog');

  const popupPromise = page.waitForEvent('popup');
  await consent.getByRole('button', { name: 'Continue to HubSpot' }).click();
  const popup = await popupPromise;
  await expect(topBar(page).getByRole('button', { name: /^Connecting to HubSpot/ })).toBeVisible();

  // The (fake) HubSpot authorize page, like the real consent screen.
  await popup.waitForLoadState('domcontentloaded');
  expect(new URL(popup.url()).pathname).toBe('/oauth/authorize');
  await expect(popup.getByRole('button', { name: 'Approve' })).toBeVisible();
  const closed = popup.waitForEvent('close');
  await popup.getByRole('button', { name: 'Approve' }).click();
  await closed;

  await expect(accountChip(page)).toBeVisible();
  await expect(accountChip(page)).toContainText(`${HUB_DOMAIN} · ${PORTAL_ID}`);
}

/** Opens the account menu from the connected chip and disconnects. */
export async function disconnectHubSpot(page: Page): Promise<void> {
  await accountChip(page).click();
  const menu = page.getByRole('dialog', { name: 'HubSpot account' });
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Disconnect' }).click();
  await expect(connectButton(page)).toHaveAttribute('data-status', 'disconnected');
}

/**
 * A builder document (.uiex.json) for a contact card that reads the record's properties and its
 * associated deals: Text `{{ record.firstname }}` / `{{ record.email }}` and a Table repeating over
 * `deals`. Built with the real model code, so it always matches the current document format.
 */
export async function liveContactDocument(): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  return builderDocument(LIVE_CONTACT_ENTRY, 'live-data-demo.uiex.json');
}

/**
 * A builder document whose card runs code (an expression with a call), like a file someone sent:
 * imported, its code is paused until the admin trusts it.
 */
export async function codeDocument(): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  return builderDocument(
    `
    import { createExtension, createProject } from './src/model/factory';
    import { newId } from './src/model/ids';
    import { serializeProject } from './src/model/persistence';

    export function make() {
      const card = createExtension({
        name: 'Shared Card',
        objectTypes: ['contacts'],
        content: [{ type: 'Text', name: 'Full name', text: "Full name: {{ [record.firstname, record.lastname].join(' ') }}" }],
      });
      card.dataSources.push({ id: newId('d'), kind: 'crmProperties', name: 'record', properties: ['firstname', 'lastname'] });
      return serializeProject(createProject('Shared Project', [card]));
    }
  `,
    'shared-project.uiex.json',
  );
}

async function builderDocument(entry: string, name: string): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const result = await build({
    stdin: { contents: entry, resolveDir: ROOT, sourcefile: name.replace(/\.uiex\.json$/, '-fixture.ts'), loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'warning',
  });
  const mod = (await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`)) as { make: () => string };
  return { name, mimeType: 'application/json', buffer: Buffer.from(mod.make()) };
}

const LIVE_CONTACT_ENTRY = `
    import { createExtension, createProject } from './src/model/factory';
    import { newId } from './src/model/ids';
    import { serializeProject } from './src/model/persistence';

    export function make() {
      const cell = (text) => ({ type: 'TableCell', children: [{ type: 'Text', text }] });
      const card = createExtension({
        name: 'Live Contact',
        objectTypes: ['contacts'],
        content: [
          {
            type: 'Flex',
            props: { direction: 'column', gap: 'medium' },
            children: [
              { type: 'Heading', text: 'Live contact' },
              { type: 'Text', name: 'First name', text: 'First name: {{ record.firstname }}' },
              { type: 'Text', name: 'Email', text: 'Email: {{ record.email }}' },
              {
                type: 'Table',
                name: 'Deals table',
                props: { bordered: true },
                children: [
                  { type: 'TableHead', children: [{ type: 'TableRow', children: [{ type: 'TableHeader', text: 'Deal' }, { type: 'TableHeader', text: 'Amount' }] }] },
                  {
                    type: 'TableBody',
                    children: [
                      {
                        type: 'TableRow',
                        name: 'Deal row',
                        repeat: { items: 'deals', itemName: 'deal', indexName: 'index', key: 'deal.toObjectId' },
                        children: [cell('{{ deal.properties.dealname }}'), cell('{{ deal.properties.amount }}')],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
      card.dataSources.push(
        { id: newId('d'), kind: 'crmProperties', name: 'record', properties: ['firstname', 'lastname', 'email'] },
        { id: newId('d'), kind: 'associations', name: 'deals', toObjectType: '0-3', properties: ['dealname', 'amount'], pageLength: 10 },
      );
      const project = createProject('Live Data Demo', [card]);
      return serializeProject(project);
    }
  `;
