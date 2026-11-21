import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import { common, createLowlight } from 'lowlight';
import { useState } from 'react';
import { Check, Copy, Loader2, Play, X } from 'lucide-react';
import clsx from 'clsx';
import { RUNNABLE, runJavaScript, runPython, pythonStatus, type RunLog } from '../sandbox/runners';

export const lowlight = createLowlight(common);
const LANGS = ['plaintext', ...lowlight.listLanguages().filter((l) => l !== 'plaintext').sort()];

function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  const lang = (node.attrs.language as string | null) ?? 'plaintext';
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [out, setOut] = useState<{ logs: RunLog[]; error: string | null; ms: number } | null>(null);
  const kind = RUNNABLE[lang];

  const copy = async () => {
    await navigator.clipboard.writeText(node.textContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const run = async () => {
    if (!kind || running) return;
    setRunning(true);
    const live: RunLog[] = [];
    setOut({ logs: [], error: null, ms: 0 });
    const onLog = (l: RunLog) => { live.push(l); setOut({ logs: [...live], error: null, ms: 0 }); };
    const res = kind === 'js' ? await runJavaScript(node.textContent, 5000, onLog) : await runPython(node.textContent, 30000, onLog);
    setOut({ logs: res.logs, error: res.error, ms: res.ms });
    setRunning(false);
  };

  return (
    <NodeViewWrapper className="iln-code" data-language={lang}>
      <div className="iln-code-bar" contentEditable={false}>
        <select value={lang} disabled={!editor.isEditable} onChange={(e) => updateAttributes({ language: e.target.value })} aria-label="Language">
          {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <div className="flex-1" />
        {kind && (
          <button onClick={() => void run()} disabled={running} title={kind === 'py' && pythonStatus() !== 'ready' ? 'Run (first run downloads Python, ~10 MB)' : 'Run (Mod+Enter)'} data-testid="code-run">
            {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} Run
          </button>
        )}
        <button onClick={() => void copy()} title="Copy code" data-testid="code-copy">{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && kind) { e.preventDefault(); void run(); } }}>
        <NodeViewContent<'code'> as="code" className={`hljs language-${lang}`} />
      </pre>
      {out && (
        <div className="iln-code-out" contentEditable={false} data-testid="code-output">
          <div className="iln-code-out-bar">
            <span>{running ? (kind === 'py' && pythonStatus() !== 'ready' ? 'Loading Python…' : 'Running…') : `Output · ${out.ms.toFixed(0)} ms`}</span>
            <button onClick={() => setOut(null)} title="Clear output"><X size={12} /></button>
          </div>
          {out.logs.map((l, i) => <div key={i} className={clsx('iln-log', `iln-log-${l.level}`)}>{l.level === 'result' ? '← ' : ''}{l.text}</div>)}
          {out.error && <div className="iln-log iln-log-error">{out.error}</div>}
          {!running && !out.error && out.logs.length === 0 && <div className="iln-log text-fg-faint">(no output)</div>}
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() { return ReactNodeViewRenderer(CodeBlockView); },
}).configure({ lowlight, defaultLanguage: 'plaintext' });
