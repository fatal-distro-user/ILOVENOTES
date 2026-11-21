import { test, expect, type Page } from '@playwright/test';
import { boot, dropFile } from './helpers';

async function studio(page: Page) {
  await page.keyboard.press('Control+Alt+n');
  await expect(page.getByTestId('paint-studio')).toBeVisible();
  await expect(page.getByTestId('panel-color')).toBeVisible();
  await expect(page.getByTestId('color-panel')).toBeVisible();
  const b = (await page.getByTestId('paint-surface').boundingBox())!;
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}
const hexInput = (page: Page) => page.getByTestId('color-hex');
const rgbOf = (hex: string) => { const n = parseInt(hex.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
async function fillColor(page: Page) {
  return page.getByTestId('color-swatch-primary-fill').evaluate((el) => getComputedStyle(el).backgroundColor);
}
async function setHex(page: Page, v: string) {
  await page.getByTestId('color-tab-hex').click();
  await hexInput(page).fill(v);
  await hexInput(page).press('Enter');
}

test('wheel and box pickers change the colour; hex typing works and reverts when invalid', async ({ page }) => {
  const errors = await boot(page);
  await studio(page);
  const initial = await hexInput(page).inputValue();
  const pick = page.getByTestId('color-picker');
  await expect(pick).toHaveAttribute('data-mode', 'wheel');
  await pick.scrollIntoViewIfNeeded();
  const b = (await pick.boundingBox())!;
  // wheel: click the ring on the right edge (hue 90°) – the colour's hue changes
  await page.mouse.click(b.x + b.width - 11, b.y + b.height / 2);
  const afterRing = await hexInput(page).inputValue();
  expect(afterRing).not.toBe(initial);
  // SV square, near the top-right corner → bright saturated colour
  await page.mouse.click(b.x + b.width / 2 + 50, b.y + b.height / 2 - 50);
  const afterSv = await hexInput(page).inputValue();
  expect(afterSv).toMatch(/^#[0-9a-f]{6}$/);
  expect(afterSv).not.toBe(afterRing);
  expect(await fillColor(page)).toBe(rgbOf(afterSv));
  // box mode
  await page.getByTestId('color-picker-mode').getByRole('radio', { name: 'Box' }).click();
  await expect(pick).toHaveAttribute('data-mode', 'box');
  await pick.scrollIntoViewIfNeeded();
  const bb = (await pick.boundingBox())!;
  await page.mouse.click(bb.x + 2 + 184 * 0.95, bb.y + 2 + 212 * 0.05);
  const afterBox = await hexInput(page).inputValue();
  expect(afterBox).not.toBe(afterSv);
  expect(await fillColor(page)).toBe(rgbOf(afterBox));
  // typing
  await setHex(page, '#ff8800');
  await expect(hexInput(page)).toHaveValue('#ff8800');
  expect(await fillColor(page)).toBe('rgb(255, 136, 0)');
  await setHex(page, '0f0');
  await expect(hexInput(page)).toHaveValue('#00ff00');
  await setHex(page, 'not-a-colour');
  await expect(hexInput(page)).toHaveValue('#00ff00');
  // 8-digit hex sets alpha
  await setHex(page, '#ff000080');
  await expect(page.getByTestId('color-alpha-value')).toHaveText('50%');
  await expect(hexInput(page)).toHaveValue('#ff000080');
  expect(errors).toEqual([]);
});

test('RGB / HSL / HSV / CMYK tabs round-trip', async ({ page }) => {
  await boot(page);
  await studio(page);
  await setHex(page, '#336699');
  await page.getByTestId('color-tab-rgb').click();
  await expect(page.getByTestId('color-field-r')).toHaveValue('51');
  await expect(page.getByTestId('color-field-g')).toHaveValue('102');
  await expect(page.getByTestId('color-field-b')).toHaveValue('153');
  await page.getByTestId('color-field-g').fill('120');
  await page.getByTestId('color-field-g').press('Enter');
  await page.getByTestId('color-tab-hex').click();
  await expect(hexInput(page)).toHaveValue('#337899');
  // invalid input reverts
  await page.getByTestId('color-tab-rgb').click();
  await page.getByTestId('color-field-r').fill('abc');
  await page.getByTestId('color-field-r').press('Enter');
  await expect(page.getByTestId('color-field-r')).toHaveValue('51');
  // CMYK
  await setHex(page, '#336699');
  await page.getByTestId('color-tab-cmyk').click();
  await expect(page.getByTestId('color-field-c')).toHaveValue('67');
  await expect(page.getByTestId('color-field-k')).toHaveValue('40');
  await page.getByTestId('color-field-k').fill('0');
  await page.getByTestId('color-field-k').press('Enter');
  await page.getByTestId('color-tab-rgb').click();
  await expect(page.getByTestId('color-field-r')).toHaveValue('85');
  // HSV / HSL
  await setHex(page, '#ff0000');
  await page.getByTestId('color-tab-hsv').click();
  await page.getByTestId('color-field-h').fill('120');
  await page.getByTestId('color-field-h').press('Enter');
  await page.getByTestId('color-tab-hex').click();
  await expect(hexInput(page)).toHaveValue('#00ff00');
  await page.getByTestId('color-tab-hsl').click();
  await expect(page.getByTestId('color-field-l')).toHaveValue('50');
});

test('harmony swatches follow the colour and apply on click', async ({ page }) => {
  await boot(page);
  await studio(page);
  await setHex(page, '#ff0000');
  await page.getByTestId('harmony-kind').selectOption('triadic');
  const sw = page.getByTestId('harmony-swatch');
  await expect(sw).toHaveCount(3);
  expect(await sw.nth(1).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(0, 255, 0)');
  await sw.nth(1).click();
  await expect(hexInput(page)).toHaveValue('#00ff00');
  await page.getByTestId('harmony-kind').selectOption('tetradic');
  await expect(sw).toHaveCount(4);
  await page.getByTestId('harmony-kind').selectOption('complementary');
  await expect(sw).toHaveCount(2);
  // history records clicked colours (most recent first)
  await expect(page.getByTestId('color-history-item').first()).toBeVisible();
  const n = await page.getByTestId('color-history-item').count();
  await page.getByTestId('color-history-item').first().click({ button: 'right' });
  await expect(page.getByTestId('color-history-item')).toHaveCount(n - 1);
});

test('palettes: default seed, create, add colour, persist across reload, import by drop', async ({ page }) => {
  await boot(page);
  await studio(page);
  await expect(page.getByTestId('palette-select')).toContainText('Default (16)');
  await page.getByTestId('palette-new').click();
  await page.getByTestId('prompt-input').fill('My Palette');
  await page.getByTestId('prompt-ok').click();
  await expect(page.getByTestId('palette-select')).toContainText('My Palette (0)');
  await setHex(page, '#123456');
  await page.getByTestId('palette-add').click();
  await expect(page.getByTestId('palette-swatch')).toHaveCount(1);
  await setHex(page, '#654321');
  await page.getByTestId('palette-add').click();
  await expect(page.getByTestId('palette-swatch')).toHaveCount(2);
  // click a swatch sets the primary colour
  await page.getByTestId('palette-swatch').first().click();
  await expect(hexInput(page)).toHaveValue('#123456');
  // drag to reorder
  await page.getByTestId('palette-swatch').first().dragTo(page.getByTestId('palette-swatch').nth(1));
  await expect.poll(() => page.getByTestId('palette-swatch').first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(101, 67, 33)');
  // reload persists
  await page.reload();
  await expect(page.getByTestId('explorer')).toBeVisible();
  await page.keyboard.press('Control+Alt+n');
  await expect(page.getByTestId('color-panel')).toBeVisible();
  await expect(page.getByTestId('palette-select')).toContainText('My Palette (2)');
  // import by dropping a .gpl file
  await dropFile(page, 'palette-drop', 'e2e/fixtures/sunset.gpl', 'sunset.gpl', 'application/octet-stream');
  await expect(page.getByTestId('palette-select')).toContainText('E2E Sunset (3)');
  await expect(page.getByTestId('palette-swatch')).toHaveCount(3);
  await page.getByTestId('palette-swatch').nth(2).click({ modifiers: ['Shift'] });
  expect(await page.getByTestId('color-swatch-secondary').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(90, 20, 120)');
  // remove with right-click, then delete the palette
  await page.getByTestId('palette-swatch').first().click({ button: 'right' });
  await expect(page.getByTestId('palette-swatch')).toHaveCount(2);
  await page.getByTestId('palette-delete').click();
  await page.getByTestId('confirm-ok').click();
  await expect(page.getByTestId('palette-select')).not.toContainText('E2E Sunset');
});

test('eyedropper picks the colour of a painted stroke and returns to the brush', async ({ page }) => {
  await boot(page);
  const { cx, cy } = await studio(page);
  await page.getByTestId('paint-tool-brush').click();
  await setHex(page, '#e11d48');
  await page.mouse.move(cx - 100, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 100, cy, { steps: 15 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  // stroke colour was recorded in history
  await expect(page.getByTestId('color-history-item').first()).toBeVisible();
  await setHex(page, '#000000');
  await page.getByTestId('paint-tool-eyedropper').click();
  await expect(page.getByTestId('eyedropper-source')).toBeVisible();
  await page.mouse.click(cx, cy);
  const picked = await hexInput(page).inputValue();
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(picked.slice(i, i + 2), 16));
  expect(r).toBeGreaterThan(200);
  expect(g).toBeLessThan(60);
  expect(b).toBeLessThan(110);
  // returned to the brush tool
  await expect(page.getByTestId('paint-tool-brush')).toHaveClass(/bg-accent/);
});
