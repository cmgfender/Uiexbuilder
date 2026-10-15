import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { addFromPalette, cardNodes, cardRoot, inspector, leftSidebar, openEditor, setMode, showLeftTab, watchConsole } from './helpers';

test.describe('templates, export and persistence', () => {
  test('add a starter card from the templates panel', async ({ page }) => {
    const watch = watchConsole(page);
    await openEditor(page);
    await showLeftTab(page, 'Templates');
    await leftSidebar(page).getByRole('group', { name: 'Template type' }).getByRole('button', { name: 'Starter cards' }).click();
    await leftSidebar(page).getByRole('button', { name: 'Add Deal discount calculator to project' }).click();

    // The new card becomes the active extension and renders without runtime errors.
    await expect(page.getByRole('button', { name: /^Discount Calculator, / })).toBeVisible();
    await expect(cardNodes(page, 'StepperInput')).toHaveCount(1);
    await expect(cardNodes(page, 'CurrencyInput')).toHaveCount(1);
    await expect(cardRoot(page).locator('.hsp-rt-error')).toHaveCount(0);

    await setMode(page, 'Preview');
    await expect(cardNodes(page, 'StepperInput')).toHaveCount(1);
    await expect(cardRoot(page).locator('.hsp-rt-error')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'No problems — ready to export' })).toBeVisible();
    expect(watch.errors).toEqual([]);
  });

  test('export downloads a complete HubSpot project zip', async ({ page }) => {
    await openEditor(page);
    await addFromPalette(page, 'Button');
    await inspector(page).getByRole('combobox', { name: 'Text content' }).fill('Export me');

    await page.getByRole('banner', { name: 'Editor top bar' }).getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /Export/ });
    await expect(dialog).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: /Download project \(\.zip\)/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);

    const zip = await JSZip.loadAsync(await readFile(await download.path()));
    const entries = Object.keys(zip.files).filter((f) => !zip.files[f].dir);
    // Everything lives in one project folder named after the project slug.
    const roots = new Set(entries.map((f) => f.split('/')[0]));
    expect([...roots]).toEqual(['my-ui-extensions-app']);
    const prefix = 'my-ui-extensions-app/';
    const files = entries.map((f) => f.slice(prefix.length));
    const read = (f: string) => zip.file(prefix + f)!.async('string');
    expect(files).toContain('hsproject.json');
    expect(files).toContain('src/app/app-hsmeta.json');
    const cardTsx = files.filter((f) => /^src\/app\/cards\/[^/]+\.tsx$/.test(f));
    const cardMeta = files.filter((f) => /^src\/app\/cards\/[^/]+-hsmeta\.json$/.test(f));
    expect(cardTsx).toHaveLength(1);
    expect(cardMeta).toHaveLength(1);

    const source = await read(cardTsx[0]);
    expect(source).toContain('hubspot.extend');
    expect(source).toContain('Export me');
    const meta = JSON.parse(await read(cardMeta[0])) as { type: string; config: { location: string } };
    expect(meta.type).toBe('card');
    expect(meta.config.location).toBe('crm.record.tab');
    const project = JSON.parse(await read('hsproject.json')) as { platformVersion: string };
    expect(project.platformVersion).toMatch(/^20\d\d\.\d+$/);
  });

  test('autosaved project is restored after a reload', async ({ page }) => {
    await openEditor(page);
    await addFromPalette(page, 'Button');
    await inspector(page).getByRole('combobox', { name: 'Text content' }).fill('Persist me');
    await expect(cardNodes(page, 'Button')).toHaveText('Persist me');
    // The autosave status is visible but deliberately not a live region (no announcement per edit).
    await expect(page.getByRole('banner', { name: 'Editor top bar' }).getByText('Saved locally')).toBeVisible();

    await page.reload();
    await expect(cardNodes(page, 'Button')).toHaveText('Persist me');
    // The welcome card was dismissed on the first visit and stays hidden.
    await expect(page.getByRole('region', { name: 'Welcome' })).toHaveCount(0);
  });
  test('builder document round trip: download .uiex.json, start a new project, import it back', async ({ page }, testInfo) => {
    await openEditor(page);
    await addFromPalette(page, 'Button');
    await inspector(page).getByRole('combobox', { name: 'Text content' }).fill('Round trip');

    const topBar = page.getByRole('banner', { name: 'Editor top bar' });
    await topBar.getByRole('button', { name: 'Project', exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /Download \.uiex\.json/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.uiex\.json$/);
    const file = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(file);

    await topBar.getByRole('button', { name: 'Project', exact: true }).click();
    await page.getByRole('menuitem', { name: /New project/ }).click();
    const dialog = page.getByRole('dialog', { name: 'New project' });
    await dialog.getByLabel('App name').fill('Second App');
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(topBar.getByRole('button', { name: 'Second App' })).toBeVisible();
    await expect(cardNodes(page, 'Button')).toHaveCount(0);

    await page.getByLabel('Import .uiex.json file').setInputFiles(file);
    await expect(topBar.getByRole('button', { name: 'My UI Extensions App' })).toBeVisible();
    await expect(cardNodes(page, 'Button')).toHaveText('Round trip');
  });
});
