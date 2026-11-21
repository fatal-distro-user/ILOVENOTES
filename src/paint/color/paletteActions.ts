import { nanoid } from 'nanoid';
import { db } from '@/db/schema';
import type { Palette } from '@/db/types';
import { openFile, saveFile, openFiles, type OpenedFile } from '@/platform/fileio';
import { promptDialog, confirmDialog } from '@/ui/dialogs';
import { toast } from '@/store/status';
import { toGpl, toHexPalette } from './colorMath';
import { DEFAULT_PALETTE, addColors, dedupeColors, parsePaletteFile } from './palette';
import { useColor, useColorUi } from './store';
import { usePaintStudio } from '../studio/store';

let seeding: Promise<void> | null = null;
/** Create the "Default" palette when none exist (idempotent, safe under StrictMode). */
export function seedDefaultPalette(): Promise<void> {
  seeding ??= db.transaction('rw', db.palettes, async () => {
    if ((await db.palettes.count()) === 0) await db.palettes.add({ id: nanoid(), name: 'Default', colors: DEFAULT_PALETTE, createdAt: Date.now() });
  }).finally(() => { seeding = null; });
  return seeding;
}

export async function activePalette(): Promise<Palette | undefined> {
  const id = useColor.getState().activePaletteId;
  return (id ? await db.palettes.get(id) : undefined) ?? (await db.palettes.orderBy('createdAt').first());
}

export async function createPalette(colors: string[] = [], suggested = 'New palette'): Promise<Palette | null> {
  const name = (await promptDialog('Palette name', suggested))?.trim();
  if (!name) return null;
  const p: Palette = { id: nanoid(), name, colors: dedupeColors(colors), createdAt: Date.now() };
  await db.palettes.add(p);
  useColor.getState().set({ activePaletteId: p.id });
  return p;
}

export async function renamePalette(p: Palette): Promise<void> {
  const name = (await promptDialog('Rename palette', p.name))?.trim();
  if (name) await db.palettes.update(p.id, { name });
}

export async function deletePalette(p: Palette): Promise<void> {
  if (!(await confirmDialog(`Delete palette "${p.name}"?`, { confirmLabel: 'Delete' }))) return;
  await db.palettes.delete(p.id);
  if (useColor.getState().activePaletteId === p.id) useColor.getState().set({ activePaletteId: null });
}

export async function setPaletteColors(id: string, colors: string[]): Promise<void> { await db.palettes.update(id, { colors }); }

export async function addToActivePalette(colors: string[]): Promise<void> {
  const p = await activePalette();
  if (!p) { await createPalette(colors); return; }
  const next = addColors(p.colors, colors);
  if (next.length === p.colors.length) { toast('Already in palette', 'info'); return; }
  await setPaletteColors(p.id, next);
}

/** Import a palette from raw file contents; returns false if the file is not a palette. */
export async function importPaletteFile(f: OpenedFile): Promise<boolean> {
  const parsed = parsePaletteFile(f.name, new TextDecoder().decode(f.data));
  if (!parsed) return false;
  const p: Palette = { id: nanoid(), name: parsed.name, colors: parsed.colors, createdAt: Date.now() };
  await db.palettes.add(p);
  useColor.getState().set({ activePaletteId: p.id });
  toast(`Imported "${p.name}" (${p.colors.length} colours)`, 'ok');
  return true;
}

const PALETTE_FILTERS = [{ name: 'Palette', extensions: ['gpl', 'hex', 'txt'] }];
const IMAGE_FILTERS = [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }];

export async function importPaletteDialog(): Promise<void> {
  const files = await openFiles({ filters: PALETTE_FILTERS, multiple: true });
  for (const f of files) if (!(await importPaletteFile(f))) toast(`"${f.name}" is not a recognised palette file`, 'error');
}

export async function exportPalette(p: Palette, format: 'gpl' | 'hex'): Promise<void> {
  const safe = p.name.replace(/[^\w\- ]+/g, '').trim() || 'palette';
  const data = format === 'gpl' ? toGpl(p.name, p.colors) : toHexPalette(p.colors);
  const saved = await saveFile(data, `${safe}.${format}`, [{ name: format === 'gpl' ? 'GIMP palette' : 'Hex palette', extensions: [format] }]);
  if (saved) toast(`Saved ${saved}`, 'ok');
}

export async function pickImageForExtraction(): Promise<void> {
  const f = await openFile({ filters: IMAGE_FILTERS });
  if (f) useColorUi.getState().setExtract(new Blob([f.data as BlobPart]), f.name);
}

export function currentPrimary(): string { return usePaintStudio.getState().color; }
