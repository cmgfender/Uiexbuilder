/**
 * Editor for option lists ({ label, value, ...optionFields }[]) used by Select, MultiSelect,
 * ToggleGroup...: add / remove / reorder rows, plus a "Paste lines" bulk editor.
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, ClipboardPaste, Plus, Trash2 } from 'lucide-react';
import type { JsonValue } from '../model/types';
import { Button, IconButton, Switch, TextArea } from '../ui';
import { moveItem, optionsToLines, optionValueFromLabel, parseOptionLines, type OptionItem } from './propValue';

export type OptionField = 'description' | 'initialIsChecked' | 'readOnly';

export interface OptionsEditorProps {
  id?: string;
  value: JsonValue | undefined;
  onChange: (value: JsonValue | undefined) => void;
  /** Extra per-option keys the HubSpot option type accepts (undefined: description only). */
  optionFields?: OptionField[];
}

function toItems(value: JsonValue | undefined): OptionItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((o) => {
    const obj = (o && typeof o === 'object' && !Array.isArray(o) ? o : {}) as Record<string, JsonValue>;
    return {
      ...obj,
      label: typeof obj.label === 'string' ? obj.label : String(obj.label ?? ''),
      value: typeof obj.value === 'number' ? obj.value : String(obj.value ?? ''),
    } as OptionItem;
  });
}

function clean(items: OptionItem[]): JsonValue {
  return items.map((o) => {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(o)) if (v !== undefined && !(k === 'description' && v === '')) out[k] = v;
    return out;
  });
}

export function OptionsEditor({ id, value, onChange, optionFields }: OptionsEditorProps) {
  const items = toItems(value);
  const fields: OptionField[] = optionFields ?? ['description'];
  const [bulk, setBulk] = useState<string | null>(null);

  const emit = (next: OptionItem[]) => onChange(next.length ? clean(next) : []);
  const update = (i: number, patch: Partial<OptionItem>) => {
    const next = items.map((o, j) => {
      if (j !== i) return o;
      const merged: OptionItem = { ...o, ...patch };
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete merged[k];
      return merged;
    });
    emit(next);
  };
  const setValue = (i: number, text: string) => {
    const prev = items[i].value;
    const asNum = Number(text);
    update(i, { value: typeof prev === 'number' && text.trim() !== '' && !Number.isNaN(asNum) ? asNum : text });
  };
  const add = () => {
    const taken = new Set(items.map((o) => String(o.value)));
    let n = items.length + 1;
    while (taken.has(`option_${n}`)) n++;
    emit([...items, { label: `Option ${n}`, value: `option_${n}` }]);
  };

  if (bulk !== null) {
    const parsed = parseOptionLines(bulk);
    return (
      <div className="ub-insp-opts">
        <TextArea
          id={id}
          code
          rows={Math.min(12, Math.max(4, bulk.split('\n').length + 1))}
          value={bulk}
          onChange={setBulk}
          aria-label="Options, one per line"
          placeholder={'Small\nMedium | md\nLarge | lg'}
          autoFocus
        />
        <div className="ub-field__hint">
          One option per line. Write “Label | value” to set a value; otherwise it is derived from the label.
        </div>
        <div className="ub-insp-row-actions">
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              const prevByValue = new Map(items.map((o) => [String(o.value), o]));
              emit(parsed.map((p) => ({ ...(prevByValue.get(String(p.value)) ?? {}), ...p })));
              setBulk(null);
            }}
          >
            Apply {parsed.length} option{parsed.length === 1 ? '' : 's'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setBulk(null)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="ub-insp-opts" id={id}>
      {items.length === 0 && <div className="ub-insp-muted">No options yet.</div>}
      {items.map((o, i) => (
        <div className="ub-insp-opt" key={i}>
          <div className="ub-insp-opt__row">
            <input
              className="ub-input ub-insp-opt__label"
              value={o.label}
              placeholder="Label"
              aria-label={`Option ${i + 1} label`}
              onChange={(e) => {
                const label = e.target.value;
                // Keep the value in sync while it still mirrors the label.
                const mirrored = String(o.value) === optionValueFromLabel(o.label) || String(o.value) === '';
                update(i, mirrored && typeof o.value === 'string' ? { label, value: optionValueFromLabel(label) } : { label });
              }}
            />
            <input
              className="ub-input ub-input--code ub-insp-opt__value"
              value={String(o.value)}
              placeholder="value"
              aria-label={`Option ${i + 1} value`}
              spellCheck={false}
              onChange={(e) => setValue(i, e.target.value)}
            />
            <span className="ub-insp-opt__actions">
              <IconButton size="sm" label="Move up" disabled={i === 0} onClick={() => emit(moveItem(items, i, i - 1))}>
                <ArrowUp size={12} />
              </IconButton>
              <IconButton size="sm" label="Move down" disabled={i === items.length - 1} onClick={() => emit(moveItem(items, i, i + 1))}>
                <ArrowDown size={12} />
              </IconButton>
              <IconButton size="sm" label={`Remove option ${o.label || i + 1}`} onClick={() => emit(items.filter((_, j) => j !== i))}>
                <Trash2 size={12} />
              </IconButton>
            </span>
          </div>
          {fields.includes('description') && (
            <input
              className="ub-input ub-insp-opt__desc"
              value={typeof o.description === 'string' ? o.description : ''}
              placeholder="Description (optional)"
              aria-label={`Option ${i + 1} description`}
              onChange={(e) => update(i, { description: e.target.value || undefined })}
            />
          )}
          {(fields.includes('initialIsChecked') || fields.includes('readOnly')) && (
            <div className="ub-insp-opt__flags">
              {fields.includes('initialIsChecked') && (
                <Switch
                  checked={o.initialIsChecked === true}
                  onChange={(c) => update(i, { initialIsChecked: c || undefined })}
                  label="Checked initially"
                />
              )}
              {fields.includes('readOnly') && (
                <Switch checked={o.readOnly === true} onChange={(c) => update(i, { readOnly: c || undefined })} label="Read-only" />
              )}
            </div>
          )}
        </div>
      ))}
      <div className="ub-insp-row-actions">
        <Button size="sm" icon={<Plus size={13} />} onClick={add}>
          Add option
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={<ClipboardPaste size={13} />}
          onClick={() => setBulk(optionsToLines(items))}
          title="Edit all options as lines of text"
        >
          Paste lines
        </Button>
      </div>
    </div>
  );
}
