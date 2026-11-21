import { test, expect, type Page } from '@playwright/test';
import { boot, newPage } from './helpers';

async function canvasPage(page: Page, title: string) {
  await newPage(page, title);
  await page.getByTestId('mode-switch').getByText('Canvas').click();
  const c = page.getByTestId('canvas');
  await expect(c).toBeVisible();
  return c;
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

test('draw ink strokes, undo/redo with keyboard, persistence', async ({ page }) => {
  const errors = await boot(page);
  const c = await canvasPage(page, 'Ink');
  const b = (await c.boundingBox())!;
  await page.getByTestId('tool-pen').click();
  await drag(page, { x: b.x + 200, y: b.y + 200 }, { x: b.x + 400, y: b.y + 260 });
  await drag(page, { x: b.x + 200, y: b.y + 300 }, { x: b.x + 420, y: b.y + 330 });
  await expect(page.getByTestId('status-bar')).toContainText('2 strokes');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('status-bar')).toContainText('1 strokes');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('status-bar')).toContainText('2 strokes');
  await expect(page.getByTestId('history-panel').getByTestId('history-entry')).toHaveCount(2);
  await page.reload();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await expect(page.getByTestId('status-bar')).toContainText('2 strokes');
  expect(errors).toEqual([]);
});

test('create, move, resize, group, duplicate and delete shapes', async ({ page }) => {
  await boot(page);
  const c = await canvasPage(page, 'Shapes');
  const b = (await c.boundingBox())!;
  await page.getByTestId('tool-rect').click();
  await drag(page, { x: b.x + 150, y: b.y + 150 }, { x: b.x + 300, y: b.y + 250 });
  await page.getByTestId('tool-ellipse').click();
  await drag(page, { x: b.x + 400, y: b.y + 150 }, { x: b.x + 500, y: b.y + 250 });
  const shapes = page.locator('[data-object-type="shape"]');
  await expect(shapes).toHaveCount(2);
  // Move the rectangle.
  const before = await shapes.first().boundingBox();
  await drag(page, { x: b.x + 220, y: b.y + 200 }, { x: b.x + 260, y: b.y + 260 });
  const after = await shapes.first().boundingBox();
  expect(Math.round(after!.x - before!.x)).toBeGreaterThan(30);
  // Resize via the south-east handle.
  const h = (await page.getByTestId('handle-se').boundingBox())!;
  await drag(page, { x: h.x + 4, y: h.y + 4 }, { x: h.x + 64, y: h.y + 44 });
  const resized = await shapes.first().boundingBox();
  expect(resized!.width).toBeGreaterThan(after!.width + 40);
  // Marquee-select both, group, duplicate, delete.
  await drag(page, { x: b.x + 100, y: b.y + 100 }, { x: b.x + 600, y: b.y + 400 });
  await expect(page.getByTestId('selection-bar')).toBeVisible();
  await page.getByTestId('sel-group').click();
  await expect(page.getByTestId('sel-ungroup')).toBeVisible();
  await page.getByTestId('sel-duplicate').click();
  await expect(shapes).toHaveCount(4);
  await page.getByTestId('sel-delete').click();
  await expect(shapes).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(shapes).toHaveCount(4);
});

test('text, zoom, background, minimap, hybrid', async ({ page }) => {
  await boot(page);
  const c = await canvasPage(page, 'Misc');
  const b = (await c.boundingBox())!;
  await page.mouse.dblclick(b.x + 300, b.y + 300);
  await page.keyboard.type('Hello canvas');
  await page.mouse.click(b.x + 700, b.y + 500);
  await expect(page.getByTestId('canvas-text').filter({ hasText: 'Hello canvas' })).toBeVisible();
  await page.mouse.move(b.x + 300, b.y + 300);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -400);
  await page.keyboard.up('Control');
  await expect(page.getByTestId('zoom-label')).not.toHaveText('100%');
  await page.getByTestId('canvas-bg-btn').click();
  await page.getByTestId('bg-isometric').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('minimap')).toBeVisible();
  await page.getByTestId('mode-switch').getByText('Hybrid').click();
  await expect(page.getByTestId('hybrid')).toBeVisible();
  await expect(page.getByTestId('hybrid').getByTestId('doc-editor')).toBeVisible();
  await expect(page.getByTestId('hybrid').getByTestId('canvas')).toBeVisible();
});
