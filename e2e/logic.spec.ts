import { expect, test } from '@playwright/test';
import { addFromPalette, cardNodes, cardRoot, expectInspectorFor, inspector, openEditor, setMode, watchConsole } from './helpers';

test.describe('state, events and overlays', () => {
  test('bind an Input to a new state variable and show it in a Text', async ({ page }) => {
    const watch = watchConsole(page);
    await openEditor(page);
    await addFromPalette(page, 'Input');
    await expectInspectorFor(page, 'Input');

    // Value binding → New variable (named after the input's `name` prop).
    await inspector(page).getByRole('button', { name: 'New variable' }).click();
    await expect(inspector(page).getByLabel('Bind value to state')).toHaveValue(/firstname/);

    // Insert a Text after the input that interpolates the variable.
    await addFromPalette(page, 'Text');
    await expectInspectorFor(page, 'Text');
    await inspector(page).getByRole('combobox', { name: 'Text content' }).fill('Hi {{ firstname }}!');
    await page.keyboard.press('Escape');
    const greeting = cardNodes(page, 'Text').last();
    await expect(greeting).toHaveText('Hi !');

    await setMode(page, 'Preview');
    const field = cardNodes(page, 'Input').locator('input');
    await field.click();
    await field.pressSequentially('Ada');
    await field.press('Enter');
    await expect(cardNodes(page, 'Text').last()).toHaveText('Hi Ada!');

    // Back in design mode the preview state is not baked into the document.
    await setMode(page, 'Design');
    await expect(cardNodes(page, 'Text').last()).toHaveText('Hi !');
    expect(watch.errors).toEqual([]);
  });

  test('a button onClick "Show alert" action shows an alert in preview', async ({ page }) => {
    await openEditor(page);
    await addFromPalette(page, 'Button');
    await expectInspectorFor(page, 'Button');

    await inspector(page).getByRole('tab', { name: /^Events/ }).click();
    const onClick = inspector(page).getByRole('region', { name: 'On click event' });
    await onClick.getByRole('button', { name: 'Add action' }).click();
    await page.getByRole('menu', { name: 'Add action' }).getByRole('menuitem', { name: /Show alert/ }).click();
    await expect(onClick.getByRole('group', { name: 'Step 1: Show alert' })).toBeVisible();
    await expect(inspector(page).getByText(/When clicked → show a success alert/)).toBeVisible();

    await setMode(page, 'Preview');
    await expect(cardRoot(page).getByText('Saved successfully')).toHaveCount(0);
    await cardNodes(page, 'Button').click();
    await expect(cardRoot(page).getByText('Saved successfully')).toBeVisible();
  });

  test('attach a Modal to a button; preview opens it and Cancel closes it', async ({ page }) => {
    await openEditor(page);
    await addFromPalette(page, 'Button');
    await expectInspectorFor(page, 'Button');
    await inspector(page).getByRole('button', { name: 'Add modal' }).click();
    // The new overlay is selected and shown in the storyboard below the card.
    await expectInspectorFor(page, 'Modal');
    await expect(page.locator('.ub-cv-sb-frame')).toHaveCount(1);

    await setMode(page, 'Preview');
    await expect(cardRoot(page).getByText('Edit details')).toHaveCount(0);
    await cardNodes(page, 'Button').filter({ hasText: 'Click me' }).click();
    const modal = cardRoot(page).locator('[data-node-type="Modal"]');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Edit details');
    await modal.getByText('Cancel', { exact: true }).click();
    await expect(modal).toBeHidden();
  });
});
