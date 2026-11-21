import { describe, it, expect } from 'vitest';
import { docToMarkdown, docToText, docHeadings, type PMNode } from './markdown';

const t = (text: string, marks?: string[]): PMNode => ({ type: 'text', text, marks: marks?.map((m) => ({ type: m })) });
const doc: PMNode = {
  type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [t('Intro')] },
    { type: 'paragraph', content: [t('Hello '), t('bold', ['bold']), t(' and '), { type: 'wikiLink', attrs: { target: 'Other', alias: 'link' } }, t(' '), { type: 'mathInline', attrs: { latex: 'x^2' } }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [t('one')] }] }, { type: 'listItem', content: [{ type: 'paragraph', content: [t('two')] }] }] },
    { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [t('three')] }] }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [t('done')] }] }] },
    { type: 'codeBlock', attrs: { language: 'js' }, content: [t('const a = 1;')] },
    { type: 'callout', attrs: { kind: 'tip' }, content: [{ type: 'paragraph', content: [t('careful')] }] },
    { type: 'mathBlock', attrs: { latex: '\\int x' } },
    { type: 'table', content: [
      { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [t('A')] }] }, { type: 'tableHeader', content: [{ type: 'paragraph', content: [t('B')] }] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [t('1')] }] }, { type: 'tableCell', content: [{ type: 'paragraph', content: [t('2')] }] }] },
    ] },
  ],
};

describe('markdown export', () => {
  it('serialises the block schema', () => {
    const md = docToMarkdown(doc, {}, 'Title');
    expect(md).toContain('# Title');
    expect(md).toContain('## Intro');
    expect(md).toContain('Hello **bold** and [[Other|link]] $x^2$');
    expect(md).toContain('- one\n- two');
    expect(md).toContain('3. three');
    expect(md).toContain('- [x] done');
    expect(md).toContain('```js\nconst a = 1;\n```');
    expect(md).toContain('> [!TIP]\n> careful');
    expect(md).toContain('$$\n\\int x\n$$');
    expect(md).toContain('| A | B |\n| --- | --- |\n| 1 | 2 |');
  });
  it('escapes markdown characters in text', () => {
    expect(docToMarkdown({ type: 'doc', content: [{ type: 'paragraph', content: [t('a*b_c')] }] })).toBe('a\\*b\\_c\n');
  });
  it('extracts text and headings', () => {
    const text = docToText(doc);
    expect(text).toContain('Hello bold and [[Other|link]] x^2');
    expect(docHeadings(doc)).toEqual([{ level: 2, text: 'Intro' }]);
  });
});

describe('markdown footnotes and embeds', () => {
  it('numbers footnotes and appends definitions', () => {
    const md = docToMarkdown({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'A' }, { type: 'footnoteRef', attrs: { id: 'x', note: 'First' } }, { type: 'text', text: ' B' }, { type: 'footnoteRef', attrs: { id: 'y', note: 'Second' } }] },
      { type: 'wikiEmbed', attrs: { target: 'Other' } },
    ] });
    expect(md).toBe('A[^1] B[^2]\n\n![[Other]]\n\n[^1]: First\n[^2]: Second\n');
  });
});
