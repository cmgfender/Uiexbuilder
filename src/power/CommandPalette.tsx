/**
 * Command palette (⌘K / Ctrl+K): fuzzy search over every editor command built from the current
 * state — insert components and blocks, go to layers, switch extensions, add data, open dialogs
 * and panels, edit actions. Mounted once by the shell; the shortcut works everywhere, including
 * inside text fields. Keyboard: ↑ ↓ (PageUp / PageDown) to move, Enter to run, Escape to close.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { useCanvasView } from '../canvas/stores';
import { useEditor } from '../model/store';
import { BLOCK_TEMPLATES } from '../templates/catalog';
import { useUserBlocks } from '../templates/userBlocks';
import { cx, useToast } from '../ui';
import { buildCommands, type PaletteBlock } from './commands';
import { highlightParts } from './fuzzy';
import { rankCommands, type RankedCommand } from './paletteModel';
import { pushRecent, readRecent } from './recent';
import { usePowerUi } from './uiStore';
import './power.css';

/** ⌘K on macOS, Ctrl+K elsewhere (either is accepted). Also matches the K key on non-Latin layouts. */
export function isPaletteShortcut(e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): boolean {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return false;
  const key = (e.key ?? '').toLowerCase();
  return key === 'k' || (e.code === 'KeyK' && !/^[a-z]$/.test(key));
}

export function CommandPalette() {
  const open = usePowerUi((s) => s.paletteOpen);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isPaletteShortcut(e)) return;
      // Capture phase: runs before inputs, editors and the shell's shortcut handler.
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      const ui = usePowerUi.getState();
      ui.setPaletteOpen(!ui.paletteOpen);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
  if (!open) return null;
  return <PaletteDialog />;
}

function firstEnabled(items: RankedCommand[]): number {
  return items.findIndex((i) => !i.command.disabledReason);
}

/** Next selectable index from `from` moving by `delta` (wraps for single steps, clamps for pages). */
function stepIndex(items: RankedCommand[], from: number, delta: number): number {
  const n = items.length;
  if (n === 0) return -1;
  const enabled = (i: number) => i >= 0 && i < n && !items[i].command.disabledReason;
  if (Math.abs(delta) === 1) {
    for (let k = 1; k <= n; k++) {
      const i = (((from + delta * k) % n) + n) % n;
      if (enabled(i)) return i;
    }
    return -1;
  }
  let i = Math.max(0, Math.min(n - 1, from + delta));
  const dir = delta > 0 ? -1 : 1;
  while (i >= 0 && i < n && !enabled(i)) i += dir;
  return enabled(i) ? i : from;
}

function PaletteDialog() {
  const toast = useToast();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const close = useCallback(() => usePowerUi.getState().setPaletteOpen(false), []);

  const project = useEditor((s) => s.project);
  const activeExtensionId = useEditor((s) => s.activeExtensionId);
  const selectedNodeId = useEditor((s) => s.selectedNodeId);
  const mode = useEditor((s) => s.mode);
  const past = useEditor((s) => s.past);
  const future = useEditor((s) => s.future);
  const zoom = useCanvasView((s) => s.zoom);
  const userBlocks = useUserBlocks();

  const blocks = useMemo<PaletteBlock[]>(
    () => [
      ...BLOCK_TEMPLATES.map((b) => ({
        id: b.id,
        name: b.name,
        description: b.description,
        icon: b.icon,
        template: b.template,
        state: b.state,
        keywords: (b as { keywords?: string[] }).keywords,
      })),
      ...userBlocks.map((b) => ({ id: b.id, name: b.name, template: b.template, state: b.state, user: true })),
    ],
    [userBlocks],
  );
  const commands = useMemo(
    () => buildCommands({ state: { project, activeExtensionId, selectedNodeId, mode, past, future }, blocks, zoom }),
    [project, activeExtensionId, selectedNodeId, mode, past, future, blocks, zoom],
  );

  const [recent, setRecent] = useState<string[]>(readRecent);
  const [query, setQuery] = useState('');
  const { items, total } = useMemo(() => rankCommands(commands, query, recent), [commands, query, recent]);
  const [active, setActive] = useState(() => firstEnabled(items));
  useEffect(() => setActive(firstEnabled(items)), [items]);

  // Focus the search box; give focus back to where it was when the palette closes (a dialog
  // opened by a command focuses itself afterwards).
  useEffect(() => {
    inputRef.current?.focus();
    const previous = restoreFocus.current;
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected && previous !== document.body) {
        try {
          previous.focus({ preventScroll: true });
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  useEffect(() => {
    if (active < 0) return;
    const el = listRef.current?.querySelector(`[data-index="${active}"]`);
    (el as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const runItem = (item: RankedCommand | undefined) => {
    if (!item) return;
    const cmd = item.command;
    if (cmd.disabledReason) {
      toast(cmd.disabledReason);
      return;
    }
    setRecent(pushRecent(cmd.id));
    close();
    const fail = (e: unknown) => toast(`“${cmd.title}” failed: ${e instanceof Error ? e.message : String(e)}`);
    try {
      const result = cmd.run({ notify: toast });
      if (result && typeof (result as Promise<void>).then === 'function') (result as Promise<void>).catch(fail);
    } catch (e) {
      fail(e);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        setActive((a) => stepIndex(items, a, e.key === 'ArrowDown' ? 1 : -1));
        break;
      case 'PageDown':
      case 'PageUp':
        e.preventDefault();
        setActive((a) => stepIndex(items, a < 0 ? 0 : a, e.key === 'PageDown' ? 8 : -8));
        break;
      case 'Enter':
        e.preventDefault();
        if (!e.nativeEvent.isComposing) runItem(items[active]);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case 'Tab':
        // Focus stays in the palette (it is modal).
        e.preventDefault();
        break;
      default:
        break;
    }
  };

  // Group headings in display order.
  const sections = useMemo(() => {
    const out: Array<{ group: string; entries: Array<{ item: RankedCommand; index: number }> }> = [];
    items.forEach((item, index) => {
      const last = out[out.length - 1];
      if (last && last.group === item.group) last.entries.push({ item, index });
      else out.push({ group: item.group, entries: [{ item, index }] });
    });
    return out;
  }, [items]);

  const optionId = (i: number) => `${listId}-opt-${i}`;
  const trimmed = query.trim();

  return createPortal(
    <div className="ub-pw-cp-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="ub-pw-cp" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="ub-pw-cp__search">
          <Search size={16} aria-hidden className="ub-pw-cp__search-icon" />
          <input
            ref={inputRef}
            className="ub-pw-cp__input"
            value={query}
            placeholder="Search commands, components, layers…"
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={active >= 0 ? optionId(active) : undefined}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd className="ub-pw-cp__kbd" aria-hidden>
            esc
          </kbd>
        </div>
        <div ref={listRef} id={listId} className="ub-pw-cp__list" role="listbox" aria-label="Commands">
          {items.length === 0 ? (
            <div className="ub-pw-cp__empty" role="status">
              <div className="ub-pw-cp__empty-title">No commands match “{trimmed}”</div>
              <div>Try a component name like “Button”, a layer name, or words such as “add”, “show” or “go to”.</div>
            </div>
          ) : (
            sections.map((section, si) => (
              <div key={`${section.group}-${si}`} role="group" aria-labelledby={`${listId}-g${si}`}>
                <div className="ub-pw-cp__group" id={`${listId}-g${si}`}>
                  {section.group}
                </div>
                {section.entries.map(({ item, index }) => {
                  const cmd = item.command;
                  const Icon = cmd.icon;
                  const disabled = !!cmd.disabledReason;
                  const secondary = disabled ? cmd.disabledReason : cmd.subtitle;
                  return (
                    <div
                      key={cmd.id}
                      id={optionId(index)}
                      data-index={index}
                      role="option"
                      aria-selected={index === active}
                      aria-disabled={disabled || undefined}
                      aria-label={secondary ? `${cmd.title}, ${secondary}` : cmd.title}
                      className={cx('ub-pw-cp__item', index === active && 'is-active', disabled && 'is-disabled')}
                      onMouseMove={() => {
                        if (!disabled && index !== active) setActive(index);
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => runItem(item)}
                    >
                      <span className="ub-pw-cp__icon" aria-hidden>
                        {Icon ? <Icon size={15} /> : null}
                      </span>
                      <span className="ub-pw-cp__text">
                        <span className="ub-pw-cp__title">
                          {highlightParts(cmd.title, item.indices).map((p, k) =>
                            p.hit ? (
                              <mark key={k} className="ub-pw-cp__hl">
                                {p.text}
                              </mark>
                            ) : (
                              <span key={k}>{p.text}</span>
                            ),
                          )}
                        </span>
                        {secondary && <span className="ub-pw-cp__sub">{secondary}</span>}
                      </span>
                      {cmd.shortcut && <kbd className="ub-pw-cp__shortcut">{cmd.shortcut}</kbd>}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="ub-pw-cp__footer" aria-hidden>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> run
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
          <span className="ub-pw-cp__count">
            {total > items.length ? `${items.length} of ${total} — keep typing to narrow down` : `${total} ${total === 1 ? 'command' : 'commands'}`}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
