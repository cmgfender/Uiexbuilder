/**
 * Chips editor for string lists (CRM property names, step names, object types...). Free text
 * (Enter / comma / paste to add, Backspace to remove the last chip) or, when `options` is given,
 * a choice among those values only.
 */
import { useState, type ClipboardEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { cx, Select } from '../ui';

export interface ChipOption {
  value: string;
  label: string;
}

export interface ChipsInputProps {
  id?: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  /** Restrict items to these values (shown as a picker instead of free text). */
  options?: ChipOption[];
  /** Validates a free-text item; return an error message to reject it. */
  validate?: (item: string) => string | null;
  'aria-label'?: string;
  /** Allow the same value twice (default false). */
  allowDuplicates?: boolean;
}

export function ChipsInput({ id, value, onChange, placeholder, options, validate, allowDuplicates, ...rest }: ChipsInputProps) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const labelOf = (v: string) => options?.find((o) => o.value === v)?.label ?? v;

  const addItems = (items: string[]) => {
    const next = [...value];
    for (const raw of items) {
      const item = raw.trim();
      if (!item) continue;
      if (!allowDuplicates && next.includes(item)) continue;
      const err = validate?.(item) ?? null;
      if (err) {
        setError(err);
        return false;
      }
      next.push(item);
    }
    setError(null);
    if (next.length !== value.length) onChange(next);
    return true;
  };
  const removeAt = (i: number) => onChange(value.filter((_, j) => j !== i));

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || (e.key === 'Tab' && draft.trim())) {
      if (!draft.trim()) return;
      e.preventDefault();
      if (addItems([draft])) setDraft('');
    } else if (e.key === 'Backspace' && !draft && value.length) {
      e.preventDefault();
      removeAt(value.length - 1);
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!/[,\n]/.test(text)) return;
    e.preventDefault();
    if (addItems(text.split(/[,\n]/))) setDraft('');
  };

  const remaining = options?.filter((o) => allowDuplicates || !value.includes(o.value)) ?? [];

  return (
    <div className="ub-insp-chips-wrap">
      {(!options || value.length > 0) && (
        <div
          className={cx('ub-insp-chips', error && 'is-invalid')}
          onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}
        >
          {value.map((v, i) => (
            <span key={`${v}-${i}`} className="ub-insp-chip">
              <span className="ub-insp-chip__text" title={v}>
                {labelOf(v)}
              </span>
              <button
                type="button"
                className="ub-insp-chip__x"
                aria-label={`Remove ${labelOf(v)}`}
                title={`Remove ${labelOf(v)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  removeAt(i);
                }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
          {!options && (
            <input
              id={id}
              className="ub-insp-chips__input"
              value={draft}
              placeholder={value.length ? '' : (placeholder ?? 'Type and press Enter')}
              aria-label={rest['aria-label']}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onBlur={() => {
                if (draft.trim() && addItems([draft])) setDraft('');
              }}
            />
          )}
        </div>
      )}
      {options && remaining.length > 0 && (
        <Select
          id={id}
          className="ub-insp-chips__select"
          value=""
          placeholder={value.length ? 'Add another…' : (placeholder ?? 'Add…')}
          aria-label={rest['aria-label'] ?? 'Add item'}
          options={remaining.map((o) => ({ value: o.value, label: o.label }))}
          onChange={(v) => v && addItems([v])}
        />
      )}
      {error && <div className="ub-field__error">{error}</div>}
    </div>
  );
}
