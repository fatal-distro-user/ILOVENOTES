import { useEffect, useState, type ReactNode } from 'react';
import { RotateCcw } from 'lucide-react';
import clsx from 'clsx';
import { ACCENTS, THEMES, useLayout, type ThemeId } from '@/store/layout';
import { useWorkspace } from '@/store/workspace';
import { useWorkspaces } from '@/db/hooks';
import { toast } from '@/store/status';
import { Slider } from '@/ui/Slider';
import { Button } from '@/ui/Modal';
import { formatBytes } from '@/layout/StatusBar';
import { registerTabView } from './registry';

function Card({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="mb-4 rounded-lg border border-line bg-bg-1 p-4" data-testid={testId}>
      <h2 className="mb-3 text-[13px] font-semibold text-fg">{title}</h2>
      {children}
    </section>
  );
}

function ThemePreview({ id, label, selected, onSelect }: { id: ThemeId; label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`theme-card-${id}`}
      className={clsx('w-[148px] overflow-hidden rounded-lg border text-left', selected ? 'border-accent ring-2 ring-accent' : 'border-line hover:border-fg-faint')}
    >
      {/* Tailwind color utilities resolve at :root, so the preview references the --iln-* variables directly to pick up its local data-theme. */}
      <div data-theme={id} className="flex h-[84px]" style={{ background: 'var(--iln-bg)', color: 'var(--iln-fg)' }}>
        <div className="w-8 p-1" style={{ background: 'var(--iln-bg-1)', borderRight: '1px solid var(--iln-line)' }}>
          <div className="mb-1 h-1 rounded" style={{ background: 'var(--iln-fg-faint)' }} />
          <div className="mb-1 h-1 w-3/4 rounded" style={{ background: 'var(--iln-fg-faint)' }} />
          <div className="h-1 w-1/2 rounded" style={{ background: 'var(--iln-accent)' }} />
        </div>
        <div className="flex-1 p-1.5">
          <div className="mb-1 h-1.5 w-3/4 rounded" style={{ background: 'var(--iln-fg)' }} />
          <div className="mb-0.5 h-1 rounded" style={{ background: 'var(--iln-fg-muted)' }} />
          <div className="mb-0.5 h-1 w-5/6 rounded" style={{ background: 'var(--iln-fg-muted)' }} />
          <div className="mt-1.5 inline-block rounded px-1.5 text-[7px] leading-3" style={{ background: 'var(--iln-accent)', color: 'var(--iln-accent-fg)' }}>Accent</div>
        </div>
      </div>
      <div className="border-t border-line bg-bg-1 px-2 py-1 text-[12px] text-fg">{label}</div>
    </button>
  );
}

function DataSection() {
  const wsId = useWorkspace((s) => s.workspaceId);
  const workspaces = useWorkspaces();
  const [usage, setUsage] = useState<string>('Calculating…');
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const refresh = async () => {
    try {
      const est = await navigator.storage?.estimate?.();
      setUsage(est?.usage !== undefined ? `${formatBytes(est.usage)}${est.quota ? ` of ${formatBytes(est.quota)}` : ''}` : 'Unavailable');
      setPersisted((await navigator.storage?.persisted?.()) ?? null);
    } catch { setUsage('Unavailable'); }
  };
  useEffect(() => { void refresh(); }, []);
  const request = async () => {
    try {
      const ok = await navigator.storage.persist();
      setPersisted(ok);
      toast(ok ? 'Persistent storage granted' : 'The browser declined persistent storage', ok ? 'ok' : 'info');
    } catch { toast('Persistent storage is not supported here', 'error'); }
  };
  return (
    <Card title="Data" testId="settings-data">
      <dl className="grid grid-cols-[140px_1fr] gap-y-1.5 text-[13px]">
        <dt className="text-fg-muted">Workspace</dt><dd data-testid="settings-workspace">{workspaces.find((w) => w.id === wsId)?.name ?? '—'}</dd>
        <dt className="text-fg-muted">Storage used</dt><dd data-testid="settings-storage">{usage}</dd>
        <dt className="text-fg-muted">Persistent</dt><dd>{persisted === null ? 'Unknown' : persisted ? 'Yes' : 'No'}</dd>
      </dl>
      <div className="mt-3 flex gap-2">
        <Button onClick={() => void request()} disabled={persisted === true}>Request persistent storage</Button>
        <Button onClick={() => void refresh()}>Refresh</Button>
      </div>
    </Card>
  );
}

function SettingsView() {
  const l = useLayout();
  const accent = l.accent ?? '';
  return (
    <div className="h-full overflow-y-auto" data-testid="settings-view">
      <div className="mx-auto max-w-[760px] p-5">
        <h1 className="mb-4 text-[18px] font-semibold">Settings</h1>

        <Card title="Appearance" testId="settings-appearance">
          <div className="mb-4 flex flex-wrap gap-3">
            {THEMES.map((t) => <ThemePreview key={t.id} id={t.id} label={t.label} selected={l.theme === t.id} onSelect={() => l.setTheme(t.id)} />)}
          </div>
          <div className="mb-1 text-[12px] text-fg-muted">Accent color</div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button onClick={() => l.setAccent(null)} className={clsx('h-6 rounded-full border border-line px-2 text-[11px] text-fg-muted hover:text-fg', !l.accent && 'ring-2 ring-accent')}>Theme default</button>
            {ACCENTS.map((c) => (
              <button key={c} aria-label={`Accent ${c}`} onClick={() => l.setAccent(c)} className={clsx('h-6 w-6 rounded-full border border-black/20', accent.toLowerCase() === c && 'ring-2 ring-fg ring-offset-2 ring-offset-bg-1')} style={{ background: c }} />
            ))}
            <label className="ml-1 flex items-center gap-1.5 text-[12px] text-fg-muted">Custom
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : '#7c5cff'} onChange={(e) => l.setAccent(e.target.value)} className="h-6 w-8 cursor-pointer rounded border border-line bg-transparent p-0" aria-label="Custom accent color" />
            </label>
            <Button className="h-6 px-2 text-[12px]" onClick={() => l.setAccent(null)}><RotateCcw size={12} />Reset</Button>
          </div>
          <Slider label="UI scale" value={Math.round(l.uiScale * 100)} min={75} max={150} step={5} format={(v) => `${v}%`} onChange={(v) => l.setUiScale(v / 100)} />
        </Card>

        <Card title="Custom CSS" testId="settings-css">
          <label className="mb-2 flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={l.customCssEnabled} onChange={(e) => l.setCustomCssEnabled(e.target.checked)} className="accent-[var(--iln-accent)]" data-testid="css-enabled" />Enable custom CSS
          </label>
          <textarea
            value={l.customCss} onChange={(e) => l.setCustomCss(e.target.value)} spellCheck={false} rows={8}
            placeholder={':root {\n  --iln-accent: #ff6b6b;\n}'}
            data-testid="css-editor"
            className="w-full resize-y rounded-md border border-line bg-bg-2 p-2 font-mono text-[12px] text-fg outline-none focus:border-accent"
          />
          <p className="mt-2 text-[12px] text-fg-muted">
            Applied live. Override theme variables on <code className="font-mono">:root</code>: <code className="font-mono">--iln-bg</code>, <code className="font-mono">--iln-bg-1</code>, <code className="font-mono">--iln-bg-2</code>, <code className="font-mono">--iln-bg-3</code>, <code className="font-mono">--iln-fg</code>, <code className="font-mono">--iln-fg-muted</code>, <code className="font-mono">--iln-fg-faint</code>, <code className="font-mono">--iln-line</code>, <code className="font-mono">--iln-accent</code>, <code className="font-mono">--iln-accent-fg</code>, <code className="font-mono">--iln-danger</code>, <code className="font-mono">--iln-ok</code>, <code className="font-mono">--iln-warn</code>.
          </p>
        </Card>

        <Card title="Layout" testId="settings-layout">
          <p className="mb-2 text-[12px] text-fg-muted">Restores dock widths, panel placement and visibility to their defaults.</p>
          <Button onClick={() => { l.resetLayout(); toast('Layout reset', 'ok'); }} data-testid="reset-layout"><RotateCcw size={13} />Reset layout</Button>
        </Card>

        <DataSection />
      </div>
    </div>
  );
}

registerTabView('settings', SettingsView);
