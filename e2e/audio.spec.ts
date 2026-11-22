import { test, expect, type Page } from '@playwright/test';
import { boot, newPage } from './helpers';

test.use({ launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] }, permissions: ['microphone'] });

async function canvasPage(page: Page, title: string) {
  await newPage(page, title);
  await page.getByTestId('mode-switch').getByText('Canvas').click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  return (await page.getByTestId('canvas').boundingBox())!;
}
async function drag(page: Page, x0: number, y0: number, x1: number, y1: number) {
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 15 }); await page.mouse.up();
}

test('record an audio note while drawing synced ink, then play it back', async ({ page }) => {
  await boot(page);
  const b = await canvasPage(page, 'Lecture');
  await page.keyboard.press('Control+Shift+r');
  await page.getByTestId('audio-record').click();
  await page.getByTestId('tool-pen').click();
  await page.waitForTimeout(300);
  await drag(page, b.x + 200, b.y + 200, b.x + 400, b.y + 220);
  await page.waitForTimeout(600);
  await page.getByTestId('audio-stop').click();
  await expect(page.getByTestId('audio-clip')).toHaveCount(1);
  await expect(page.getByTestId('audio-pin')).toHaveCount(1);
  await page.getByTestId('audio-clip-play').click();
  await expect(page.getByTestId('synced-ink')).toBeVisible();
});
