import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { switchDatabase } from '@/db/schema';
import { CanvasDoc } from './doc';
import type { Stroke } from '@/db/types';

let n = 0;
beforeEach(() => { switchDatabase(`canvas-${++n}`); });
const stroke = (id: string): Stroke => ({ id, pageId: 'p', points: [0, 0, 0.5, 0, 10, 10, 0.5, 1], color: '#000', width: 2, opacity: 1, tool: 'pen', createdAt: Date.now() });

describe('CanvasDoc history', () => {
  it('undoes and redoes stroke commits in order', async () => {
    const d = new CanvasDoc('p');
    await d.load();
    await d.commit('a', { strokes: { put: [stroke('a')] } });
    await d.commit('b', { strokes: { put: [stroke('b')] } });
    await d.history.undo();
    expect(Object.keys(d.state.strokes)).toEqual(['a']);
    await d.history.redo();
    expect(Object.keys(d.state.strokes).sort()).toEqual(['a', 'b']);
  });
  it('move commit restores previous positions on undo', async () => {
    const d = new CanvasDoc('p');
    await d.load();
    const o = d.newObject('shape', { x: 0, y: 0, w: 10, h: 10 });
    await d.addObjects([o]);
    d.preview([{ ...o, x: 50 }]);
    await d.commit('Move', { objects: { put: [{ ...o, x: 50 }] } }, 'object', { objects: [o] });
    expect(d.state.objects[o.id].x).toBe(50);
    await d.history.undo();
    expect(d.state.objects[o.id].x).toBe(0);
    await d.history.redo();
    expect(d.state.objects[o.id].x).toBe(50);
  });
});
