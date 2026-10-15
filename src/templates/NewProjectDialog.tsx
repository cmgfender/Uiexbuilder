/**
 * New project dialog: app name + starter gallery (Blank card first). Creates a project with the
 * chosen starter (and any app functions it needs) and opens it. The current project stays saved in
 * this browser. Also offers importing a builder document (.uiex.json).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { FileUp, Plus, TriangleAlert } from 'lucide-react';
import { toProjectSlug } from '../model/factory';
import { toUid } from '../model/ids';
import { parseProjectJson, saveProject } from '../model/persistence';
import { useEditor } from '../model/store';
import type { DialogComponentProps } from '../panels/dialogs';
import { CRM_OBJECT_TYPES } from '../registry/constants';
import { Badge, Button, Dialog, Field, TextInput, cx, useToast } from '../ui';
import { projectFromTemplate } from './actions';
import { PROJECT_TEMPLATES, templateLocationLabel, type ExtensionTemplate } from './catalog';
import { extensionTemplates, Wireframe } from './Wireframe';
import './templates.css';

const BLANK_ID = 'blank-card';
const OBJECT_LABELS = new Map(CRM_OBJECT_TYPES.map((t) => [t.value, t.label]));

/** Blank first, then the starters in catalog order. */
function orderedTemplates(): ExtensionTemplate[] {
  const blank = PROJECT_TEMPLATES.filter((t) => t.id === BLANK_ID);
  return [...blank, ...PROJECT_TEMPLATES.filter((t) => t.id !== BLANK_ID)];
}

const thumbs = new Map<string, ReturnType<typeof extensionTemplates>>();
function thumbFor(tpl: ExtensionTemplate) {
  let nodes = thumbs.get(tpl.id);
  if (!nodes) {
    try {
      nodes = extensionTemplates(tpl.build([]));
    } catch {
      nodes = [];
    }
    thumbs.set(tpl.id, nodes);
  }
  return nodes;
}

export function NewProjectDialog({ open, onClose, arg }: DialogComponentProps) {
  const toast = useToast();
  const templates = useMemo(orderedTemplates, []);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string>(BLANK_ID);
  const [touched, setTouched] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setTouched(false);
    setImportError(null);
    setSelected(arg && templates.some((t) => t.id === arg) ? arg : templates[0]?.id ?? BLANK_ID);
    // The dialog focuses its container when it opens; move focus to the name field right after.
    const timer = setTimeout(() => nameRef.current?.querySelector('input')?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open, arg, templates]);

  const trimmed = name.trim();
  const nameError = touched && !trimmed ? 'Give your app a name, e.g. “Acme CRM Tools”.' : null;
  const selectedTpl = templates.find((t) => t.id === selected) ?? templates[0];

  const create = (tplId = selected) => {
    setTouched(true);
    const tpl = templates.find((t) => t.id === tplId);
    if (!trimmed || !tpl) return;
    saveProject(useEditor.getState().project);
    const project = projectFromTemplate(trimmed, tpl);
    useEditor.getState().newProject(project);
    toast(`Created “${trimmed}”${tpl.id === BLANK_ID ? '' : ` from ${tpl.name}`}`);
    onClose();
  };

  const importFile = async (file: File) => {
    setImportError(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setImportError(`Could not read ${file.name}.`);
      return;
    }
    const parsed = parseProjectJson(text);
    if (!parsed.ok) {
      setImportError(`${file.name} is not a valid builder file: ${parsed.error}`);
      return;
    }
    saveProject(useEditor.getState().project);
    useEditor.getState().loadProject(parsed.project);
    saveProject(parsed.project);
    toast(`Imported “${parsed.project.app.name}”`);
    onClose();
  };

  /** Arrow-key navigation inside the template radio group. */
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const index = templates.findIndex((t) => t.id === selected);
    let next = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % templates.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + templates.length) % templates.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = templates.length - 1;
    setSelected(templates[next].id);
    gridRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      wide
      title="New project"
      footer={
        <div className="ub-tpl-np-footer">
          <Button variant="ghost" icon={<FileUp size={14} aria-hidden />} onClick={() => fileRef.current?.click()}>
            Import .uiex.json
          </Button>
          <span className="ub-tpl-np-footer__spacer" />
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<Plus size={14} aria-hidden />} onClick={() => create()} disabled={touched && !trimmed}>
            Create project
          </Button>
        </div>
      }
    >
      <div className="ub-tpl-np">
        <form
          ref={nameRef}
          className="ub-tpl-np__name"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <Field
            label="App name"
            htmlFor="ub-tpl-np-name"
            error={nameError}
            hint={
              trimmed ? (
                <>
                  Project folder <code>{toProjectSlug(trimmed)}</code> · app uid <code>{toUid(trimmed, 'my_app')}</code>
                </>
              ) : (
                'Shown to users when they install your app. You can change it later in App settings.'
              )
            }
          >
            <TextInput
              id="ub-tpl-np-name"
              value={name}
              onChange={setName}
              onBlur={() => setTouched(true)}
              placeholder="e.g. Acme CRM Tools"
              invalid={!!nameError}
              autoComplete="off"
            />
          </Field>
        </form>

        <div className="ub-tpl-np__label" id="ub-tpl-np-start">
          Start with
          {selectedTpl && <span className="ub-tpl-np__selected">{selectedTpl.name}</span>}
        </div>
        <div className="ub-tpl-np-grid" role="radiogroup" aria-labelledby="ub-tpl-np-start" ref={gridRef} onKeyDown={onGridKey}>
          {templates.map((tpl) => {
            const checked = tpl.id === selected;
            return (
              <button
                key={tpl.id}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                className={cx('ub-tpl-np-card', checked && 'ub-tpl-np-card--on')}
                onClick={() => setSelected(tpl.id)}
                onDoubleClick={() => create(tpl.id)}
                title={`${tpl.name} — double-click to create`}
              >
                <span className="ub-tpl-np-card__thumb">
                  <Wireframe nodes={thumbFor(tpl)} size="sm" />
                </span>
                <span className="ub-tpl-np-card__name">{tpl.id === BLANK_ID ? 'Blank card' : tpl.name}</span>
                <span className="ub-tpl-np-card__badges">
                  <Badge tone={checked ? 'select' : undefined}>{templateLocationLabel(tpl)}</Badge>
                  {tpl.kind === 'card' && tpl.objectTypes?.[0] && <Badge>{OBJECT_LABELS.get(tpl.objectTypes[0]) ?? tpl.objectTypes[0]}</Badge>}
                  {tpl.functions && <Badge tone="accent">+ function</Badge>}
                </span>
                <span className="ub-tpl-np-card__desc">{tpl.description}</span>
              </button>
            );
          })}
        </div>

        {importError && (
          <div className="ub-tpl-np__error" role="alert">
            <TriangleAlert size={14} aria-hidden />
            {importError}
          </div>
        )}
        <p className="ub-tpl-np__note">Your current project stays saved in this browser — reopen it any time from Open projects.</p>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.uiex.json,application/json"
        className="ub-tpl-file-input"
        aria-label="Import builder file"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void importFile(file);
        }}
      />
    </Dialog>
  );
}
