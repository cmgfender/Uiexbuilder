/**
 * Component palette: searchable, grouped by category, with recently used components. Tiles are
 * draggable onto the canvas / layers and insert at a smart position on click or Enter.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Clock, ExternalLink, Search, SearchX, X } from 'lucide-react';
import { selectActiveExtension, useEditor } from '../model/store';
import { isAvailableIn } from '../model/rules';
import { componentsByCategory, getComponent, listComponents } from '../registry';
import type { ComponentDef } from '../registry/types';
import { endDrag, startDrag } from '../dnd/dragState';
import { Button, EmptyState, IconButton, TextInput, cx, useToast } from '../ui';
import { insertComponent, unavailableReason } from './actions';
import {
  highlightSegments,
  recordRecentComponent,
  searchComponents,
  searchTerms,
  useRecentComponents,
} from './paletteModel';
import { PREF_KEYS, readPref, writePref } from './prefs';
import { useShell } from './shellStore';
import { formatShortcut } from './shortcuts';

const HOVER_DELAY_MS = 450;
const HIDE_DELAY_MS = 140;

interface Availability {
  ok: boolean;
  reason?: string;
}

/** Availability of every component in the active extension (recomputed when its location changes). */
function useAvailability(): Map<string, Availability> {
  const extId = useEditor((s) => s.activeExtensionId);
  const kind = useEditor((s) => selectActiveExtension(s).kind);
  const location = useEditor((s) => selectActiveExtension(s).location);
  return useMemo(() => {
    const ext = selectActiveExtension(useEditor.getState());
    const map = new Map<string, Availability>();
    for (const def of listComponents()) {
      const ok = isAvailableIn(def, ext);
      map.set(def.type, ok ? { ok } : { ok, reason: unavailableReason(def, ext) });
    }
    return map;
  }, [extId, kind, location]);
}

interface HoverState {
  def: ComponentDef;
  rect: { left: number; top: number; right: number; bottom: number };
  reason?: string;
}

export function Palette() {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const terms = useMemo(() => searchTerms(query), [query]);
  const searchRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const availability = useAvailability();
  const recent = useRecentComponents();
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    const raw = readPref<unknown>(PREF_KEYS.collapsedCategories, []);
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  });
  const focusNonce = useShell((s) => s.paletteFocusNonce);

  // Cmd+/ (or the rail) asks to focus the search box.
  useEffect(() => {
    if (focusNonce === 0) return;
    const input = searchRef.current?.querySelector('input');
    input?.focus();
    input?.select();
  }, [focusNonce]);

  const toggleCategory = useCallback((category: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(category) ? prev.filter((c) => c !== category) : [...prev, category];
      writePref(PREF_KEYS.collapsedCategories, next);
      return next;
    });
  }, []);

  const groups = useMemo(() => {
    const all = componentsByCategory().map((g) => ({
      category: g.category as string,
      components: g.components.filter((c) => !c.hiddenFromPalette),
    }));
    if (!terms.length) return all.filter((g) => g.components.length > 0);
    const ranked = searchComponents(
      all.flatMap((g) => g.components),
      query,
    );
    const rank = new Map(ranked.map((d, i) => [d.type, i]));
    return all
      .map((g) => ({
        category: g.category,
        components: g.components.filter((c) => rank.has(c.type)).sort((a, b) => rank.get(a.type)! - rank.get(b.type)!),
      }))
      .filter((g) => g.components.length > 0)
      .sort((a, b) => rank.get(a.components[0].type)! - rank.get(b.components[0].type)!);
  }, [terms, query]);

  const recentDefs = useMemo(
    () =>
      recent
        .map((t) => getComponent(t))
        .filter((d): d is ComponentDef => !!d && !d.hiddenFromPalette),
    [recent],
  );

  const matchCount = useMemo(() => groups.reduce((n, g) => n + g.components.length, 0), [groups]);

  // ---------------------------------------------------------------- insert / drag
  const add = useCallback(
    (def: ComponentDef) => {
      const avail = availability.get(def.type);
      if (avail && !avail.ok) {
        toast(avail.reason ?? `${def.label} is not available here.`);
        return;
      }
      if (useEditor.getState().mode !== 'design') useEditor.getState().setMode('design');
      const id = insertComponent(def.type, toast);
      if (id) recordRecentComponent(def.type);
    },
    [availability, toast],
  );

  // ---------------------------------------------------------------- hover card
  const [hover, setHover] = useState<HoverState | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimers = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    showTimer.current = null;
    hideTimer.current = null;
  };
  useEffect(() => clearTimers, []);
  const scheduleHover = useCallback(
    (def: ComponentDef, el: HTMLElement) => {
      clearTimers();
      showTimer.current = setTimeout(() => {
        if (!el.isConnected) return;
        const r = el.getBoundingClientRect();
        setHover({ def, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, reason: availability.get(def.type)?.reason });
      }, HOVER_DELAY_MS);
    },
    [availability],
  );
  const scheduleHide = useCallback(() => {
    if (showTimer.current) clearTimeout(showTimer.current);
    showTimer.current = null;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHover(null), HIDE_DELAY_MS);
  }, []);
  const hideNow = useCallback(() => {
    clearTimers();
    setHover(null);
  }, []);

  // ---------------------------------------------------------------- keyboard
  const focusTile = (index: number) => {
    const tiles = bodyRef.current?.querySelectorAll<HTMLButtonElement>('.ub-sh-pal-tile');
    if (!tiles || !tiles.length) return;
    tiles[Math.max(0, Math.min(index, tiles.length - 1))].focus();
  };

  const onSearchKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      // First Escape clears the search, the next one leaves the field.
      if (query) setQuery('');
      else (e.target as HTMLElement).blur?.();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusTile(0);
    } else if (e.key === 'Enter' && terms.length) {
      // Enter inserts the best available match.
      const best = groups.flatMap((g) => g.components).find((d) => availability.get(d.type)?.ok !== false);
      if (best) {
        e.preventDefault();
        add(best);
      }
    }
  };

  /** Arrow keys move between tiles (2-column grids, across groups). */
  const onBodyKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains('ub-sh-pal-tile') || e.altKey || e.metaKey || e.ctrlKey) return;
    const grids = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>('.ub-sh-pal-grid') ?? []);
    const grid = target.parentElement as HTMLElement | null;
    const gi = grid ? grids.indexOf(grid) : -1;
    if (gi === -1) return;
    const items = (g: HTMLElement) => Array.from(g.children) as HTMLElement[];
    const cur = items(grid!);
    const idx = cur.indexOf(target);
    const col = idx % 2;
    let next: HTMLElement | undefined;
    const focusSearch = () => searchRef.current?.querySelector('input')?.focus();
    switch (e.key) {
      case 'ArrowRight':
        next = cur[idx + 1] ?? (grids[gi + 1] ? items(grids[gi + 1])[0] : undefined);
        break;
      case 'ArrowLeft':
        next = cur[idx - 1] ?? (grids[gi - 1] ? items(grids[gi - 1]).at(-1) : undefined);
        break;
      case 'ArrowDown': {
        next = cur[idx + 2];
        if (!next && grids[gi + 1]) {
          const below = items(grids[gi + 1]);
          next = below[col] ?? below[0];
        }
        break;
      }
      case 'ArrowUp': {
        next = cur[idx - 2];
        if (!next && grids[gi - 1]) {
          const above = items(grids[gi - 1]);
          const lastRowStart = above.length - (above.length % 2 === 0 ? 2 : 1);
          next = above[lastRowStart + col] ?? above.at(-1);
        }
        if (!next) {
          e.preventDefault();
          focusSearch();
          return;
        }
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    next?.focus();
  };

  const tileProps = { terms, availability, onAdd: add, onHover: scheduleHover, onLeave: scheduleHide, onDragBegin: hideNow };

  return (
    <div className="ub-sh-pal">
      <div className="ub-sh-pal-search" ref={searchRef} onKeyDown={onSearchKeyDown}>
        <Search size={14} className="ub-sh-pal-search-icon" aria-hidden />
        <TextInput
          value={query}
          onChange={setQuery}
          placeholder="Search components"
          aria-label="Search components"
          className="ub-sh-pal-search-input"
          type="search"
          autoComplete="off"
          spellCheck={false}
        />
        {query ? (
          <IconButton label="Clear search" size="sm" className="ub-sh-pal-search-clear" onClick={() => setQuery('')}>
            <X size={13} />
          </IconButton>
        ) : (
          <kbd className="ub-sh-kbd ub-sh-pal-search-kbd" aria-hidden>
            {formatShortcut('Cmd+/')}
          </kbd>
        )}
      </div>

      <div className="ub-sh-pal-body ub-scroll" ref={bodyRef} onKeyDown={onBodyKeyDown} onScroll={hideNow}>
        {terms.length > 0 && (
          <div className="ub-sh-pal-resultcount" aria-live="polite">
            {matchCount === 0 ? 'No matches' : `${matchCount} ${matchCount === 1 ? 'component' : 'components'}`}
          </div>
        )}

        {!terms.length && recentDefs.length > 0 && (
          <PaletteGroup
            id="__recent"
            title="Recently used"
            icon={<Clock size={12} />}
            defs={recentDefs}
            collapsed={collapsed.includes('__recent')}
            onToggle={toggleCategory}
            tileProps={tileProps}
          />
        )}

        {groups.map((g) => (
          <PaletteGroup
            key={g.category}
            id={g.category}
            title={g.category}
            defs={g.components}
            collapsed={!terms.length && collapsed.includes(g.category)}
            onToggle={toggleCategory}
            tileProps={tileProps}
          />
        ))}

        {terms.length > 0 && matchCount === 0 && (
          <EmptyState icon={<SearchX size={22} />} title={`No components match “${query.trim()}”`}>
            <div className="ub-sh-pal-empty-hint">Try a different word — e.g. “button”, “table”, “input”.</div>
            <Button size="sm" onClick={() => setQuery('')} style={{ marginTop: 8 }}>
              Clear search
            </Button>
          </EmptyState>
        )}
      </div>

      <div className="ub-sh-pal-footer">Drag onto the canvas or click to add</div>

      {hover && <HoverCard state={hover} onEnter={clearTimers} onLeave={scheduleHide} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface TileSharedProps {
  terms: string[];
  availability: Map<string, Availability>;
  onAdd: (def: ComponentDef) => void;
  onHover: (def: ComponentDef, el: HTMLElement) => void;
  onLeave: () => void;
  onDragBegin: () => void;
}

interface PaletteGroupProps {
  id: string;
  title: string;
  icon?: React.ReactNode;
  defs: ComponentDef[];
  collapsed: boolean;
  onToggle: (id: string) => void;
  tileProps: TileSharedProps;
}

function PaletteGroup({ id, title, icon, defs, collapsed, onToggle, tileProps }: PaletteGroupProps) {
  const bodyId = `ub-sh-pal-group-${id.replace(/[^a-z0-9]+/gi, '-')}`;
  return (
    <section className="ub-sh-pal-group" aria-label={title}>
      <button
        type="button"
        className="ub-sh-pal-group-head"
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        onClick={() => onToggle(id)}
      >
        {collapsed ? <ChevronRight size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
        {icon}
        <span className="ub-sh-pal-group-title">{title}</span>
        <span className="ub-sh-pal-group-count">{defs.length}</span>
      </button>
      {!collapsed && (
        <div className="ub-sh-pal-grid" id={bodyId}>
          {defs.map((def) => (
            <PaletteTile key={def.type} def={def} {...tileProps} />
          ))}
        </div>
      )}
    </section>
  );
}

const PaletteTile = memo(function PaletteTile({
  def,
  terms,
  availability,
  onAdd,
  onHover,
  onLeave,
  onDragBegin,
}: TileSharedProps & { def: ComponentDef }) {
  const avail = availability.get(def.type);
  const disabled = avail ? !avail.ok : false;
  const Icon = def.icon;
  const onDragStart = (e: DragEvent<HTMLButtonElement>) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    onDragBegin();
    startDrag(e, { kind: 'new', componentType: def.type }, def.label);
  };
  // Recents are recorded when the drop succeeded — not on dragstart, where re-rendering the
  // "Recently used" group would move (or detach) the dragged tile and cancel the browser drag.
  const onDragEnd = (e: DragEvent<HTMLButtonElement>) => {
    const effect = e.dataTransfer?.dropEffect;
    if (effect && effect !== 'none') recordRecentComponent(def.type);
    endDrag();
  };
  return (
    <button
      type="button"
      className={cx('ub-sh-pal-tile', disabled && 'ub-sh-pal-tile--disabled')}
      aria-disabled={disabled || undefined}
      aria-label={disabled ? `${def.label} (unavailable: ${avail?.reason ?? ''})` : `Add ${def.label}`}
      title={disabled ? avail?.reason : undefined}
      data-component-type={def.type}
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onAdd(def)}
      onMouseEnter={(e) => onHover(def, e.currentTarget)}
      onMouseLeave={onLeave}
      onBlur={onLeave}
    >
      <Icon size={16} strokeWidth={1.75} className="ub-sh-pal-tile-icon" aria-hidden />
      <span className="ub-sh-pal-tile-label">
        {highlightSegments(def.label, terms).map((seg, i) =>
          seg.match ? (
            <mark key={i} className="ub-sh-pal-mark">
              {seg.text}
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </span>
    </button>
  );
});

function HoverCard({ state, onEnter, onLeave }: { state: HoverState; onEnter: () => void; onLeave: () => void }) {
  const { def, rect, reason } = state;
  const Icon = def.icon;
  const width = 260;
  const left = Math.min(rect.right + 10, window.innerWidth - width - 8);
  const top = Math.max(8, Math.min(rect.top - 6, window.innerHeight - 180));
  return createPortal(
    <div
      className="ub-sh-pal-card"
      style={{ left, top, width }}
      role="tooltip"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="ub-sh-pal-card-head">
        <span className="ub-sh-pal-card-icon">
          <Icon size={16} aria-hidden />
        </span>
        <div className="ub-sh-pal-card-titles">
          <div className="ub-sh-pal-card-title">{def.label}</div>
          <code className="ub-sh-pal-card-type">{`<${def.type}>`}</code>
        </div>
      </div>
      <p className="ub-sh-pal-card-desc">{def.description}</p>
      {reason && <p className="ub-sh-pal-card-reason">{reason}</p>}
      <div className="ub-sh-pal-card-foot">
        <span className="ub-sh-pal-card-from">{def.importFrom}</span>
        {def.docsUrl && (
          <a className="ub-sh-pal-card-docs" href={def.docsUrl} target="_blank" rel="noreferrer noopener">
            Docs <ExternalLink size={11} aria-hidden />
          </a>
        )}
      </div>
    </div>,
    document.body,
  );
}
