/**
 * Resizable, collapsible bottom panel under the canvas: Code | Problems | Console. While collapsed
 * only its tab strip shows; the height is persisted (see shellStore).
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ChevronDown, ChevronUp, CircleAlert, Code2, Terminal, TriangleAlert } from 'lucide-react';
import { useEditor } from '../model/store';
import { useRuntime } from '../runtime';
import { IconButton, cx } from '../ui';
import { CodePanel } from './CodePanel';
import { ConsolePanel } from './ConsolePanel';
import { ProblemsPanel } from './ProblemsPanel';
import { useProblems } from './problems';
import { BOTTOM_MIN_HEIGHT, BOTTOM_STRIP_HEIGHT, openBottomTab, toggleBottomPanel, useShell, type BottomTab } from './shellStore';
import { shortcutLabel } from './shortcuts';

/** Smallest canvas height kept visible above the panel. */
const MIN_CANVAS = 140;

/** Number of console entries logged since the console was last visible. */
function useNewLogCount(consoleVisible: boolean): number {
  const { logs } = useRuntime();
  const [seenId, setSeenId] = useState<string | null>(null);
  const lastId = logs.length ? logs[logs.length - 1].id : null;
  useEffect(() => {
    if (consoleVisible && seenId !== lastId) setSeenId(lastId);
  }, [consoleVisible, lastId, seenId]);
  if (consoleVisible) return 0;
  if (seenId === null) return logs.length;
  const idx = logs.findIndex((l) => l.id === seenId);
  return idx === -1 ? logs.length : logs.length - idx - 1;
}

export function BottomPanel() {
  const tab = useEditor((s) => s.bottomPanel);
  const mode = useEditor((s) => s.mode);
  const height = useShell((s) => s.bottomHeight);
  const lastTab = useShell((s) => s.lastBottomTab);
  const errors = useProblems((s) => s.errors);
  const warnings = useProblems((s) => s.warnings);
  const open = tab !== null;
  const newLogs = useNewLogCount(tab === 'console');
  const sectionRef = useRef<HTMLElement>(null);
  const [dragging, setDragging] = useState(false);

  const maxHeight = () => {
    const center = sectionRef.current?.parentElement;
    const total = center?.clientHeight ?? 0;
    return total > 0 ? Math.max(BOTTOM_MIN_HEIGHT, total - MIN_CANVAS) : 2000;
  };
  const setHeight = (h: number) => useShell.getState().setBottomHeight(Math.min(maxHeight(), Math.max(BOTTOM_MIN_HEIGHT, h)));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = useShell.getState().bottomHeight;
    const el = e.currentTarget;
    el.setPointerCapture?.(e.pointerId);
    setDragging(true);
    const move = (ev: globalThis.PointerEvent) => setHeight(startH + (startY - ev.clientY));
    const up = () => {
      setDragging(false);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const onHandleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowUp') setHeight(height + step);
    else if (e.key === 'ArrowDown') setHeight(height - step);
    else if (e.key === 'Home') setHeight(BOTTOM_MIN_HEIGHT);
    else if (e.key === 'End') setHeight(maxHeight());
    else if (e.key === 'Enter') toggleBottomPanel();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  // Keep the panel within bounds when the window shrinks.
  useEffect(() => {
    if (!open) return;
    const fit = () => {
      const max = maxHeight();
      if (useShell.getState().bottomHeight > max) useShell.getState().setBottomHeight(max);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open]);

  const tabs: Array<{ value: BottomTab; label: string; icon: React.ReactNode; badge?: React.ReactNode }> = [
    { value: 'code', label: 'Code', icon: <Code2 size={13} aria-hidden /> },
    {
      value: 'problems',
      label: 'Problems',
      icon: errors > 0 ? <CircleAlert size={13} className="ub-sh-sev--error" aria-hidden /> : warnings > 0 ? <TriangleAlert size={13} className="ub-sh-sev--warning" aria-hidden /> : <CircleAlert size={13} aria-hidden />,
      badge:
        errors + warnings > 0 ? (
          <span className={cx('ub-sh-count', errors > 0 ? 'ub-sh-count--error' : 'ub-sh-count--warning')}>{errors + warnings}</span>
        ) : undefined,
    },
    {
      value: 'console',
      label: 'Console',
      icon: <Terminal size={13} aria-hidden />,
      badge:
        mode === 'preview' && newLogs > 0 ? (
          <span className="ub-sh-count ub-sh-count--new" aria-label={`${newLogs} new`}>
            {newLogs > 99 ? '99+' : newLogs}
          </span>
        ) : undefined,
    },
  ];

  return (
    <section
      ref={sectionRef}
      className={cx('ub-sh-bottom', !open && 'ub-sh-bottom--collapsed', dragging && 'ub-sh-bottom--dragging')}
      style={{ height: open ? height : BOTTOM_STRIP_HEIGHT }}
      aria-label="Code, problems and console"
    >
      {open && (
        <div
          className="ub-sh-bottom-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize panel"
          aria-valuenow={height}
          aria-valuemin={BOTTOM_MIN_HEIGHT}
          tabIndex={0}
          title="Drag to resize · double-click to hide"
          onPointerDown={onPointerDown}
          onDoubleClick={toggleBottomPanel}
          onKeyDown={onHandleKey}
        />
      )}
      <div className="ub-sh-bottom-head">
        <div className="ub-sh-bottom-tabs" role="tablist" aria-label="Bottom panel">
          {tabs.map((t) => {
            const selected = tab === t.value;
            return (
              <button
                key={t.value}
                type="button"
                role="tab"
                aria-selected={selected}
                className={cx('ub-sh-bottom-tab', selected && 'ub-sh-bottom-tab--active')}
                onClick={() => openBottomTab(t.value)}
              >
                {t.icon}
                {t.label}
                {t.badge}
              </button>
            );
          })}
        </div>
        <span className="ub-sh-bottom-spacer" onDoubleClick={toggleBottomPanel} />
        <IconButton
          size="sm"
          label={open ? `Hide panel (${shortcutLabel('toggleBottom')})` : `Show panel (${shortcutLabel('toggleBottom')})`}
          onClick={() => (open ? toggleBottomPanel() : openBottomTab(lastTab))}
        >
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </IconButton>
      </div>
      {open && (
        <div className="ub-sh-bottom-body" role="tabpanel">
          {tab === 'code' && <CodePanel />}
          {tab === 'problems' && <ProblemsPanel />}
          {tab === 'console' && <ConsolePanel />}
        </div>
      )}
    </section>
  );
}
