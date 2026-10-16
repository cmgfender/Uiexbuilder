/**
 * Component palette: searchable, grouped by category, with recently used components. Tiles are
 * draggable onto the canvas / layers and insert at a smart position on click or Enter.
 *
 * Keyboard: the palette body is a single Tab stop (roving tabindex over group headers and tiles);
 * arrow keys move between tiles (2-column grid) and headers, Home / End jump to the ends,
 * Left / Right on a header collapse / expand it. Each tile describes its component
 * (aria-describedby); resting on a tile — with the pointer or keyboard focus — shows the info
 * card, which Escape dismisses. F1 on a tile opens the component's HubSpot docs.
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

/** Roving-focus key of a palette element (`head:<group>` or `tile:<group>:<type>`). */
const headKey = (group: string) => `head:${group}`;
const tileKey = (group: string, type: string) => `tile:${group}:${type}`;
const domId = (text: string) => text.replace(/[^a-z0-9_-]+/gi, '-');

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
  /** Shown for keyboard focus (the card then mentions the F1 shortcut). */
  viaKeyboard?: boolean;
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
  useInputModality();

  // Cmd+/ (or the rail, or "Search components" from Templates) asks to focus the search box.
  useEffect(() => {
    if (focusNonce === 0) return;
    const wanted = useShell.getState().paletteFocusQuery;
    if (wanted) setQuery(wanted);
    const input = searchRef.current?.querySelector('input');
    input?.focus();
    if (!wanted) input?.select();
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

  // ---------------------------------------------------------------- roving tabindex
  const showRecent = !terms.length && recentDefs.length > 0;
  const recentCollapsed = collapsed.includes('__recent');
  const roveKeys = useMemo(() => {
    const keys: string[] = [];
    const add = (id: string, defs: ComponentDef[], isCollapsed: boolean) => {
      keys.push(headKey(id));
      if (!isCollapsed) for (const d of defs) keys.push(tileKey(id, d.type));
    };
    if (showRecent) add('__recent', recentDefs, recentCollapsed);
    for (const g of groups) add(g.category, g.components, !terms.length && collapsed.includes(g.category));
    return keys;
  }, [showRecent, recentDefs, recentCollapsed, groups, terms.length, collapsed]);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  // The one Tab stop: the last focused element, else the first tile (else the first header).
  const rovingKey =
    currentKey && roveKeys.includes(currentKey) ? currentKey : roveKeys.find((k) => k.startsWith('tile:')) ?? roveKeys[0] ?? null;
  const onBodyFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const key = (e.target as HTMLElement).dataset.roveKey;
    if (key && key !== currentKey) setCurrentKey(key);
  };

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
    (def: ComponentDef, el: HTMLElement, viaKeyboard = false) => {
      clearTimers();
      showTimer.current = setTimeout(() => {
        if (!el.isConnected) return;
        const r = el.getBoundingClientRect();
        setHover({
          def,
          rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
          reason: availability.get(def.type)?.reason,
          viaKeyboard,
        });
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
  // Escape dismisses the info card without moving the pointer or focus (WCAG 1.4.13).
  const cardShown = hover !== null;
  useEffect(() => {
    if (!cardShown) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      hideNow();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [cardShown, hideNow]);

  // ---------------------------------------------------------------- keyboard
  const focusTile = (index: number) => {
    const tiles = bodyRef.current?.querySelectorAll<HTMLButtonElement>('.ub-sh-pal-tile');
    if (!tiles || !tiles.length) {
      bodyRef.current?.querySelector<HTMLElement>('[data-rove-key]')?.focus();
      return;
    }
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

  /**
   * Arrow keys inside the palette body: Left / Right step through the tiles (across groups),
   * Up / Down move by grid row and visit the group headers between groups, Home / End jump to
   * the first / last element; Left / Right on a header collapse / expand it. F1 on a tile opens
   * its docs.
   */
  const onBodyKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const key = target.dataset.roveKey;
    if (!key || e.altKey || e.metaKey || e.ctrlKey) return;
    const body = bodyRef.current;
    if (!body) return;
    const all = Array.from(body.querySelectorAll<HTMLElement>('[data-rove-key]'));
    const tiles = all.filter((el) => el.classList.contains('ub-sh-pal-tile'));
    const isHead = key.startsWith('head:');
    const focusSearch = () => searchRef.current?.querySelector('input')?.focus();
    let next: HTMLElement | undefined;
    if (e.key === 'F1' && !isHead) {
      const def = getComponent(target.dataset.componentType ?? '');
      if (def?.docsUrl) {
        e.preventDefault();
        window.open(def.docsUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }
    if (e.key === 'Home') next = all[0];
    else if (e.key === 'End') next = all[all.length - 1];
    else if (isHead) {
      const section = target.closest('section');
      const grid = section?.querySelector<HTMLElement>('.ub-sh-pal-grid');
      const i = all.indexOf(target);
      switch (e.key) {
        case 'ArrowDown':
          next = all[i + 1];
          break;
        case 'ArrowUp':
          next = all[i - 1];
          if (!next) {
            e.preventDefault();
            focusSearch();
            return;
          }
          break;
        case 'ArrowRight':
        case 'ArrowLeft': {
          const expanded = target.getAttribute('aria-expanded') === 'true';
          if ((e.key === 'ArrowRight') !== expanded) target.click();
          else if (e.key === 'ArrowRight' && grid) next = grid.querySelector<HTMLElement>('[data-rove-key]') ?? undefined;
          e.preventDefault();
          e.stopPropagation();
          next?.focus();
          return;
        }
        default:
          return;
      }
    } else {
      const grid = target.parentElement as HTMLElement | null;
      const cur = grid ? (Array.from(grid.children) as HTMLElement[]) : [];
      const idx = cur.indexOf(target);
      const t = tiles.indexOf(target);
      switch (e.key) {
        case 'ArrowRight':
          next = tiles[t + 1];
          break;
        case 'ArrowLeft':
          next = tiles[t - 1];
          break;
        case 'ArrowDown': {
          // Next row of this grid (the short last row's tile), else the next group's header.
          const lastRow = Math.floor((cur.length - 1) / 2);
          if (cur[idx + 2]) next = cur[idx + 2];
          else if (Math.floor(idx / 2) < lastRow) next = cur[cur.length - 1];
          else next = all[all.indexOf(cur[cur.length - 1]) + 1];
          break;
        }
        case 'ArrowUp':
          // Previous row of this grid, else this group's header.
          next = cur[idx - 2] ?? target.closest('section')?.querySelector<HTMLElement>('.ub-sh-pal-group-head') ?? undefined;
          break;
        default:
          return;
      }
    }
    e.preventDefault();
    e.stopPropagation();
    next?.focus();
  };

  const tileProps = { terms, availability, rovingKey, onAdd: add, onHover: scheduleHover, onLeave: scheduleHide, onDragBegin: hideNow };

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

      <div className="ub-sh-pal-body ub-scroll" ref={bodyRef} onKeyDown={onBodyKeyDown} onFocus={onBodyFocus} onScroll={hideNow}>
        {terms.length > 0 && (
          <div className="ub-sh-pal-resultcount" aria-live="polite">
            {matchCount === 0 ? 'No matches' : `${matchCount} ${matchCount === 1 ? 'component' : 'components'}`}
          </div>
        )}

        {showRecent && (
          <PaletteGroup
            id="__recent"
            title="Recently used"
            icon={<Clock size={12} />}
            defs={recentDefs}
            collapsed={recentCollapsed}
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
  /** The palette element that is the Tab stop (see roveKeys). */
  rovingKey: string | null;
  onAdd: (def: ComponentDef) => void;
  onHover: (def: ComponentDef, el: HTMLElement, viaKeyboard?: boolean) => void;
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
  const key = headKey(id);
  return (
    <section className="ub-sh-pal-group" aria-label={title}>
      <button
        type="button"
        className="ub-sh-pal-group-head"
        aria-expanded={!collapsed}
        aria-controls={collapsed ? undefined : bodyId}
        tabIndex={tileProps.rovingKey === key ? 0 : -1}
        data-rove-key={key}
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
            <PaletteTile key={def.type} def={def} group={id} {...tileProps} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Whether the last user input was a key press (focus moved by keyboard) rather than the pointer. */
const inputModality = { keyboard: false };

function useInputModality(): void {
  useEffect(() => {
    const onKey = () => {
      inputModality.keyboard = true;
    };
    const onPointer = () => {
      inputModality.keyboard = false;
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('mousedown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('mousedown', onPointer, true);
    };
  }, []);
}

const PaletteTile = memo(function PaletteTile({
  def,
  group,
  terms,
  availability,
  rovingKey,
  onAdd,
  onHover,
  onLeave,
  onDragBegin,
}: TileSharedProps & { def: ComponentDef; group: string }) {
  const avail = availability.get(def.type);
  const disabled = avail ? !avail.ok : false;
  const Icon = def.icon;
  const key = tileKey(group, def.type);
  const descId = `ub-sh-pal-desc-${domId(group)}-${domId(def.type)}`;
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
      aria-describedby={descId}
      title={disabled ? avail?.reason : undefined}
      tabIndex={rovingKey === key ? 0 : -1}
      data-rove-key={key}
      data-component-type={def.type}
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onAdd(def)}
      onMouseEnter={(e) => onHover(def, e.currentTarget)}
      onMouseLeave={onLeave}
      onFocus={(e) => {
        if (inputModality.keyboard) onHover(def, e.currentTarget, true);
      }}
      onBlur={onLeave}
    >
      <span id={descId} className="ub-sr-only">
        {def.description}
        {def.docsUrl ? ' Press F1 for the HubSpot docs.' : ''}
      </span>
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
  const { def, rect, reason, viaKeyboard } = state;
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
        {def.docsUrl &&
          (viaKeyboard ? (
            <span className="ub-sh-pal-card-key">
              <kbd className="ub-sh-kbd">F1</kbd> docs · <kbd className="ub-sh-kbd">Esc</kbd> close
            </span>
          ) : (
            <a className="ub-sh-pal-card-docs" href={def.docsUrl} target="_blank" rel="noreferrer noopener">
              Docs <ExternalLink size={11} aria-hidden />
            </a>
          ))}
      </div>
    </div>,
    // Inside the sidebar landmark (it is position: fixed, so nothing clips it).
    document.querySelector('.ub-sh-left') ?? document.body,
  );
}
