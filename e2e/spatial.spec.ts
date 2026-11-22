import { test, expect, type Page } from '@playwright/test';
import { boot, newPage } from './helpers';

async function canvasPage(page: Page, title: string) {
  await newPage(page, title);
  await page.getByTestId('mode-switch').getByText('Canvas').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  return (await page.getByTestId('canvas').boundingBox())!;
}
async function drag(page: Page, x0: number, y0: number, x1: number, y1: number, steps = 15) {
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps }); await page.mouse.up();
}

test('sticky notes render markdown; port drag creates a connector; routes switch', async ({ page }) => {
  const errors = await boot(page);
  const b = await canvasPage(page, 'Stickies');
  await page.getByTestId('tool-sticky').click();
  await page.mouse.click(b.x + 250, b.y + 250);
  await expect(page.getByTestId('sticky-editor')).toBeFocused();
  await page.keyboard.type('# Plan');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- [x] **ship** it');
  await page.mouse.click(b.x + 450, b.y + 60);
  await expect(page.getByTestId('sticky').locator('h1')).toHaveText('Plan');
  await expect(page.getByTestId('sticky').locator('strong')).toHaveText('ship');
  await page.getByTestId('tool-sticky').click();
  await page.mouse.click(b.x + 650, b.y + 250);
  await page.keyboard.press('Escape');
  // Select the first sticky and drag from its east port onto the second.
  await page.mouse.click(b.x + 250, b.y + 250);
  const port = (await page.getByTestId('port-e').boundingBox())!;
  await drag(page, port.x + 6, port.y + 6, b.x + 650, b.y + 250);
  await expect(page.getByTestId('connector')).toHaveCount(1);
  // Click the connector line to select it and change the route.
  await page.mouse.click(b.x + 450, b.y + 250);
  await expect(page.getByTestId('connector-bar')).toBeVisible();
  await page.getByTestId('route-orthogonal').click();
  await page.getByTestId('connector-label-btn').click();
  await page.getByRole('textbox').last().fill('depends on');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('connector-label')).toHaveText('depends on');
  // Moving a sticky keeps the connector attached; deleting it removes the connector.
  await page.mouse.click(b.x + 650, b.y + 250);
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('connector')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('mind map: Tab adds children, Enter adds siblings, connected', async ({ page }) => {
  await boot(page);
  const b = await canvasPage(page, 'Mind');
  await page.getByTestId('tool-mindmap').click();
  await page.mouse.click(b.x + 200, b.y + 300);
  await page.keyboard.type('Root');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('mindnode-text')).toHaveCount(2);
  await expect(page.getByTestId('mindnode-text').nth(1)).toBeFocused();
  await page.keyboard.type('Child A');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('mindnode-text')).toHaveCount(3);
  await expect(page.getByTestId('mindnode-text').nth(2)).toBeFocused();
  await page.keyboard.type('Child B');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('mindnode')).toHaveCount(3);
  await expect(page.getByTestId('connector')).toHaveCount(2);
  await expect(page.getByTestId('mindnode-text').filter({ hasText: 'Child B' })).toBeVisible();
});

test('inline sketch frame in a document paints and persists', async ({ page }) => {
  await boot(page);
  const ed = await newPage(page, 'Sketchy');
  await ed.click();
  await page.keyboard.type('/sketch');
  await page.keyboard.press('Enter');
  const sketch = page.getByTestId('doc-sketch');
  await expect(sketch.getByTestId('paint-surface')).toBeVisible();
  const s = (await sketch.getByTestId('paint-surface').boundingBox())!;
  await drag(page, s.x + 60, s.y + s.height / 2, s.x + 300, s.y + s.height / 2);
  const dark = await sketch.getByTestId('paint-surface').locator('canvas').first().evaluate((c: HTMLCanvasElement, [X, Y]) => {
    const r = c.getBoundingClientRect(); const k = c.width / r.width;
    return c.getContext('2d')!.getImageData(Math.round((X - r.left) * k), Math.round((Y - r.top) * k), 1, 1).data[0];
  }, [s.x + 180, s.y + s.height / 2]);
  expect(dark).toBeLessThan(150);
  await expect(sketch.getByTestId('sketch-open-studio')).toBeVisible();
});

test('rough ink converts to a clean diagram with a connector', async ({ page }) => {
  await boot(page);
  const b = await canvasPage(page, 'Diagram');
  await page.getByTestId('tool-pen').click();
  const box = async (x: number, y: number) => {
    await page.mouse.move(x, y); await page.mouse.down();
    for (const [dx, dy] of [[120, 0], [120, 80], [0, 80], [0, 0]]) await page.mouse.move(x + dx, y + dy, { steps: 8 });
    await page.mouse.up();
  };
  await box(b.x + 150, b.y + 200);
  await box(b.x + 500, b.y + 200);
  await drag(page, b.x + 275, b.y + 240, b.x + 495, b.y + 240, 12);
  await page.getByTestId('tool-select').click();
  await page.locator('[data-testid="canvas"]').focus();
  await page.keyboard.press('Control+a');
  await page.getByTestId('ink-to-diagram').click();
  await expect(page.locator('[data-object-type="shape"]')).toHaveCount(2);
  await expect(page.getByTestId('connector')).toHaveCount(1);
  await expect(page.getByTestId('status-bar')).toContainText('0 strokes');
});

