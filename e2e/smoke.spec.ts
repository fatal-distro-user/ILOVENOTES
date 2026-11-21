import { test, expect } from '@playwright/test';

test('app boots and renders the shell', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('ILOVENOTES').first()).toBeVisible();
  expect(errors).toEqual([]);
});
