import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { LayoutTemplate } from 'lucide-react';
import { toast } from '@/store/status';
import { registerTabView } from '@/views/registry';
import { TEMPLATES, type Template } from './templates';

const S = { stroke: 'currentColor', fill: 'none', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const PREVIEWS: Record<string, ReactNode> = {
  cornell: (
    <g {...S}><rect x="8" y="6" width="144" height="68" rx="3" /><line x1="52" y1="6" x2="52" y2="54" /><line x1="8" y1="54" x2="152" y2="54" />
      {[16, 26, 36, 46].map((y) => <line key={y} x1="60" y1={y} x2="140" y2={y} opacity=".5" />)}<line x1="16" y1="16" x2="42" y2="16" opacity=".5" /><line x1="16" y1="28" x2="38" y2="28" opacity=".5" />
      <rect x="14" y="58" width="132" height="12" rx="2" className="text-accent" /></g>
  ),
  kanban: (
    <g {...S}>{[0, 1, 2].map((i) => <g key={i}><rect x={10 + i * 48} y="8" width="42" height="64" rx="3" />
      <rect x={14 + i * 48} y="14" width="34" height="12" rx="2" className="text-accent" />{i < 2 && <rect x={14 + i * 48} y="30" width="34" height="12" rx="2" opacity=".6" />}{i === 0 && <rect x="14" y="46" width="34" height="12" rx="2" opacity=".6" />}</g>)}</g>
  ),
  storyboard: (
    <g {...S}>{[0, 1, 2, 3, 4, 5].map((i) => { const x = 8 + (i % 3) * 49, y = 8 + Math.floor(i / 3) * 36; return <g key={i}><rect x={x} y={y} width="44" height="24" rx="2" /><line x1={x + 4} y1={y + 29} x2={x + 36} y2={y + 29} opacity=".5" /></g>; })}</g>
  ),
  mindmap: (
    <g {...S}><rect x="12" y="30" width="38" height="20" rx="10" className="text-accent" />
      {[10, 28, 46, 64].map((y, i) => <g key={y}><path d={`M50 40 C70 40 70 ${y + 5} 96 ${y + 5}`} opacity=".7" /><rect x="96" y={y - 1} width="50" height="12" rx="6" opacity={0.9 - i * 0.1} /></g>)}</g>
  ),
  pixel: (
    <g {...S}><rect x="40" y="8" width="80" height="64" rx="2" />{[0, 1, 2, 3].map((i) => <line key={`v${i}`} x1={56 + i * 16} y1="8" x2={56 + i * 16} y2="72" opacity=".35" />)}{[0, 1, 2].map((i) => <line key={`h${i}`} x1="40" y1={24 + i * 16} x2="120" y2={24 + i * 16} opacity=".35" />)}
      {[[56, 24], [72, 40], [88, 40], [72, 56], [104, 24]].map(([x, y]) => <rect key={`${x}${y}`} x={x} y={y} width="16" height="16" fill="currentColor" className="text-accent" stroke="none" />)}</g>
  ),
  architecture: (
    <g {...S}><rect x="8" y="30" width="30" height="20" rx="2" /><path d="M70 28 L88 40 L70 52 L52 40 Z" className="text-accent" /><rect x="104" y="8" width="34" height="18" rx="2" /><rect x="104" y="54" width="34" height="18" rx="2" /><ellipse cx="146" cy="40" rx="9" ry="9" />
      <path d="M38 40 H52 M88 40 H104 M88 40 L104 17 M88 40 L104 63 M138 17 H146 V31" opacity=".7" /></g>
  ),
  weekly: (
    <g {...S}><rect x="8" y="6" width="144" height="14" rx="2" className="text-accent" />{[0, 1, 2, 3, 4].map((i) => <g key={i}><rect x="12" y={26 + i * 10} width="6" height="6" rx="1" /><line x1="24" y1={29 + i * 10} x2={100 + (i % 3) * 20} y2={29 + i * 10} opacity=".5" /></g>)}</g>
  ),
  meeting: (
    <g {...S}><line x1="12" y1="12" x2="80" y2="12" className="text-accent" strokeWidth="3" /><line x1="12" y1="24" x2="50" y2="24" opacity=".5" />{[0, 1, 2].map((i) => <g key={i}><circle cx="16" cy={38 + i * 12} r="2.5" /><line x1="26" y1={38 + i * 12} x2={100 - i * 14} y2={38 + i * 12} opacity=".5" /></g>)}<rect x="110" y="34" width="38" height="34" rx="3" opacity=".6" /></g>
  ),
};

const KIND_LABEL: Record<Template['kind'], string> = { document: 'Document', canvas: 'Canvas', board: 'Board' };

function TemplatesView() {
  const [busy, setBusy] = useState<string | null>(null);
  const create = async (t: Template) => {
    if (busy) return;
    setBusy(t.id);
    try { await t.create(); toast(`Created ${t.title}`, 'ok'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not create template', 'error'); }
    finally { setBusy(null); }
  };
  return (
    <div className="h-full overflow-y-auto bg-bg p-8" data-testid="templates">
      <div className="mx-auto max-w-[1000px]">
        <div className="mb-6 flex items-center gap-2.5"><LayoutTemplate size={20} className="text-accent" /><h1 className="text-[20px] font-semibold">Templates</h1></div>
        <p className="mb-6 text-[13px] text-fg-muted">Start from a ready-made page. Templates are created in the current notebook and opened for you.</p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
          {TEMPLATES.map((t) => (
            <button
              key={t.id} data-testid={`template-${t.id}`} onClick={() => void create(t)} disabled={busy !== null}
              className={clsx('group flex flex-col overflow-hidden rounded-xl border border-line bg-bg-1 text-left transition-all hover:-translate-y-0.5 hover:border-accent hover:shadow-lg disabled:opacity-60', busy === t.id && 'border-accent')}
            >
              <div className="flex h-[110px] items-center justify-center bg-bg-2 text-fg-muted group-hover:text-fg">
                <svg viewBox="0 0 160 80" className="h-[84px] w-[168px]" aria-hidden>{PREVIEWS[t.id]}</svg>
              </div>
              <div className="flex-1 p-3.5">
                <div className="flex items-center gap-2"><span className="text-[17px]">{t.icon}</span><span className="text-[14px] font-semibold">{t.title}</span>
                  <span className="ml-auto rounded bg-bg-3 px-1.5 text-[10.5px] uppercase tracking-wide text-fg-muted">{KIND_LABEL[t.kind]}</span></div>
                <p className="mt-1.5 text-[12.5px] leading-snug text-fg-muted">{t.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

registerTabView('templates', TemplatesView);
