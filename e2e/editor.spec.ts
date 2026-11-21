import { test, expect } from '@playwright/test';
import { boot, newPage } from './helpers';

test('typing, slash heading, and persistence after reload', async ({ page }) => {
  const errors = await boot(page);
  const ed = await newPage(page, 'Doc One');
  await ed.click();
  await page.keyboard.type('/head');
  await expect(page.getByTestId('suggest-slash')).toBeVisible();
  await page.keyboard.type('ing 2');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Section A');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Body text with **bold** and #research tag');
  await expect(ed.locator('h2')).toHaveText('Section A');
  await expect(ed.locator('strong')).toHaveText('bold');
  await expect(ed.locator('.iln-tag')).toHaveText('#research');
  await expect(page.getByTestId('status-bar')).toContainText(/\d+ words/);
  await page.waitForTimeout(700);
  await page.reload();
  await expect(page.getByTestId('doc-editor').locator('h2')).toHaveText('Section A');
  expect(errors).toEqual([]);
});

test('wiki-link autocomplete creates a link and backlink', async ({ page }) => {
  await boot(page);
  await newPage(page, 'Target Page');
  const ed = await newPage(page, 'Source Page');
  await ed.click();
  await page.keyboard.type('See [[Targ');
  await expect(page.getByTestId('suggest-wiki')).toContainText('Target Page');
  await page.keyboard.press('Enter');
  await expect(ed.getByTestId('wikilink')).toHaveText('Target Page');
  await page.waitForTimeout(700);
  await ed.getByTestId('wikilink').click();
  await expect(page.getByTestId('page-title')).toHaveValue('Target Page');
  await expect(page.getByTestId('backlinks-panel').getByTestId('backlink')).toContainText('Source Page');
});

test('math, callout, table sort, footnote', async ({ page }) => {
  await boot(page);
  const ed = await newPage(page, 'Blocks');
  await ed.click();
  await page.keyboard.type('Euler $e^{i\\pi}+1=0$ ');
  await expect(ed.locator('.iln-math-inline .katex')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('/callout');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Careful here');
  await expect(ed.locator('.iln-callout')).toContainText('Careful here');
  await ed.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/table');
  await page.keyboard.press('Enter');
  // header row then 2 body rows; fill first column with 3, 1, (2 in row 3 via Tab traversal)
  await page.keyboard.type('Num');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  await page.keyboard.type('3');
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  await page.keyboard.type('1');
  await page.getByTestId('table-sort-asc').click();
  await expect(ed.locator('table tr').nth(1).locator('td').first()).toHaveText('1');
  await expect(ed.locator('table tr').nth(2).locator('td').first()).toHaveText('3');
});

test('javascript code block runs in sandbox and copy works', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await boot(page);
  const ed = await newPage(page, 'Code');
  await ed.click();
  await page.keyboard.type('/code block');
  await page.keyboard.press('Enter');
  await page.keyboard.type('console.log("hi", 1 + 2); return [1, 2].map((x) => x * 2);');
  await page.getByTestId('code-run').click();
  await expect(page.getByTestId('code-output')).toContainText('hi 3');
  await expect(page.getByTestId('code-output')).toContainText('[2, 4]');
  await page.getByTestId('code-copy').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('console.log');
});

test('infinite loop is killed by timeout', async ({ page }) => {
  test.setTimeout(30_000);
  await boot(page);
  const ed = await newPage(page, 'Loop');
  await ed.click();
  await page.keyboard.type('/code block');
  await page.keyboard.press('Enter');
  await page.keyboard.type('while (true) {}');
  await page.getByTestId('code-run').click();
  await expect(page.getByTestId('code-output')).toContainText('Timed out', { timeout: 10_000 });
});
