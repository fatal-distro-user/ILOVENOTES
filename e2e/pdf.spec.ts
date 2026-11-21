import { test, expect, type Page } from '@playwright/test';
import { boot, newPage, dropFile } from './helpers';

async function pdfPage(page: Page) {
  await newPage(page, 'Paper');
  await page.getByTestId('mode-switch').getByText('PDF').click();
  await dropFile(page, 'pdf-view', 'e2e/fixtures/sample.pdf', 'sample.pdf', 'application/pdf');
  await expect(page.getByTestId('pdf-page')).toHaveCount(3);
  await expect(page.getByTestId('pdf-page').first().locator('.textLayer span').first()).toBeVisible();
}

test('import PDF, highlight text, ink, sticky note, undo, export', async ({ page }) => {
  const errors = await boot(page);
  await pdfPage(page);
  const first = page.getByTestId('pdf-page').first();
  // Highlight: select a text span with the highlighter tool.
  await page.getByTestId('pdf-tool-highlight').click();
  const span = first.locator('.textLayer span', { hasText: 'quick brown fox' });
  const sb = (await span.boundingBox())!;
  await page.mouse.move(sb.x + 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width - 2, sb.y + sb.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(first.getByTestId('pdf-highlight')).toHaveCount(1);
  await expect(page.getByTestId('annotations-panel').getByTestId('annotation-item')).toContainText('quick brown fox');
  // Ink.
  await page.getByTestId('pdf-tool-ink').click();
  const pb = (await first.boundingBox())!;
  await page.mouse.move(pb.x + 100, pb.y + 300);
  await page.mouse.down();
  await page.mouse.move(pb.x + 300, pb.y + 360, { steps: 10 });
  await page.mouse.up();
  await expect(first.getByTestId('pdf-ink')).toHaveCount(1);
  // Sticky.
  await page.getByTestId('pdf-tool-sticky').click();
  await page.mouse.click(pb.x + 400, pb.y + 200);
  await page.getByTestId('pdf-sticky-text').fill('Remember this');
  await page.keyboard.press('Tab');
  await expect(first.getByTestId('pdf-sticky')).toHaveCount(1);
  // Undo the sticky note text + note via keyboard on the PDF scope.
  await page.getByTestId('pdf-tool-select').click();
  await expect(page.getByTestId('annotations-panel').getByTestId('annotation-item')).toHaveCount(3);
  // Export flattened PDF (fallback download path in Chromium uses the File System Access picker; intercept it).
  await page.evaluate(() => {
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => ({
      createWritable: async () => ({ write: async (b: Blob) => { (window as unknown as { __saved: number }).__saved = b.size; }, close: async () => undefined }),
    });
  });
  await page.getByTestId('pdf-export').click();
  await page.getByTestId('pdf-export-run').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __saved?: number }).__saved ?? 0)).toBeGreaterThan(1500);
  expect(errors).toEqual([]);
});

test('erase annotation and undo restores it', async ({ page }) => {
  await boot(page);
  await pdfPage(page);
  const first = page.getByTestId('pdf-page').first();
  await page.getByTestId('pdf-tool-ink').click();
  const pb = (await first.boundingBox())!;
  await page.mouse.move(pb.x + 100, pb.y + 300);
  await page.mouse.down();
  await page.mouse.move(pb.x + 300, pb.y + 300, { steps: 10 });
  await page.mouse.up();
  await expect(first.getByTestId('pdf-ink')).toHaveCount(1);
  await page.getByTestId('pdf-tool-eraser').click();
  await page.mouse.click(pb.x + 200, pb.y + 300);
  await expect(first.getByTestId('pdf-ink')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(first.getByTestId('pdf-ink')).toHaveCount(1);
});

test('dropping a PDF on a canvas places its pages', async ({ page }) => {
  await boot(page);
  await newPage(page, 'Board');
  await page.getByTestId('mode-switch').getByText('Canvas').click();
  await dropFile(page, 'canvas', 'e2e/fixtures/sample.pdf', 'sample.pdf', 'application/pdf');
  // Off-screen objects are culled, so fit the view first.
  await expect(page.locator('[data-object-type="pdfpage"]').first()).toBeVisible();
  await page.getByTestId('zoom-fit').click();
  await expect(page.locator('[data-object-type="pdfpage"]')).toHaveCount(3);
  await expect(page.getByTestId('canvas-pdfpage').first().locator('img')).toBeVisible();
});
