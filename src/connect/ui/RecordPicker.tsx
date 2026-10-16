/**
 * Canvas toolbar controls for real data (shown only while connected):
 *  - "Mock data | Live data" switch (per project)
 *  - CRM cards: the sample-record chip ("Live data · Ada Lovelace") opening the picker — record type
 *    (limited to the card's object types), a keyboard-accessible search list, the picked record with
 *    "Open in HubSpot" and Clear, and plain-language problems (e.g. a missing permission).
 *  - Settings / app home: a "Live data · <account>" badge (no record needed).
 *  - Preview mode: the switch moves into the chip's popover so the preview banner keeps its room.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Database, ExternalLink, FlaskConical, LoaderCircle, RefreshCw, Search, TriangleAlert, X } from 'lucide-react';
import { selectActiveExtension, useEditor } from '../../model/store';
import { Button, Segmented, Select, cx } from '../../ui';
import type { CrmObjectTypeInfo, CrmRecordSummary } from '../types';
import { getConnectorClient, isAbortError } from '../client';
import { describeError, type FriendlyError } from '../describe';
import { useObjectTypes } from '../catalog';
import { objectTypeIdOf, objectTypeLabel, sameObjectType } from '../objectTypes';
import { useConnection } from '../store';
import { useLiveData, type LiveDataError, type LiveMode } from '../records';
import { useSampleRecord } from '../live';
import { recordUrl } from './links';
import { Popover } from './Popover';
import './connect.css';

export const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_LIMIT = 10;

/** Primitive view of the active extension (re-renders only when these change). */
function useActiveExtensionSummary() {
  const id = useEditor((s) => selectActiveExtension(s).id);
  const kind = useEditor((s) => selectActiveExtension(s).kind);
  const typesKey = useEditor((s) => selectActiveExtension(s).objectTypes.join(','));
  const projectId = useEditor((s) => s.project.id);
  const objectTypes = useMemo(() => (typesKey ? typesKey.split(',') : []), [typesKey]);
  return { id, kind, objectTypes, projectId };
}

export function RecordPicker() {
  const connected = useConnection((s) => s.status === 'connected' && s.info.connected);
  if (!connected) return null;
  return <LiveDataControls />;
}

function LiveDataControls() {
  const ext = useActiveExtensionSummary();
  const loaded = useLiveData((s) => s.projectId === ext.projectId);
  const mode = useLiveData((s) => s.mode);
  // In preview the toolbar belongs to the preview banner (Reset / Exit): one compact chip whose
  // popover holds the Mock | Live switch.
  const compact = useEditor((s) => s.mode === 'preview');
  if (!loaded) return null;
  return (
    <div className={cx('ub-cn-live', compact && 'ub-cn-live--compact')}>
      {!compact && <ModeSwitch mode={mode} />}
      {(compact || mode === 'live') && <DataChip ext={ext} mode={mode} compact={compact} />}
      <span className="ub-cn-live__divider" aria-hidden />
    </div>
  );
}

function ModeSwitch({ mode }: { mode: LiveMode }) {
  return (
    <Segmented<LiveMode>
      aria-label="Preview data"
      value={mode}
      onChange={(m) => useLiveData.getState().setMode(m)}
      options={[
        {
          value: 'mock',
          label: (
            <>
              <FlaskConical size={12} aria-hidden /> Mock<span className="ub-cn-live__suffix"> data</span>
            </>
          ),
          title: 'Preview with the sample values from Data › Mock data',
        },
        {
          value: 'live',
          label: (
            <>
              <Database size={12} aria-hidden /> Live<span className="ub-cn-live__suffix"> data</span>
            </>
          ),
          title: 'Preview with real records from your HubSpot account (read-only)',
        },
      ]}
    />
  );
}

/** Looks the record's name up again after a reload (only ids are remembered). */
function useRecordLabel(extId: string, record: CrmRecordSummary | null): void {
  const portalId = useConnection((s) => (s.info.connected ? s.info.portalId : null));
  const needsLabel = !!record && !record.label;
  const id = record?.id;
  const objectType = record?.objectType || record?.objectTypeId;
  useEffect(() => {
    if (!needsLabel || !id || !objectType || portalId === null) return;
    const controller = new AbortController();
    getConnectorClient()
      .searchRecords(objectType, id, { limit: 5, signal: controller.signal })
      .then((list) => {
        const match = Array.isArray(list) ? list.find((r) => r.id === id) : undefined;
        const current = useLiveData.getState().recordByExtension[extId];
        if (match && current && current.id === id && !current.label) useLiveData.getState().setRecord(extId, match, portalId);
      })
      .catch(() => {
        /* the chip keeps showing "Record <id>" */
      });
    return () => controller.abort();
  }, [needsLabel, id, objectType, portalId, extId]);
}

function displayLabel(record: CrmRecordSummary): string {
  return record.label || `Record ${record.id}`;
}

interface ExtSummary {
  id: string;
  kind: string;
  objectTypes: string[];
}

/**
 * The toolbar chip and its popover:
 *  live + CRM card       "Live data · Ada Lovelace" / "Pick a sample record" → record picker
 *  live + settings/home  "Live data · acme.com" → what live data means without a record
 *  mock (preview only)   "Mock data" → explanation; the popover has the Mock | Live switch
 */
function DataChip({ ext, mode, compact }: { ext: ExtSummary; mode: LiveMode; compact: boolean }) {
  const isCard = ext.kind === 'card';
  const record = useSampleRecord({ id: ext.id, kind: isCard ? 'card' : ext.kind === 'home' ? 'home' : 'settings', objectTypes: ext.objectTypes });
  const info = useConnection((s) => s.info);
  const error = useLiveData((s) => s.error);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const live = mode === 'live';
  useRecordLabel(ext.id, live && isCard ? record : null);
  if (!info.connected) return null;
  const account = info.hubDomain || `account ${info.portalId}`;
  const problem = live && error ? ` — problem: ${error.title}` : '';
  const searchId = `${ext.id}-record-search`;

  let icon;
  let text;
  let label: string;
  let title: string;
  let popoverLabel: string;
  if (!live) {
    icon = <FlaskConical size={13} aria-hidden />;
    text = 'Mock data';
    label = 'Preview data: mock data. Change';
    title = 'The preview uses mock data — click to use real HubSpot data';
    popoverLabel = 'Preview data';
  } else if (isCard) {
    icon = error ? <TriangleAlert size={13} aria-hidden /> : record ? <span className="ub-cn-live-dot" aria-hidden /> : <Search size={13} aria-hidden />;
    text = record ? (
      <>
        Live data · <strong>{displayLabel(record)}</strong>
      </>
    ) : (
      'Pick a sample record'
    );
    label = record ? `Live data: ${displayLabel(record)}${problem}. Change the sample record` : 'Pick a sample record to preview with real data';
    title = record ? `Previewing with ${displayLabel(record)} — click to change` : 'Pick a sample record to preview with real data';
    popoverLabel = 'Sample record';
  } else {
    icon = error ? <TriangleAlert size={13} aria-hidden /> : <span className="ub-cn-live-dot" aria-hidden />;
    text = (
      <>
        Live data · <strong>{account}</strong>
      </>
    );
    label = `Live data from ${account}${problem}. Details`;
    title = 'This page has no record: the preview uses your HubSpot account and user';
    popoverLabel = 'Live data';
  }

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={cx('ub-cn-chip', !live && 'ub-cn-chip--mock', live && isCard && !record && 'ub-cn-chip--empty', live && error && 'ub-cn-chip--warn')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={title}
        onClick={() => setOpen((o) => !o)}
        data-testid={live && isCard ? 'uiex-sample-record' : 'uiex-preview-data'}
      >
        {icon}
        <span className="ub-cn-chip__text">{text}</span>
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <Popover
          anchor={ref.current}
          label={popoverLabel}
          align="end"
          width={isCard && live ? 360 : 320}
          onClose={() => setOpen(false)}
          initialFocus={() => (live && isCard ? document.getElementById(searchId) : null)}
        >
          {compact && (
            <div className="ub-cn-picker__switch">
              <span className="ub-cn-picker__label">Preview with</span>
              <ModeSwitch mode={mode} />
            </div>
          )}
          {!live ? (
            <MockNote />
          ) : isCard ? (
            <SampleRecordPanel ext={ext} record={record} searchId={searchId} onPicked={() => setOpen(false)} />
          ) : (
            <AccountNote />
          )}
        </Popover>
      )}
    </>
  );
}

function MockNote() {
  return (
    <div className="ub-cn-picker">
      <div className="ub-cn-picker__head">
        <strong>Mock data</strong>
        <span>The preview uses the sample values from Data › Mock data. Choose Live data to preview with real records from your HubSpot account (read-only).</span>
      </div>
    </div>
  );
}

function AccountNote() {
  const error = useLiveData((s) => s.error);
  return (
    <div className="ub-cn-picker">
      <div className="ub-cn-picker__head">
        <strong>Live data</strong>
        <span>Settings pages and app home have no CRM record. The preview uses your real account and user, and CRM searches return real records. Nothing in HubSpot is changed.</span>
      </div>
      {error && <LiveErrorNote error={error} onRetry={() => useLiveData.getState().clearError()} />}
    </div>
  );
}

function SampleRecordPanel({
  ext,
  record,
  searchId,
  onPicked,
}: {
  ext: { id: string; objectTypes: string[] };
  record: CrmRecordSummary | null;
  searchId: string;
  onPicked: () => void;
}) {
  const { objectTypes: known } = useObjectTypes();
  const info = useConnection((s) => s.info);
  const error = useLiveData((s) => s.error);
  const types = ext.objectTypes.length ? ext.objectTypes : ['contacts'];
  const initialType = (record && types.find((t) => sameObjectType(t, record.objectTypeId, known) || sameObjectType(t, record.objectType, known))) ?? types[0];
  const [type, setType] = useState(initialType);
  const activeType = types.includes(type) ? type : types[0];
  const selectId = useId();

  const pick = (r: CrmRecordSummary) => {
    useLiveData.getState().setRecord(ext.id, r, info.connected ? info.portalId : undefined);
    onPicked();
  };
  const url = record ? (record.url ?? (info.connected ? recordUrl(info, record.objectTypeId, record.id) : undefined)) : undefined;

  return (
    <div className="ub-cn-picker">
      <div className="ub-cn-picker__head">
        <strong>Sample record</strong>
        <span>The preview shows this record's real data from HubSpot. Nothing in HubSpot is changed.</span>
      </div>

      {error && <LiveErrorNote error={error} onRetry={() => useLiveData.getState().clearError()} />}

      {record ? (
        <div className="ub-cn-selected" aria-label="Picked record">
          <span className="ub-cn-live-dot" aria-hidden />
          <span className="ub-cn-selected__text">
            <span className="ub-cn-selected__label">{displayLabel(record)}</span>
            {record.secondary && <span className="ub-cn-selected__secondary">{record.secondary}</span>}
            <span className="ub-cn-selected__secondary">
              {objectTypeLabel(record.objectType || record.objectTypeId, known, 'singular')} · ID {record.id}
            </span>
          </span>
          {url && (
            <a className="ub-cn-selected__link" href={url} target="_blank" rel="noopener noreferrer" title="Open this record in HubSpot (new tab)">
              Open in HubSpot <ExternalLink size={11} aria-hidden />
            </a>
          )}
          <button
            type="button"
            className="ub-icon-btn ub-icon-btn--sm"
            aria-label="Clear sample record"
            title="Clear sample record"
            onClick={() => useLiveData.getState().setRecord(ext.id, null)}
          >
            <X size={13} aria-hidden />
          </button>
        </div>
      ) : (
        <p className="ub-cn-picker__prompt">Pick a sample record to preview with real data</p>
      )}

      {types.length > 1 && (
        <div className="ub-cn-picker__row">
          <label htmlFor={selectId}>Record type</label>
          <Select
            id={selectId}
            value={activeType}
            onChange={setType}
            options={types.map((t) => ({ value: t, label: objectTypeLabel(t, known) }))}
          />
        </div>
      )}

      <RecordSearch key={activeType} inputId={searchId} objectType={activeType} known={known} selectedId={record?.id ?? null} onPick={pick} />
    </div>
  );
}

const SEARCH_HINT: Record<string, string> = {
  '0-1': 'name or email',
  '0-2': 'name or domain',
};

export interface RecordSearchProps {
  objectType: string;
  onPick: (record: CrmRecordSummary) => void;
  selectedId?: string | null;
  known?: readonly CrmObjectTypeInfo[];
  inputId?: string;
}

/** Search combobox (input + listbox): shows recently changed records, then matches as you type. */
export function RecordSearch({ objectType, onPick, selectedId, known, inputId }: RecordSearchProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<CrmRecordSummary[]>([]);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState<FriendlyError | null>(null);
  const [active, setActive] = useState(-1);
  const [attempt, setAttempt] = useState(0);
  // Enter pressed while the list still shows results for an older query: pick the first match of
  // the new search as soon as it arrives (never a stale row the user did not mean).
  const pendingPick = useRef(false);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const autoId = useId();
  const baseId = inputId ?? `${autoId}-search`;
  const listId = `${baseId}-list`;
  const plural = objectTypeLabel(objectType, known);
  const lowerPlural = plural.toLowerCase();
  const hint = SEARCH_HINT[objectTypeIdOf(objectType, known) ?? ''] ?? 'name or record ID';

  const latestQuery = useRef(query);
  latestQuery.current = query;

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    setError(null);
    getConnectorClient()
      .searchRecords(objectType, debounced, { limit: SEARCH_LIMIT, signal: controller.signal })
      .then(
        (list) => {
          const rows = Array.isArray(list) ? list : [];
          setResults(rows);
          setStatus('ok');
          setActive(rows.length ? 0 : -1);
          if (pendingPick.current && debounced === latestQuery.current.trim()) {
            pendingPick.current = false;
            if (rows.length) onPickRef.current(rows[0]);
          }
        },
        (err: unknown) => {
          if (isAbortError(err) || controller.signal.aborted) return;
          pendingPick.current = false;
          setResults([]);
          setActive(-1);
          setError(describeError(err));
          setStatus('error');
        },
      );
    return () => controller.abort();
  }, [objectType, debounced, attempt]);

  useEffect(() => {
    if (active < 0) return;
    const el = document.getElementById(`${baseId}-opt-${active}`) as (HTMLElement & { scrollIntoView?: (o?: object) => void }) | null;
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active, baseId]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = results.length;
    const searching = status === 'loading' || query.trim() !== debounced;
    if (e.key === 'Enter' && searching) {
      e.preventDefault();
      pendingPick.current = true;
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (n) setActive((i) => (i + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (n) setActive((i) => (i <= 0 ? n - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (active >= 0 && active < n) {
        e.preventDefault();
        onPick(results[active]);
      }
    } else if (e.key === 'Escape' && query) {
      // First Escape clears the search; the next one closes the picker.
      e.preventDefault();
      e.stopPropagation();
      pendingPick.current = false;
      setQuery('');
    }
  };

  const busy = status === 'loading' || query.trim() !== debounced;
  const statusText =
    status === 'error'
      ? (error?.message ?? '')
      : busy
        ? 'Searching…'
        : results.length === 0
          ? debounced
            ? `No ${lowerPlural} match “${debounced}”.`
            : `No ${lowerPlural} in this account yet.`
          : debounced
            ? `${results.length} ${results.length === 1 ? 'match' : 'matches'}`
            : `Recently updated ${lowerPlural}`;

  return (
    <div className="ub-cn-search">
      <label className="ub-cn-picker__label" htmlFor={baseId}>
        Find a {objectTypeLabel(objectType, known, 'singular').toLowerCase()}
      </label>
      <div className="ub-cn-search__field">
        <Search size={13} aria-hidden className="ub-cn-search__icon" />
        <input
          id={baseId}
          className="ub-input ub-cn-search__input"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-activedescendant={active >= 0 && active < results.length ? `${baseId}-opt-${active}` : undefined}
          aria-describedby={`${baseId}-status`}
          autoComplete="off"
          spellCheck={false}
          placeholder={`Search ${lowerPlural} by ${hint}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {busy && <LoaderCircle size={13} aria-hidden className="ub-cn-spin ub-cn-search__busy" />}
      </div>
      <div id={`${baseId}-status`} className={cx('ub-cn-search__status', status === 'error' && 'ub-cn-search__status--error')} role="status" aria-live="polite">
        {status === 'error' && error ? <strong>{error.title}. </strong> : null}
        {statusText}
      </div>
      {status === 'error' && error && error.action !== 'none' && (
        <div className="ub-cn-search__actions">
          {error.action === 'reconnect' ? (
            <Button size="sm" icon={<RefreshCw size={13} aria-hidden />} onClick={() => void useConnection.getState().connect()}>
              Reconnect HubSpot
            </Button>
          ) : (
            <Button size="sm" icon={<RefreshCw size={13} aria-hidden />} onClick={() => setAttempt((a) => a + 1)}>
              Try again
            </Button>
          )}
        </div>
      )}
      <ul id={listId} role="listbox" aria-label={`Matching ${lowerPlural}`} className="ub-cn-search__list">
        {results.map((r, i) => (
          <li
            key={`${r.objectTypeId}:${r.id}`}
            id={`${baseId}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            className={cx('ub-cn-option', i === active && 'ub-cn-option--active', r.id === selectedId && 'ub-cn-option--current')}
            title={`ID ${r.id}`}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(r)}
          >
            <span className="ub-cn-option__label">{r.label || `Record ${r.id}`}</span>
            {r.secondary && <span className="ub-cn-option__secondary">{r.secondary}</span>}
            {r.id === selectedId && <span className="ub-cn-option__current">Current</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LiveErrorNote({ error, onRetry }: { error: LiveDataError; onRetry: () => void }) {
  return (
    <div className="ub-cn-error" role="alert">
      <TriangleAlert size={14} aria-hidden className="ub-cn-error__icon" />
      <div className="ub-cn-error__body">
        <strong>{error.title}</strong>
        <span>{error.message}</span>
        {error.action === 'reconnect' ? (
          <Button size="sm" icon={<RefreshCw size={13} aria-hidden />} onClick={() => void useConnection.getState().connect()}>
            Reconnect HubSpot
          </Button>
        ) : error.action === 'retry' ? (
          <Button
            size="sm"
            icon={<RefreshCw size={13} aria-hidden />}
            onClick={() => {
              onRetry();
              useEditor.getState().resetPreview();
            }}
          >
            Load again
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The data part of the preview banner sentence ("interactions run with mock data" …). */
export function PreviewDataNote() {
  const connected = useConnection((s) => s.status === 'connected' && s.info.connected);
  const ext = useActiveExtensionSummary();
  const loaded = useLiveData((s) => s.projectId === ext.projectId);
  const mode = useLiveData((s) => s.mode);
  const record = useSampleRecord({ id: ext.id, kind: ext.kind, objectTypes: ext.objectTypes });
  if (!connected || !loaded || mode !== 'live') return <>interactions run with mock data</>;
  if (ext.kind === 'card' && !record) return <>pick a sample record to use real data (mock data for now)</>;
  return <>showing real HubSpot data (read-only)</>;
}
