/**
 * Top bar: product mark, app name, extension switcher, undo/redo, Design/Preview, problems badge,
 * functions, project & help menus, autosave status, panel toggles and Export.
 */
import { useRef, type ChangeEvent } from 'react';
import {
  BookOpen,
  Braces,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Cloud,
  CloudAlert,
  CloudCheck,
  CloudOff,
  Command,
  Download,
  ExternalLink,
  FilePlus2,
  FolderOpen,
  House,
  Keyboard,
  LayoutPanelTop,
  LoaderCircle,
  Package,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PenTool,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Settings,
  SlidersHorizontal,
  TriangleAlert,
  Undo2,
  Upload,
} from 'lucide-react';
import { selectActiveExtension, useEditor } from '../model/store';
import { downloadFile, serializeProject } from '../model/persistence';
import { DOCS_BASE } from '../registry/constants';
import { Button, IconButton, Menu, Segmented, cx, useToast, type MenuItem } from '../ui';
import { useAnchoredMenu } from './useAnchoredMenu';
import { useDialogs } from './dialogs';
import { extensionLocationLabel, historyStep } from './actions';
import { ExtensionKindIcon } from './ExtensionKindIcon';
import { importMessage, importProjectFromText } from './importProject';
import { saveErrorMessage } from './persistence';
import { showProjectConflict } from './ProjectConflictDialog';
import { useProblems } from './problems';
import { isLeftCollapsed, openBottomTab, setLeftSidebarOpen, toggleBottomPanel, useShell } from './shellStore';
import { saveNow, shortcutLabel } from './shortcuts';
import { openCommandPalette as openPowerPalette } from '../power/uiStore';

export function LogoMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="ub-sh-logo-mark">
      <rect width="24" height="24" rx="6" fill="var(--ub-accent)" />
      <rect x="5" y="5" width="6" height="6" rx="1.6" fill="#fff" />
      <rect x="13" y="5" width="6" height="6" rx="1.6" fill="#fff" fillOpacity="0.55" />
      <rect x="5" y="13" width="6" height="6" rx="1.6" fill="#fff" fillOpacity="0.55" />
      <circle cx="16" cy="16" r="3.2" fill="#fff" />
    </svg>
  );
}

export function TopBar() {
  return (
    <header className="ub-sh-tb" aria-label="Editor top bar">
      <div className="ub-sh-tb-group ub-sh-tb-left">
        <div className="ub-sh-tb-brand" title="UI Extension Builder for HubSpot">
          <LogoMark />
          <span className="ub-sh-tb-product">Extension Builder</span>
        </div>
        <span className="ub-sh-tb-divider" aria-hidden />
        <AppNameButton />
        <span className="ub-sh-tb-slash" aria-hidden>
          /
        </span>
        <ExtensionSwitcher />
      </div>

      <div className="ub-sh-tb-group ub-sh-tb-center">
        <UndoRedo />
        <ModeToggle />
      </div>

      <div className="ub-sh-tb-group ub-sh-tb-right">
        <SaveIndicator />
        <ProblemsBadge />
        <FunctionsButton />
        <ProjectMenu />
        <HelpMenu />
        <PanelToggles />
        <Button variant="primary" icon={<Package size={14} />} onClick={() => useDialogs.getState().open('export')} title={`Export HubSpot project (${shortcutLabel('export')})`}>
          Export
        </Button>
      </div>
    </header>
  );
}

function AppNameButton() {
  const name = useEditor((s) => s.project.app.name);
  return (
    <button
      type="button"
      className="ub-sh-tb-app"
      onClick={() => useDialogs.getState().open('appSettings')}
      title="App settings — name, scopes, permitted URLs, distribution"
    >
      <span className="ub-sh-tb-app-name">{name || 'Untitled app'}</span>
      <SlidersHorizontal size={12} aria-hidden className="ub-sh-tb-app-icon" />
    </button>
  );
}

export function ExtensionSwitcher() {
  const toast = useToast();
  const menu = useAnchoredMenu();
  const extensions = useEditor((s) => s.project.extensions);
  const activeId = useEditor((s) => s.activeExtensionId);
  const active = useEditor((s) => selectActiveExtension(s));
  const hasSettings = extensions.some((e) => e.kind === 'settings');
  const hasHome = extensions.some((e) => e.kind === 'home');

  const add = (kind: 'card' | 'settings' | 'home') => {
    const state = useEditor.getState();
    if (state.mode !== 'design') state.setMode('design');
    state.addExtension({ kind });
    const ext = selectActiveExtension(useEditor.getState());
    toast(`Added “${ext.name}”`);
  };

  const items: MenuItem[] = [
    ...extensions.map<MenuItem>((ext) => ({
      icon: <ExtensionKindIcon kind={ext.kind} />,
      label: (
        <span className="ub-sh-ext-item">
          <span className="ub-sh-ext-item-name">{ext.name}</span>
          <span className="ub-sh-ext-item-loc">{extensionLocationLabel(ext)}</span>
        </span>
      ),
      shortcut: ext.id === activeId ? '✓' : undefined,
      onSelect: () => useEditor.getState().setActiveExtension(ext.id),
    })),
    { separator: true, label: '' },
    { icon: <Plus size={14} />, label: 'Add card', onSelect: () => add('card') },
    {
      icon: <Settings size={14} />,
      label: hasSettings ? 'Add settings page (already added)' : 'Add settings page',
      disabled: hasSettings,
      onSelect: () => add('settings'),
    },
    {
      icon: <House size={14} />,
      label: hasHome ? 'Add app home page (already added)' : 'Add app home page',
      disabled: hasHome,
      onSelect: () => add('home'),
    },
    { separator: true, label: '' },
    { icon: <LayoutPanelTop size={14} />, label: 'Manage extensions…', onSelect: () => useDialogs.getState().open('extensionSettings', activeId) },
  ];

  return (
    <>
      <button
        type="button"
        className={cx('ub-sh-tb-ext', menu.position && 'ub-sh-tb-ext--open')}
        aria-haspopup="menu"
        aria-expanded={!!menu.position}
        aria-label={`${active.name}, ${extensionLocationLabel(active)} — switch or add extensions`}
        title="Switch or add extensions"
        onMouseDown={menu.onTriggerMouseDown}
        onClick={(e) => menu.toggle(e.currentTarget)}
      >
        <ExtensionKindIcon kind={active.kind} size={14} className="ub-sh-tb-ext-icon" />
        <span className="ub-sh-tb-ext-name">{active.name}</span>
        <span className="ub-sh-tb-ext-loc">{extensionLocationLabel(active)}</span>
        {extensions.length > 1 && <span className="ub-sh-tb-ext-count">{extensions.length}</span>}
        <ChevronDown size={13} aria-hidden />
      </button>
      {menu.position && <Menu x={menu.position.x} y={menu.position.y} items={items} onClose={menu.close} returnFocus={menu.returnFocus} />}
    </>
  );
}

function UndoRedo() {
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const toast = useToast();
  return (
    <div className="ub-sh-tb-cluster">
      <IconButton label={`Undo (${shortcutLabel('undo')})`} disabled={!canUndo} onClick={() => historyStep('undo', toast)}>
        <Undo2 size={15} />
      </IconButton>
      <IconButton label={`Redo (${shortcutLabel('redo')})`} disabled={!canRedo} onClick={() => historyStep('redo', toast)}>
        <Redo2 size={15} />
      </IconButton>
    </div>
  );
}

function ModeToggle() {
  const mode = useEditor((s) => s.mode);
  const key = shortcutLabel('togglePreview');
  return (
    <div className="ub-sh-tb-cluster">
      <Segmented
        aria-label="Editor mode"
        value={mode}
        onChange={(m) => useEditor.getState().setMode(m)}
        options={[
          { value: 'design', label: <><PenTool size={13} aria-hidden /> Design</>, title: `Design — select and arrange components (${key})` },
          { value: 'preview', label: <><Play size={13} aria-hidden /> Preview</>, title: `Preview — interact with the card using mock data (${key})` },
        ]}
      />
      {mode === 'preview' && (
        <IconButton label="Reset preview (state, data and overlays)" onClick={() => useEditor.getState().resetPreview()}>
          <RotateCcw size={15} />
        </IconButton>
      )}
    </div>
  );
}

function ProblemsBadge() {
  const errors = useProblems((s) => s.errors);
  const warnings = useProblems((s) => s.warnings);
  const total = errors + warnings;
  const label =
    total === 0
      ? 'No problems — ready to export'
      : `${errors} ${errors === 1 ? 'error' : 'errors'}, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'} — show problems`;
  return (
    <button
      type="button"
      className={cx('ub-sh-tb-problems', errors > 0 ? 'ub-sh-tb-problems--error' : warnings > 0 ? 'ub-sh-tb-problems--warning' : 'ub-sh-tb-problems--ok')}
      onClick={() => openBottomTab('problems')}
      title={label}
      aria-label={label}
    >
      {total === 0 ? (
        <CircleCheck size={14} aria-hidden />
      ) : (
        <>
          {errors > 0 && (
            <span className="ub-sh-tb-problems-part">
              <CircleAlert size={14} aria-hidden />
              {errors}
            </span>
          )}
          {warnings > 0 && (
            <span className="ub-sh-tb-problems-part ub-sh-tb-problems-part--warning">
              <TriangleAlert size={14} aria-hidden />
              {warnings}
            </span>
          )}
        </>
      )}
    </button>
  );
}

function FunctionsButton() {
  const count = useEditor((s) => s.project.functions.length);
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={<Braces size={14} />}
      onClick={() => useDialogs.getState().open('functions')}
      title="App functions — server-side code your cards can call"
      className="ub-sh-tb-btn"
    >
      <span className="ub-sh-tb-btn-label">Functions</span>
      {count > 0 && <span className="ub-sh-count">{count}</span>}
    </Button>
  );
}

function ProjectMenu() {
  const toast = useToast();
  const menu = useAnchoredMenu();
  const fileRef = useRef<HTMLInputElement>(null);

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      toast(`Couldn't read ${file.name}`);
      return;
    }
    // Saves the current project first and asks before replacing a saved version with the same id.
    toast(importMessage(await importProjectFromText(text, { fileName: file.name })));
  };

  const download = () => {
    const project = useEditor.getState().project;
    downloadFile(`${project.name || 'project'}.uiex.json`, serializeProject(project));
    toast('Downloaded the builder document (.uiex.json)');
  };

  const items: MenuItem[] = [
    { icon: <FilePlus2 size={14} />, label: 'New project…', onSelect: () => useDialogs.getState().open('newProject') },
    { icon: <FolderOpen size={14} />, label: 'Open…', onSelect: () => useDialogs.getState().open('projects') },
    { separator: true, label: '' },
    { icon: <Upload size={14} />, label: 'Import .uiex.json…', onSelect: () => fileRef.current?.click() },
    { icon: <Download size={14} />, label: 'Download .uiex.json', onSelect: download },
    { separator: true, label: '' },
    { icon: <Save size={14} />, label: 'Save', shortcut: shortcutLabel('save'), onSelect: () => saveNow(toast) },
  ];

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="ub-sh-tb-btn"
        aria-haspopup="menu"
        aria-expanded={!!menu.position}
        onMouseDown={menu.onTriggerMouseDown}
        onClick={(e) => menu.toggle(e.currentTarget)}
        title="New, open, import and download projects"
      >
        <FolderOpen size={14} aria-hidden />
        <span className="ub-sh-tb-btn-label">Project</span>
        <ChevronDown size={12} aria-hidden />
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.uiex.json,application/json"
        className="ub-sh-hidden-input"
        aria-label="Import .uiex.json file"
        tabIndex={-1}
        onChange={onImport}
      />
      {menu.position && <Menu x={menu.position.x} y={menu.position.y} items={items} onClose={menu.close} returnFocus={menu.returnFocus} />}
    </>
  );
}

/** Opens the power module's command palette (same as pressing Cmd/Ctrl+K). */
export function openCommandPalette(): void {
  openPowerPalette();
}

function HelpMenu() {
  const menu = useAnchoredMenu();
  const items: MenuItem[] = [
    { icon: <Keyboard size={14} />, label: 'Keyboard shortcuts', shortcut: '?', onSelect: () => useDialogs.getState().open('shortcuts') },
    { icon: <Command size={14} />, label: 'Command palette', shortcut: shortcutLabel('commandPalette'), onSelect: () => setTimeout(openCommandPalette, 0) },
    { separator: true, label: '' },
    {
      icon: <BookOpen size={14} />,
      label: (
        <span className="ub-sh-menu-link">
          HubSpot UI components docs <ExternalLink size={11} aria-hidden />
        </span>
      ),
      onSelect: () => window.open(DOCS_BASE, '_blank', 'noopener,noreferrer'),
    },
  ];
  return (
    <>
      <IconButton
        label="Help"
        aria-haspopup="menu"
        aria-expanded={!!menu.position}
        onMouseDown={menu.onTriggerMouseDown}
        onClick={(e) => menu.toggle(e.currentTarget)}
      >
        <CircleHelp size={16} />
      </IconButton>
      {menu.position && <Menu x={menu.position.x} y={menu.position.y} items={items} onClose={menu.close} returnFocus={menu.returnFocus} />}
    </>
  );
}

function PanelToggles() {
  const leftCollapsed = useShell(isLeftCollapsed);
  const rightCollapsed = useShell((s) => s.rightCollapsed);
  const bottomOpen = useEditor((s) => s.bottomPanel !== null);
  return (
    <div className="ub-sh-tb-cluster ub-sh-tb-toggles">
      <IconButton
        label={leftCollapsed ? 'Show left sidebar' : 'Hide left sidebar'}
        active={!leftCollapsed}
        onClick={() => setLeftSidebarOpen(leftCollapsed)}
      >
        <PanelLeft size={15} />
      </IconButton>
      <IconButton
        label={`${bottomOpen ? 'Hide' : 'Show'} code, problems & console (${shortcutLabel('toggleBottom')})`}
        active={bottomOpen}
        onClick={toggleBottomPanel}
      >
        <PanelBottom size={15} />
      </IconButton>
      <IconButton
        label={rightCollapsed ? 'Show inspector' : 'Hide inspector'}
        active={!rightCollapsed}
        onClick={() => useShell.getState().setRightCollapsed(!rightCollapsed)}
      >
        <PanelRight size={15} />
      </IconButton>
    </div>
  );
}

/**
 * Autosave status. Routine "Saving… / Saved" changes are not announced to screen readers (they
 * would interrupt typing after every pause); a failed save is, once, through the alert region.
 * When another tab changed the project the status becomes a button that asks what to keep.
 */
function SaveIndicator() {
  const status = useShell((s) => s.saveStatus);
  const saveError = useShell((s) => s.saveError);
  const at = useShell((s) => s.lastSavedAt);
  const time = at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  const content =
    status === 'pending'
      ? { icon: <LoaderCircle size={13} className="ub-sh-spin" aria-hidden />, text: 'Saving…', title: 'Saving changes in this browser…' }
      : status === 'saved'
        ? { icon: <CloudCheck size={14} aria-hidden />, text: 'Saved locally', title: time ? `Autosaved in this browser at ${time}` : 'Autosaved in this browser' }
        : status === 'error'
          ? { icon: <CloudOff size={14} aria-hidden />, text: saveError === 'quota' ? 'Storage full' : 'Not saved', title: saveErrorMessage(saveError) }
          : status === 'conflict'
            ? { icon: <CloudAlert size={14} aria-hidden />, text: 'Changed in another tab', title: 'Another tab saved this project — choose which version to keep' }
            : { icon: <Cloud size={14} aria-hidden />, text: 'Autosave on', title: 'Changes are saved automatically in this browser' };
  if (status === 'conflict') {
    return (
      <button type="button" className={cx('ub-sh-tb-save', 'ub-sh-tb-save--conflict')} title={content.title} onClick={showProjectConflict}>
        {content.icon}
        <span className="ub-sh-tb-save-text">{content.text}</span>
      </button>
    );
  }
  return (
    <span className={cx('ub-sh-tb-save', `ub-sh-tb-save--${status}`)} title={content.title}>
      {content.icon}
      <span className="ub-sh-tb-save-text">{content.text}</span>
      <span className="ub-sr-only" role="alert">
        {status === 'error' ? `Not saved: ${saveErrorMessage(saveError)}.` : ''}
      </span>
    </span>
  );
}
