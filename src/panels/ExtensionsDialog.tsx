/** Manage the project's extensions: cards, the settings page and the app home page. */
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CopyPlus, House, LayoutPanelTop, Pencil, Settings, Trash2 } from 'lucide-react';
import { useEditor } from '../model/store';
import type { CardLocation, Extension, ExtensionKind } from '../model/types';
import { CRM_OBJECT_TYPES } from '../registry/constants';
import { Badge, Button, Dialog, IconButton, Select, useToast } from '../ui';
import { ChipInput, CommitInput } from './common';
import type { DialogComponentProps } from './dialogTypes';
import { EXTENSION_KIND_LABEL, ExtensionIcon } from './icons';
import { CARD_LOCATIONS } from './locations';
import { extensionFileNameError, projectUidError } from './utils';


const OBJECT_TYPE_SUGGESTIONS = CRM_OBJECT_TYPES.map((t) => ({ value: t.value, detail: t.label }));

function validateObjectType(v: string): string | null {
  return /^[A-Za-z0-9_-]+$/.test(v) ? null : 'Use an object type name (contacts) or custom object (p_my_object)';
}

export function ExtensionsDialog({ open, onClose, arg }: DialogComponentProps) {
  const extensions = useEditor((s) => s.project.extensions);
  const activeId = useEditor((s) => s.activeExtensionId);
  const toast = useToast();
  if (!open) return null;
  const hasSettings = extensions.some((e) => e.kind === 'settings');
  const hasHome = extensions.some((e) => e.kind === 'home');

  const add = (kind: ExtensionKind) => {
    useEditor.getState().addExtension({ kind });
    const added = useEditor.getState().project.extensions.at(-1);
    if (added) toast(`Added “${added.name}”`);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Cards and pages"
      wide
      footer={
        <>
          <span className="ub-pn-footnote">A project can have many cards, one settings page and one app home page.</span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="ub-pn-row ub-pn-ext-add">
        <Button icon={<LayoutPanelTop size={14} aria-hidden />} onClick={() => add('card')}>
          Add card
        </Button>
        <Button
          icon={<Settings size={14} aria-hidden />}
          disabled={hasSettings}
          title={hasSettings ? 'This project already has a settings page' : 'Add a settings page'}
          onClick={() => add('settings')}
        >
          Add settings page
        </Button>
        <Button
          icon={<House size={14} aria-hidden />}
          disabled={hasHome}
          title={hasHome ? 'This project already has an app home page' : 'Add an app home page'}
          onClick={() => add('home')}
        >
          Add app home page
        </Button>
      </div>
      <div className="ub-pn-table-wrap">
        <table className="ub-pn-table" aria-label="Cards and pages">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Appears in</th>
              <th scope="col">Object types</th>
              <th scope="col">File</th>
              <th scope="col">UID</th>
              <th scope="col">
                <span className="ub-pn-sr">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {extensions.map((ext) => (
              <ExtensionRow
                key={ext.id}
                ext={ext}
                all={extensions}
                active={ext.id === activeId}
                highlight={ext.id === arg}
                onOpen={() => {
                  useEditor.getState().setActiveExtension(ext.id);
                  onClose();
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Dialog>
  );
}

function ExtensionRow({
  ext,
  all,
  active,
  highlight,
  onOpen,
}: {
  ext: Extension;
  all: Extension[];
  active: boolean;
  /** Opened for this extension (e.g. from a problem): scroll to it, flash it and focus its name. */
  highlight?: boolean;
  onOpen: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (!highlight) return;
    // After the dialog has focused itself.
    const t = setTimeout(() => {
      rowRef.current?.scrollIntoView?.({ block: 'nearest' });
      nameRef.current?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [highlight]);
  const toast = useToast();
  const update = (patch: Partial<Extension>) => useEditor.getState().updateExtension(ext.id, patch);
  const last = all.length <= 1;
  const nodeCount = Object.keys(ext.nodes).length - 1;

  if (confirming) {
    return (
      <tr className="ub-pn-table__confirm">
        <td colSpan={6}>
          <div className="ub-pn-row ub-pn-row--between">
            <span>
              Delete <strong>{ext.name}</strong>? Its {nodeCount} component{nodeCount === 1 ? '' : 's'}, state and data sources are removed
              (you can undo).
            </span>
            <span className="ub-pn-row">
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  useEditor.getState().removeExtension(ext.id);
                  toast(`Deleted “${ext.name}”`);
                }}
              >
                Delete extension
              </Button>
            </span>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr ref={rowRef} className={[active && 'ub-pn-table__active', highlight && 'ub-pn-table__flash'].filter(Boolean).join(' ') || undefined}>
      <td>
        <div className="ub-pn-ext-name">
          <ExtensionIcon kind={ext.kind} size={14} className="ub-pn-ext-name__icon" />
          <CommitInput
            inputRef={nameRef}
            value={ext.name}
            aria-label={`Name of ${ext.name}`}
            validate={(v) => (v.trim() ? null : 'Name is required')}
            onCommit={(name) => update({ name: name.trim() })}
          />
          {active && <Badge tone="select">Editing</Badge>}
        </div>
      </td>
      <td>
        {ext.kind === 'card' ? (
          <Select
            aria-label={`Location of ${ext.name}`}
            value={ext.location}
            options={CARD_LOCATIONS.map((l) => ({ value: l.value, label: l.label }))}
            title={CARD_LOCATIONS.find((l) => l.value === ext.location)?.hint}
            onChange={(v) => update({ location: v as CardLocation })}
          />
        ) : (
          <span className="ub-pn-muted">{EXTENSION_KIND_LABEL[ext.kind]}</span>
        )}
      </td>
      <td>
        {ext.kind === 'card' ? (
          <ChipInput
            aria-label={`Object types of ${ext.name}`}
            values={ext.objectTypes}
            suggestions={OBJECT_TYPE_SUGGESTIONS}
            validate={validateObjectType}
            placeholder="contacts"
            onChange={(objectTypes) => update({ objectTypes })}
          />
        ) : (
          <span className="ub-pn-muted">—</span>
        )}
      </td>
      <td>
        <CommitInput
          code
          value={ext.fileName}
          suffix=".tsx"
          aria-label={`File name of ${ext.name}`}
          validate={(v) => extensionFileNameError(useEditor.getState().project, v, ext.id)}
          onCommit={(fileName) => update({ fileName })}
        />
      </td>
      <td>
        <CommitInput
          code
          value={ext.uid}
          aria-label={`UID of ${ext.name}`}
          validate={(v) => projectUidError(useEditor.getState().project, v, { kind: 'extension', id: ext.id })}
          onCommit={(uid) => update({ uid })}
        />
      </td>
      <td>
        <div className="ub-pn-row ub-pn-row--nowrap">
          <IconButton label={`Open ${ext.name} in the editor`} size="sm" onClick={onOpen}>
            <ArrowUpRight size={14} aria-hidden />
          </IconButton>
          <IconButton
            label={`Rename ${ext.name}`}
            size="sm"
            onClick={() => {
              nameRef.current?.focus();
              nameRef.current?.select();
            }}
          >
            <Pencil size={13} aria-hidden />
          </IconButton>
          <IconButton
            label={ext.kind === 'card' ? `Duplicate ${ext.name}` : `Only one ${EXTENSION_KIND_LABEL[ext.kind].toLowerCase()} is allowed`}
            size="sm"
            disabled={ext.kind !== 'card'}
            onClick={() => {
              const id = useEditor.getState().duplicateExtension(ext.id);
              if (id) toast(`Duplicated “${ext.name}”`);
            }}
          >
            <CopyPlus size={13} aria-hidden />
          </IconButton>
          <IconButton
            label={last ? 'A project needs at least one card or page' : `Delete ${ext.name}`}
            size="sm"
            disabled={last}
            onClick={() => setConfirming(true)}
          >
            <Trash2 size={13} aria-hidden />
          </IconButton>
        </div>
      </td>
    </tr>
  );
}

