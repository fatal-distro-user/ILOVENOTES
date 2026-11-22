import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import clsx from 'clsx';
import { GraduationCap, Play, RotateCcw } from 'lucide-react';
import { db } from '@/db/schema';
import * as repo from '@/db/repo';
import { useWorkspace } from '@/store/workspace';
import { Segmented } from '@/ui/Segmented';
import { Button } from '@/ui/Modal';
import { openNode } from '@/layout/actions';
import { registerTabView, type TabViewProps } from '@/views/registry';
import { NEW_CARD, previewInterval, review, type Grade, type SrsState } from '@/lib/srs';
import { buildCards, deckKey, deckStats, formatDue, inDeck, inlineTokens, parseDeck, sessionQueue, type DeckCard } from './flashLogic';

function Rich({ text }: { text: string }) {
  return (
    <>
      {inlineTokens(text).map((t, i) =>
        t.t === 'bold' ? <strong key={i} className="font-semibold text-accent">{t.s}</strong>
        : t.t === 'italic' ? <em key={i}>{t.s}</em>
        : t.t === 'code' ? <code key={i} className="rounded bg-bg-3 px-1 font-mono text-[0.9em]">{t.s}</code>
        : <span key={i}>{t.s}</span>)}
    </>
  );
}

const GRADES: { grade: Grade; label: string; key: string; cls: string }[] = [
  { grade: 'again', label: 'Again', key: '1', cls: 'border-danger/60 hover:bg-danger/15' },
  { grade: 'hard', label: 'Hard', key: '2', cls: 'border-warn/60 hover:bg-warn/15' },
  { grade: 'good', label: 'Good', key: '3', cls: 'border-ok/60 hover:bg-ok/15' },
  { grade: 'easy', label: 'Easy', key: '4', cls: 'border-accent/60 hover:bg-accent/15' },
];

interface SessionResult { reviewed: number; counts: Record<Grade, number> }

function FlashcardsView({ paneId, active }: TabViewProps) {
  const ws = useWorkspace((s) => s.workspaceId);
  const pages = useLiveQuery(async () => {
    if (!ws) return [];
    const nodes = await db.nodes.where('workspaceId').equals(ws).filter((n) => !n.deletedAt && n.kind === 'page').toArray();
    const docs = await db.docs.bulkGet(nodes.map((n) => n.id));
    return nodes.flatMap((n, i) => (docs[i]?.text ? [{ id: n.id, title: n.title, notebookId: n.notebookId, tags: n.tags, text: docs[i]?.text ?? '' }] : []));
  }, [ws], []);
  const notebooks = useLiveQuery(() => (ws ? repo.listNotebooks(ws) : []), [ws], []);
  const states = useLiveQuery(async () => new Map((await db.srsReviews.toArray()).map((r) => [r.id, r as SrsState])), [], new Map<string, SrsState>());

  const [deckK, setDeckK] = useState('all');
  const [view, setView] = useState<'review' | 'browse'>('review');
  const allCards = useMemo(() => buildCards(pages), [pages]);
  const deck = parseDeck(deckK);
  const cards = useMemo(() => allCards.filter((c) => inDeck(c, deck)), [allCards, deckK]); // eslint-disable-line react-hooks/exhaustive-deps
  const stats = deckStats(cards, states);
  const tagList = useMemo(() => Array.from(new Set(allCards.flatMap((c) => c.tags))).sort(), [allCards]);

  const [queue, setQueue] = useState<DeckCard[] | null>(null);
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [total, setTotal] = useState(0);
  const counts = useRef<Record<Grade, number>>({ again: 0, hard: 0, good: 0, easy: 0 });
  const statesRef = useRef(states);
  statesRef.current = states;

  const start = () => {
    const q = sessionQueue(cards, states);
    if (!q.length) return;
    counts.current = { again: 0, hard: 0, good: 0, easy: 0 };
    setQueue(q); setPos(0); setFlipped(false); setResult(null); setTotal(q.length);
  };
  const end = useCallback(() => {
    const c = counts.current;
    setResult({ reviewed: c.again + c.hard + c.good + c.easy, counts: { ...c } });
    setQueue(null);
  }, []);

  const current = queue?.[pos];
  const grade = useCallback(async (g: Grade) => {
    if (!queue || !queue[pos]) return;
    const card = queue[pos];
    const prev = statesRef.current.get(card.id) ?? NEW_CARD;
    const next = review(prev, g);
    await db.srsReviews.put({ id: card.id, pageId: card.pageId, ...next });
    counts.current[g]++;
    let q = queue;
    if (g === 'again') { q = [...queue, card]; setQueue(q); setTotal(q.length); }
    if (pos + 1 >= q.length) { end(); return; }
    setPos(pos + 1);
    setFlipped(false);
  }, [queue, pos, end]);

  useEffect(() => {
    if (!queue || !active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setFlipped((f) => !f); }
      else if (flipped && /^[1-4]$/.test(e.key)) { e.preventDefault(); void grade(GRADES[+e.key - 1].grade); }
      else if (e.key === 'Escape') end();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [queue, active, flipped, grade, end]);

  const selectedState = current ? states.get(current.id) ?? NEW_CARD : NEW_CARD;
  const pct = queue ? Math.round((pos / Math.max(1, total)) * 100) : 0;

  return (
    <div className="flex h-full flex-col bg-bg" data-testid="flashcards">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4">
        <GraduationCap size={16} className="text-accent" />
        <h2 className="text-[15px] font-semibold">Flashcards</h2>
        <select value={deckK} onChange={(e) => { setDeckK(e.target.value); setQueue(null); setResult(null); }} data-testid="fc-deck" aria-label="Deck"
          className="h-7 rounded-md border border-line bg-bg-2 px-2 text-[12.5px] text-fg outline-none focus:border-accent">
          <option value="all">All decks</option>
          <optgroup label="Notebooks">{notebooks.map((n) => <option key={n.id} value={deckKey({ kind: 'notebook', id: n.id })}>{n.icon} {n.name}</option>)}</optgroup>
          {tagList.length > 0 && <optgroup label="Tags">{tagList.map((t) => <option key={t} value={deckKey({ kind: 'tag', id: t })}>#{t}</option>)}</optgroup>}
        </select>
        <div className="flex-1" />
        <Segmented value={view} onChange={(v) => { setView(v); setQueue(null); }} options={[{ value: 'review', label: 'Review' }, { value: 'browse', label: 'Browse' }]} testId="fc-view" />
      </div>

      {view === 'review' && !queue && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-8">
          {result ? (
            <div className="w-[420px] rounded-2xl border border-line bg-bg-1 p-6 text-center" data-testid="fc-summary">
              <div className="text-[18px] font-semibold">Session complete</div>
              <div className="mt-1 text-fg-muted">{result.reviewed} review{result.reviewed === 1 ? '' : 's'}</div>
              <div className="mt-4 grid grid-cols-4 gap-2">
                {GRADES.map((g) => <div key={g.grade} className="rounded-lg bg-bg-2 p-2"><div className="text-[18px] font-semibold tabular-nums">{result.counts[g.grade]}</div><div className="text-[11px] text-fg-muted">{g.label}</div></div>)}
              </div>
              <div className="mt-3 text-fg-muted">Recall: {result.reviewed ? Math.round(((result.reviewed - result.counts.again) / result.reviewed) * 100) : 0}%</div>
              <Button className="mt-4" variant="primary" onClick={() => setResult(null)} data-testid="fc-done">Done</Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Due now" value={stats.due} testId="fc-due-count" accent />
                <Stat label="New" value={stats.new} testId="fc-new-count" />
                <Stat label="Learned" value={stats.learned} testId="fc-learned-count" />
                <Stat label="Retention" value={stats.retention === null ? '—' : `${Math.round(stats.retention * 100)}%`} testId="fc-retention" />
              </div>
              <Button variant="primary" className="h-10 px-6 text-[14px]" disabled={stats.due === 0} onClick={start} data-testid="fc-start"><Play size={15} />Start review</Button>
              {stats.total === 0 && (
                <div className="max-w-md text-center text-[13px] text-fg-muted">
                  No cards yet. Write <code className="rounded bg-bg-3 px-1">Question :: Answer</code>, <code className="rounded bg-bg-3 px-1">Term ::: Definition</code> (both ways) or <code className="rounded bg-bg-3 px-1">{'{{c1::cloze}}'}</code> on its own line in any page.
                </div>
              )}
              {stats.total > 0 && stats.due === 0 && <div className="text-[13px] text-fg-muted">All caught up. {stats.total} card{stats.total === 1 ? '' : 's'} in this deck.</div>}
            </>
          )}
        </div>
      )}

      {view === 'review' && queue && current && (
        <div className="flex min-h-0 flex-1 flex-col items-center gap-5 overflow-y-auto p-8">
          <div className="flex w-full max-w-[640px] items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-3" data-testid="fc-progress" data-pct={pct}><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
            <span className="text-[12px] tabular-nums text-fg-muted">{pos + 1} / {total}</span>
            <Button onClick={end} data-testid="fc-end">End</Button>
          </div>
          <div
            onClick={() => setFlipped((f) => !f)} data-testid="fc-card" data-flipped={flipped}
            className="flex min-h-[260px] w-full max-w-[640px] cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border border-line bg-bg-1 p-8 text-center shadow-lg"
          >
            <div className="text-[11px] uppercase tracking-wider text-fg-faint">{current.kind} · {current.title}</div>
            <div className="text-[22px] leading-snug" data-testid="fc-front"><Rich text={current.front} /></div>
            {flipped && (<><div className="h-px w-24 bg-line" /><div className="text-[20px] leading-snug text-fg" data-testid="fc-back"><Rich text={current.back} /></div></>)}
          </div>
          {!flipped ? (
            <Button className="h-9 px-8" onClick={() => setFlipped(true)} data-testid="fc-flip"><RotateCcw size={14} />Show answer <kbd className="ml-1 rounded border border-line px-1 text-[10.5px] text-fg-faint">Space</kbd></Button>
          ) : (
            <div className="flex gap-2">
              {GRADES.map((g) => (
                <button key={g.grade} onClick={() => void grade(g.grade)} data-testid={`fc-grade-${g.grade}`}
                  className={clsx('flex w-[100px] flex-col items-center gap-0.5 rounded-lg border bg-bg-1 px-3 py-2 transition-colors', g.cls)}>
                  <span className="text-[13px] font-medium">{g.label}</span>
                  <span className="text-[11px] text-fg-muted">{previewInterval(selectedState, g.grade)}</span>
                  <kbd className="text-[10px] text-fg-faint">{g.key}</kbd>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'browse' && (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <table className="w-full text-left text-[12.5px]" data-testid="fc-browse">
            <thead className="sticky top-0 bg-bg text-[11px] uppercase tracking-wider text-fg-faint">
              <tr><th className="p-2">Front</th><th className="p-2">Back</th><th className="p-2">Type</th><th className="p-2">Due</th><th className="p-2">Interval</th><th className="p-2">Page</th></tr>
            </thead>
            <tbody>
              {cards.map((c) => {
                const s = states.get(c.id);
                return (
                  <tr key={c.id} className="border-t border-line hover:bg-bg-1" data-testid="fc-row">
                    <td className="max-w-[260px] truncate p-2"><Rich text={c.front} /></td>
                    <td className="max-w-[260px] truncate p-2 text-fg-muted"><Rich text={c.back} /></td>
                    <td className="p-2 text-fg-muted">{c.kind}</td>
                    <td className="p-2">{formatDue(s)}</td>
                    <td className="p-2 text-fg-muted">{s ? `${s.interval}d` : '—'}</td>
                    <td className="p-2"><button className="text-accent hover:underline" onClick={(e) => openNode({ id: c.pageId, title: c.title }, { paneId, newTab: e.ctrlKey || e.metaKey })}>{c.title}</button></td>
                  </tr>
                );
              })}
              {cards.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-fg-faint">No cards in this deck.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, testId, accent }: { label: string; value: number | string; testId: string; accent?: boolean }) {
  return (
    <div className="w-[130px] rounded-xl border border-line bg-bg-1 p-3 text-center">
      <div className={clsx('text-[26px] font-semibold tabular-nums', accent && 'text-accent')} data-testid={testId}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-fg-muted">{label}</div>
    </div>
  );
}

registerTabView('flashcards', FlashcardsView);
