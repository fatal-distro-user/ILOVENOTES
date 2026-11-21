import { test, expect, type Page } from '@playwright/test';
import { boot } from './helpers';

async function studio(page: Page) {
  await page.keyboard.press('Control+Alt+n');
  await expect(page.getByTestId('paint-studio')).toBeVisible();
  const b = (await page.getByTestId('paint-surface').boundingBox())!;
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}
async function drag(page: Page, x0: number, y0: number, x1: number, y1: number) {
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 15 }); await page.mouse.up();
}
async function px(page: Page, x: number, y: number) {
  return page.getByTestId('paint-surface').locator('canvas').first().evaluate((c: HTMLCanvasElement, [X, Y]) => {
    const r = c.getBoundingClientRect(); const k = c.width / r.width;
    return Array.from(c.getContext('2d')!.getImageData(Math.round((X - r.left) * k), Math.round((Y - r.top) * k), 1, 1).data);
  }, [x, y]);
}

test('invert and gaussian blur filters with preview, cancel and apply', async ({ page }) => {
  const errors = await boot(page);
  const { cx, cy } = await studio(page);
  // Work on the background layer (white) so invert turns it black.
  await page.getByTestId('layer-row').last().click();
  await page.getByTestId('filters-menu').click();
  await page.getByTestId('filter-invert').click();
  await expect(page.getByTestId('filter-dialog')).toBeVisible();
  await page.waitForTimeout(400);
  expect((await px(page, cx, cy))[0]).toBeLessThan(20);
  await page.getByTestId('filter-cancel').click();
  await page.waitForTimeout(100);
  expect((await px(page, cx, cy))[0]).toBeGreaterThan(235);
  await page.getByTestId('filters-menu').click();
  await page.getByTestId('filter-invert').click();
  await page.getByTestId('filter-apply').click();
  await expect(page.getByTestId('filter-dialog')).toHaveCount(0);
  expect((await px(page, cx, cy))[0]).toBeLessThan(20);
  await expect(page.getByTestId('history-panel')).toContainText('Invert');
  expect(errors).toEqual([]);
});

test('gaussian blur softens a hard stroke', async ({ page }) => {
  await boot(page);
  const { cx, cy } = await studio(page);
  await page.getByTestId('paint-tool-brush').click();
  await page.getByTestId('brush-preset-select').selectOption('fineliner');
  await page.getByTestId('brush-size').fill('40');
  await drag(page, cx - 100, cy, cx + 100, cy);
  await page.getByTestId('filters-menu').click();
  await page.getByTestId('filter-gaussian-blur').click();
  await page.getByTestId('filter-radius').fill('20');
  await page.getByTestId('filter-apply').click();
  // The full-resolution filter runs in a worker; wait for it to land.
  await expect.poll(async () => (await px(page, cx, cy - 10))[0]).toBeLessThan(235);
  expect((await px(page, cx, cy - 10))[0]).toBeGreaterThan(40);
});

test('flipbook: frames, onion skin, playback and GIF export', async ({ page }) => {
  await boot(page);
  const { cx, cy } = await studio(page);
  await page.getByTestId('anim-toggle').click();
  await expect(page.getByTestId('timeline')).toBeVisible();
  // Background + Layer 1 → pin background so frames = [Layer 1].
  await page.getByTestId('layer-row').last().click();
  await page.getByText('Pin as background').click();
  await expect(page.getByTestId('anim-frame')).toHaveCount(1);
  await page.getByTestId('paint-tool-brush').click();
  await page.getByTestId('brush-size').fill('30');
  await drag(page, cx - 120, cy, cx - 60, cy);
  await page.getByTestId('anim-add').click();
  await expect(page.getByTestId('anim-frame')).toHaveCount(2);
  await expect(page.getByTestId('anim-counter')).toHaveText('2 / 2');
  // Frame 1 content is hidden on frame 2 and appears only as a red-tinted onion skin on the overlay.
  await page.waitForTimeout(150);
  expect((await px(page, cx - 90, cy))[0]).toBeGreaterThan(235);
  const onion = await page.getByTestId('paint-surface').locator('canvas').nth(1).evaluate((c: HTMLCanvasElement, [X, Y]) => {
    const r = c.getBoundingClientRect(); const k = c.width / r.width;
    return Array.from(c.getContext('2d')!.getImageData(Math.round((X - r.left) * k), Math.round((Y - r.top) * k), 1, 1).data);
  }, [cx - 90, cy]);
  expect(onion[3]).toBeGreaterThan(20);
  expect(onion[0]).toBeGreaterThan(onion[1]);
  await drag(page, cx + 60, cy, cx + 120, cy);
  await page.keyboard.press(',');
  await expect(page.getByTestId('anim-counter')).toHaveText('1 / 2');
  await page.getByTestId('anim-play').click();
  await page.waitForTimeout(400);
  await page.getByTestId('anim-play').click();
  // GIF export via an intercepted save picker.
  await page.evaluate(() => {
    (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () => ({
      createWritable: async () => ({ write: async (b: Blob) => { const u8 = new Uint8Array(await b.arrayBuffer()); (window as unknown as { __gif: string }).__gif = String.fromCharCode(...u8.slice(0, 6)); }, close: async () => undefined }),
    });
  });
  await page.getByTestId('anim-export').click();
  await page.getByTestId('anim-export-gif').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __gif?: string }).__gif ?? '')).toBe('GIF89a');
});
