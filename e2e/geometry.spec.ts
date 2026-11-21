import { test, expect, type Page } from '@playwright/test';
import { boot, newPage } from './helpers';

async function studio(page: Page) {
  await page.keyboard.press('Control+Alt+n');
  await expect(page.getByTestId('paint-studio')).toBeVisible();
  const b = (await page.getByTestId('paint-surface').boundingBox())!;
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}
async function drag(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 15) {
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps }); await page.mouse.up();
}
async function px(page: Page, x: number, y: number) {
  return page.getByTestId('paint-surface').locator('canvas').first().evaluate((c: HTMLCanvasElement, [X, Y]) => {
    const r = c.getBoundingClientRect(); const k = c.width / r.width;
    return Array.from(c.getContext('2d')!.getImageData(Math.round((X - r.left) * k), Math.round((Y - r.top) * k), 1, 1).data);
  }, [x, y]);
}
const dark = (p: number[]) => p[0] < 120;
const white = (p: number[]) => p[0] > 235 && p[1] > 235 && p[2] > 235;

test('marquee selection restricts fill; invert and clear', async ({ page }) => {
  const errors = await boot(page);
  const { cx, cy } = await studio(page);
  await page.getByTestId('paint-tool-select-rect').click();
  await drag(page, cx - 50, cy - 50, cx + 50, cy + 50);
  await page.keyboard.press('Alt+Backspace');
  await page.waitForTimeout(100);
  expect(dark(await px(page, cx, cy))).toBe(true);
  expect(white(await px(page, cx + 80, cy))).toBe(true);
  await page.keyboard.press('Control+Shift+i');
  await page.keyboard.press('Alt+Backspace');
  await page.waitForTimeout(100);
  expect(dark(await px(page, cx + 80, cy))).toBe(true);
  await page.keyboard.press('Control+d');
  await page.keyboard.press('Delete');
  await page.waitForTimeout(100);
  expect(white(await px(page, cx, cy))).toBe(true);
  expect(errors).toEqual([]);
});

test('flood fill with gap closing stays inside line art; gradient', async ({ page }) => {
  await boot(page);
  const { cx, cy } = await studio(page);
  await page.getByTestId('paint-tool-brush').click();
  await page.getByTestId('brush-preset-select').selectOption('fineliner');
  await page.getByTestId('brush-size').fill('6');
  // Square outline with a small gap on the top edge.
  await drag(page, cx - 80, cy - 80, cx - 2, cy - 80); await drag(page, cx + 2, cy - 80, cx + 80, cy - 80);
  await drag(page, cx + 80, cy - 80, cx + 80, cy + 80); await drag(page, cx + 80, cy + 80, cx - 80, cy + 80); await drag(page, cx - 80, cy + 80, cx - 80, cy - 80);
  await page.getByTestId('paint-tool-fill').click();
  await page.getByTestId('fill-gap').fill('10');
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(150);
  expect(dark(await px(page, cx, cy))).toBe(true);
  expect(white(await px(page, cx, cy - 140))).toBe(true);
  // Gradient on a new layer: start is primary (dark), end is secondary (white).
  await page.keyboard.press('Control+z');
  await page.getByTestId('paint-tool-gradient').click();
  await drag(page, cx - 200, cy + 150, cx + 200, cy + 150, 10);
  await page.waitForTimeout(100);
  const a = await px(page, cx - 190, cy + 150), b = await px(page, cx + 190, cy + 150);
  expect(a[0]).toBeLessThan(b[0]);
});

test('free transform scales the selection', async ({ page }) => {
  await boot(page);
  const { cx, cy } = await studio(page);
  await page.getByTestId('paint-tool-select-rect').click();
  await drag(page, cx - 20, cy - 20, cx + 20, cy + 20);
  await page.keyboard.press('Alt+Backspace');
  await page.keyboard.press('Control+t');
  await expect(page.getByTestId('transform-apply')).toBeVisible();
  await page.getByTestId('transform-flip-h').click();
  // Drag the bottom-right corner handle outward to scale.
  await drag(page, cx + 20, cy + 20, cx + 70, cy + 70, 10);
  await page.getByTestId('transform-apply').click();
  await page.waitForTimeout(150);
  expect(dark(await px(page, cx + 55, cy + 55))).toBe(true);
  await expect(page.getByTestId('history-panel')).toContainText('Transform');
});

test('vertical symmetry mirrors strokes; QuickShape snaps a held stroke', async ({ page }) => {
  await boot(page);
  const { cx, cy } = await studio(page);
  await page.getByTestId('guides-menu').click();
  await page.getByTestId('sym-vertical').click();
  await page.keyboard.press('Escape');
  await page.getByTestId('paint-tool-brush').click();
  await page.getByTestId('brush-size').fill('16');
  await drag(page, cx - 150, cy - 100, cx - 100, cy - 100);
  await page.waitForTimeout(100);
  expect(dark(await px(page, cx + 125, cy - 100))).toBe(true);
  await page.getByTestId('guides-menu').click();
  await page.getByTestId('sym-off').click();
  await page.keyboard.press('Escape');
  // Rough line, then hold still → QuickShape.
  await page.mouse.move(cx - 150, cy + 100); await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(cx - 150 + i * 15, cy + 100 + (i % 2 ? 4 : -4));
  await page.waitForTimeout(800);
  await page.mouse.up();
  await expect(page.getByTestId('history-panel')).toContainText('QuickShape line');
});

test('canvas pen QuickShape converts a held circle into a shape object', async ({ page }) => {
  await boot(page);
  await newPage(page, 'QS');
  await page.getByTestId('mode-switch').getByText('Canvas').click();
  const b = (await page.getByTestId('canvas').boundingBox())!;
  await page.getByTestId('tool-pen').click();
  const cx = b.x + 400, cy = b.y + 300;
  await page.mouse.move(cx + 80, cy); await page.mouse.down();
  for (let i = 1; i <= 40; i++) { const a = (i / 40) * Math.PI * 2; await page.mouse.move(cx + Math.cos(a) * 80, cy + Math.sin(a) * 80); }
  await page.waitForTimeout(800);
  await page.mouse.up();
  await expect(page.locator('[data-object-type="shape"]')).toHaveCount(1);
  await expect(page.getByTestId('status-bar')).toContainText('0 strokes');
});
