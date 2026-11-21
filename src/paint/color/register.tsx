import { Palette } from 'lucide-react';
import { registerPanel } from '@/panels/registry';
import { registerCommands } from '@/commands/registry';
import { activeTab } from '@/store/tabs';
import { usePaintStudio } from '../studio/store';
import { ColorPanel } from './ColorPanel';
import { trackStrokeColors } from './store';
import { createPalette, importPaletteDialog, pickImageForExtraction, exportPalette, activePalette } from './paletteActions';
import { toast } from '@/store/status';
import './eyedropper';

const isPaint = () => activeTab()?.kind === 'paint' || !!usePaintStudio.getState().doc;

registerPanel({ id: 'color', title: 'Color', icon: Palette, defaultSide: 'right', component: ColorPanel, when: isPaint, defaultOrder: 4 });
trackStrokeColors();

registerCommands([
  { id: 'color.swap', title: 'Color: Swap primary / secondary', category: 'Color', when: isPaint, run: () => usePaintStudio.getState().swapColors() },
  { id: 'color.reset', title: 'Color: Reset to black / white', category: 'Color', when: isPaint, run: () => usePaintStudio.getState().set({ color: '#000000', secondary: '#ffffff' }) },
  { id: 'color.eyedropper', title: 'Color: Eyedropper', category: 'Color', when: () => !!usePaintStudio.getState().doc, run: () => usePaintStudio.getState().setTool('eyedropper') },
  { id: 'color.newPalette', title: 'Color: New palette', category: 'Color', when: isPaint, run: async () => { await createPalette(); } },
  { id: 'color.extractFromImage', title: 'Color: Extract palette from image…', category: 'Color', when: isPaint, run: () => pickImageForExtraction() },
  { id: 'color.importPalette', title: 'Color: Import palette (.gpl, .hex)…', category: 'Color', when: isPaint, run: () => importPaletteDialog() },
  { id: 'color.exportPalette', title: 'Color: Export active palette as .gpl', category: 'Color', when: isPaint, run: async () => { const p = await activePalette(); if (p) await exportPalette(p, 'gpl'); else toast('No palette to export', 'error'); } },
]);
