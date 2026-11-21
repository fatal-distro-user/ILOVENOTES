/**
 * Sandboxed code runners for code blocks.
 * - JavaScript: a throwaway dedicated Worker built from a Blob (no DOM, no app state access, killed on timeout).
 * - Python: Pyodide (WebAssembly CPython) loaded lazily from the jsDelivr CDN into a persistent Worker;
 *   the service worker caches it after first use so it keeps working offline.
 */

export interface RunLog { level: 'log' | 'info' | 'warn' | 'error' | 'result'; text: string }
export interface RunResult { logs: RunLog[]; error: string | null; ms: number; timedOut: boolean }

export const PYODIDE_VERSION = '314.0.8';
const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

const FORMAT_FN = `
function __fmt(v, depth = 0) {
  if (typeof v === 'string') return depth ? JSON.stringify(v) : v;
  if (v === undefined) return 'undefined';
  if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
  if (typeof v === 'bigint') return v + 'n';
  if (v instanceof Error) return v.name + ': ' + v.message;
  if (v && typeof v === 'object') {
    if (depth > 3) return Array.isArray(v) ? '[Array]' : '[Object]';
    try {
      if (Array.isArray(v)) return '[' + v.map((x) => __fmt(x, depth + 1)).join(', ') + ']';
      if (v instanceof Map) return 'Map(' + v.size + ') {' + [...v].map(([k, x]) => __fmt(k, depth + 1) + ' => ' + __fmt(x, depth + 1)).join(', ') + '}';
      if (v instanceof Set) return 'Set(' + v.size + ') {' + [...v].map((x) => __fmt(x, depth + 1)).join(', ') + '}';
      return '{ ' + Object.keys(v).map((k) => k + ': ' + __fmt(v[k], depth + 1)).join(', ') + ' }';
    } catch { return String(v); }
  }
  return String(v);
}`;

function jsWorkerSource(code: string): string {
  // The user code is embedded as the worker's own script (not eval), so it runs under worker-src blob:.
  return `${FORMAT_FN}
const __post = (level, args) => postMessage({ type: 'log', level, text: args.map((a) => __fmt(a)).join(' ') });
for (const level of ['log', 'info', 'warn', 'error', 'debug']) console[level] = (...a) => __post(level === 'debug' ? 'log' : level, a);
self.fetch = undefined; self.XMLHttpRequest = undefined; self.WebSocket = undefined; self.importScripts = undefined;
(async () => {
${code}
})().then((r) => { if (r !== undefined) postMessage({ type: 'log', level: 'result', text: __fmt(r) }); postMessage({ type: 'done' }); },
         (e) => postMessage({ type: 'error', text: (e && e.stack) ? String(e.stack).split('\\n').slice(0, 4).join('\\n') : String(e) }));
`;
}

export function runJavaScript(code: string, timeoutMs = 5000, onLog?: (l: RunLog) => void): Promise<RunResult> {
  return new Promise((resolve) => {
    const started = performance.now();
    const logs: RunLog[] = [];
    const url = URL.createObjectURL(new Blob([jsWorkerSource(code)], { type: 'text/javascript' }));
    let worker: Worker;
    try { worker = new Worker(url); } catch (e) {
      URL.revokeObjectURL(url);
      resolve({ logs, error: e instanceof Error ? e.message : String(e), ms: 0, timedOut: false });
      return;
    }
    const finish = (error: string | null, timedOut = false) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve({ logs, error, ms: performance.now() - started, timedOut });
    };
    const timer = setTimeout(() => finish(`Timed out after ${timeoutMs / 1000}s (possible infinite loop) — execution stopped.`, true), timeoutMs);
    worker.onmessage = (e: MessageEvent<{ type: string; level?: RunLog['level']; text?: string }>) => {
      const m = e.data;
      if (m.type === 'log') { const l = { level: m.level ?? 'log', text: m.text ?? '' }; logs.push(l); onLog?.(l); }
      else if (m.type === 'done') finish(null);
      else if (m.type === 'error') finish(m.text ?? 'Error');
    };
    worker.onerror = (e) => { e.preventDefault(); finish(`${e.message}${e.lineno ? ` (line ${Math.max(1, e.lineno - 2 - FORMAT_FN.split('\n').length - 2)})` : ''}`); };
  });
}

// ───────────────────────── Python (Pyodide) ─────────────────────────

const PY_WORKER = `
importScripts('${PYODIDE_URL}pyodide.js');
const ready = loadPyodide({ indexURL: '${PYODIDE_URL}' }).then((py) => { postMessage({ type: 'ready' }); return py; },
  (e) => { postMessage({ type: 'fatal', text: String(e && e.message || e) }); throw e; });
onmessage = async (e) => {
  const { id, code } = e.data;
  let py;
  try { py = await ready; } catch (err) { postMessage({ id, type: 'error', text: 'Python runtime failed to load: ' + (err && err.message || err) }); return; }
  py.setStdout({ batched: (s) => postMessage({ id, type: 'log', level: 'log', text: s }) });
  py.setStderr({ batched: (s) => postMessage({ id, type: 'log', level: 'error', text: s }) });
  try {
    await py.loadPackagesFromImports(code);
    const r = await py.runPythonAsync(code);
    if (r !== undefined && r !== null) postMessage({ id, type: 'log', level: 'result', text: String(r) });
    if (r && typeof r.destroy === 'function') r.destroy();
    postMessage({ id, type: 'done' });
  } catch (err) {
    postMessage({ id, type: 'error', text: String(err && err.message || err) });
  }
};`;

let pyWorker: Worker | null = null;
let pyStatus: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
let seq = 0;

export function pythonStatus(): typeof pyStatus { return pyStatus; }

function getPyWorker(): Worker {
  if (pyWorker) return pyWorker;
  const url = URL.createObjectURL(new Blob([PY_WORKER], { type: 'text/javascript' }));
  pyWorker = new Worker(url);
  pyStatus = 'loading';
  pyWorker.addEventListener('message', (e: MessageEvent<{ type: string }>) => {
    if (e.data.type === 'ready') pyStatus = 'ready';
    if (e.data.type === 'fatal') pyStatus = 'failed';
  });
  return pyWorker;
}

export function runPython(code: string, timeoutMs = 30000, onLog?: (l: RunLog) => void): Promise<RunResult> {
  return new Promise((resolve) => {
    const started = performance.now();
    const logs: RunLog[] = [];
    const id = ++seq;
    const w = getPyWorker();
    // First run includes downloading the runtime, so the timeout only starts once Pyodide is ready.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => { timer = setTimeout(() => {
      // Kill the runtime: the only way to interrupt a runaway Python loop.
      w.terminate(); pyWorker = null; pyStatus = 'idle';
      cleanup();
      resolve({ logs, error: `Timed out after ${timeoutMs / 1000}s — Python runtime restarted.`, ms: performance.now() - started, timedOut: true });
    }, timeoutMs); };
    if (pyStatus === 'ready') arm();
    const onMsg = (e: MessageEvent<{ id?: number; type: string; level?: RunLog['level']; text?: string }>) => {
      const m = e.data;
      if (m.type === 'ready' && !timer) { arm(); return; }
      if (m.type === 'fatal') { cleanup(); resolve({ logs, error: `Could not load Python runtime (needs network on first use): ${m.text}`, ms: performance.now() - started, timedOut: false }); return; }
      if (m.id !== id) return;
      if (m.type === 'log') { const l = { level: m.level ?? 'log', text: m.text ?? '' }; logs.push(l); onLog?.(l); }
      else if (m.type === 'done' || m.type === 'error') { cleanup(); resolve({ logs, error: m.type === 'error' ? m.text ?? 'Error' : null, ms: performance.now() - started, timedOut: false }); }
    };
    const onErr = (e: ErrorEvent) => { cleanup(); pyWorker?.terminate(); pyWorker = null; pyStatus = 'failed'; resolve({ logs, error: e.message || 'Python worker crashed', ms: performance.now() - started, timedOut: false }); };
    const cleanup = () => { if (timer) clearTimeout(timer); w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr); };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    w.postMessage({ id, code });
  });
}

export const RUNNABLE: Record<string, 'js' | 'py'> = { javascript: 'js', js: 'js', python: 'py', py: 'py' };
