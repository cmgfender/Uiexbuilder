/**
 * Templates tab of the left sidebar:
 *  - Blocks: searchable gallery of drop-in snippets (click to insert at the selection, or drag
 *    onto the canvas / layers).
 *  - Starter cards: complete, working extensions to add to the project or to replace the current one.
 *  - My blocks: the user's saved blocks ("Save as block" in the canvas / layers context menu).
 */
import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Bookmark, Check, Pencil, Plus, Replace, Search, Trash2, X, Zap } from 'lucide-react';
import { endDrag, startDrag } from '../dnd/dragState';
import { selectActiveExtension, useEditor } from '../model/store';
import type { Extension, NodeTemplate, StateVar } from '../model/types';
import { getComponent } from '../registry';
import { CRM_OBJECT_TYPES } from '../registry/constants';
import { Badge, Button, Dialog, EmptyState, IconButton, Segmented, TextInput, cx, useToast } from '../ui';
import { addTemplateToProject, insertBlock, replaceActiveWithTemplate } from './actions';
import {
  BLOCK_TEMPLATES,
  freshBlockTemplate,
  matchesBlock,
  PROJECT_TEMPLATES,
  templateConflict,
  templateLocationLabel,
  type BlockTemplate,
  type ExtensionTemplate,
} from './catalog';
import { deleteUserBlock, renameUserBlock, useUserBlocks, type UserBlock } from './userBlocks';
import { extensionTemplates, Wireframe } from './Wireframe';
import './templates.css';

export type TemplatesTab = 'blocks' | 'starters' | 'mine';

const TAB_KEY = 'uiex-builder:templates-tab';

function readTab(): TemplatesTab {
  try {
    const v = window.localStorage.getItem(TAB_KEY);
    if (v === 'blocks' || v === 'starters' || v === 'mine') return v;
  } catch {
    /* storage unavailable */
  }
  return 'blocks';
}

function writeTab(tab: TemplatesTab): void {
  try {
    window.localStorage.setItem(TAB_KEY, tab);
  } catch {
    /* storage unavailable */
  }
}

/** Activates a role="button" element with Enter / Space. */
function onActivateKey(e: KeyboardEvent, action: () => void): void {
  if (e.target !== e.currentTarget) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    action();
  }
}

function countNodes(t: NodeTemplate): number {
  let n = 1;
  for (const c of t.children ?? []) n += countNodes(c);
  for (const list of Object.values(t.slots ?? {})) for (const c of list) n += countNodes(c);
  return n;
}

function useInsert() {
  const toast = useToast();
  return (template: NodeTemplate, state: Array<Omit<StateVar, 'id'>> | undefined, label: string) => {
    const result = insertBlock(template, state, label);
    toast(result.message);
    return result.ok;
  };
}

function dragHandlers(template: NodeTemplate, state: Array<Omit<StateVar, 'id'>> | undefined, label: string) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      const ext = selectActiveExtension(useEditor.getState());
      startDrag(e, { kind: 'template', template: freshBlockTemplate(template, ext ?? null), label, ...(state?.length ? { state } : {}) }, label);
    },
    onDragEnd: () => endDrag(),
  };
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function TemplatesPanel() {
  const [tab, setTabState] = useState<TemplatesTab>(readTab);
  const [query, setQuery] = useState('');
  const userBlocks = useUserBlocks();
  const setTab = (next: TemplatesTab) => {
    setTabState(next);
    writeTab(next);
  };
  const searchRef = useRef<HTMLDivElement>(null);

  return (
    <div className="ub-tpl">
      <div className="ub-tpl-head">
        <div className="ub-tpl-seg">
          <Segmented<TemplatesTab>
            aria-label="Template type"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'blocks', label: 'Blocks', title: 'Drop-in building blocks' },
              { value: 'starters', label: 'Starter cards', title: 'Complete cards and pages' },
              {
                value: 'mine',
                label: (
                  <>
                    My blocks{userBlocks.length > 0 && <span className="ub-tpl-seg__count">{userBlocks.length}</span>}
                  </>
                ),
                title: 'Blocks you saved',
              },
            ]}
          />
        </div>
        {tab !== 'starters' && (
          <div className="ub-tpl-search" ref={searchRef}>
            <Search size={13} className="ub-tpl-search__icon" aria-hidden />
            <TextInput
              value={query}
              onChange={setQuery}
              placeholder={tab === 'blocks' ? 'Search blocks' : 'Search my blocks'}
              aria-label={tab === 'blocks' ? 'Search blocks' : 'Search my blocks'}
              className="ub-tpl-search__input"
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.stopPropagation();
                  setQuery('');
                }
              }}
            />
            {query && (
              <IconButton
                label="Clear search"
                size="sm"
                className="ub-tpl-search__clear"
                onClick={() => {
                  setQuery('');
                  searchRef.current?.querySelector('input')?.focus();
                }}
              >
                <X size={12} />
              </IconButton>
            )}
          </div>
        )}
      </div>
      {tab === 'blocks' && <BlockGallery query={query} onClearQuery={() => setQuery('')} />}
      {tab === 'starters' && <StarterGallery />}
      {tab === 'mine' && <MyBlocks blocks={userBlocks} query={query} onClearQuery={() => setQuery('')} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function NoMatches({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <EmptyState icon={<Search size={20} aria-hidden />} title={`No blocks match “${query.trim()}”`}>
      <Button size="sm" variant="ghost" onClick={onClear}>
        Show all blocks
      </Button>
    </EmptyState>
  );
}

function BlockGallery({ query, onClearQuery }: { query: string; onClearQuery: () => void }) {
  const blocks = useMemo(() => BLOCK_TEMPLATES.filter((b) => matchesBlock(b, query)), [query]);
  if (blocks.length === 0) return <NoMatches query={query} onClear={onClearQuery} />;
  return (
    <>
      <p className="ub-tpl-hint">Click a block to insert it at the selection, or drag it onto the canvas.</p>
      <div className="ub-tpl-grid" role="group" aria-label="Blocks">
        {blocks.map((b) => (
          <BlockCard key={b.id} block={b} />
        ))}
      </div>
    </>
  );
}

function BlockCard({ block }: { block: BlockTemplate }) {
  const insert = useInsert();
  const Icon = block.icon;
  const run = () => insert(block.template, block.state, block.name);
  return (
    <div
      role="button"
      className="ub-tpl-block"
      tabIndex={0}
      aria-label={`${block.name}: ${block.description} Press Enter to insert.`}
      title={`${block.name} — click to insert, or drag onto the canvas`}
      onClick={run}
      onKeyDown={(e) => onActivateKey(e, run)}
      {...dragHandlers(block.template, block.state, block.name)}
    >
      <Wireframe nodes={[block.template]} size="sm" className="ub-tpl-block__thumb" />
      <span className="ub-tpl-block__name">
        <Icon size={13} aria-hidden />
        <span>{block.name}</span>
      </span>
      <span className="ub-tpl-block__desc">{block.description}</span>
      {block.state?.length ? (
        <span className="ub-tpl-block__state" title="State variables this block adds if they don't exist yet">
          <Zap size={10} aria-hidden /> {block.state.map((s) => s.name).join(', ')}
        </span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Starter cards
// ---------------------------------------------------------------------------

const thumbCache = new Map<string, NodeTemplate[]>();
function starterThumb(tpl: ExtensionTemplate): NodeTemplate[] {
  let nodes = thumbCache.get(tpl.id);
  if (!nodes) {
    try {
      nodes = extensionTemplates(tpl.build([]));
    } catch {
      nodes = [];
    }
    thumbCache.set(tpl.id, nodes);
  }
  return nodes;
}

const OBJECT_LABELS = new Map(CRM_OBJECT_TYPES.map((t) => [t.value, t.label]));

function StarterGallery() {
  const toast = useToast();
  // Primitive selectors: the gallery only needs extension kinds and the active card's id / name.
  const signature = useEditor((s) => s.project.extensions.map((e) => `${e.kind}:${e.id}`).join('|'));
  const activeId = useEditor((s) => selectActiveExtension(s)?.id ?? null);
  const activeName = useEditor((s) => selectActiveExtension(s)?.name ?? 'current card');
  const extensions = useMemo(
    () =>
      signature
        .split('|')
        .filter(Boolean)
        .map((entry) => {
          const [kind, ...rest] = entry.split(':');
          return { kind: kind as Extension['kind'], id: rest.join(':') };
        }),
    [signature],
  );
  const [confirming, setConfirming] = useState<ExtensionTemplate | null>(null);

  const add = (tpl: ExtensionTemplate) => {
    const r = addTemplateToProject(tpl);
    toast(r.message);
  };
  const replace = (tpl: ExtensionTemplate) => {
    const r = replaceActiveWithTemplate(tpl);
    toast(r.ok ? `${r.message} Undo with ⌘Z / Ctrl+Z.` : r.message);
  };

  return (
    <>
      <p className="ub-tpl-hint">Complete, working cards with data, actions and mock data. Add one to your project or replace the current card.</p>
      <ul className="ub-tpl-starters" aria-label="Starter cards">
        {PROJECT_TEMPLATES.map((tpl) => (
          <StarterCard
            key={tpl.id}
            tpl={tpl}
            addConflict={templateConflict(tpl, extensions)}
            replaceConflict={activeId ? templateConflict(tpl, extensions, activeId) : null}
            onAdd={() => add(tpl)}
            onReplace={() => setConfirming(tpl)}
          />
        ))}
      </ul>
      <Dialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={`Replace “${activeName}”?`}
        footer={
          <>
            <Button onClick={() => setConfirming(null)}>Cancel</Button>
            <Button
              variant="primary"
              icon={<Replace size={14} aria-hidden />}
              onClick={() => {
                const tpl = confirming;
                setConfirming(null);
                if (tpl) replace(tpl);
              }}
            >
              Replace
            </Button>
          </>
        }
      >
        <p className="ub-tpl-confirm">
          The components, state, data sources and mock data of <strong>{activeName}</strong> are replaced by the{' '}
          <strong>{confirming?.name}</strong> starter. You can undo this with ⌘Z / Ctrl+Z.
        </p>
      </Dialog>
    </>
  );
}

function StarterCard({
  tpl,
  addConflict,
  replaceConflict,
  onAdd,
  onReplace,
}: {
  tpl: ExtensionTemplate;
  addConflict: string | null;
  replaceConflict: string | null;
  onAdd: () => void;
  onReplace: () => void;
}) {
  const nodes = starterThumb(tpl);
  return (
    <li className="ub-tpl-starter">
      <article aria-label={tpl.name}>
        <div className={cx('ub-tpl-starter__thumb', tpl.location === 'crm.record.sidebar' || tpl.location === 'helpdesk.sidebar' ? 'ub-tpl-starter__thumb--narrow' : '')}>
          <Wireframe nodes={nodes} />
        </div>
        <div className="ub-tpl-starter__body">
          <h3 className="ub-tpl-starter__title">{tpl.name}</h3>
          <div className="ub-tpl-starter__badges">
            <Badge tone="select">{templateLocationLabel(tpl)}</Badge>
            {tpl.kind === 'card' && (tpl.objectTypes ?? []).map((o) => <Badge key={o}>{OBJECT_LABELS.get(o) ?? o}</Badge>)}
            {tpl.functions && (
              <Badge tone="accent" title="Adds an app function (server-side code) to the project">
                + app function
              </Badge>
            )}
          </div>
          <p className="ub-tpl-starter__desc">{tpl.description}</p>
          <div className="ub-tpl-starter__tags" aria-label="Features">
            {tpl.tags.map((t) => (
              <span key={t} className="ub-tpl-tag">
                {t}
              </span>
            ))}
          </div>
          <div className="ub-tpl-starter__actions">
            <Button
              size="sm"
              variant="primary"
              icon={<Plus size={13} aria-hidden />}
              disabled={!!addConflict}
              title={addConflict ?? `Add “${tpl.name}” as a new ${tpl.kind === 'card' ? 'card' : 'page'} in this project`}
              onClick={onAdd}
              aria-label={`Add ${tpl.name} to project`}
            >
              Add to project
            </Button>
            <Button
              size="sm"
              icon={<Replace size={13} aria-hidden />}
              disabled={!!replaceConflict}
              title={replaceConflict ?? 'Replace the card you are editing with this starter'}
              onClick={onReplace}
              aria-label={`Replace current with ${tpl.name}`}
            >
              Replace current
            </Button>
          </div>
        </div>
      </article>
    </li>
  );
}

// ---------------------------------------------------------------------------
// My blocks
// ---------------------------------------------------------------------------

function MyBlocks({ blocks, query, onClearQuery }: { blocks: UserBlock[]; query: string; onClearQuery: () => void }) {
  const [deleting, setDeleting] = useState<UserBlock | null>(null);
  const toast = useToast();
  const visible = useMemo(() => blocks.filter((b) => matchesBlock({ name: b.name, description: getComponent(b.template.type)?.label ?? '' }, query)), [blocks, query]);

  if (blocks.length === 0) {
    return (
      <EmptyState icon={<Bookmark size={22} aria-hidden />} title="No saved blocks yet">
        <p className="ub-tpl-empty-text">
          Right-click a component on the canvas or in Layers → <strong>Save as block</strong>. Saved blocks show up here so you can reuse them in any
          project.
        </p>
      </EmptyState>
    );
  }
  if (visible.length === 0) return <NoMatches query={query} onClear={onClearQuery} />;

  return (
    <>
      <p className="ub-tpl-hint">Saved in this browser. Click to insert, or drag onto the canvas.</p>
      <ul className="ub-tpl-mine-list" aria-label="My blocks">
        {visible.map((b) => (
          <UserBlockRow key={b.id} block={b} onDelete={() => setDeleting(b)} />
        ))}
      </ul>
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name ?? ''}”?`}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="primary"
              icon={<Trash2 size={14} aria-hidden />}
              onClick={() => {
                if (deleting) {
                  deleteUserBlock(deleting.id);
                  toast(`Deleted “${deleting.name}”`);
                }
                setDeleting(null);
              }}
            >
              Delete block
            </Button>
          </>
        }
      >
        <p className="ub-tpl-confirm">The block is removed from your library. Components already placed on cards are not affected. This can’t be undone.</p>
      </Dialog>
    </>
  );
}

function UserBlockRow({ block, onDelete }: { block: UserBlock; onDelete: () => void }) {
  const insert = useInsert();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(block.name);
  const run = () => insert(block.template, block.state, block.name);
  const typeLabel = getComponent(block.template.type)?.label ?? block.template.type;
  const count = countNodes(block.template);
  const commit = () => {
    if (draft.trim() && draft.trim() !== block.name) renameUserBlock(block.id, draft);
    setEditing(false);
  };

  let main: ReactNode;
  if (editing) {
    main = (
      <div className="ub-tpl-mine__main ub-tpl-mine__main--editing">
        <Wireframe nodes={[block.template]} size="sm" className="ub-tpl-mine__thumb" />
        <TextInput
          value={draft}
          onChange={setDraft}
          autoFocus
          aria-label="Block name"
          className="ub-tpl-mine__rename"
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              e.stopPropagation();
              setDraft(block.name);
              setEditing(false);
            }
          }}
        />
      </div>
    );
  } else {
    main = (
      <div
        role="button"
        tabIndex={0}
        className="ub-tpl-mine__main"
        title={`${block.name} — click to insert, or drag onto the canvas`}
        aria-label={`Insert ${block.name}`}
        onClick={run}
        onKeyDown={(e) => onActivateKey(e, run)}
        {...dragHandlers(block.template, block.state, block.name)}
      >
        <Wireframe nodes={[block.template]} size="sm" className="ub-tpl-mine__thumb" />
        <span className="ub-tpl-mine__text">
          <span className="ub-tpl-mine__name">{block.name}</span>
          <span className="ub-tpl-mine__meta">
            {typeLabel} · {count} {count === 1 ? 'component' : 'components'}
            {block.state?.length ? ` · uses ${block.state.map((s) => s.name).join(', ')}` : ''}
          </span>
        </span>
      </div>
    );
  }

  return (
    <li className="ub-tpl-mine">
      {main}
      <span className="ub-tpl-mine__actions">
        {editing ? (
          <IconButton label="Save name" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={commit}>
            <Check size={13} />
          </IconButton>
        ) : (
          <IconButton
            label={`Rename ${block.name}`}
            size="sm"
            onClick={() => {
              setDraft(block.name);
              setEditing(true);
            }}
          >
            <Pencil size={13} />
          </IconButton>
        )}
        <IconButton label={`Delete ${block.name}`} size="sm" onClick={onDelete}>
          <Trash2 size={13} />
        </IconButton>
      </span>
    </li>
  );
}

