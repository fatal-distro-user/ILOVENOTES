// Renders public/icons/icon.svg to the PNG sizes required by the PWA manifest and electron-builder.
// Usage: node scripts/gen-icons.mjs   (requires `npx playwright install chromium`)
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const svg = await readFile(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
await mkdir(new URL('../build/', import.meta.url), { recursive: true });
for (const size of [192, 512, 1024]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  if (size === 1024) await writeFile(new URL('../build/icon.png', import.meta.url), png);
  else await writeFile(new URL(`../public/icons/icon-${size}.png`, import.meta.url), png);
}
await browser.close();
console.log('icons generated');
