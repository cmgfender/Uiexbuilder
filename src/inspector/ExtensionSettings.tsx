/**
 * Shown when nothing is selected: settings of the active extension (name, placement, object
 * types, uid, file name) and a summary with shortcuts to the Data panel and project dialogs.
 */
import { useEffect, useMemo, useState } from 'react';
import { Home, LayoutPanelLeft, MousePointerClick, Plus, Settings, X } from 'lucide-react';
import { useEditor } from '../model/store';
import { ROOT_TYPE, type CardLocation, type Extension, type Project } from '../model/types';
import { CRM_OBJECT_TYPES } from '../registry/constants';
import { useDialogs } from '../shell/dialogs';
import { extensionFileNameError, projectUidError } from '../panels/utils';
import { showLeftTab } from '../shell/shellStore';
import { Badge, Button, Select, TextArea, TextInput } from '../ui';
import { InspectorSection } from './Section';

export const LOCATION_INFO: Record<CardLocation, { label: string; help: string }> = {
  'crm.record.tab': { label: 'Record tab', help: 'A card in the middle column of CRM record pages.' },
  'crm.record.sidebar': {
    label: 'Record sidebar',
    help: 'A card in the right sidebar of record pages. Only CRM action components are available there.',
  },
  'crm.preview': { label: 'Preview panel', help: 'Shown in the record preview panel opened from lists, boards and associations.' },
  'helpdesk.sidebar': { label: 'Help desk sidebar', help: 'Shown next to tickets in the help desk workspace.' },
};

const KIND_INFO: Record<Extension['kind'], { label: string; help: string; icon: typeof Home }> = {
  card: { label: 'App card', help: '', icon: LayoutPanelLeft },
  settings: { label: 'Settings page', help: 'Rendered on your app’s settings page in HubSpot.', icon: Settings },
  home: { label: 'App home', help: 'Your app’s home page, opened from the HubSpot apps menu.', icon: Home },
};

const CUSTOM_OBJECT_RE = /^(p_[a-z0-9_]+|2-\d+)$/i;

/** The project-wide uid rule (shared with the Extensions / Functions / App settings dialogs and validation). */
export function uidError(uid: string, ext: Extension, project: Project): string | null {
  if (!uid) return 'Required.';
  return projectUidError(project, uid, { kind: 'extension', id: ext.id });
}

/** PascalCase and unique among the extensions, ignoring case (as validateProject checks). */
export function fileNameError(name: string, ext: Extension, project: Project): string | null {
  if (!name) return 'Required.';
  return extensionFileNameError(project, name, ext.id);
}

/** Text field that keeps an invalid draft locally and only stores valid values. */
function ValidatedField({
  label,
  value,
  validate,
  onCommit,
  hint,
  code,
}: {
  label: string;
  value: string;
  validate: (v: string) => string | null;
  onCommit: (v: string) => void;
  hint?: string;
  code?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const error = validate(draft);
  const id = `ext-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="ub-insp-field">
      <div className="ub-insp-field__label">
        <label htmlFor={id}>{label}</label>
      </div>
      <TextInput
        id={id}
        code={code}
        value={draft}
        invalid={!!error}
        onChange={(v) => {
          setDraft(v);
          if (!validate(v)) onCommit(v);
        }}
        onBlur={() => setDraft(value)}
      />
      {error ? <div className="ub-field__error">{error}</div> : hint ? <div className="ub-field__hint">{hint}</div> : null}
    </div>
  );
}

function ObjectTypesEditor({ ext }: { ext: Extension }) {
  const updateExtension = useEditor((s) => s.updateExtension);
  const [custom, setCustom] = useState('');
  const types = ext.objectTypes;
  const labelOf = (v: string) => CRM_OBJECT_TYPES.find((t) => t.value === v)?.label ?? v;
  const set = (next: string[]) => updateExtension(ext.id, { objectTypes: next });
  const customError =
    custom && !CUSTOM_OBJECT_RE.test(custom)
      ? 'Custom objects use their p_ name (e.g. p_my_object) or a 2-… type id.'
      : custom && types.includes(custom)
        ? 'Already added.'
        : null;
  const addCustom = () => {
    if (!custom || customError) return;
    set([...types, custom]);
    setCustom('');
  };
  return (
    <div className="ub-insp-field">
      <div className="ub-insp-field__label">
        <label>Object types</label>
      </div>
      <div className="ub-insp-chips">
        {types.map((t) => (
          <span key={t} className="ub-insp-chip">
            <span className="ub-insp-chip__text" title={t}>
              {labelOf(t)}
            </span>
            <button
              type="button"
              className="ub-insp-chip__x"
              aria-label={`Remove ${labelOf(t)}`}
              title={`Remove ${labelOf(t)}`}
              onClick={() => set(types.filter((x) => x !== t))}
            >
              <X size={11} />
            </button>
          </span>
        ))}
        {types.length === 0 && <span className="ub-insp-muted">None — the card won’t appear anywhere.</span>}
      </div>
      <Select
        value=""
        aria-label="Add object type"
        placeholder="Add a standard object…"
        options={CRM_OBJECT_TYPES.filter((t) => !types.includes(t.value)).map((t) => ({ value: t.value, label: t.label }))}
        onChange={(v) => v && set([...types, v])}
      />
      <div className="ub-insp-inline">
        <TextInput
          code
          value={custom}
          onChange={(v) => setCustom(v.trim())}
          placeholder="p_my_object"
          aria-label="Custom object type"
          invalid={!!customError}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
        />
        <Button size="sm" icon={<Plus size={13} />} disabled={!custom || !!customError} onClick={addCustom}>
          Add
        </Button>
      </div>
      {customError ? (
        <div className="ub-field__error">{customError}</div>
      ) : (
        <div className="ub-field__hint">The record pages this card appears on.</div>
      )}
    </div>
  );
}

export function ExtensionSettings({ ext, project }: { ext: Extension; project: Project }) {
  const updateExtension = useEditor((s) => s.updateExtension);
  const kind = KIND_INFO[ext.kind];
  const KindIcon = kind.icon;
  const componentCount = useMemo(() => Object.values(ext.nodes).filter((n) => n.type !== ROOT_TYPE).length, [ext.nodes]);
  const loc = LOCATION_INFO[ext.location] ?? LOCATION_INFO['crm.record.tab'];

  return (
    <div className="ub-insp ub-insp--ext">
      <div className="ub-insp-head">
        <div className="ub-insp-head__row">
          <span className="ub-insp-head__icon is-ext" aria-hidden>
            <KindIcon size={16} />
          </span>
          <div className="ub-insp-head__titles">
            <div className="ub-insp-head__title">
              <span className="ub-insp-head__label">{ext.name || 'Untitled extension'}</span>
              <Badge tone="accent">{kind.label}</Badge>
            </div>
            <div className="ub-insp-muted ub-insp-head__sub">
              <MousePointerClick size={12} aria-hidden /> Select a component to edit its properties.
            </div>
          </div>
        </div>
      </div>
      <div className="ub-insp-body ub-scroll">
        <InspectorSection id="ext:general" title="Extension">
          <div className="ub-insp-field">
            <div className="ub-insp-field__label">
              <label htmlFor="ext-name">Name</label>
            </div>
            <TextInput
              id="ext-name"
              value={ext.name}
              onChange={(name) => updateExtension(ext.id, { name })}
              placeholder="Shown as the card title in HubSpot"
            />
          </div>
          <div className="ub-insp-field">
            <div className="ub-insp-field__label">
              <label htmlFor="ext-desc">Description</label>
            </div>
            <TextArea
              id="ext-desc"
              rows={2}
              value={ext.description ?? ''}
              onChange={(description) => updateExtension(ext.id, { description })}
              placeholder="What this extension does (optional)"
            />
          </div>
          {ext.kind === 'card' ? (
            <div className="ub-insp-field">
              <div className="ub-insp-field__label">
                <label htmlFor="ext-location">Location</label>
              </div>
              <Select
                id="ext-location"
                value={ext.location}
                onChange={(v) => updateExtension(ext.id, { location: v as CardLocation })}
                options={(Object.keys(LOCATION_INFO) as CardLocation[]).map((l) => ({ value: l, label: LOCATION_INFO[l].label }))}
              />
              <div className="ub-field__hint">{loc.help}</div>
            </div>
          ) : (
            <div className="ub-insp-help">{kind.help}</div>
          )}
          {ext.kind === 'card' && <ObjectTypesEditor ext={ext} />}
        </InspectorSection>
        <InspectorSection id="ext:files" title="Project files">
          <ValidatedField
            label="uid"
            code
            value={ext.uid}
            validate={(v) => uidError(v, ext, project)}
            onCommit={(uid) => updateExtension(ext.id, { uid })}
            hint="Identifies the extension in the HubSpot project (hsmeta uid)."
          />
          <ValidatedField
            label="Component file name"
            code
            value={ext.fileName}
            validate={(v) => fileNameError(v, ext, project)}
            onCommit={(fileName) => updateExtension(ext.id, { fileName })}
            hint={`Generated as ${ext.fileName}.tsx`}
          />
        </InspectorSection>
        <InspectorSection id="ext:summary" title="Summary">
          <dl className="ub-insp-summarylist">
            <div>
              <dt>Components</dt>
              <dd>{componentCount}</dd>
            </div>
            <div>
              <dt title="State variables">State</dt>
              <dd>{ext.state.length}</dd>
            </div>
            <div>
              <dt title="Data sources">Data</dt>
              <dd>{ext.dataSources.length}</dd>
            </div>
            {(ext.computed?.length ?? 0) > 0 && (
              <div>
                <dt title="Computed values">Computed</dt>
                <dd>{ext.computed!.length}</dd>
              </div>
            )}
          </dl>
          <div className="ub-insp-linkgrid">
            <Button size="sm" onClick={() => showLeftTab('data')} title="Edit state, data sources and mock data">
              Data panel
            </Button>
            <Button size="sm" onClick={() => useDialogs.getState().open('appSettings')} title="App name, scopes, permitted URLs…">
              App settings
            </Button>
            <Button
              size="sm"
              onClick={() => useDialogs.getState().open('extensionSettings', ext.id)}
              title="Add or manage cards, settings page and app home"
            >
              Extensions
            </Button>
          </div>
        </InspectorSection>
      </div>
    </div>
  );
}
