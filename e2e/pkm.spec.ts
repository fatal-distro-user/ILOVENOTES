import { test, expect, type Page } from '@playwright/test';
import { boot, newPage } from './helpers';

async function runCommand(page: Page, query: string) {
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette')).toBeVisible();
  await page.getByTestId('palette-input').fill(`>${query}`);
  await expect(page.getByTestId('palette-item').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('palette')).toBeHidden();
}

const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

test('command palette: fuzzy page search and command execution', async ({ page }) => {
  const errors = await boot(page);
  await newPage(page, 'Quantum Mechanics');
  await newPage(page, 'Gardening Notes');
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('palette')).toBeVisible();
  await page.getByTestId('palette-input').fill('quantm mech');
  await expect(page.getByTestId('palette-item').first()).toContainText('Quantum Mechanics');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('page-title')).toHaveValue('Quantum Mechanics');
  await runCommand(page, 'open calendar');
  await expect(page.getByTestId('calendar')).toBeVisible();
  // Esc closes, create-page entry is offered for unknown queries.
  await page.keyboard.press('Control+k');
  await page.getByTestId('palette-input').fill('zzzunknownzzz');
  await expect(page.getByTestId('palette-item').filter({ hasText: 'Create page' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('palette')).toBeHidden();
  expect(errors).toEqual([]);
});

test('knowledge graph shows linked pages', async ({ page }) => {
  const errors = await boot(page);
  await newPage(page, 'Alpha Page');
  const ed = await newPage(page, 'Beta Page');
  await ed.click();
  await page.keyboard.type('Refers to [[Alpha');
  await expect(page.getByTestId('suggest-wiki')).toContainText('Alpha Page');
  await page.keyboard.press('Enter');
  await expect(ed.getByTestId('wikilink')).toHaveText('Alpha Page');
  await page.waitForTimeout(800);
  await runCommand(page, 'knowledge graph');
  const g = page.getByTestId('graph-view');
  await expect(g).toBeVisible();
  await expect(page.getByTestId('graph-canvas')).toBeVisible();
  await expect(g).toHaveAttribute('data-edge-count', '1');
  expect(Number(await g.getAttribute('data-node-count'))).toBeGreaterThanOrEqual(3);
  await page.getByTestId('graph-orphans').getByText('Only').click();
  await expect(g).toHaveAttribute('data-edge-count', '0');
  await page.getByTestId('graph-orphans').getByText('Hide').click();
  await expect(g).toHaveAttribute('data-node-count', '2');
  expect(errors).toEqual([]);
});

test('kanban: drag a card to another column persists status', async ({ page }) => {
  await boot(page);
  await newPage(page, 'Task Alpha');
  await runCommand(page, 'kanban');
  await expect(page.getByTestId('kanban')).toBeVisible();
  const backlog = page.locator('[data-testid="kanban-column"][data-column="Backlog"]');
  const doing = page.locator('[data-testid="kanban-column"][data-column="To do"]');
  const card = backlog.locator('[data-testid="kanban-card"][data-title="Task Alpha"]');
  await expect(card).toBeVisible();
  const from = (await card.boundingBox())!;
  const to = (await doing.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + 20, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + 120, { steps: 12 });
  await page.mouse.up();
  await expect(doing.locator('[data-testid="kanban-card"][data-title="Task Alpha"]')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('kanban')).toBeVisible();
  await expect(page.locator('[data-testid="kanban-column"][data-column="To do"] [data-testid="kanban-card"][data-title="Task Alpha"]')).toBeVisible();
  // Add a card through the column footer.
  await page.locator('[data-testid="kanban-column"][data-column="Done"]').getByTestId('kanban-add-card').click();
  await page.getByTestId('kanban-add-input').fill('Brand new card');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-testid="kanban-column"][data-column="Done"] [data-testid="kanban-card"][data-title="Brand new card"]')).toBeVisible();
});

test('calendar opens (and creates) the daily note for a day', async ({ page }) => {
  await boot(page);
  await runCommand(page, 'open calendar');
  const cal = page.getByTestId('calendar');
  await expect(cal).toBeVisible();
  await page.getByTestId('calendar-mode').getByText('Week').click();
  await page.getByTestId('calendar-mode').getByText('Month').click();
  await page.locator(`[data-testid="calendar-day"][data-date="${today()}"]`).click();
  await expect(page.getByTestId('page-title')).toHaveValue(today());
});

test('flashcards: review a card and the due count drops', async ({ page }) => {
  await boot(page);
  const ed = await newPage(page, 'Geography');
  await ed.click();
  await page.keyboard.type('Capital of France :: Paris');
  await page.waitForTimeout(900);
  await runCommand(page, 'flashcards');
  await expect(page.getByTestId('flashcards')).toBeVisible();
  await expect(page.getByTestId('fc-due-count')).toHaveText('1');
  await page.getByTestId('fc-start').click();
  await expect(page.getByTestId('fc-card')).toContainText('Capital of France');
  await page.getByTestId('fc-flip').click();
  await expect(page.getByTestId('fc-card')).toContainText('Paris');
  await page.getByTestId('fc-grade-good').click();
  await expect(page.getByTestId('fc-summary')).toBeVisible();
  await page.getByTestId('fc-done').click();
  await expect(page.getByTestId('fc-due-count')).toHaveText('0');
});

test('templates: meeting notes and mind map', async ({ page }) => {
  const errors = await boot(page);
  await runCommand(page, 'template library');
  await expect(page.getByTestId('templates')).toBeVisible();
  await page.getByTestId('template-meeting').click();
  await expect(page.getByTestId('page-title')).toHaveValue(/Meeting/);
  await expect(page.getByTestId('doc-editor').last()).toContainText('Action items');
  await expect(page.getByTestId('doc-editor').last()).toContainText('Attendees');
  await runCommand(page, 'template library');
  await page.getByTestId('template-mindmap').click();
  await expect(page.getByTestId('page-title')).toHaveValue('Mind Map');
  await expect(page.getByTestId('mindnode')).toHaveCount(5);
  expect(errors).toEqual([]);
});

test('version history: checkpoint, edit, restore', async ({ page }) => {
  await boot(page);
  const ed = await newPage(page, 'Versioned');
  await ed.click();
  await page.keyboard.type('original wording');
  await page.waitForTimeout(900);
  await page.keyboard.press('Control+Alt+s');
  await page.getByTestId('prompt-input').fill('First draft');
  await page.getByTestId('prompt-ok').click();
  await expect(page.getByTestId('versions-panel').getByTestId('version-item')).toHaveCount(1);
  await ed.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('completely different text');
  await page.waitForTimeout(900);
  await expect(ed).toContainText('completely different text');
  await page.getByTestId('version-item').first().click();
  await expect(page.getByTestId('version-diff')).toBeVisible();
  await page.getByTestId('version-restore').click();
  await expect(ed).toContainText('original wording');
  await expect(ed).not.toContainText('completely different');
});

test('time-lapse replays ink strokes', async ({ page }) => {
  const errors = await boot(page);
  await newPage(page, 'Ink replay');
  await page.getByTestId('mode-switch').getByText('Canvas').click();
  const c = page.getByTestId('canvas');
  await expect(c).toBeVisible();
  const b = (await c.boundingBox())!;
  await page.getByTestId('tool-pen').click();
  await page.mouse.move(b.x + 200, b.y + 200);
  await page.mouse.down();
  await page.mouse.move(b.x + 420, b.y + 280, { steps: 20 });
  await page.mouse.up();
  await expect(page.getByTestId('status-bar')).toContainText('1 strokes');
  await page.getByTestId('versions-timelapse').click();
  const modal = page.getByTestId('timelapse');
  await expect(modal).toBeVisible();
  const state = modal.getByTestId('timelapse-state');
  await expect(state).toHaveAttribute('data-strokes', '1');
  await modal.getByTestId('timelapse-speed-5').click();
  await modal.getByTestId('timelapse-play').click();
  await expect.poll(async () => Number(await state.getAttribute('data-time'))).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  expect(errors).toEqual([]);
});
