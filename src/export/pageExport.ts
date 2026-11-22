/** Page & notebook exports: Markdown (single file or folder ZIP with assets), canvas SVG/PNG, annotated PDF. */
import { zipSync, strToU8 } from 'fflate';
import { db } from '@/db/schema';
import type { TreeNode } from '@/db/types';
import { docToMarkdown, type PMNode } from './markdown';
import { blobToDataUrl } from '@/lib/image';
import { canvasToSvg } from './canvasExport';

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Untitled';

function frontMatter(n: TreeNode): string {
  const lines = ['---', `title: "${n.title.replace(/"/g, '\\"')}"`, `created: ${new Date(n.createdAt).toISOString()}`, `updated: ${new Date(n.updatedAt).toISOString()}`];
  if (n.tags.length) lines.push(`tags: [${n.tags.map((t) => `"${t}"`).join(', ')}]`);
  if (n.dailyDate) lines.push(`date: ${n.dailyDate}`);
  lines.push('---', '');
  return lines.join('\n');
}

/** Markdown for one page. `assets` receives sketch PNGs when exporting into a folder; otherwise images are inlined. */
export async function pageToMarkdown(n: TreeNode, assets?: Record<string, Uint8Array>, assetPrefix = 'assets/'): Promise<string> {
  const doc = await db.docs.get(n.id);
  const sketchIds: string[] = [];
  const collect = (x: PMNode) => { if (x.type === 'sketch' && x.attrs?.docId) sketchIds.push(String(x.attrs.docId)); x.content?.forEach(collect); };
  if (doc?.content) collect(doc.content as PMNode);
  const srcs = new Map<string, string>();
  for (const id of sketchIds) {
    const meta = await db.rasterDocs.get(id);
    if (!meta?.preview) continue;
    if (assets) { const name = `sketch-${id}.png`; assets[name] = new Uint8Array(await meta.preview.arrayBuffer()); srcs.set(id, `${assetPrefix}${name}`); }
    else srcs.set(id, await blobToDataUrl(meta.preview));
  }
  let body = doc?.content ? docToMarkdown(doc.content as PMNode, { sketchSrc: (id) => srcs.get(id) }, n.title) : `# ${n.title}\n`;
  if (n.mode === 'canvas' || n.mode === 'hybrid') {
    const hasCanvas = (await db.canvasObjects.where('pageId').equals(n.id).count()) + (await db.strokes.where('pageId').equals(n.id).count()) > 0;
    if (hasCanvas) {
      const { svg } = await canvasToSvg(n.id, { background: '#ffffff' });
      if (assets) { const name = `canvas-${n.id}.svg`; assets[name] = strToU8(svg); body += `\n![Canvas](${assetPrefix}${name})\n`; }
      else body += `\n![Canvas](data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))})\n`;
    }
  }
  return frontMatter(n) + body;
}

/** Notebook (or whole workspace) as a ZIP of Markdown files mirroring the folder tree. */
export async function notebookToMarkdownZip(notebookId: string): Promise<Uint8Array> {
  const nb = await db.notebooks.get(notebookId);
  if (!nb) throw new Error('Notebook not found');
  const nodes = (await db.nodes.where('notebookId').equals(notebookId).toArray()).filter((n) => !n.deletedAt);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pathOf = (n: TreeNode): string[] => { const out: string[] = []; let p = n.parentId ? byId.get(n.parentId) : undefined; while (p) { out.unshift(safe(p.title)); p = p.parentId ? byId.get(p.parentId) : undefined; } return out; };
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const n of nodes.filter((x) => x.kind === 'page')) {
    const dir = pathOf(n);
    const assets: Record<string, Uint8Array> = {};
    const depth = dir.length;
    const md = await pageToMarkdown(n, assets, `${'../'.repeat(depth)}assets/`);
    let file = [...dir, `${safe(n.title)}.md`].join('/');
    for (let k = 2; used.has(file); k++) file = [...dir, `${safe(n.title)} ${k}.md`].join('/');
    used.add(file);
    files[`${safe(nb.name)}/${file}`] = strToU8(md);
    for (const [name, data] of Object.entries(assets)) files[`${safe(nb.name)}/assets/${name}`] = data;
  }
  return zipSync(files);
}
