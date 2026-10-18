/** Data sources of the active extension: list, "+ Add data" menu, editors and UI generation. */
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Database, ListFilter, Plus, WandSparkles } from 'lucide-react';
import { useEditor } from '../../model/store';
import type { DataSource, DataSourceKind, Extension } from '../../model/types';
import { Button, Field, IconButton, Menu, Section, cx, useMenu, useToast } from '../../ui';
import { CommitInput, Snippet } from '../common';
import { addDataSourceOfKind, insertGeneratedUi, renameDataSource } from '../actions';
import { DATA_SOURCE_KINDS, isCrmRecordExtension, kindInfo, summarizeDataSource, usageExample } from '../dataSourceMeta';
import { validateDeclaredName } from '../names';
import { DataSourceEditor } from './DataSourceEditors';
import { DeleteGuard } from './DeleteGuard';
import { consumeDataReveal, useDataReveal } from '../reveal';
import { addShapedList } from '../../power/actions';
import { parseShape } from '../../power/shape';
import { usePowerUi } from '../../power/uiStore';

/**
 * "Filter & sort" on a list data source: opens the shaped list (Computed) that already starts from
 * it, or adds one (`dealsView`).
 */
function shapeDataSource(ext: Extension, ds: DataSource): { name: string; created: boolean } {
  const existing = (ext.computed ?? []).find((c) => parseShape(c.expr)?.source === ds.name);
  const c = existing ?? addShapedList(ds.name);
  usePowerUi.getState().revealComputed(c.id);
  return { name: c.name, created: !existing };
}

const LIST_KINDS = new Set<DataSource['kind']>(['associations', 'crmSearch', 'fetch', 'function']);

export function DataSourcesSection({ ext }: { ext: Extension }) {
  const functions = useEditor((s) => s.project.functions);
  const [openId, setOpenId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  // Problems panel → "show me": expand the item.
  const revealTarget = useDataReveal((s) => s.target);
  useEffect(() => {
    if (revealTarget) consumeDataReveal('dataSource', ext.dataSources.map((x) => x.id), setOpenId);
  }, [revealTarget, ext.dataSources]);
  const menu = useMenu();
  const crm = isCrmRecordExtension(ext);

  const add = (kind: DataSourceKind) => {
    const ds = addDataSourceOfKind(kind);
    setOpenId(ds.id);
    setFocusId(ds.id);
  };

  const items = DATA_SOURCE_KINDS.map((k) => {
    const Icon = k.icon;
    const disabled = k.crmOnly && !crm;
    return {
      label: (
        <span className="ub-pn-menu-item">
          <span className="ub-pn-menu-item__title">{k.label}</span>
          <span className="ub-pn-menu-item__desc">{disabled ? 'Only available on CRM record cards' : k.description}</span>
        </span>
      ),
      icon: <Icon size={15} aria-hidden className="ub-pn-menu-item__icon" />,
      disabled,
      onSelect: () => add(k.kind),
    };
  });

  return (
    <Section
      title={
        <span className="ub-pn-section-title">
          Data sources <span className="ub-pn-count">{ext.dataSources.length}</span>
        </span>
      }
      actions={
        <IconButton label="Add data source" size="sm" aria-haspopup="menu" onClick={(e) => menu.openAt(e.currentTarget)}>
          <Plus size={14} aria-hidden />
        </IconButton>
      }
    >
      {ext.dataSources.length === 0 ? (
        <div className="ub-pn-empty">
          <Database size={18} aria-hidden />
          <div>
            <div className="ub-pn-strong">Connect data</div>
            <div className="ub-pn-muted">
              Load properties of the current record, associated records, CRM search results, an external API or an app function.
            </div>
          </div>
        </div>
      ) : (
        <div className="ub-pn-items" role="list" aria-label="Data sources">
          {ext.dataSources.map((ds) => (
            <DataSourceRow
              key={ds.id}
              ext={ext}
              ds={ds}
              summary={summarizeDataSource(ds, functions)}
              open={openId === ds.id}
              autoFocus={focusId === ds.id}
              onToggle={() => {
                setOpenId(openId === ds.id ? null : ds.id);
                setFocusId(null);
              }}
            />
          ))}
        </div>
      )}
      <div>
        <Button size="sm" icon={<Plus size={13} aria-hidden />} aria-haspopup="menu" onClick={(e) => menu.openAt(e.currentTarget)}>
          Add data
        </Button>
      </div>
      {menu.position && <Menu x={menu.position.x} y={menu.position.y} items={items} onClose={menu.close} />}
    </Section>
  );
}

function DataSourceRow({
  ext,
  ds,
  summary,
  open,
  autoFocus,
  onToggle,
}: {
  ext: Extension;
  ds: DataSource;
  summary: string;
  open: boolean;
  autoFocus: boolean;
  onToggle: () => void;
}) {
  const toast = useToast();
  const info = kindInfo(ds.kind);
  const Icon = info.icon;
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open && autoFocus) {
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [open, autoFocus]);
  const example = usageExample(ds);

  return (
    <div className={cx('ub-pn-item', open && 'ub-pn-item--open')} role="listitem" data-pn-item={ds.id}>
      <button type="button" className="ub-pn-item__head ub-pn-item__head--2l" aria-expanded={open} onClick={onToggle}>
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
        <span className="ub-pn-kind" title={info.label}>
          <Icon size={13} aria-hidden />
        </span>
        <span className="ub-pn-item__text">
          <span className="ub-pn-item__name">{ds.name}</span>
          <span className="ub-pn-item__summary">{summary}</span>
        </span>
      </button>
      {open && (
        <div className="ub-pn-item__body">
          <div className="ub-pn-kind-line">
            <Icon size={13} aria-hidden /> {info.label}
          </div>
          <Field label="Name">
            <CommitInput
              code
              inputRef={nameRef}
              value={ds.name}
              aria-label="Data source name"
              validate={(name) => validateDeclaredName(ext, name, { kind: 'dataSource', id: ds.id, dsKind: ds.kind })}
              onCommit={(name) => {
                const n = renameDataSource(ds.id, name);
                if (n > 0) toast(`Renamed “${ds.name}” to “${name}” and updated ${n} reference${n === 1 ? '' : 's'}`);
              }}
            />
          </Field>
          <DataSourceEditor ext={ext} ds={ds} />
          <div className="ub-pn-hint">
            Use <Snippet code={example.template} /> in text, or <Snippet code={example.expression} /> in expressions.{' '}
            <Snippet code={`${ds.name}Loading`} /> is true while loading; <Snippet code={`${ds.name}Error`} /> holds an error message.
          </div>
          <div className="ub-pn-row ub-pn-row--between">
            <Button
              size="sm"
              variant="primary"
              icon={<WandSparkles size={13} aria-hidden />}
              title="Insert components that display this data (into the selected container or at the end of the card)"
              onClick={() => {
                const id = insertGeneratedUi(ds.id);
                toast(id ? `Added UI for “${ds.name}”` : 'Could not find a place to insert the UI — select a container first');
              }}
            >
              Generate UI
            </Button>
            {LIST_KINDS.has(ds.kind) && (
              <Button
                size="sm"
                icon={<ListFilter size={13} aria-hidden />}
                title="Filter, sort, limit and format the rows without code (adds a computed list you can repeat over)"
                onClick={() => {
                  const r = shapeDataSource(ext, ds);
                  toast(r.created ? `Added “${r.name}” under Computed — choose filters, sorting and formats there` : `Opened “${r.name}” under Computed`);
                }}
              >
                Filter & sort
              </Button>
            )}
            <DeleteGuard ext={ext} name={ds.name} noun="source" onDelete={() => useEditor.getState().removeDataSource(ds.id)} />
          </div>
        </div>
      )}
    </div>
  );
}
