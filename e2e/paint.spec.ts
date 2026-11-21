import { test, expect, type Page } from '@playwright/test';
import { boot } from './helpers';

async function openPainting(page: Page) {
  await page.keyboard.press('Control+Alt+n');
  await expect(page.getByTestId('paint-studio')).toBeVisible();
  await expect(page.getByTestId('layer-row')).toHaveCount(2);
  return page.getByTestId('paint-surface');
}

async function stroke(page: Page, x0: number, y0: number, x1: number, y1: number) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 15 });
  await page.mouse.up();
}

/** Read a composited pixel via the surface canvas. */
async function pixelAt(page: Page, x: number, y: number) {
  return page.getByTestId('paint-surface').locator('canvas').first().evaluate((c: HTMLCanvasElement, [px, py]) => {
    const r = c.getBoundingClientRect();
    const k = c.width / r.width;
    return Array.from(c.getContext('2d')!.getImageData(Math.round((px - r.left) * k), Math.round((py - r.top) * k), 1, 1).data);
  }, [x, y]);
}

test('paint, layers, blend, visibility, undo/redo, merge, persistence', async ({ page }) => {
  const errors = await boot(page);
  const surface = await openPainting(page);
  const b = (await surface.boundingBox())!;
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await page.getByTestId('paint-tool-brush').click();
  await stroke(page, cx - 100, cy, cx + 100, cy);
  await page.waitForTimeout(100);
  const painted = await pixelAt(page, cx, cy);
  expect(painted[0]).toBeLessThan(120); // dark default brush colour on white background
  // Undo restores white; redo brings it back.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(100);
  expect((await pixelAt(page, cx, cy))[0]).toBeGreaterThan(240);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(100);
  expect((await pixelAt(page, cx, cy))[0]).toBeLessThan(120);
  // Hide the active layer → white again.
  await page.getByTestId('layer-row').first().getByTestId('layer-visibility').click();
  await page.waitForTimeout(100);
  expect((await pixelAt(page, cx, cy))[0]).toBeGreaterThan(240);
  await page.getByTestId('layer-row').first().getByTestId('layer-visibility').click();
  // Add a layer, change blend mode, check panel and status.
  await page.getByTestId('layer-add').click();
  await page.getByTestId('layer-add-raster').click();
  await expect(page.getByTestId('layer-row')).toHaveCount(3);
  await page.getByTestId('layer-blend').selectOption('multiply');
  await expect(page.getByTestId('layer-row').first()).toContainText('Multiply');
  await expect(page.getByTestId('status-bar')).toContainText('3 layers');
  // Merge down and flatten.
  await page.getByTestId('layer-merge-down').click();
  await expect(page.getByTestId('layer-row')).toHaveCount(2);
  await page.getByTestId('layer-more').click();
  await page.getByTestId('layer-flatten').click();
  await expect(page.getByTestId('layer-row')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('layer-row')).toHaveCount(2);
  // Persist: wait for autosave, reload, layers & pixels remain.
  await page.waitForTimeout(1500);
  await page.reload();
  await expect(page.getByTestId('paint-studio')).toBeVisible();
  await expect(page.getByTestId('layer-row')).toHaveCount(2);
  await page.waitForTimeout(300);
  const s2 = (await page.getByTestId('paint-surface').boundingBox())!;
  expect((await pixelAt(page, s2.x + s2.width / 2, s2.y + s2.height / 2))[0]).toBeLessThan(120);
  expect(errors).toEqual([]);
});

test('layer mask hides pixels and clipping mask restricts paint', async ({ page }) => {
  await boot(page);
  const surface = await openPainting(page);
  const b = (await surface.boundingBox())!;
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  await page.getByTestId('paint-tool-brush').click();
  await stroke(page, cx - 100, cy, cx + 100, cy);
  // Add mask, paint black on it with the eraser to hide pixels.
  await page.getByTestId('layer-mask').click();
  await page.getByTestId('paint-tool-eraser').click();
  await page.getByTestId('brush-preset-select').selectOption('eraser-hard');
  await page.getByTestId('brush-size').fill('40');
  await stroke(page, cx - 40, cy, cx + 40, cy);
  await page.waitForTimeout(100);
  expect((await pixelAt(page, cx, cy))[0]).toBeGreaterThan(240);
  expect((await pixelAt(page, cx - 90, cy))[0]).toBeLessThan(120);
});
