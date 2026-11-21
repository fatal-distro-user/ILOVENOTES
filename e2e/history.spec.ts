import { test, expect } from '@playwright/test';
import { boot, newPage } from './helpers';

test('history panel undoes and redoes document edits', async ({ page }) => {
  await boot(page);
  const ed = await newPage(page, 'Hist');
  await ed.click();
  await page.keyboard.type('first line');
  await expect(page.getByTestId('history-panel')).toContainText(/[1-9]\d* undo step/);
  await page.getByTestId('history-undo').click();
  await expect(ed).not.toContainText('first line');
  await page.getByTestId('history-redo').click();
  await expect(ed).toContainText('first line');
});
