/** Template definitions: each creates a fully set-up page (or folder of pages) in the current notebook. */
import { nanoid } from 'nanoid';
import { db } from '@/db/schema';
import * as repo from '@/db/repo';
import type { CanvasObject, CanvasObjectType, PageMode, TreeNode } from '@/db/types';
import { indexDoc } from '@/editor/indexing';
import type { PMNode } from '@/export/markdown';
import { ensureTarget, openNode, todayString } from '@/layout/actions';
import { useTabs } from '@/store/tabs';
import { useWorkspace } from '@/store/workspace';
import { PaintDocument } from '@/paint/engine/document';

// ───────────── ProseMirror JSON builders ─────────────
const t = (text: string): PMNode => ({ type: 'text', text });
const bold = (text: string): PMNode => ({ type: 'text', text, marks: [{ type: 'bold' }] });
const para = (...inline: (PMNode | string)[]): PMNode => {
  const content = inline.map((i) => (typeof i === 'string' ? t(i) : i)).filter((n) => n.type !== 'text' || n.text);
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
};
const h = (level: number, text: string): PMNode => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const bullets = (...items: string[]): PMNode => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [para(i)] })) });
const numbered = (...items: string[]): PMNode => ({ type: 'orderedList', attrs: { start: 1 }, content: items.map((i) => ({ type: 'listItem', content: [para(i)] })) });
const tasks = (...items: (string | [string, boolean])[]): PMNode => ({
  type: 'taskList',
  content: items.map((i) => { const [text, checked] = typeof i === 'string' ? [i, false] : i; return { type: 'taskItem', attrs: { checked }, content: [para(text)] }; }),
});
const callout = (kind: string, emoji: string, ...blocks: PMNode[]): PMNode => ({ type: 'callout', attrs: { kind, emoji }, content: blocks });
const cell = (type: 'tableCell' | 'tableHeader', ...blocks: PMNode[]): PMNode => ({ type, content: blocks.length ? blocks : [para()] });
const table = (header: string[], rows: PMNode[][][]): PMNode => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: header.map((x) => cell('tableHeader', para(bold(x)))) },
    ...rows.map((r) => ({ type: 'tableRow', content: r.map((c) => cell('tableCell', ...c)) })),
  ],
});
const doc = (...blocks: PMNode[]): PMNode => ({ type: 'doc', content: blocks });

// ───────────── Canvas builders ─────────────
interface Ctx { workspaceId: string; notebookId: string }
let z = 0;
function obj(pageId: string, type: CanvasObjectType, x: number, y: number, w: number, h: number, data: Record<string, unknown>, id = nanoid()): CanvasObject {
  const now = Date.now();
  return { id, pageId, type, x, y, w, h, rotation: 0, z: ++z, locked: false, groupId: null, data, createdAt: now, updatedAt: now };
}
function connector(pageId: string, from: string, to: string, extra: Record<string, unknown> = {}): CanvasObject {
  return obj(pageId, 'connector', 0, 0, 0, 0, { from, to, fromSide: 'e', toSide: 'w', route: 'curved', mind: true, arrowEnd: false, ...extra });
}

async function newPageNode(ctx: Ctx, title: string, icon: string, mode: PageMode, templateId: string, extra: { parentId?: string | null; status?: string } = {}): Promise<TreeNode> {
  const node = await repo.createNode({
    workspaceId: ctx.workspaceId, notebookId: ctx.notebookId, parentId: extra.parentId ?? null, kind: 'page',
    title, icon, mode, templateId, status: extra.status,
  });
  useWorkspace.getState().setExpanded(ctx.notebookId, true);
  return node;
}

async function writeDoc(pageId: string, d: PMNode): Promise<void> {
  await repo.saveDoc({ pageId, content: d, ...indexDoc(d) });
}

async function docPage(ctx: Ctx, title: string, icon: string, templateId: string, d: PMNode, extra: { parentId?: string | null; status?: string } = {}): Promise<TreeNode> {
  const node = await newPageNode(ctx, title, icon, 'document', templateId, extra);
  await writeDoc(node.id, d);
  return node;
}

async function canvasPage(ctx: Ctx, title: string, icon: string, templateId: string, build: (pageId: string) => CanvasObject[] | Promise<CanvasObject[]>): Promise<TreeNode> {
  const node = await newPageNode(ctx, title, icon, 'canvas', templateId);
  const objs = await build(node.id);
  await db.canvasObjects.bulkAdd(objs);
  return node;
}

export interface Template { id: string; title: string; description: string; icon: string; kind: 'document' | 'canvas' | 'board'; create(): Promise<void> }

async function ctx(): Promise<Ctx> { return ensureTarget(); }
const open = (n: TreeNode) => openNode(n, { newTab: true });

export const TEMPLATES: Template[] = [
  {
    id: 'cornell', title: 'Cornell Notes', icon: '🗒️', kind: 'document',
    description: 'Cue column beside your notes with a summary callout, the classic study layout.',
    async create() {
      const c = await ctx();
      const rows = Array.from({ length: 6 }, () => [[para()], [para()]]);
      const n = await docPage(c, 'Cornell Notes', '🗒️', 'cornell', doc(
        h(1, 'Cornell Notes'),
        para(bold('Topic: '), t(''), t('   '), bold('Date: '), t(todayString())),
        table(['Cues / Questions', 'Notes'], rows),
        h(2, 'Summary'),
        callout('note', '📝', para('Summarise the page in two or three sentences, in your own words.')),
      ));
      open(n);
    },
  },
  {
    id: 'kanban', title: 'Kanban Board', icon: '🗂️', kind: 'board',
    description: 'A folder of task pages with statuses, opened as a drag-and-drop board.',
    async create() {
      const c = await ctx();
      const folder = await repo.createNode({ workspaceId: c.workspaceId, notebookId: c.notebookId, parentId: null, kind: 'folder', title: 'Kanban Board', icon: '🗂️', templateId: 'kanban' });
      useWorkspace.getState().setExpanded(c.notebookId, true);
      useWorkspace.getState().setExpanded(folder.id, true);
      const seed: [string, string, string, string[]][] = [
        ['Plan the project', 'To do', '🧭', ['Define the goal', 'List milestones']],
        ['Build the first version', 'Doing', '🔨', ['Sketch the design', 'Implement the core']],
        ['Ship it', 'Done', '🚀', ['Write release notes']],
      ];
      for (const [title, status, icon, items] of seed) {
        await docPage(c, title, icon, 'kanban', doc(h(2, title), tasks(...items.map((i): [string, boolean] => [i, status === 'Done']))), { parentId: folder.id, status });
      }
      useTabs.getState().open({ kind: 'kanban', title: 'Kanban Board', params: { folderId: folder.id } }, { newTab: true });
    },
  },
  {
    id: 'storyboard', title: 'Storyboard', icon: '🎞️', kind: 'canvas',
    description: 'Canvas with six framed panels and a caption box under each.',
    async create() {
      const c = await ctx();
      const n = await canvasPage(c, 'Storyboard', '🎞️', 'storyboard', (pid) => {
        const out: CanvasObject[] = [];
        for (let i = 0; i < 6; i++) {
          const x = (i % 3) * 420, y = Math.floor(i / 3) * 360;
          out.push(obj(pid, 'frame', x, y, 380, 240, { text: `Panel ${i + 1}` }));
        }
        for (let i = 0; i < 6; i++) {
          const x = (i % 3) * 420, y = Math.floor(i / 3) * 360;
          out.push(obj(pid, 'text', x, y + 252, 380, 60, { text: `Caption ${i + 1}: what happens here?`, fontSize: 16 }));
        }
        return out;
      });
      open(n);
    },
  },
  {
    id: 'mindmap', title: 'Mind Map', icon: '🧠', kind: 'canvas',
    description: 'A central idea with four connected branches ready to extend with Tab and Enter.',
    async create() {
      const c = await ctx();
      const n = await canvasPage(c, 'Mind Map', '🧠', 'mindmap', (pid) => {
        const center = obj(pid, 'mindnode', 0, 0, 170, 56, { text: 'Central idea', level: 0, color: '#7c5cff' });
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899'];
        const ys = [-210, -70, 70, 210];
        const out: CanvasObject[] = [center];
        ys.forEach((y, i) => {
          const child = obj(pid, 'mindnode', 340, y - 20, 130, 44, { text: `Branch ${i + 1}`, level: 1, color: colors[i] });
          out.push(child, connector(pid, center.id, child.id, { color: colors[i] }));
        });
        return out;
      });
      open(n);
    },
  },
  {
    id: 'pixel', title: 'Pixel / Sprite Sheet Grid', icon: '👾', kind: 'canvas',
    description: 'A 128×128 painting on a canvas with an 8px grid for pixel art and sprite sheets.',
    async create() {
      const c = await ctx();
      const node = await newPageNode(c, 'Sprite Sheet', '👾', 'canvas', 'pixel');
      const objId = nanoid();
      const pd = await PaintDocument.create({ pageId: node.id, ownerId: objId, width: 128, height: 128, background: 'transparent', name: 'Sprite' });
      await db.canvasObjects.bulkAdd([
        obj(node.id, 'paint', 0, 0, 512, 512, { docId: pd.id, name: 'Sprite' }, objId),
        obj(node.id, 'text', 0, -48, 512, 36, { text: '128×128 sprite sheet · double-click the frame to paint', fontSize: 16 }),
      ]);
      await repo.setSetting(`canvas-settings:${node.id}`, { background: 'grid', gridSize: 8, bgColor: null });
      open(node);
    },
  },
  {
    id: 'architecture', title: 'Architecture Diagram', icon: '🏗️', kind: 'canvas',
    description: 'Client, gateway, services and data stores wired together with connectors.',
    async create() {
      const c = await ctx();
      const n = await canvasPage(c, 'Architecture Diagram', '🏗️', 'architecture', (pid) => {
        const shape = (x: number, y: number, w: number, hh: number, kind: 'rect' | 'ellipse' | 'diamond', text: string, color: string) =>
          obj(pid, 'shape', x, y, w, hh, { shape: kind, stroke: color, fill: `${color}22`, strokeWidth: 2, text, fontSize: 15 });
        const client = shape(0, 120, 150, 70, 'rect', 'Client', '#3b82f6');
        const gateway = shape(260, 105, 170, 100, 'diamond', 'API Gateway', '#7c5cff');
        const svcA = shape(560, 0, 160, 70, 'rect', 'Auth Service', '#10b981');
        const svcB = shape(560, 240, 160, 70, 'rect', 'Notes Service', '#10b981');
        const db1 = shape(860, 0, 150, 90, 'ellipse', 'Users DB', '#f59e0b');
        const db2 = shape(860, 230, 150, 90, 'ellipse', 'Notes DB', '#f59e0b');
        const cache = shape(560, 120, 160, 70, 'ellipse', 'Cache', '#ec4899');
        const link = (a: CanvasObject, b: CanvasObject, fs: 'e' | 'n' | 's' | 'w' = 'e', ts: 'e' | 'n' | 's' | 'w' = 'w') =>
          connector(pid, a.id, b.id, { fromSide: fs, toSide: ts, route: 'orthogonal', mind: false, arrowEnd: true, color: '#94a3b8' });
        return [client, gateway, svcA, svcB, db1, db2, cache,
          link(client, gateway), link(gateway, svcA), link(gateway, svcB), link(gateway, cache), link(svcA, db1), link(svcB, db2), link(svcB, cache, 'n', 's')];
      });
      open(n);
    },
  },
  {
    id: 'weekly', title: 'Weekly Planner', icon: '📆', kind: 'document',
    description: 'Monday to Sunday with a task list per day and a priorities callout.',
    async create() {
      const c = await ctx();
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const n = await docPage(c, `Week of ${todayString()}`, '📆', 'weekly', doc(
        h(1, 'Weekly Planner'),
        callout('tip', '🎯', para(bold('Top priorities')), tasks('Priority 1', 'Priority 2', 'Priority 3')),
        ...days.flatMap((d) => [h(2, d), tasks('')]),
      ));
      open(n);
    },
  },
  {
    id: 'meeting', title: 'Meeting Notes', icon: '🤝', kind: 'document',
    description: 'Date, attendees, agenda, notes, decisions and an action-item checklist.',
    async create() {
      const c = await ctx();
      const n = await docPage(c, `Meeting ${todayString()}`, '🤝', 'meeting', doc(
        h(1, 'Meeting Notes'),
        para(bold('Date: '), t(todayString())),
        h(2, 'Attendees'),
        bullets('Name', 'Name'),
        h(2, 'Agenda'),
        numbered('Topic one', 'Topic two'),
        h(2, 'Notes'),
        para(),
        h(2, 'Decisions'),
        callout('success', '✅', para('Record what was decided and why.')),
        h(2, 'Action items'),
        tasks('Owner: first action', 'Owner: second action'),
        para(t('Follow-ups are reviewed at the next meeting.'), { type: 'footnoteRef', attrs: { id: nanoid(6), note: 'Agree an owner and a due date for every action item.' } }),
      ));
      open(n);
    },
  },
];

export function getTemplate(id: string): Template | undefined { return TEMPLATES.find((x) => x.id === id); }
