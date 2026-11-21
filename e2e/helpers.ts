import { expect, type Page } from '@playwright/test';

export async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByTestId('explorer')).toBeVisible();
  return errors;
}

/** Create a new page in the first notebook, title it, and return the editor locator. */
export async function newPage(page: Page, title: string) {
  const tabs = await page.getByTestId('tab').count();
  await page.getByTestId('notebook-row').first().hover();
  await page.getByTestId('notebook-add').first().click();
  // Wait for the new tab to mount so we never type into the previous page's title.
  await expect(page.getByTestId('tab')).toHaveCount(tabs + 1);
  await expect(page.getByTestId('page-title')).toHaveValue('Untitled');
  await page.getByTestId('page-title').fill(title);
  await page.getByTestId('page-title').press('Enter');
  const editor = page.getByTestId('doc-editor').last();
  await expect(editor).toBeVisible();
  return editor;
}

/** Simulate dropping a file onto an element (Playwright cannot drive native file pickers). */
export async function dropFile(page: Page, testId: string, path: string, name: string, type: string) {
  const { readFileSync } = await import('node:fs');
  const b64 = readFileSync(path).toString('base64');
  await page.getByTestId(testId).evaluate(async (el, { b64, name, type }) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], name, { type }));
    for (const t of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { b64, name, type });
}
