/**
 * Console tab: the preview runtime's log (logger calls, executed actions, host calls, data
 * fetches) with level filters, timestamps and expandable details.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Ban, ChevronDown, ChevronRight, Play, Terminal } from 'lucide-react';
import { useEditor } from '../model/store';
import { useRuntime, type RuntimeLogEntry } from '../runtime';
import { Button, EmptyState, cx } from '../ui';

type Level = RuntimeLogEntry['level'];
type Filter = 'all' | Level;

const LEVELS: Array<{ value: Level; label: string }> = [
  { value: 'action', label: 'Actions' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warnings' },
  { value: 'error', label: 'Errors' },
  { value: 'debug', label: 'Debug' },
];

export function formatLogTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function formatDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  try {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(
      detail,
      (_k, v: unknown) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        if (typeof v === 'function') return '[Function]';
        if (typeof v === 'bigint') return `${v}n`;
        return v;
      },
      2,
    );
    return json ?? String(detail);
  } catch {
    return String(detail);
  }
}

export function ConsolePanel() {
  const { logs, clearLogs } = useRuntime();
  const mode = useEditor((s) => s.mode);
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of logs) c[l.level] = (c[l.level] ?? 0) + 1;
    return c;
  }, [logs]);
  const visible = useMemo(() => (filter === 'all' ? logs : logs.filter((l) => l.level === filter)), [logs, filter]);

  // Follow new entries while scrolled to the bottom.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [visible.length]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="ub-sh-con">
      <div className="ub-sh-con-toolbar">
        <button
          type="button"
          className={cx('ub-sh-chip', filter === 'all' && 'ub-sh-chip--on')}
          aria-pressed={filter === 'all'}
          onClick={() => setFilter('all')}
        >
          All <span className="ub-sh-chip-count">{logs.length}</span>
        </button>
        {LEVELS.map((l) => (
          <button
            key={l.value}
            type="button"
            className={cx('ub-sh-chip', `ub-sh-chip--lvl-${l.value}`, filter === l.value && 'ub-sh-chip--on')}
            aria-pressed={filter === l.value}
            onClick={() => setFilter(l.value)}
          >
            <span className={cx('ub-sh-con-dot', `ub-sh-con-dot--${l.value}`)} aria-hidden />
            {l.label}
            <span className="ub-sh-chip-count">{counts[l.value] ?? 0}</span>
          </button>
        ))}
        <span className="ub-sh-con-spacer" />
        <Button size="sm" variant="ghost" icon={<Ban size={13} />} onClick={clearLogs} disabled={logs.length === 0} title="Clear the console">
          Clear
        </Button>
      </div>
      <div
        className="ub-sh-con-list ub-scroll"
        ref={listRef}
        role="log"
        aria-label="Preview console"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {logs.length === 0 ? (
          <EmptyState icon={<Terminal size={22} />} title="Console is empty">
            <div>Actions, logger messages and data requests appear here while you interact with the card in Preview.</div>
            {mode === 'design' && (
              <Button size="sm" icon={<Play size={13} />} style={{ marginTop: 8 }} onClick={() => useEditor.getState().setMode('preview')}>
                Switch to Preview
              </Button>
            )}
          </EmptyState>
        ) : visible.length === 0 ? (
          <div className="ub-sh-con-none">No entries at this level.</div>
        ) : (
          visible.map((entry) => {
            const hasDetail = entry.detail !== undefined;
            const open = expanded.has(entry.id);
            return (
              <div key={entry.id} className={cx('ub-sh-con-entry', `ub-sh-con-entry--${entry.level}`)}>
                <div className="ub-sh-con-line">
                  {hasDetail ? (
                    <button
                      type="button"
                      className="ub-sh-con-toggle"
                      aria-expanded={open}
                      aria-label={open ? 'Hide details' : 'Show details'}
                      title={open ? 'Hide details' : 'Show details'}
                      onClick={() => toggle(entry.id)}
                    >
                      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                  ) : (
                    <span className="ub-sh-con-toggle ub-sh-con-toggle--none" aria-hidden />
                  )}
                  <time className="ub-sh-con-time" dateTime={new Date(entry.at).toISOString()}>
                    {formatLogTime(entry.at)}
                  </time>
                  <span className={cx('ub-sh-con-level', `ub-sh-con-level--${entry.level}`)}>{entry.level}</span>
                  <span className="ub-sh-con-msg">{entry.message}</span>
                </div>
                {hasDetail && open && <pre className="ub-sh-con-detail">{formatDetail(entry.detail)}</pre>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
