/**
 * Shape a list without code: "From [deals] — only rows where [amount is more than 1000] — sort by
 * [amount, highest first] — show the first [5] — format [amount] as [currency]", with a live
 * preview of the rows it gives right now (mock or live data). Edits a ListShape (shape.ts); the
 * host stores it as the expression of a computed value. Used by the Data panel (computed values,
 * "Filter & sort" on a list data source) and Advanced › Repeat.
 */
import { useId, useMemo } from 'react';
import { ArrowRight, Plus, Trash2 } from 'lucide-react';
import type { Extension, NodeId } from '../model/types';
import { usePreviewScope } from '../inspector/controls';
import { ConditionBuilder } from '../inspector/power-ConditionBuilder';
import { SubjectPicker, type SubjectChoice } from '../inspector/power-SubjectPicker';
import { safeEvaluate } from '../inspector/scope';
import { cx, IconButton } from '../ui';
import { humanizeProperty, propertyLabel } from '../panels/crmProperties';
import {
  accessor,
  CURRENCIES,
  fieldLabel,
  fieldValue,
  FORMAT_KINDS,
  formatName,
  guessFormat,
  guessSortAs,
  listChoices,
  ROW,
  rowFields,
  shapeToExpr,
  sourceProperties,
  type FormatKind,
  type ListShape,
  type ShapeFormat,
  type SortAs,
} from './shape';
import './power.css';

export interface ShapeEditorProps {
  ext: Extension;
  shape: ListShape;
  onChange: (next: ListShape) => void;
  /** The computed value being edited (only lists declared above it can be its source). */
  computedId?: string;
  /** Where previews are evaluated (a repeat's node), else the card's top level. */
  nodeId?: NodeId | null;
  /** Name of the list (for the "use it" hint). */
  name?: string;
  /** Item name of the repeat that shows the list (for the "use it" hint). */
  itemName?: string;
}

const NAME_RE = /^[A-Za-z_$][\w$]*$/;
const PREVIEW_ROWS = 5;
const LABEL_KEY_RE = /^(?:name|dealname|title|subject|label|firstname|email|hs_ticket_subject|content)$/i;

function cell(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** The field a new format starts with: amounts, dates and numbers before text. */
function formatCandidate(fields: string[][], used: Set<string>, rows: unknown[]): string[] | undefined {
  const free = fields.filter((f) => !used.has(JSON.stringify(f)));
  const sample = (f: string[]) => (rows.length ? fieldValue(rows[0], f) : undefined);
  const numeric = (f: string[]) => {
    const v = sample(f);
    return typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
  };
  return (
    free.find((f) => guessFormat(f, sample(f)) !== 'number' && (numeric(f) || guessFormat(f, sample(f)) === 'date') && !/^(?:hs_object_id|toObjectId|objectId|id)$/.test(f[f.length - 1])) ??
    free.find((f) => numeric(f) && !/^(?:hs_object_id|toObjectId|objectId|id)$/.test(f[f.length - 1])) ??
    free[0]
  );
}

export function ShapeEditor({ ext, shape, onChange, computedId, nodeId, name, itemName }: ShapeEditorProps) {
  const id = useId();
  const scope = usePreviewScope(ext, nodeId);
  const update = (patch: Partial<ListShape>) => {
    const next: ListShape = { ...shape, ...patch };
    for (const k of Object.keys(patch) as Array<keyof ListShape>) if (patch[k] === undefined) delete next[k];
    onChange(next);
  };

  // The source rows right now and what the shape gives.
  const sourceRes = useMemo(() => (shape.source.trim() ? safeEvaluate(`(${shape.source}) ?? []`, scope) : null), [shape.source, scope]);
  const sourceRows = sourceRes?.ok && Array.isArray(sourceRes.value) ? (sourceRes.value as unknown[]) : null;
  const result = useMemo(() => safeEvaluate(shapeToExpr(shape), scope), [shape, scope]);
  const rows = result?.ok && Array.isArray(result.value) ? (result.value as unknown[]) : null;

  const declared = useMemo(() => sourceProperties(ext, shape.source), [ext, shape.source]);
  const fields = useMemo(() => rowFields(sourceRows ?? [], declared), [sourceRows, declared]);
  // Plain names for the fields ("Deal name", "Amount"); the exact path is the option's tooltip.
  const objectType = useMemo(() => sourceObjectType(ext, shape.source), [ext, shape.source]);
  const label = (f: string[]) => fieldDisplayLabel(f, objectType);
  const fieldChoices: SubjectChoice[] = fields.map((f) => {
    const sample = sourceRows?.length ? fieldValue(sourceRows[0], f) : undefined;
    return {
      label: label(f),
      expr: `${ROW}${accessor(f)}`,
      detail: sample === undefined ? undefined : sample === null || sample === '' ? 'empty in row 1' : `“${clip(cell(sample), 22)}” in row 1`,
    };
  });
  const filterScope = useMemo(() => ({ ...scope, [ROW]: sourceRows?.[0] }), [scope, sourceRows]);
  // A computed value can only read the ones declared before it.
  const later = useMemo(() => {
    const list = ext.computed ?? [];
    const at = computedId ? list.findIndex((c) => c.id === computedId) : -1;
    return at === -1 ? [] : list.slice(at).map((c) => c.name);
  }, [ext.computed, computedId]);
  const lists = useMemo(() => listChoices(ext, scope, computedId), [ext, scope, computedId]);
  const fieldKey = (f: string[]) => JSON.stringify(f);
  const fieldByKey = (k: string) => fields.find((f) => fieldKey(f) === k) ?? (JSON.parse(k) as string[]);

  // Preview columns: a name-like field, the sort field and the formatted fields.
  const columns = useMemo(() => {
    const cols: Array<{ label: string; get: (row: unknown) => unknown }> = [];
    const labelField = fields.find((f) => LABEL_KEY_RE.test(f[f.length - 1] ?? '')) ?? fields.find((f) => f[0] === 'properties') ?? fields[0];
    if (labelField) cols.push({ label: fieldDisplayLabel(labelField, objectType), get: (r) => fieldValue(r, labelField) });
    if (shape.sort && (!labelField || fieldKey(shape.sort.field) !== fieldKey(labelField))) {
      const f = shape.sort.field;
      cols.push({ label: fieldDisplayLabel(f, objectType), get: (r) => fieldValue(r, f) });
    }
    for (const fm of shape.formats ?? []) cols.push({ label: fm.name, get: (r) => fieldValue(r, [fm.name]) });
    return cols.slice(0, 3);
  }, [fields, shape.sort, shape.formats, objectType]);

  const formats = shape.formats ?? [];
  const setFormat = (i: number, patch: Partial<ShapeFormat>) =>
    update({ formats: formats.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const addFormat = () => {
    const used = new Set(formats.map((f) => fieldKey(f.field)));
    const field = formatCandidate(fields, used, sourceRows ?? []) ?? ['value'];
    const kind = guessFormat(field, sourceRows?.length ? fieldValue(sourceRows[0], field) : undefined);
    update({
      formats: [...formats, { name: formatName(field, formats.map((f) => f.name)), field, kind, ...(kind === 'currency' ? { currency: 'USD' } : {}) }],
    });
  };

  const sortValue = shape.sort ? fieldKey(shape.sort.field) : '';

  return (
    <div className="ub-pw-shape" role="group" aria-label={`${name ? `${name}: ` : ''}filter and sort`}>
      <div className="ub-pw-shape__row">
        <label className="ub-pw-shape__label" htmlFor={`${id}-source`}>
          From
        </label>
        <div className="ub-pw-shape__field">
          <SubjectPicker
            id={`${id}-source`}
            ext={ext}
            nodeId={nodeId}
            value={shape.source}
            onChange={(source) => update({ source })}
            groups={[{ label: 'Lists', items: lists.map((l) => ({ label: l.label, expr: l.expr, detail: l.detail })) }]}
            scopeless
            exprLabel="List (expression)"
            placeholder="Choose a list…"
          />
        </div>
      </div>
      {sourceRes && !sourceRows && (
        <div className="ub-pw-shape__warn" role="status">
          {sourceRes.ok ? 'This is not a list right now.' : `Can’t read it: ${sourceRes.error}`}
        </div>
      )}

      <ConditionBuilder
        ext={ext}
        nodeId={nodeId}
        value={shape.filter ?? ''}
        onChange={(filter) => update({ filter: filter.trim() ? filter : undefined })}
        label="Only rows where"
        groups={[{ label: 'Each row', items: fieldChoices }]}
        exclude={later}
        scope={filterScope}
        codePlaceholder={`e.g. ${ROW}.properties.amount > 1000`}
        addLabel="Add a filter"
      />

      <div className="ub-pw-shape__row">
        <label className="ub-pw-shape__label" htmlFor={`${id}-sort`}>
          Sort by
        </label>
        <div className="ub-pw-shape__field ub-pw-shape__pair">
          <select
            id={`${id}-sort`}
            className="ub-select"
            value={sortValue}
            onChange={(e) => {
              if (!e.target.value) return update({ sort: undefined });
              const field = fieldByKey(e.target.value);
              const as = guessSortAs(sourceRows ?? [], field);
              // Numbers start highest first; text starts A → Z.
              update({ sort: { field, dir: shape.sort && (shape.sort.as === 'text') === (as === 'text') ? shape.sort.dir : as === 'text' ? 'asc' : 'desc', as } });
            }}
          >
            <option value="">As they come</option>
            {fields.map((f) => (
              <option key={fieldKey(f)} value={fieldKey(f)} title={fieldLabel(f)}>
                {label(f)}
              </option>
            ))}
            {shape.sort && !fields.some((f) => fieldKey(f) === sortValue) && <option value={sortValue}>{label(shape.sort.field)}</option>}
          </select>
          {shape.sort && (
            <select
              className="ub-select"
              aria-label="Sort order"
              value={`${shape.sort.as}:${shape.sort.dir}`}
              onChange={(e) => {
                const [as, dir] = e.target.value.split(':') as [SortAs, 'asc' | 'desc'];
                update({ sort: { ...shape.sort!, as, dir } });
              }}
            >
              {/* Formatted numbers ("$48,000.00") keep comparing as numbers. */}
              <option value={`${shape.sort.as === 'formatted' ? 'formatted' : 'number'}:desc`}>High → low</option>
              <option value={`${shape.sort.as === 'formatted' ? 'formatted' : 'number'}:asc`}>Low → high</option>
              <option value="text:asc">A → Z</option>
              <option value="text:desc">Z → A</option>
            </select>
          )}
        </div>
      </div>

      <div className="ub-pw-shape__row">
        <label className="ub-pw-shape__label" htmlFor={`${id}-limit`}>
          Show
        </label>
        <div className="ub-pw-shape__field ub-pw-shape__pair">
          <select
            className="ub-select"
            aria-label="How many rows"
            value={shape.limit === undefined ? 'all' : 'first'}
            onChange={(e) => update({ limit: e.target.value === 'all' ? undefined : (shape.limit ?? 5) })}
          >
            <option value="all">All rows</option>
            <option value="first">The first…</option>
          </select>
          {shape.limit !== undefined && (
            <input
              id={`${id}-limit`}
              className="ub-input"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              aria-label="Number of rows to show"
              value={shape.limit}
              onChange={(e) => {
                const n = Math.max(0, Math.floor(Number(e.target.value)));
                if (Number.isFinite(n)) update({ limit: n });
              }}
            />
          )}
        </div>
      </div>

      <div className="ub-pw-shape__formats" role="group" aria-label="Formatted fields">
        <div className="ub-pw-shape__label">Format fields</div>
        {formats.map((f, i) => (
          <div key={i} className="ub-pw-shape__format">
            <div className="ub-pw-shape__pair">
              <select
                className="ub-select"
                aria-label={`Format ${i + 1}: field`}
                value={fieldKey(f.field)}
                onChange={(e) => {
                  const field = fieldByKey(e.target.value);
                  const auto = formatName(f.field, []);
                  setFormat(i, {
                    field,
                    ...(f.name === auto || f.name.startsWith(auto) ? { name: formatName(field, formats.filter((_, j) => j !== i).map((x) => x.name)) } : {}),
                  });
                }}
              >
                {fields.map((fl) => (
                  <option key={fieldKey(fl)} value={fieldKey(fl)} title={fieldLabel(fl)}>
                    {label(fl)}
                  </option>
                ))}
                {!fields.some((fl) => fieldKey(fl) === fieldKey(f.field)) && <option value={fieldKey(f.field)}>{label(f.field)}</option>}
              </select>
              <select
                className="ub-select"
                aria-label={`Format ${i + 1}: as`}
                title={FORMAT_KINDS.find((k) => k.value === f.kind)?.example}
                value={f.kind}
                onChange={(e) => {
                  const kind = e.target.value as FormatKind;
                  setFormat(i, { kind, currency: kind === 'currency' ? (f.currency ?? 'USD') : undefined, decimals: undefined });
                }}
              >
                {FORMAT_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <IconButton size="sm" label={`Remove format ${i + 1}`} onClick={() => update({ formats: formats.filter((_, j) => j !== i) })}>
                <Trash2 size={12} />
              </IconButton>
            </div>
            <div className="ub-pw-shape__pair">
              {f.kind === 'currency' && (
                <select
                  className="ub-select"
                  aria-label={`Format ${i + 1}: currency`}
                  value={f.currency ?? 'USD'}
                  onChange={(e) => setFormat(i, { currency: e.target.value })}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
              {(f.kind === 'currency' || f.kind === 'number' || f.kind === 'percent') && (
                <select
                  className="ub-select"
                  aria-label={`Format ${i + 1}: decimals`}
                  value={String(f.decimals ?? (f.kind === 'number' ? 2 : 0))}
                  onChange={(e) => setFormat(i, { decimals: Number(e.target.value) })}
                >
                  {[0, 1, 2, 3].map((d) => (
                    <option key={d} value={d}>
                      {d === 0 ? 'No decimals' : `${d} decimal${d === 1 ? '' : 's'}`}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="ub-pw-shape__as">
              <ArrowRight size={12} aria-hidden />
              <input
                className={cx('ub-input ub-input--code', !NAME_RE.test(f.name) && 'ub-input--invalid')}
                aria-label={`Format ${i + 1}: new field name`}
                value={f.name}
                spellCheck={false}
                onChange={(e) => setFormat(i, { name: e.target.value.trim() })}
              />
            </div>
          </div>
        ))}
        <button type="button" className="ub-insp-linkbtn ub-pw-shape__add" onClick={addFormat} disabled={!fields.length && !formats.length}>
          <Plus size={12} aria-hidden /> Format a field
        </button>
      </div>

      <div className="ub-pw-shape__preview" aria-live="polite">
        <div className="ub-pw-shape__count">
          {!rows
            ? result && !result.ok
              ? `Can’t preview: ${result.error}`
              : 'No preview yet'
            : sourceRows
              ? `${rows.length} of ${sourceRows.length} row${sourceRows.length === 1 ? '' : 's'} right now`
              : `${rows.length} row${rows.length === 1 ? '' : 's'} right now`}
        </div>
        {rows && rows.length > 0 && columns.length > 0 && (
          <table className="ub-pw-shape__table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.label} scope="col">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.label} title={cell(c.get(r))}>
                      {cell(c.get(r))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows && rows.length > PREVIEW_ROWS && <div className="ub-pw-shape__more">and {rows.length - PREVIEW_ROWS} more…</div>}
      </div>
      {name && formats.length > 0 && (
        <div className="ub-pw-hint">
          {itemName ? (
            <>
              Show a formatted value with <code>{`{{ ${itemName}.${formats[0].name} }}`}</code> in this row’s text.
            </>
          ) : (
            <>
              Repeat over <code>{name}</code> and show e.g. <code>{`{{ item.${formats[0].name} }}`}</code> (with the repeat’s item name).
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The CRM object type of a list data source (for property labels), if it is one. */
function sourceObjectType(ext: Extension, source: string): string | null {
  const ds = ext.dataSources.find((d) => d.name === source.trim());
  if (ds?.kind === 'associations') return ds.toObjectType;
  if (ds?.kind === 'crmSearch') return ds.objectType;
  return null;
}

/** "Amount" for properties.amount, "Record ID" for toObjectId / id, else a humanised name. */
export function fieldDisplayLabel(path: string[], objectType: string | null = null): string {
  const last = path[path.length - 1] ?? '';
  if (path.length === 2 && path[0] === 'properties') return propertyLabel(last, [objectType]);
  if (path.length === 1 && (last === 'toObjectId' || last === 'id' || last === 'objectId')) return 'Record ID';
  return humanizeProperty(last) || fieldLabel(path);
}
