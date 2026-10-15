/** Mock data used by the designer preview: record properties, context, data source and function results. */
import { useId, useState } from 'react';
import { FlaskConical, Plus, RotateCcw, WandSparkles, X } from 'lucide-react';
import { useEditor } from '../../model/store';
import type { Extension } from '../../model/types';
import { CRM_OBJECT_TYPES } from '../../registry/constants';
import { Badge, Button, Field, IconButton, NumberField, Section, Select, TextInput } from '../../ui';
import { CommitInput, JsonEditor } from '../common';
import { addMissingMockProperties, missingMockProperties, sampleMockForSource } from '../actions';
import { kindInfo } from '../dataSourceMeta';

export function MockSection({ ext }: { ext: Extension }) {
  return (
    <Section
      defaultOpen={false}
      title={
        <span className="ub-pn-section-title">
          <FlaskConical size={13} aria-hidden /> Mock data
        </span>
      }
    >
      <div className="ub-pn-muted">Mock data is only used by the designer preview — it is never exported.</div>
      {ext.kind === 'card' && <RecordProperties ext={ext} />}
      <ContextEditor ext={ext} />
      <DataSourceMocks ext={ext} />
      <FunctionMocks ext={ext} />
    </Section>
  );
}

function RecordProperties({ ext }: { ext: Extension }) {
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const props = ext.mock.properties;
  const keys = Object.keys(props);
  const missing = missingMockProperties(ext);
  const updateMock = useEditor.getState().updateMock;

  const addRow = () => {
    const k = newKey.trim();
    if (!k || props[k] !== undefined) return;
    updateMock((m) => {
      m.properties[k] = newValue;
    });
    setNewKey('');
    setNewValue('');
  };

  const renameKey = (from: string, to: string) =>
    updateMock((m) => {
      const entries = Object.entries(m.properties).map(([k, v]) => [k === from ? to : k, v] as const);
      m.properties = Object.fromEntries(entries);
    });

  return (
    <div className="ub-pn-block">
      <div className="ub-pn-subhead">
        <span>Current record properties</span>
        {missing.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus size={12} aria-hidden />}
            title={`Add sample values for: ${missing.join(', ')}`}
            onClick={() => addMissingMockProperties()}
          >
            Add missing ({missing.length})
          </Button>
        )}
      </div>
      <div className="ub-pn-kv" role="table" aria-label="Mock record properties">
        {keys.map((k) => (
          <div key={k} className="ub-pn-kv__row" role="row">
            <span role="cell">
              <CommitInput
                code
                value={k}
                aria-label={`Property name ${k}`}
                hideError
                validate={(v) => (!/^[A-Za-z0-9_]+$/.test(v) ? 'Invalid name' : props[v] !== undefined ? 'Already exists' : null)}
                onCommit={(v) => renameKey(k, v)}
              />
            </span>
            <span role="cell">
              <TextInput
                value={props[k] ?? ''}
                aria-label={`Value of ${k}`}
                onChange={(v) =>
                  updateMock((m) => {
                    m.properties[k] = v;
                  })
                }
              />
            </span>
            <span role="cell">
              <IconButton
                label={`Remove ${k}`}
                size="sm"
                onClick={() =>
                  updateMock((m) => {
                    delete m.properties[k];
                  })
                }
              >
                <X size={13} aria-hidden />
              </IconButton>
            </span>
          </div>
        ))}
        <div className="ub-pn-kv__row" role="row">
          <span role="cell">
            <TextInput
              code
              value={newKey}
              placeholder="property"
              aria-label="New property name"
              invalid={!!newKey.trim() && (props[newKey.trim()] !== undefined || !/^[A-Za-z0-9_]+$/.test(newKey.trim()))}
              onChange={setNewKey}
              onKeyDown={(e) => e.key === 'Enter' && addRow()}
            />
          </span>
          <span role="cell">
            <TextInput
              value={newValue}
              placeholder="value"
              aria-label="New property value"
              onChange={setNewValue}
              onKeyDown={(e) => e.key === 'Enter' && addRow()}
            />
          </span>
          <span role="cell">
            <IconButton
              label="Add property"
              size="sm"
              disabled={!newKey.trim() || props[newKey.trim()] !== undefined || !/^[A-Za-z0-9_]+$/.test(newKey.trim())}
              onClick={addRow}
            >
              <Plus size={13} aria-hidden />
            </IconButton>
          </span>
        </div>
      </div>
    </div>
  );
}

function ContextEditor({ ext }: { ext: Extension }) {
  const ids = {
    first: useId(),
    last: useId(),
    email: useId(),
    userId: useId(),
    portal: useId(),
    tz: useId(),
    objectId: useId(),
    typeId: useId(),
  };
  const ctx = ext.mock.context;
  const updateMock = useEditor.getState().updateMock;
  const typeKnown = CRM_OBJECT_TYPES.some((t) => t.typeId === ctx.crm.objectTypeId);
  return (
    <div className="ub-pn-block">
      <div className="ub-pn-subhead">
        <span>Context</span>
      </div>
      <div className="ub-pn-grid2">
        <Field label="User first name" htmlFor={ids.first}>
          <TextInput id={ids.first} value={ctx.user.firstName} onChange={(v) => updateMock((m) => void (m.context.user.firstName = v))} />
        </Field>
        <Field label="User last name" htmlFor={ids.last}>
          <TextInput id={ids.last} value={ctx.user.lastName} onChange={(v) => updateMock((m) => void (m.context.user.lastName = v))} />
        </Field>
        <Field label="User email" htmlFor={ids.email}>
          <TextInput id={ids.email} value={ctx.user.email} onChange={(v) => updateMock((m) => void (m.context.user.email = v))} />
        </Field>
        <Field label="User ID" htmlFor={ids.userId}>
          <NumberField id={ids.userId} value={ctx.user.id} onChange={(v) => v !== undefined && updateMock((m) => void (m.context.user.id = v))} />
        </Field>
        <Field label="Portal ID" htmlFor={ids.portal}>
          <NumberField id={ids.portal} value={ctx.portal.id} onChange={(v) => v !== undefined && updateMock((m) => void (m.context.portal.id = v))} />
        </Field>
        <Field label="Portal time zone" htmlFor={ids.tz}>
          <TextInput
            id={ids.tz}
            value={ctx.portal.timezone}
            placeholder="America/New_York"
            onChange={(v) => updateMock((m) => void (m.context.portal.timezone = v))}
          />
        </Field>
        {ext.kind === 'card' && (
          <>
            <Field label="Record ID" htmlFor={ids.objectId}>
              <NumberField
                id={ids.objectId}
                value={ctx.crm.objectId}
                onChange={(v) => v !== undefined && updateMock((m) => void (m.context.crm.objectId = v))}
              />
            </Field>
            <Field label="Record type" htmlFor={ids.typeId}>
              <Select
                id={ids.typeId}
                value={ctx.crm.objectTypeId}
                options={[
                  ...CRM_OBJECT_TYPES.map((t) => ({ value: t.typeId, label: `${t.label} (${t.typeId})` })),
                  ...(typeKnown ? [] : [{ value: ctx.crm.objectTypeId, label: ctx.crm.objectTypeId || 'Custom' }]),
                ]}
                onChange={(v) => updateMock((m) => void (m.context.crm.objectTypeId = v))}
              />
            </Field>
          </>
        )}
      </div>
    </div>
  );
}

function DataSourceMocks({ ext }: { ext: Extension }) {
  const sources = ext.dataSources.filter((d) => d.kind !== 'crmProperties');
  if (ext.dataSources.length === 0) return null;
  const updateMock = useEditor.getState().updateMock;
  return (
    <div className="ub-pn-block">
      <div className="ub-pn-subhead">
        <span>Data source results</span>
      </div>
      {ext.dataSources.some((d) => d.kind === 'crmProperties') && (
        <div className="ub-pn-muted">Current record properties sources read the record properties above.</div>
      )}
      {sources.map((ds) => {
        const configured = ext.mock.dataSources[ds.id];
        const Icon = kindInfo(ds.kind).icon;
        const generates = ds.kind === 'associations' || ds.kind === 'crmSearch';
        return (
          <div key={ds.id} className="ub-pn-mock">
            <div className="ub-pn-mock__head">
              <Icon size={13} aria-hidden />
              <span className="ub-pn-item__name">{ds.name}</span>
              {configured !== undefined ? (
                <Badge tone="select">Custom</Badge>
              ) : (
                <Badge>
                  {generates
                    ? 'Generated rows'
                    : ds.kind === 'function' && ext.mock.functions[ds.functionId] !== undefined
                      ? 'Function mock'
                      : 'null'}
                </Badge>
              )}
              <span className="ub-pn-spacer" />
              <IconButton
                label={`Generate sample for ${ds.name}`}
                size="sm"
                onClick={() => {
                  const sample = sampleMockForSource(ext, ds);
                  updateMock((m) => {
                    m.dataSources[ds.id] = sample;
                  });
                }}
              >
                <WandSparkles size={13} aria-hidden />
              </IconButton>
              <IconButton
                label={`Clear mock for ${ds.name} (use generated)`}
                size="sm"
                disabled={configured === undefined}
                onClick={() =>
                  updateMock((m) => {
                    delete m.dataSources[ds.id];
                  })
                }
              >
                <RotateCcw size={13} aria-hidden />
              </IconButton>
            </div>
            <JsonEditor
              aria-label={`Mock result for ${ds.name}`}
              value={configured}
              rows={3}
              placeholder={
                generates
                  ? 'Using generated sample rows — “Generate sample” copies them here to edit.'
                  : ds.kind === 'function' && ext.mock.functions[ds.functionId] !== undefined
                    ? 'Using the function’s mock result below.'
                    : 'No mock yet — the value is null in the preview.'
              }
              onChange={(v) =>
                updateMock((m) => {
                  m.dataSources[ds.id] = v;
                })
              }
              onClear={() =>
                updateMock((m) => {
                  delete m.dataSources[ds.id];
                })
              }
            />
          </div>
        );
      })}
    </div>
  );
}

function FunctionMocks({ ext }: { ext: Extension }) {
  const functions = useEditor((s) => s.project.functions);
  if (functions.length === 0) return null;
  const updateMock = useEditor.getState().updateMock;
  return (
    <div className="ub-pn-block">
      <div className="ub-pn-subhead">
        <span>Function results</span>
      </div>
      <div className="ub-pn-muted">Returned by “Run function” actions in the preview (default: {'{ "ok": true }'}).</div>
      {functions.map((fn) => {
        const configured = ext.mock.functions[fn.id];
        return (
          <div key={fn.id} className="ub-pn-mock">
            <div className="ub-pn-mock__head">
              <span className="ub-pn-item__name">{fn.uid}</span>
              <span className="ub-pn-spacer" />
              <IconButton
                label={`Clear mock result for ${fn.uid}`}
                size="sm"
                disabled={configured === undefined}
                onClick={() =>
                  updateMock((m) => {
                    delete m.functions[fn.id];
                  })
                }
              >
                <RotateCcw size={13} aria-hidden />
              </IconButton>
            </div>
            <JsonEditor
              aria-label={`Mock result for function ${fn.uid}`}
              value={configured}
              rows={2}
              placeholder='{ "ok": true }'
              onChange={(v) =>
                updateMock((m) => {
                  m.functions[fn.id] = v;
                })
              }
              onClear={() =>
                updateMock((m) => {
                  delete m.functions[fn.id];
                })
              }
            />
          </div>
        );
      })}
    </div>
  );
}
