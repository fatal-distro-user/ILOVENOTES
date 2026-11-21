import 'katex/dist/katex.min.css';
import './editor.css';
import { registerPageBody, type PageBodyProps } from '@/views/registry';
import { registerCommands } from '@/commands/registry';
import { DocumentEditor } from './DocumentEditor';
import { SuggestionMenu } from './SuggestionMenu';
import { useActiveEditor } from './activeEditor';
import { registerGlobalOverlay } from '@/layout/overlays';
import './panels';

function DocumentBody({ node, active }: PageBodyProps) {
  return (
    <div className="h-full overflow-y-auto" data-scroll-container>
      <DocumentEditor pageId={node.id} active={active} />
    </div>
  );
}

registerPageBody('document', DocumentBody);
registerGlobalOverlay('suggestion-menu', SuggestionMenu);

const ed = () => { const e = useActiveEditor.getState().editor; return e && !e.isDestroyed ? e : null; };
registerCommands([
  { id: 'doc.heading1', title: 'Document: Heading 1', category: 'Document', when: () => !!ed(), run: () => { ed()?.chain().focus().toggleHeading({ level: 1 }).run(); } },
  { id: 'doc.heading2', title: 'Document: Heading 2', category: 'Document', when: () => !!ed(), run: () => { ed()?.chain().focus().toggleHeading({ level: 2 }).run(); } },
  { id: 'doc.checklist', title: 'Document: Toggle checklist', category: 'Document', when: () => !!ed(), run: () => { ed()?.chain().focus().toggleTaskList().run(); } },
  { id: 'doc.codeBlock', title: 'Document: Insert code block', category: 'Document', when: () => !!ed(), run: () => { ed()?.chain().focus().setCodeBlock({ language: 'javascript' }).run(); } },
  { id: 'doc.math', title: 'Document: Insert math block', category: 'Document', when: () => !!ed(), run: () => { ed()?.chain().focus().insertMathBlock('').run(); } },
  { id: 'doc.table', title: 'Document: Insert table', category: 'Document', when: () => !!ed(), run: () => { ed()?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); } },
  { id: 'doc.toc', title: 'Document: Insert table of contents', category: 'Document', when: () => !!ed(), run: () => { ed()?.chain().focus().insertContent({ type: 'tableOfContents' }).run(); } },
  { id: 'doc.callout', title: 'Document: Insert callout', category: 'Document', when: () => !!ed(), run: () => { ed()?.chain().focus().setCallout('note').run(); } },
  { id: 'doc.footnote', title: 'Document: Insert footnote', category: 'Document', when: () => !!ed(), run: () => { ed()?.chain().focus().insertFootnote('').run(); } },
]);
