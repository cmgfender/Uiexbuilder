/**
 * Searchable component list in a popover (grouped by palette category). Used by the Children
 * section's "Add child" button.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { getComponent } from '../registry';
import { CATEGORY_ORDER, type ComponentDef } from '../registry/types';
import { cx } from '../ui';
import { Popover } from './Popover';

export interface ComponentPickerProps {
  anchor: HTMLElement | null;
  open: boolean;
  onClose: (refocus: boolean) => void;
  /** Component types to offer (in any order). */
  types: string[];
  onPick: (type: string) => void;
  title?: string;
}

export function ComponentPicker({ anchor, open, onClose, types, onPick, title = 'Add a component' }: ComponentPickerProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const defs = useMemo(() => types.map((t) => getComponent(t)).filter((d): d is ComponentDef => !!d), [types]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return defs;
    return defs.filter(
      (d) =>
        d.label.toLowerCase().includes(q) ||
        d.type.toLowerCase().includes(q) ||
        (d.keywords ?? []).some((k) => k.toLowerCase().includes(q)),
    );
  }, [defs, query]);
  const groups = useMemo(
    () => CATEGORY_ORDER.map((c) => ({ category: c, items: filtered.filter((d) => d.category === c) })).filter((g) => g.items.length),
    [filtered],
  );
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    setActive(0);
  }, [query, open]);
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  return (
    <Popover anchor={anchor} open={open} onClose={() => onClose(false)} width={280} maxHeight={380} role="dialog" aria-label={title}>
      <div
        className="ub-insp-vp"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose(true);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(flat.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const d = flat[active];
            if (d) onPick(d.type);
          }
        }}
      >
        <div className="ub-insp-vp__search">
          <Search size={13} aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search components…"
            aria-label="Search components"
          />
        </div>
        <div ref={listRef} className="ub-insp-vp__list" role="listbox" aria-label="Components">
          {flat.length === 0 && <div className="ub-insp-vp__empty">No matching components.</div>}
          {groups.map((g) => (
            <div key={g.category} role="group" aria-label={g.category}>
              {groups.length > 1 && <div className="ub-insp-vp__group">{g.category}</div>}
              {g.items.map((d) => {
                const i = flat.indexOf(d);
                const Icon = d.icon;
                return (
                  <div
                    key={d.type}
                    role="option"
                    aria-selected={i === active}
                    data-active={i === active}
                    className={cx('ub-insp-ac__item ub-insp-cp__item', i === active && 'is-active')}
                    title={d.description}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => onPick(d.type)}
                  >
                    <Icon size={14} aria-hidden />
                    <span className="ub-insp-cp__label">{d.label}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Popover>
  );
}
