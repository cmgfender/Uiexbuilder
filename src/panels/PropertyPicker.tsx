/**
 * PropertyPicker: the one CRM property picker of the builder, used by the Data panel (data source
 * properties, search filters and sorts, function inputs) and the inspector (CRM component property
 * lists, date property names, "import options from a property").
 *
 * Suggestions come from the connected HubSpot account when there is one (labels, custom
 * properties, property groups, types) and from the built-in common properties otherwise. Search
 * matches labels and internal names. A name that isn't in the connected account is kept but gets a
 * subtle "Not found in your portal" warning (with a one-click fix when it is a near miss).
 *
 * `multiple` edits a list of names as chips; otherwise one name is edited in a combobox. Keyboard:
 * ↑/↓ move through suggestions, Enter (or Tab while typing) picks, Escape closes the list,
 * Backspace on an empty field removes the last chip, commas / pasted lists add several names.
 */
import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, CalendarClock, CircleDot, Hash, List, Loader2, Phone, ToggleLeft, TriangleAlert, Type, X } from 'lucide-react';
import { cx } from '../ui';
import { useAnchorRect } from './common';
import { objectTypeLabel, propertyNameWarning } from './crmProperties';
import {
  closestProperty,
  groupProperties,
  propertyTypeLabel,
  searchProperties,
  usePortalProperties,
  type PortalProperties,
  type PortalProperty,
} from './portal';
import './panels.css';

const NAME_RE = /^[A-Za-z0-9_]+$/;
const BROWSE_LIMIT = 400;
const SEARCH_LIMIT = 60;

// ---------------------------------------------------------------------------
// Pieces shared with other pickers
// ---------------------------------------------------------------------------

/** Small icon for a HubSpot property type (decorative). */
export function PropertyTypeIcon({ type, size = 12, className }: { type: string; size?: number; className?: string }) {
  const Icon =
    type === 'number'
      ? Hash
      : type === 'date'
        ? Calendar
        : type === 'datetime'
          ? CalendarClock
          : type === 'enumeration'
            ? List
            : type === 'bool'
              ? ToggleLeft
              : type === 'phone_number'
                ? Phone
                : type === 'string'
                  ? Type
                  : CircleDot;
  return <Icon size={size} aria-hidden className={cx('ub-pp-type', className)} />;
}

export interface PropertyIssue {
  name: string;
  kind: 'missing' | 'typo';
  /** Short text for the chip ("Not found in your portal"). */
  short: string;
  /** Full explanation. */
  message: string;
  /** A likely replacement name. */
  fix?: string;
  fixLabel?: string;
}

/**
 * What's wrong with a property name, if anything: not in the connected account (only once the
 * account's properties loaded), or — without an account — a likely typo of a common property.
 */
export function propertyIssue(name: string, props: PortalProperties): PropertyIssue | null {
  const n = name.trim();
  if (!n || n.includes('{{')) return null;
  if (props.canVerify) {
    if (props.byName.has(n)) return null;
    const near = closestProperty(n, props.properties);
    const where = props.objectTypes.map((t) => objectTypeLabel(t).toLowerCase()).join(' / ');
    return {
      name: n,
      kind: 'missing',
      short: 'Not found in your portal',
      message: `Not found in your portal${where ? ` (${where} properties)` : ''}. Check the spelling — it may also have been renamed or deleted in HubSpot.`,
      fix: near && near.name !== n ? near.name : undefined,
      fixLabel: near?.label,
    };
  }
  // Connected but still loading (or the account's list failed): don't guess.
  if (props.connected) return null;
  const w = propertyNameWarning(n, props.objectTypes);
  return w ? { name: n, kind: 'typo', short: 'Possible typo', message: w.message, fix: w.fix } : null;
}

/** The internal name for typed text: an internal name as is, a label (exact) mapped to its name. */
export function resolveTypedProperty(text: string, props: Pick<PortalProperties, 'byName' | 'properties'>): string {
  const t = text.trim();
  if (!t || props.byName.has(t)) return t;
  const lower = t.toLowerCase();
  const byLabel = props.properties.filter((p) => p.label.toLowerCase() === lower);
  if (byLabel.length === 1) return byLabel[0].name;
  return t;
}

interface ListView {
  /** Groups to render ('' = flat search results). */
  groups: Array<{ group: string; items: PortalProperty[] }>;
  flat: PortalProperty[];
}

function buildView(list: readonly PortalProperty[], query: string, exclude: ReadonlySet<string>, accept?: (p: PortalProperty) => boolean): ListView {
  const q = query.trim();
  const candidates = list.filter((p) => !exclude.has(p.name) && (!accept || accept(p)) && (q !== '' || !p.hidden));
  if (q) {
    const flat = searchProperties(candidates, q).slice(0, SEARCH_LIMIT);
    return { groups: flat.length ? [{ group: '', items: flat }] : [], flat };
  }
  const groups: ListView['groups'] = [];
  let count = 0;
  for (const g of groupProperties(candidates)) {
    if (count >= BROWSE_LIMIT) break;
    const items = g.items.slice(0, BROWSE_LIMIT - count);
    count += items.length;
    groups.push({ group: g.group, items });
  }
  return { groups, flat: groups.flatMap((g) => g.items) };
}

function sourceNote(props: PortalProperties): string {
  if (props.connected && props.loading) return 'Loading your HubSpot properties…';
  if (props.fromPortal) return props.error ? 'Your HubSpot properties (some couldn’t load)' : 'Your HubSpot properties';
  if (props.connected && props.error) return 'Common properties — your HubSpot properties couldn’t load';
  return props.connected ? 'Common properties' : 'Common properties · connect HubSpot to see your own';
}

function describeProperty(p: PortalProperty): string {
  const parts = [`${p.label} (${p.name})`, propertyTypeLabel(p), p.group];
  if (p.custom) parts.push('custom property');
  if (p.readOnly) parts.push('read-only');
  if (p.description) parts.push(p.description);
  return parts.join(' · ');
}

/** The floating list of suggestions (listbox with property groups). */
function PropertyList({
  id,
  anchor,
  view,
  active,
  onPick,
  onHover,
  note,
  empty,
}: {
  id: string;
  anchor: React.RefObject<HTMLElement>;
  view: ListView;
  active: number;
  onPick: (p: PortalProperty) => void;
  onHover: (index: number) => void;
  note: string;
  empty: ReactNode;
}) {
  const rect = useAnchorRect(anchor, true);
  useEffect(() => {
    if (active < 0) return;
    const el = document.getElementById(`${id}-${active}`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [id, active]);
  if (!rect) return null;
  let index = -1;
  // At least wide enough for "label · internal name · Custom · group" (fields in the narrow
  // sidebars are ~240px), and kept inside the window (pickers in the right-hand inspector).
  const width = Math.min(Math.max(rect.width, 340), window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  return createPortal(
    <div
      className="ub-pp-pop"
      style={{
        left,
        width,
        ...(rect.flip ? { bottom: window.innerHeight - rect.top } : { top: rect.top }),
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="ub-pp-pop__note">{note}</div>
      {view.flat.length > 0 ? (
        <div className="ub-pp-list" id={id} role="listbox" aria-label="Property suggestions">
          {view.groups.map((g) => (
            <div key={g.group || '__results'} role="group" aria-label={g.group || 'Matching properties'} className="ub-pp-group">
              {g.group && (
                <div className="ub-pp-group__label" aria-hidden>
                  {g.group}
                </div>
              )}
              {g.items.map((p) => {
                index++;
                const i = index;
                return (
                  <div
                    key={p.name}
                    id={`${id}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    title={describeProperty(p)}
                    className={cx('ub-pp-option', i === active && 'ub-pp-option--active')}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onPick(p);
                    }}
                    onMouseEnter={() => onHover(i)}
                  >
                    <PropertyTypeIcon type={p.type} />
                    <span className="ub-pp-option__label">{p.label}</span>
                    <span className="ub-pp-option__name">{p.name}</span>
                    {p.custom && <span className="ub-pp-badge">Custom</span>}
                    {!g.group && <span className="ub-pp-option__group">{p.group}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <div className="ub-pp-pop__empty">{empty}</div>
      )}
    </div>,
    document.body,
  );
}

function StatusLine({ props }: { props: PortalProperties }) {
  if (props.connected && props.loading) {
    return (
      <div className="ub-pp-status" role="status">
        <Loader2 size={11} aria-hidden className="ub-pp-spin" /> Loading your HubSpot properties…
      </div>
    );
  }
  if (props.connected && props.error) {
    return (
      <div className="ub-pp-status ub-pp-status--warn" role="status">
        Couldn’t load your HubSpot properties, so common ones are suggested. {props.error}
      </div>
    );
  }
  return null;
}

function IssueList({ issues, onFix, disabled }: { issues: PropertyIssue[]; onFix: (from: string, to: string) => void; disabled?: boolean }) {
  if (issues.length === 0) return null;
  return (
    <ul className="ub-pn-chip-warnings" aria-label="Property warnings">
      {issues.map((w) => (
        <li key={w.name} className="ub-pn-chip-warning">
          <TriangleAlert size={12} aria-hidden className="ub-pn-chip-warning__icon" />
          <span>
            {w.kind === 'missing' ? (
              <>
                <code>{w.name}</code>: {w.message}
              </>
            ) : (
              w.message
            )}
            {w.fix && !disabled && (
              <>
                {' '}
                <button type="button" className="ub-pn-link" onClick={() => onFix(w.name, w.fix!)}>
                  Use “{w.fix}”{w.fixLabel && w.kind === 'missing' ? ` (${w.fixLabel})` : ''}
                </button>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Keyboard navigation over the flat suggestion list
// ---------------------------------------------------------------------------

function useListNav(count: number, open: boolean, highlightFirst: boolean, signature: string) {
  const [active, setActive] = useState(-1);
  useEffect(() => setActive(highlightFirst && open && count > 0 ? 0 : -1), [signature, open, highlightFirst, count]);
  const onKey = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    if (!open || count === 0) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % count);
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a <= 0 ? count - 1 : a - 1));
      return true;
    }
    if (e.key === 'Home' && active >= 0) {
      e.preventDefault();
      setActive(0);
      return true;
    }
    if (e.key === 'End' && active >= 0) {
      e.preventDefault();
      setActive(count - 1);
      return true;
    }
    return false;
  };
  return { active, setActive, onKey };
}

// ---------------------------------------------------------------------------
// PropertyPicker
// ---------------------------------------------------------------------------

interface PickerBase {
  /** Object types whose properties are suggested (card object types, a data source's type …). */
  objectTypes: ReadonlyArray<string | null | undefined>;
  'aria-label': string;
  placeholder?: string;
  /** Suggest only properties passing this test (typed names are still accepted). */
  accept?: (p: PortalProperty) => boolean;
  disabled?: boolean;
  id?: string;
  /** Already merged properties (skips the picker's own lookup). */
  catalog?: PortalProperties;
  /** Extra id(s) for aria-describedby. */
  describedBy?: string;
}

export interface MultiPropertyPickerProps extends PickerBase {
  multiple: true;
  value: string[];
  onChange: (value: string[]) => void;
  /** HubSpot shows at most this many (a note appears above it). */
  max?: number;
}

export interface SinglePropertyPickerProps extends PickerBase {
  multiple?: false;
  value: string;
  onChange: (value: string) => void;
}

export type PropertyPickerProps = MultiPropertyPickerProps | SinglePropertyPickerProps;

export function PropertyPicker(props: PropertyPickerProps) {
  const own = usePortalProperties(props.catalog ? [] : props.objectTypes);
  const catalog = props.catalog ?? own;
  return props.multiple ? <MultiPicker {...props} catalog={catalog} /> : <SinglePicker {...props} catalog={catalog} />;
}

function invalidName(name: string): string | null {
  return NAME_RE.test(name) ? null : 'Use the internal property name (letters, numbers and _) or pick one from the list.';
}

function MultiPicker({
  value,
  onChange,
  catalog,
  accept,
  placeholder = 'Add a property…',
  disabled,
  id,
  max,
  describedBy,
  ...rest
}: MultiPropertyPickerProps & { catalog: PortalProperties }) {
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const errorId = useId();
  const values = Array.isArray(value) ? value : [];
  const present = useMemo(() => new Set(values), [values]);
  const view = useMemo(() => buildView(catalog.properties, draft, present, accept), [catalog.properties, draft, present, accept]);
  const open = focused && !dismissed && !disabled;
  const signature = `${draft}|${view.flat.length}`;
  const nav = useListNav(view.flat.length, open, draft.trim() !== '', signature);
  const issues = useMemo(() => values.map((v) => propertyIssue(v, catalog)).filter((x): x is PropertyIssue => !!x), [values, catalog]);
  const issueByName = useMemo(() => new Map(issues.map((i) => [i.name, i])), [issues]);

  useEffect(() => setDismissed(false), [draft]);

  const add = (raw: string[]): boolean => {
    const names = raw.map((r) => resolveTypedProperty(r, catalog)).filter(Boolean);
    if (names.length === 0) return false;
    const next = [...values];
    for (const n of names) {
      const err = invalidName(n);
      if (err) {
        setError(`${n}: ${err}`);
        return false;
      }
      if (!next.includes(n)) next.push(n);
    }
    setError(null);
    setDraft('');
    if (next.length !== values.length) onChange(next);
    return true;
  };
  const pick = (p: PortalProperty) => {
    add([p.name]);
    inputRef.current?.focus();
  };
  const remove = (name: string) => onChange(values.filter((v) => v !== name));
  const replace = (from: string, to: string) => {
    const next: string[] = [];
    for (const v of values) {
      const n = v === from ? to : v;
      if (!next.includes(n)) next.push(n);
    }
    onChange(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && open && (view.flat.length > 0 || draft)) {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(true);
      return;
    }
    if (e.key === 'Enter' && e.shiftKey) {
      // Exactly as typed.
      if (draft.trim()) {
        e.preventDefault();
        add([draft]);
      }
      return;
    }
    if (nav.onKey(e)) return;
    if (e.key === 'Enter' || (e.key === 'Tab' && draft.trim())) {
      const hit = open && nav.active >= 0 ? view.flat[nav.active] : undefined;
      if (hit) {
        e.preventDefault();
        add([hit.name]);
      } else if (draft.trim()) {
        e.preventDefault();
        add([draft]);
      }
    } else if (e.key === 'Backspace' && draft === '' && values.length) {
      remove(values[values.length - 1]);
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (/[,\n]/.test(text)) {
      e.preventDefault();
      add(text.split(/[,\n]+/));
    }
  };

  return (
    <div className="ub-pn-chips-wrap ub-pp">
      <div
        ref={boxRef}
        className={cx('ub-pn-chips', focused && 'ub-pn-chips--focus', error && 'ub-pn-chips--invalid', disabled && 'ub-pn-chips--disabled')}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            inputRef.current?.focus();
          }
        }}
      >
        {values.map((v) => {
          const p = catalog.byName.get(v);
          const issue = issueByName.get(v);
          return (
            <span
              key={v}
              className={cx('ub-pn-chip', 'ub-pp-chip', issue && 'ub-pn-chip--warn')}
              title={issue ? `${v} — ${issue.short}` : p ? describeProperty(p) : v}
              data-property={v}
            >
              {issue ? <TriangleAlert size={11} aria-hidden className="ub-pn-chip__icon" /> : p ? <PropertyTypeIcon type={p.type} size={11} /> : null}
              <span className="ub-pn-chip__text">{p && p.label !== v ? p.label : v}</span>
              {p && p.label !== v && <span className="ub-pp-chip__name">{v}</span>}
              {issue && <span className="ub-sr-only">({issue.short})</span>}
              {!disabled && (
                <button type="button" className="ub-pn-chip__remove" aria-label={`Remove ${v}`} title={`Remove ${p ? p.label : v}`} onClick={() => remove(v)}>
                  <X size={11} aria-hidden />
                </button>
              )}
            </span>
          );
        })}
        {!disabled && (
          <input
            ref={inputRef}
            id={id}
            className="ub-pn-chips__input"
            value={draft}
            placeholder={values.length ? '' : placeholder}
            aria-label={rest['aria-label']}
            role="combobox"
            aria-expanded={open && view.flat.length > 0}
            aria-controls={open && view.flat.length > 0 ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={open && nav.active >= 0 ? `${listId}-${nav.active}` : undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={[error ? errorId : '', describedBy ?? ''].filter(Boolean).join(' ') || undefined}
            spellCheck={false}
            autoComplete="off"
            onFocus={() => {
              setFocused(true);
              setDismissed(false);
            }}
            onBlur={() => {
              setFocused(false);
              // Never save half-typed text: an exact name / label is added, anything else stays a draft.
              const t = draft.trim();
              if (!t) return;
              const resolved = resolveTypedProperty(t, catalog);
              if (catalog.byName.has(resolved)) add([resolved]);
            }}
            onChange={(e) => {
              setError(null);
              const v = e.target.value;
              if (/,/.test(v)) add(v.split(','));
              else setDraft(v);
            }}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
          />
        )}
      </div>
      {open && (
        <PropertyList
          id={listId}
          anchor={boxRef}
          view={view}
          active={nav.active}
          onPick={pick}
          onHover={nav.setActive}
          note={sourceNote(catalog)}
          empty={
            draft.trim() ? (
              invalidName(draft.trim()) ? (
                'No matching property.'
              ) : (
                <>
                  No matching property. Press Enter to add <code>{draft.trim()}</code> anyway.
                </>
              )
            ) : (
              'All suggested properties are added. Type a property’s internal name to add another.'
            )
          }
        />
      )}
      {error && (
        <div className="ub-field__error" id={errorId} role="alert">
          {error}
        </div>
      )}
      {max !== undefined && values.length > max && (
        <div className="ub-field__hint ub-pp-max">HubSpot shows up to {max} properties here; the rest are ignored.</div>
      )}
      <IssueList issues={issues} onFix={replace} disabled={disabled} />
      <StatusLine props={catalog} />
    </div>
  );
}

function SinglePicker({
  value,
  onChange,
  catalog,
  accept,
  placeholder = 'property',
  disabled,
  id,
  describedBy,
  ...rest
}: SinglePropertyPickerProps & { catalog: PortalProperties }) {
  const current = typeof value === 'string' ? value : '';
  const [draft, setDraft] = useState(current);
  const [editing, setEditing] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const errorId = useId();
  const hintId = useId();
  useEffect(() => {
    if (!editing) setDraft(current);
  }, [current, editing]);
  useEffect(() => setDismissed(false), [draft]);

  // While the text still equals the stored name, browse everything.
  const query = editing && draft !== current ? draft : '';
  const exclude = useMemo(() => new Set<string>(), []);
  const view = useMemo(() => buildView(catalog.properties, query, exclude, accept), [catalog.properties, query, exclude, accept]);
  const open = focused && !dismissed && !disabled;
  const nav = useListNav(view.flat.length, open, query.trim() !== '', `${query}|${view.flat.length}`);
  const known = catalog.byName.get(current);
  const issue = useMemo(() => propertyIssue(current, catalog), [current, catalog]);

  const commit = (text: string, revertInvalid: boolean): boolean => {
    const t = resolveTypedProperty(text, catalog);
    if (t === current) {
      setDraft(current);
      setError(null);
      setEditing(false);
      return true;
    }
    const err = t === '' ? null : invalidName(t);
    if (err) {
      if (revertInvalid) {
        setDraft(current);
        setError(null);
        setEditing(false);
      } else setError(err);
      return false;
    }
    setError(null);
    setEditing(false);
    setDraft(t);
    onChange(t);
    return true;
  };
  const pick = (p: PortalProperty) => {
    setDismissed(true);
    commit(p.name, true);
  };

  return (
    <div className="ub-pn-chips-wrap ub-pp ub-pp--single" ref={wrapRef}>
      <div className={cx('ub-pp-single', issue && 'ub-pp-single--warn')}>
        {known ? <PropertyTypeIcon type={known.type} className="ub-pp-single__icon" /> : issue ? <TriangleAlert size={12} aria-hidden className="ub-pp-single__icon ub-pp-single__icon--warn" /> : null}
        <input
          id={id}
          className={cx('ub-input', 'ub-input--code', 'ub-pp-single__input', error && 'ub-input--invalid')}
          value={draft}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={rest['aria-label']}
          role="combobox"
          aria-expanded={open && view.flat.length > 0}
          aria-controls={open && view.flat.length > 0 ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && nav.active >= 0 ? `${listId}-${nav.active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={[error ? errorId : '', known || issue ? hintId : '', describedBy ?? ''].filter(Boolean).join(' ') || undefined}
          title={known ? describeProperty(known) : undefined}
          spellCheck={false}
          autoComplete="off"
          onFocus={() => {
            setFocused(true);
            setDismissed(false);
          }}
          onBlur={() => {
            setFocused(false);
            if (editing) commit(draft, true);
          }}
          onChange={(e) => {
            setEditing(true);
            setError(null);
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (open && view.flat.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                setDismissed(true);
                return;
              }
              if (draft !== current) {
                e.preventDefault();
                e.stopPropagation();
                setDraft(current);
                setEditing(false);
                setError(null);
              }
              return;
            }
            if (nav.onKey(e)) return;
            if (e.key === 'Enter' || (e.key === 'Tab' && editing && query.trim())) {
              const hit = open && nav.active >= 0 ? view.flat[nav.active] : undefined;
              if (hit) {
                e.preventDefault();
                pick(hit);
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (commit(draft, false)) setDismissed(true);
              }
            }
          }}
        />
      </div>
      {open && (
        <PropertyList
          id={listId}
          anchor={wrapRef}
          view={view}
          active={nav.active}
          onPick={pick}
          onHover={nav.setActive}
          note={sourceNote(catalog)}
          empty={query.trim() && !invalidName(query.trim()) ? <>No matching property. Press Enter to use <code>{query.trim()}</code>.</> : 'No matching property.'}
        />
      )}
      {error ? (
        <div className="ub-field__error" id={errorId} role="alert">
          {error}
        </div>
      ) : issue ? (
        <div className="ub-pp-hint ub-pp-hint--warn" id={hintId}>
          <TriangleAlert size={11} aria-hidden /> <span>{issue.kind === 'missing' ? issue.short : issue.message}</span>
          {issue.fix && !disabled && (
            <button type="button" className="ub-pn-link" onClick={() => commit(issue.fix!, true)}>
              Use “{issue.fix}”
            </button>
          )}
        </div>
      ) : known && known.label !== known.name ? (
        <div className="ub-pp-hint" id={hintId}>
          {known.label}
          <span className="ub-pp-hint__type"> · {propertyTypeLabel(known)}</span>
          {known.custom && <span className="ub-pp-badge">Custom</span>}
        </div>
      ) : null}
    </div>
  );
}
