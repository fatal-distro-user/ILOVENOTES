import { test, expect, type Page } from '@playwright/test';

async function boot(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByTestId('explorer')).toBeVisible();
  return errors;
}

async function newPageViaPlus(page: Page) {
  const before = await page.getByTestId('tab').count();
  await page.getByTestId('notebook-row').first().hover();
  await page.getByTestId('notebook-add').first().click();
  await expect(page.getByTestId('page-title')).toBeVisible();
  await expect(page.getByTestId('tab')).toHaveCount(before + 1);
}

test('app boots with no page errors and shows the welcome page in the explorer', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.getByTestId('tree-node').filter({ hasText: 'Welcome to ILOVENOTES' })).toBeVisible();
  await expect(page.getByTestId('status-bar')).toBeVisible();
  expect(errors).toEqual([]);
});

test('creating a page via the notebook plus button opens a tab; renaming updates the tab', async ({ page }) => {
  await boot(page);
  await newPageViaPlus(page);
  await expect(page.getByTestId('tab-title').first()).toHaveText('Untitled');
  await page.getByTestId('page-title').fill('My renamed page');
  await expect(page.getByTestId('tab-title').first()).toHaveText('My renamed page');
  await expect(page.getByTestId('tree-node').filter({ hasText: 'My renamed page' })).toBeVisible();
});

test('theme switch to Light Paper changes the document theme', async ({ page }) => {
  await boot(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark-studio');
  await page.getByTestId('theme-switch').click();
  await page.getByTestId('theme-option-light-paper').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('light-paper');
});

test('split vertical creates two panes', async ({ page }) => {
  await boot(page);
  await newPageViaPlus(page);
  await expect(page.getByTestId('pane')).toHaveCount(1);
  await page.getByTestId('split-vertical').click();
  await expect(page.getByTestId('pane')).toHaveCount(2);
  await page.getByTestId('unsplit').click();
  await expect(page.getByTestId('pane')).toHaveCount(1);
});

test('zen mode hides the explorer', async ({ page }) => {
  await boot(page);
  await expect(page.getByTestId('left-dock')).toBeVisible();
  await page.keyboard.press('Control+Shift+F');
  await expect(page.getByTestId('left-dock')).toHaveCount(0);
  await expect(page.getByTestId('status-bar')).toHaveCount(0);
  await expect(page.getByTestId('zen-pill')).toBeVisible();
  await page.getByTestId('zen-exit').click();
  await expect(page.getByTestId('left-dock')).toBeVisible();
});

test('scratchpad opens with the shortcut and its text persists after reload', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Control+Shift+Space');
  const area = page.getByTestId('scratchpad-text');
  await expect(area).toBeVisible();
  await expect(area).toBeEnabled();
  await area.fill('remember the milk');
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByTestId('explorer')).toBeVisible();
  await page.keyboard.press('Control+Shift+Space');
  await expect(page.getByTestId('scratchpad-text')).toHaveValue('remember the milk');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('scratchpad')).toHaveAttribute('aria-hidden', 'true');
});

test('moving a page to trash then restoring it from the Trash tab works', async ({ page }) => {
  await boot(page);
  await newPageViaPlus(page);
  await page.getByTestId('page-title').fill('Doomed page');
  const row = page.getByTestId('tree-node').filter({ hasText: 'Doomed page' });
  await expect(row).toBeVisible();
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByTestId('trash-count')).toHaveText('1');

  await page.getByTestId('trash-entry').click();
  await expect(page.getByTestId('trash-view')).toBeVisible();
  await expect(page.getByTestId('trash-row-title')).toHaveText('Doomed page');
  await page.getByTestId('trash-restore').click();
  await expect(page.getByTestId('trash-row')).toHaveCount(0);
  await expect(page.getByTestId('tree-node').filter({ hasText: 'Doomed page' })).toBeVisible();
});
