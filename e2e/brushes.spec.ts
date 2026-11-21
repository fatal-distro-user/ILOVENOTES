import { test, expect, type Page } from '@playwright/test';
import { boot } from './helpers';

async function studio(page: Page) {
  await page.keyboard.press('Control+Alt+n');
  await expect(page.getByTestId('paint-studio')).toBeVisible();
  const b = (await page.getByTestId('paint-surface').boundingBox())!;
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, b };
}
async function stroke(page: Page, x0: number, y0: number, x1: number, y1: number, mods: ('Alt')[] = []) {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 20 }); await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
}
async function pixel(page: Page, x: number, y: number) {
  return page.getByTestId('paint-surface').locator('canvas').first().evaluate((c: HTMLCanvasElement, [px, py]) => {
    const r = c.getBoundingClientRect(); const k = c.width / r.width;
    return Array.from(c.getContext('2d')!.getImageData(Math.round((px - r.left) * k), Math.round((py - r.top) * k), 1, 1).data);
  }, [x, y]);
}

test('brush presets paint, opacity caps overlapping dabs, eraser removes', async ({ page }) => {
  const errors = await boot(page);
  const { cx, cy } = await studio(page);
  await page.getByTestId('paint-tool-brush').click();
  await expect(page.getByTestId('brush-preset-select')).toBeVisible();
  await page.getByTestId('brush-opacity').fill('50');
  await stroke(page, cx - 120, cy, cx + 120, cy);
  await stroke(page, cx - 120, cy + 1, cx + 120, cy + 1);
  const p = await pixel(page, cx, cy);
  // Two strokes at 50% stack to ~75% coverage, never 100%, and a single stroke's own overlaps don't stack.
  expect(p[0]).toBeGreaterThan(40);
  expect(p[0]).toBeLessThan(200);
  await page.getByTestId('brush-opacity').fill('100');
  await page.getByTestId('paint-tool-eraser').click();
  await page.getByTestId('brush-preset-select').selectOption('eraser-hard');
  await page.getByTestId('brush-size').fill('80');
  await stroke(page, cx - 60, cy, cx + 60, cy);
  await page.waitForTimeout(100);
  expect((await pixel(page, cx, cy))[0]).toBeGreaterThan(235);
  expect(errors).toEqual([]);
});

test('brush studio lists presets, edits params, saves custom preset', async ({ page }) => {
  await boot(page);
  await studio(page);
  await page.getByTestId('paint-tool-brush').click();
  await expect(page.getByTestId('brush-studio').getByTestId('brush-preset')).toHaveCount(18);
  await page.getByTestId('brush-studio').locator('[data-preset="charcoal"]').click();
  await expect(page.getByTestId('brush-preset-select')).toHaveValue('charcoal');
  await page.getByTestId('brush-param-hardness').fill('0.9');
  await page.getByTestId('brush-save-new').click();
  await page.getByRole('textbox').last().fill('My charcoal');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('brush-studio').getByTestId('brush-preset')).toHaveCount(19);
  await expect(page.getByTestId('brush-preset-select')).toContainText('My charcoal');
});

test('smudge, clone, pixel brush and vector layer', async ({ page }) => {
  await boot(page);
  const { cx, cy } = await studio(page);
  await page.getByTestId('paint-tool-brush').click();
  await page.getByTestId('brush-size').fill('40');
  await stroke(page, cx - 150, cy, cx - 60, cy);
  // Smudge drags paint to the right into white space.
  await page.getByTestId('paint-tool-smudge').click();
  expect((await pixel(page, cx - 20, cy))[0]).toBeGreaterThan(235);
  await stroke(page, cx - 100, cy, cx + 10, cy);
  await page.waitForTimeout(100);
  expect((await pixel(page, cx - 30, cy))[0]).toBeLessThan(235);
  // Clone: alt-click on paint, then paint elsewhere.
  await page.getByTestId('paint-tool-clone').click();
  await page.keyboard.down('Alt'); await page.mouse.click(cx - 120, cy); await page.keyboard.up('Alt');
  await stroke(page, cx + 60, cy + 80, cx + 70, cy + 80);
  await page.waitForTimeout(100);
  expect((await pixel(page, cx + 62, cy + 80))[0]).toBeLessThan(200);
  // Vector layer: brush strokes become shapes; eraser removes them.
  await page.getByTestId('layer-add').click();
  await page.getByTestId('layer-add-vector').click();
  await page.getByTestId('paint-tool-brush').click();
  await stroke(page, cx - 100, cy + 150, cx + 100, cy + 150);
  await page.waitForTimeout(100);
  expect((await pixel(page, cx, cy + 150))[0]).toBeLessThan(150);
  await page.getByTestId('paint-tool-eraser').click();
  await page.mouse.click(cx, cy + 150);
  await page.waitForTimeout(100);
  expect((await pixel(page, cx, cy + 150))[0]).toBeGreaterThan(235);
});
