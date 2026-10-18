import { expect, test } from '@playwright/test';
import {
  addFromPalette,
  cardNodes,
  cardRoot,
  expectInspectorFor,
  html5Drag,
  inspector,
  layerRow,
  layersTree,
  leftSidebar,
  MOD,
  mouseDrag,
  openEditor,
  showLeftTab,
  watchConsole,
} from './helpers';

test.describe('editor basics', () => {
  test('loads the default project without console errors', async ({ page }) => {
    const watch = watchConsole(page);
    await page.goto('/');
    // First visit: the welcome screen covers the editor; skipping it opens the editor.
    await expect(page.getByRole('dialog', { name: 'Build your own HubSpot cards' })).toBeVisible();
    await page.getByRole('button', { name: /I know what I’m doing/ }).click();
    await expect(page.getByRole('banner', { name: 'Editor top bar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'My UI Extensions App' })).toBeVisible();
    await expect(page.getByTestId('canvas')).toBeVisible();
    // The default card renders its starter content.
    await expect(cardNodes(page, 'Heading')).toHaveCount(1);
    await expect(cardNodes(page, 'Heading')).toContainText('Hello');
    await expect(cardRoot(page).locator('.hsp-rt-error')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'No problems — ready to publish' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(watch.errors).toEqual([]);
  });

  test('drag a Button from the palette onto the canvas', async ({ page }) => {
    const watch = watchConsole(page);
    await openEditor(page);
    await expect(cardNodes(page, 'Button')).toHaveCount(0);

    const tile = leftSidebar(page).getByRole('button', { name: 'Add Button', exact: true });
    const text = cardNodes(page, 'Text').first();
    const box = (await text.boundingBox())!;
    // Real pointer drag; drop on the bottom edge of the starter paragraph (→ after it).
    await mouseDrag(page, tile, text, { x: box.width / 2, y: box.height - 2 });

    await expect(cardNodes(page, 'Button')).toHaveCount(1);
    await expect(cardNodes(page, 'Button')).toContainText('Click me');
    await expectInspectorFor(page, 'Button');
    await expect(inspector(page).getByRole('combobox', { name: 'Text content' })).toHaveValue('Click me');

    await showLeftTab(page, 'Layers');
    const row = layerRow(page, /^Button/);
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute('aria-selected', 'true');
    // A completed drop counts as "recently used".
    await showLeftTab(page, 'Components');
    await expect(leftSidebar(page).getByRole('region', { name: 'Recently used' }).getByRole('button', { name: 'Add Button' })).toBeVisible();
    expect(watch.errors).toEqual([]);
  });

  test('drag a block from the templates panel (one undo step with its state)', async ({ page }) => {
    await openEditor(page);
    await showLeftTab(page, 'Templates');
    const block = leftSidebar(page).getByRole('group', { name: 'Blocks' }).getByRole('button', { name: /^Search \+ results/ });
    const text = cardNodes(page, 'Text').first();
    const box = (await text.boundingBox())!;
    await html5Drag(page, block, text, { x: box.width / 2, y: box.height - 2 });
    await expect(cardNodes(page, 'SearchInput')).toHaveCount(1);
    await showLeftTab(page, 'Data');
    const stateList = leftSidebar(page).getByRole('list', { name: 'State variables' });
    await expect(stateList.getByRole('listitem')).toHaveCount(1);
    await expect(stateList).toContainText('query');

    await page.getByRole('region', { name: 'Design canvas' }).focus();
    await page.keyboard.press(`${MOD}+z`);
    await expect(cardNodes(page, 'SearchInput')).toHaveCount(0);
    await expect(stateList).toHaveCount(0);
  });

  test('edit button text and variant in the inspector, then see the code', async ({ page }) => {
    await openEditor(page);
    await addFromPalette(page, 'Button');
    await expectInspectorFor(page, 'Button');

    const textInput = inspector(page).getByRole('combobox', { name: 'Text content' });
    await textInput.fill('Save deal');
    await expect(cardNodes(page, 'Button')).toHaveText('Save deal');

    await inspector(page).getByRole('radiogroup', { name: 'Style' }).getByRole('radio', { name: 'Destructive' }).check();
    await expect(cardNodes(page, 'Button')).toHaveClass(/destructive/);

    await page.getByRole('tab', { name: 'Code' }).click();
    const code = page.getByRole('region', { name: /tsx code/ });
    await expect(code).toContainText('<Button');
    await expect(code).toContainText('variant="destructive"');
    await expect(code).toContainText('Save deal');
  });

  test('undo / redo / delete with the keyboard and reorder in the layers tree', async ({ page }) => {
    await openEditor(page);
    await addFromPalette(page, 'Button');
    await expect(cardNodes(page, 'Button')).toHaveCount(1);
    await addFromPalette(page, 'Divider');
    await expect(cardNodes(page, 'Divider')).toHaveCount(1);

    // Focus the canvas (shortcuts are ignored while typing in fields).
    await page.getByRole('region', { name: 'Design canvas' }).focus();
    await page.keyboard.press(`${MOD}+z`);
    await expect(cardNodes(page, 'Divider')).toHaveCount(0);
    await page.keyboard.press(`${MOD}+Shift+z`);
    await expect(cardNodes(page, 'Divider')).toHaveCount(1);

    // Delete the selected Divider.
    await cardNodes(page, 'Divider').click();
    await expectInspectorFor(page, 'Divider');
    await page.keyboard.press('Delete');
    await expect(cardNodes(page, 'Divider')).toHaveCount(0);
    await page.keyboard.press(`${MOD}+z`);
    await expect(cardNodes(page, 'Divider')).toHaveCount(1);

    // Layers: drag the Divider above the Button. (Click-to-add put both at the end of the card's
    // main column.)
    await showLeftTab(page, 'Layers');
    const order = async () =>
      cardRoot(page)
        .locator(':scope > [data-node-id] > [data-node-id]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-type')).slice(-2));
    expect(await order()).toEqual(['Button', 'Divider']);
    const divider = layerRow(page, /^Divider/);
    const button = layerRow(page, /^Button/);
    await mouseDrag(page, divider, button, { x: 40, y: 2 });
    await expect.poll(order).toEqual(['Divider', 'Button']);
    await expect(layersTree(page).getByRole('treeitem').nth(-1)).toContainText('Button');
  });

  test('command palette inserts a Divider', async ({ page }) => {
    await openEditor(page);
    await expect(cardNodes(page, 'Divider')).toHaveCount(0);
    await page.getByRole('region', { name: 'Design canvas' }).focus();
    await page.keyboard.press(`${MOD}+k`);
    const palette = page.getByRole('dialog', { name: /command/i });
    await expect(palette).toBeVisible();
    await palette.getByRole('combobox').fill('Insert Divider');
    await expect(palette.getByRole('option').first()).toContainText('Divider');
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();
    await expect(cardNodes(page, 'Divider')).toHaveCount(1);
  });
});

test.describe('canvas editing', () => {
  test('inline text editing, context menu duplicate and copy / paste', async ({ page }) => {
    await openEditor(page);
    const heading = cardNodes(page, 'Heading');
    await heading.dblclick();
    const editor = page.getByRole('textbox', { name: /Edit text/i });
    await expect(editor).toBeFocused();
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.type('Account summary');
    await page.keyboard.press('Enter');
    await expect(heading).toHaveText('Account summary');

    await heading.click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Duplicate/ }).click();
    await expect(cardNodes(page, 'Heading')).toHaveCount(2);

    await cardNodes(page, 'Heading').first().click();
    await page.keyboard.press(`${MOD}+c`);
    await page.keyboard.press(`${MOD}+v`);
    await expect(cardNodes(page, 'Heading')).toHaveCount(3);
    await expect(cardNodes(page, 'Heading').nth(1)).toHaveText('Account summary');
  });

  test('a problem in the problems panel navigates to the field', async ({ page }) => {
    await openEditor(page);
    await addFromPalette(page, 'Input');
    await inspector(page).getByRole('combobox', { name: 'Label' }).fill('');
    const badge = page.getByRole('button', { name: /1 error/ });
    await expect(badge).toBeVisible();

    // Deselect (Escape climbs to the card's main column, then clears), then jump back to the node
    // from the problem.
    await page.getByRole('region', { name: 'Design canvas' }).focus();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(inspector(page).getByText('Select a component to edit its properties.')).toBeVisible();
    await badge.click();
    const problem = page.getByRole('button', { name: /Input needs “Label”/ });
    await problem.click();
    await expectInspectorFor(page, 'Input');
    await expect(inspector(page).getByRole('combobox', { name: 'Label' })).toBeFocused();
    await inspector(page).getByRole('combobox', { name: 'Label' }).fill('Email');
    await expect(page.getByRole('button', { name: 'No problems — ready to publish' })).toBeVisible();
  });
});
