/**
 * Searchable picker for HubSpot icon names (ICON_NAMES), drawn with the registry's own Icon preview
 * so the glyphs match what the canvas shows.
 */
import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { getComponent } from '../registry';
import { ICON_NAMES } from '../registry/constants';
import type { PreviewRootProps } from '../registry/types';
import type { UINode } from '../model/types';
import { cx } from '../ui';
import { Popover } from './Popover';

const COLS = 5;
const noop = () => {};

/** Readable words for an icon name: "callingVoicemail" -> "calling voicemail". */
export function iconWords(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

export function IconGlyph({ name, size = 16 }: { name: string; size?: number }) {
  const def = getComponent('Icon');
  const node = useMemo<UINode>(() => ({ id: '', type: 'Icon', props: { name }, children: [] }), [name]);
  if (!def) return null;
  const Preview = def.preview;
  // No data-node-id: the glyph must never be mistaken for a canvas node.
  const rootProps = { 'data-node-type': 'Icon', 'data-node-id': undefined } as unknown as PreviewRootProps;
  return (
    <span className="ub-insp-icon-glyph" style={{ fontSize: size }} aria-hidden>
      <Preview node={node} props={{ name }} text="" slots={{}} mode="design" rootProps={rootProps} trigger={noop} />
    </span>
  );
}

export interface IconPickerProps {
  id?: string;
  value: string | undefined;
  onChange: (name: string | undefined) => void;
  /** Shown when unset (e.g. the HubSpot default icon). */
  placeholder?: string;
  allowClear?: boolean;
}

export function IconPicker({ id, value, onChange, placeholder, allowClear = true }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const names = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = ICON_NAMES as readonly string[];
    if (!q) return list;
    return list.filter((n) => n.toLowerCase().includes(q) || iconWords(n).includes(q));
  }, [query]);
  const shown = value ?? placeholder;

  const close = (refocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (refocus) btnRef.current?.focus();
  };
  const pick = (name: string | undefined) => {
    onChange(name);
    close(true);
  };
  const focusCell = (i: number) => {
    const cells = gridRef.current?.querySelectorAll<HTMLButtonElement>('button[data-icon]');
    if (!cells?.length) return;
    cells[Math.max(0, Math.min(cells.length - 1, i))]?.focus();
  };
  const onGridKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const idx = Number(target.getAttribute('data-index') ?? -1);
    if (idx < 0) return;
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? COLS : e.key === 'ArrowUp' ? -COLS : 0;
    if (!delta) return;
    e.preventDefault();
    if (idx + delta < 0) {
      (document.getElementById(`${id ?? 'icon'}-search`) as HTMLInputElement | null)?.focus();
      return;
    }
    focusCell(idx + delta);
  };

  return (
    <>
      <button
        ref={btnRef}
        id={id}
        type="button"
        className="ub-insp-iconbtn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        {shown ? <IconGlyph name={shown} /> : <span className="ub-insp-icon-glyph" />}
        <span className={cx('ub-insp-iconbtn__name', !value && 'is-placeholder')}>
          {value ?? (placeholder ? `${placeholder} (default)` : 'Choose icon')}
        </span>
        <ChevronDown size={13} aria-hidden />
      </button>
      <Popover
        anchor={btnRef.current}
        open={open}
        onClose={() => close(false)}
        width={300}
        maxHeight={360}
        role="dialog"
        aria-label="Choose an icon"
      >
        <div
          className="ub-insp-iconpick"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close(true);
            }
          }}
        >
          <div className="ub-insp-vp__search">
            <Search size={13} aria-hidden />
            <input
              id={`${id ?? 'icon'}-search`}
              autoFocus
              value={query}
              placeholder={`Search ${ICON_NAMES.length} icons…`}
              aria-label="Search icons"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && names[0]) {
                  e.preventDefault();
                  pick(names[0]);
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  focusCell(0);
                }
              }}
            />
            {allowClear && value && (
              <button type="button" className="ub-insp-linkbtn" onClick={() => pick(undefined)} title="Use the default icon">
                <X size={12} aria-hidden /> Clear
              </button>
            )}
          </div>
          <div ref={gridRef} className="ub-insp-iconpick__grid" role="listbox" aria-label="Icons" onKeyDown={onGridKey}>
            {names.map((n, i) => (
              <button
                key={n}
                type="button"
                role="option"
                aria-selected={n === value}
                data-icon={n}
                data-index={i}
                title={n}
                className={cx('ub-insp-iconpick__cell', n === value && 'is-selected')}
                onClick={() => pick(n)}
              >
                <IconGlyph name={n} size={18} />
                <span className="ub-insp-iconpick__label">{n}</span>
              </button>
            ))}
            {names.length === 0 && <div className="ub-insp-vp__empty">No icons match “{query}”.</div>}
          </div>
        </div>
      </Popover>
    </>
  );
}
