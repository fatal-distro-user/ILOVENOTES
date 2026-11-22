import { test, expect, type Page } from '@playwright/test';
import { boot, newPage } from './helpers';

/** Capture files written through the File System Access save picker; feed them back to the open picker. */
async function interceptFiles(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __files: Record<string, Uint8Array>; showSaveFilePicker: unknown; showOpenFilePicker: unknown; __next?: string };
    w.__files = {};
    w.showSaveFilePicker = async (o: { suggestedName: string }) => ({
      createWritable: async () => ({ write: async (b: Blob) => { w.__files[o.suggestedName] = new Uint8Array(await b.arrayBuffer()); }, close: async () => undefined }),
    });
    w.showOpenFilePicker = async () => [{ getFile: async () => new File([w.__files[w.__next!] as BlobPart], w.__next!) }];
  });
}
const saved = (page: Page) => page.evaluate(() => Object.fromEntries(Object.entries((window as unknown as { __files: Record<string, Uint8Array> }).__files).map(([k, v]) => [k, { size: v.length, head: Array.from(v.slice(0, 8)), text: new TextDecoder().decode(v.slice(0, 4000)) }])));

test('page markdown, canvas SVG/PNG export', async ({ page }) => {
  await boot(page);
  await interceptFiles(page);
  const ed = await newPage(page, 'Exported');
  await ed.click();
  await page.keyboard.type('Hello **world** with $x^2$ ');
  await page.waitForTimeout(600);
  await page.getByTestId('page-export').click();
  await page.getByTestId('export-md').click();
  await expect.poll(async () => Object.keys(await saved(page))).toContain('Exported.md');
  const md = (await saved(page))['Exported.md'].text;
  expect(md).toContain('title: "Exported"');
  expect(md).toContain('Hello **world** with $x^2$');
  // Canvas export.
  await page.getByTestId('mode-switch').getByText('Canvas').click();
  const b = (await page.getByTestId('canvas').boundingBox())!;
  await page.getByTestId('tool-rect').click();
  await page.mouse.move(b.x + 200, b.y + 200); await page.mouse.down(); await page.mouse.move(b.x + 350, b.y + 300, { steps: 5 }); await page.mouse.up();
  await page.getByTestId('tool-pen').click();
  await page.mouse.move(b.x + 200, b.y + 350); await page.mouse.down(); await page.mouse.move(b.x + 400, b.y + 380, { steps: 10 }); await page.mouse.up();
  await page.keyboard.press('Control+Shift+e');
  await page.getByTestId('export-svg').click();
  await expect.poll(async () => Object.keys(await saved(page))).toContain('Exported.svg');
  const svg = (await saved(page))['Exported.svg'].text;
  expect(svg.startsWith('<svg')).toBe(true);
  await page.keyboard.press('Control+Shift+e');
  await page.getByTestId('export-png').click();
  await expect.poll(async () => (await saved(page))['Exported.png']?.head.slice(0, 4)).toEqual([137, 80, 78, 71]);
});

test('workspace export → import round-trip creates a new workspace with the same pages', async ({ page }) => {
  await boot(page);
  await interceptFiles(page);
  const ed = await newPage(page, 'Backup me');
  await ed.click();
  await page.keyboard.type('Precious content');
  await page.waitForTimeout(600);
  await page.keyboard.press('Control+Shift+e');
  await page.getByTestId('export-workspace').click();
  const name = await expect.poll(async () => Object.keys(await saved(page)).find((k) => k.endsWith('.ilovenotes')) ?? '').not.toBe('').then(async () => Object.keys(await saved(page)).find((k) => k.endsWith('.ilovenotes'))!);
  await page.evaluate((n) => { (window as unknown as { __next: string }).__next = n; }, name);
  await page.keyboard.press('Control+Shift+o');
  await expect(page.getByTestId('toast')).toContainText('Imported workspace');
  await expect(page.getByTestId('tree-node').filter({ hasText: 'Backup me' })).toBeVisible();
  await page.getByTestId('tree-node').filter({ hasText: 'Backup me' }).click();
  await expect(page.getByTestId('doc-editor')).toContainText('Precious content');
});

test('painting exports ORA, PSD and layer ZIP', async ({ page }) => {
  await boot(page);
  await interceptFiles(page);
  await page.keyboard.press('Control+Alt+n');
  await expect(page.getByTestId('paint-studio')).toBeVisible();
  const s = (await page.getByTestId('paint-surface').boundingBox())!;
  await page.getByTestId('paint-tool-brush').click();
  await page.mouse.move(s.x + 200, s.y + 200); await page.mouse.down(); await page.mouse.move(s.x + 400, s.y + 250, { steps: 10 }); await page.mouse.up();
  for (const id of ['export-ora', 'export-psd', 'export-layers-zip']) {
    await page.getByTestId('paint-export').click();
    await page.getByTestId(id).click();
  }
  await expect.poll(async () => Object.keys(await saved(page)).sort()).toEqual(['Painting-layers.zip', 'Painting.ora', 'Painting.psd']);
  const f = await saved(page);
  expect(f['Painting.psd'].text.slice(0, 4)).toBe('8BPS');
  expect(f['Painting.ora'].text).toContain('mimetypeimage/openraster');
  expect(f['Painting-layers.zip'].head.slice(0, 2)).toEqual([80, 75]);
});
