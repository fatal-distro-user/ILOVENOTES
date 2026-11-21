import StarterKit from '@tiptap/starter-kit';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Image from '@tiptap/extension-image';
import Typography from '@tiptap/extension-typography';
import type { AnyExtension } from '@tiptap/core';
import { Callout } from './nodes/Callout';
import { Toggle, ToggleSummary, ToggleContent } from './nodes/Toggle';
import { MathInline, MathBlock } from './nodes/Math';
import { WikiLink, WikiEmbed } from './nodes/WikiLink';
import { CodeBlock } from './nodes/CodeBlock';
import { FootnoteRef, FootnoteNumbering } from './nodes/Footnote';
import { TableOfContents } from './nodes/Toc';
import { InlineDecorations } from './plugins/decorations';
import { SlashCommand } from './slash';

/** Extra node extensions registered by later modules (inline sketch frames, audio clips, ...). */
const extraExtensions: AnyExtension[] = [];
export function registerEditorExtension(ext: AnyExtension): void { extraExtensions.push(ext); }

export interface ExtensionContext { onTagClick: (tag: string) => void; placeholder?: string }

export function buildExtensions(ctx: ExtensionContext): AnyExtension[] {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } },
      undoRedo: { depth: 300 },
    }),
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return `Heading ${node.attrs.level as number}`;
        if (node.type.name === 'toggleSummary') return 'Toggle title';
        return ctx.placeholder ?? "Type '/' for commands, '[[' to link a page…";
      },
      includeChildren: true,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true }),
    TableRow, TableHeader, TableCell,
    Highlight.configure({ multicolor: true }),
    Subscript, Superscript,
    Image.configure({ allowBase64: true, inline: false }),
    Typography,
    CodeBlock,
    Callout,
    Toggle, ToggleSummary, ToggleContent,
    MathInline, MathBlock,
    WikiLink, WikiEmbed,
    FootnoteRef, FootnoteNumbering,
    TableOfContents,
    InlineDecorations.configure({ onTagClick: ctx.onTagClick }),
    SlashCommand,
    ...extraExtensions,
  ];
}
