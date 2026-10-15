/**
 * Code tab of the bottom panel: every generated project file in a tree, the chosen file in the
 * code viewer, and tools to copy / download / prettier-format it or show only the selection's JSX.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Crosshair,
  Download,
  File as FileIcon,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  MousePointerClick,
  TriangleAlert,
  WandSparkles,
} from 'lucide-react';
import {
  formatSource,
  generateExtensionSource,
  generateNodeJsx,
  generateProjectFiles,
  planExtensionFiles,
  type GeneratedFile,
} from '../codegen';
import { downloadFile } from '../model/persistence';
import { selectActiveExtension, useEditor } from '../model/store';
import { nodeLabel } from '../model/tree';
import type { Extension, NodeId, Project } from '../model/types';
import { CodeViewer } from '../ui/CodeViewer';
import { EmptyState, cx, useToast } from '../ui';
import { typeLabel } from './actions';
import { PREF_KEYS, readPref, writePref } from './prefs';

export const CODE_DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function languageForPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.tsx') || lower.endsWith('.jsx')) return 'tsx';
  if (lower.endsWith('.ts')) return 'ts';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'js';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md')) return 'markdown';
  return 'text';
}

function fileIcon(path: string) {
  const lang = languageForPath(path);
  if (lang === 'tsx' || lang === 'ts' || lang === 'js') return FileCode2;
  if (lang === 'json') return FileJson;
  if (lang === 'markdown') return FileText;
  return FileIcon;
}

export interface FileTreeDir {
  name: string;
  path: string;
  dirs: FileTreeDir[];
  files: GeneratedFile[];
}

/** Groups flat file paths into a folder tree (folders first, then files; alphabetical). */
export function buildFileTree(files: GeneratedFile[]): FileTreeDir {
  const root: FileTreeDir = { name: '', path: '', dirs: [], files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      const path = dir.path ? `${dir.path}/${part}` : part;
      let next = dir.dirs.find((d) => d.name === part);
      if (!next) {
        next = { name: part, path, dirs: [], files: [] };
        dir.dirs.push(next);
      }
      dir = next;
    }
    dir.files.push(file);
  }
  const sort = (d: FileTreeDir) => {
    d.dirs.sort((a, b) => a.name.localeCompare(b.name));
    d.files.sort((a, b) => baseName(a.path).localeCompare(baseName(b.path)));
    d.dirs.forEach(sort);
  };
  sort(root);
  return root;
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Source path of an extension's component file in the generated project. */
export function extensionSourcePath(project: Project, extId: string): string | null {
  try {
    return planExtensionFiles(project).find((f) => f.ext.id === extId)?.sourcePath ?? null;
  } catch {
    return null;
  }
}

type SelectionCode =
  | { kind: 'code'; code: string; label: string }
  | { kind: 'empty' }
  | { kind: 'error'; error: string };

type NodeJsxGenerator = (project: Project, ext: Extension, nodeId: NodeId) => string;

/**
 * JSX of one node using only the public generator: renders a probe extension whose root holds just
 * that node and extracts the returned fragment's children. Fallback when generateNodeJsx fails.
 */
export function fallbackNodeJsx(project: Project, ext: Extension, nodeId: NodeId): string {
  const root = ext.nodes[ext.rootId];
  if (!root || !ext.nodes[nodeId]) return '';
  const probe: Extension = { ...ext, nodes: { ...ext.nodes, [ext.rootId]: { ...root, children: [nodeId] } } };
  const lines = generateExtensionSource(project, probe).split('\n');
  const start = lines.indexOf('    <>');
  const end = lines.lastIndexOf('    </>');
  if (start === -1 || end <= start) return '';
  return `${lines
    .slice(start + 1, end)
    .map((l) => (l.startsWith('      ') ? l.slice(6) : l.trimStart()))
    .join('\n')}\n`;
}

/**
 * `generateNodeJsx(project, ext, nodeId)` from src/codegen (the node exactly as it appears in the
 * generated file); the probe fallback is used only if it throws or returns nothing.
 */
export function getNodeJsxGenerator(): NodeJsxGenerator {
  return (project, ext, nodeId) => {
    try {
      const out = generateNodeJsx(project, ext, nodeId);
      if (out.trim()) return out;
    } catch {
      /* fall back below */
    }
    return fallbackNodeJsx(project, ext, nodeId);
  };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand?.('copy') ?? false;
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

const formatCache = new Map<string, string>();

/** Prettier output for `code` (cached per path + content). */
function useFormatted(code: string | null, path: string, enabled: boolean): { text: string | null; pending: boolean } {
  const key = code === null ? null : `${path}\u0000${code}`;
  const [, force] = useState(0);
  const cached = key ? formatCache.get(key) : undefined;
  const pending = enabled && key !== null && cached === undefined;
  useEffect(() => {
    if (!enabled || key === null || code === null || formatCache.has(key)) return;
    let cancelled = false;
    formatSource(code, path).then(
      (out) => {
        formatCache.set(key, out);
        if (formatCache.size > 200) formatCache.delete(formatCache.keys().next().value as string);
        if (!cancelled) force((n) => n + 1);
      },
      () => {
        formatCache.set(key, code);
        if (!cancelled) force((n) => n + 1);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, key, code, path]);
  if (!enabled || code === null) return { text: code, pending: false };
  return { text: cached ?? code, pending };
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function CodePanel() {
  const toast = useToast();
  const project = useEditor((s) => s.project);
  const activeExtId = useEditor((s) => s.activeExtensionId);
  const selectedId = useEditor((s) => s.selectedNodeId);
  const [files, setFiles] = useState<GeneratedFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [formatOn, setFormatOn] = useState(() => readPref<boolean>(PREF_KEYS.codeFormat, false) === true);
  const [selectionOn, setSelectionOn] = useState(false);
  const [copied, setCopied] = useState(false);
  const firstRun = useRef(true);

  // Regenerate (debounced) whenever the document changes.
  useEffect(() => {
    const run = () => {
      try {
        setFiles(generateProjectFiles(project));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    if (firstRun.current) {
      firstRun.current = false;
      run();
      return;
    }
    const t = setTimeout(run, CODE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [project]);

  // Follow the active extension: show its component file.
  useEffect(() => {
    const p = extensionSourcePath(useEditor.getState().project, activeExtId);
    if (p) setPath(p);
  }, [activeExtId]);

  const current = useMemo(() => {
    if (!files) return null;
    return (
      files.find((f) => f.path === path) ??
      files.find((f) => f.path === extensionSourcePath(project, activeExtId)) ??
      files.find((f) => f.path.endsWith('.tsx')) ??
      files[0] ??
      null
    );
  }, [files, path, project, activeExtId]);

  // Selection JSX (power module's generateNodeJsx).
  const nodeJsx = useMemo((): SelectionCode | null => {
    if (!selectionOn) return null;
    const gen = getNodeJsxGenerator();
    const ext = selectActiveExtension({ project, activeExtensionId: activeExtId });
    if (!selectedId || !ext.nodes[selectedId]) return { kind: 'empty' };
    const node = ext.nodes[selectedId];
    try {
      const code = gen(project, ext, selectedId);
      return { kind: 'code', code: typeof code === 'string' ? code : String(code), label: nodeLabel(node, typeLabel(node.type)) };
    } catch (err) {
      return { kind: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  }, [selectionOn, project, activeExtId, selectedId]);

  const showingSelection = selectionOn && nodeJsx !== null;
  const rawCode = showingSelection ? (nodeJsx?.kind === 'code' ? nodeJsx.code : null) : current?.contents ?? null;
  const codePath = showingSelection ? 'selection.tsx' : current?.path ?? 'file.txt';
  const { text: code, pending } = useFormatted(rawCode, codePath, formatOn);

  const tree = useMemo(() => (files ? buildFileTree(files) : null), [files]);

  const toggleFormat = () => {
    setFormatOn((v) => {
      writePref(PREF_KEYS.codeFormat, !v);
      return !v;
    });
  };

  const onCopy = async () => {
    if (code === null) return;
    const ok = await copyText(code);
    toast(ok ? 'Copied to clipboard' : 'Could not copy — select the code and copy it manually');
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };

  const onDownload = () => {
    if (code === null) return;
    const name = showingSelection ? 'selection.tsx' : baseName(codePath);
    downloadFile(name, code, languageForPath(name) === 'json' ? 'application/json' : 'text/plain');
  };

  return (
    <div className="ub-sh-code">
      <nav className="ub-sh-code-tree ub-scroll" aria-label="Project files">
        {error && !files && <div className="ub-sh-code-tree-error">No files</div>}
        {tree && (
          <FileTree
            dir={tree}
            depth={0}
            selected={showingSelection ? null : current?.path ?? null}
            onSelect={(p) => {
              setPath(p);
              setSelectionOn(false);
            }}
          />
        )}
      </nav>
      <div className="ub-sh-code-main">
        <div className="ub-sh-code-toolbar">
          <div className="ub-sh-code-path" title={showingSelection ? undefined : codePath}>
            {showingSelection ? (
              <>
                <Crosshair size={13} aria-hidden />
                <span>{nodeJsx?.kind === 'code' ? `Selection: ${nodeJsx.label}` : 'Selection'}</span>
              </>
            ) : (
              <span>{current?.path ?? ''}</span>
            )}
            {pending && <span className="ub-sh-code-status">Formatting…</span>}
          </div>
          <button
            type="button"
            className={cx('ub-sh-chip', selectionOn && 'ub-sh-chip--on')}
            aria-pressed={selectionOn}
            title="Show only the JSX of the selected component"
            onClick={() => setSelectionOn((v) => !v)}
          >
            <Crosshair size={12} aria-hidden /> Selection
          </button>
          <button
            type="button"
            className={cx('ub-sh-chip', formatOn && 'ub-sh-chip--on')}
            aria-pressed={formatOn}
            title="Format the code with Prettier (the exported project can be formatted too)"
            onClick={toggleFormat}
          >
            <WandSparkles size={12} aria-hidden /> Format with Prettier
          </button>
          <span className="ub-sh-code-sep" aria-hidden />
          <button type="button" className="ub-icon-btn ub-icon-btn--sm" aria-label="Copy to clipboard" title="Copy to clipboard" onClick={onCopy} disabled={code === null}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <button type="button" className="ub-icon-btn ub-icon-btn--sm" aria-label="Download file" title="Download file" onClick={onDownload} disabled={code === null}>
            <Download size={13} />
          </button>
        </div>
        <div className="ub-sh-code-view ub-scroll">
          {error && (
            <div className="ub-sh-code-error" role="alert">
              <TriangleAlert size={14} aria-hidden />
              <div>
                <strong>Code generation failed.</strong> {error}
                {files && <div className="ub-sh-code-error-sub">Showing the last generated version.</div>}
              </div>
            </div>
          )}
          {showingSelection && nodeJsx?.kind === 'empty' ? (
            <EmptyState icon={<MousePointerClick size={22} />} title="Nothing selected">
              Select a component on the canvas or in Layers to see its JSX.
            </EmptyState>
          ) : showingSelection && nodeJsx?.kind === 'error' ? (
            <EmptyState icon={<TriangleAlert size={22} />} title="Can't show the selection">
              {nodeJsx.error}
            </EmptyState>
          ) : code !== null ? (
            <CodeViewer code={code} language={languageForPath(codePath)} lineNumbers className="ub-sh-code-viewer" />
          ) : (
            !error && <div className="ub-sh-code-loading">Generating…</div>
          )}
        </div>
      </div>
    </div>
  );
}

function FileTree({
  dir,
  depth,
  selected,
  onSelect,
}: {
  dir: FileTreeDir;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  return (
    <ul className="ub-sh-code-list" role={depth === 0 ? 'list' : undefined}>
      {dir.dirs.map((d) => (
        <FolderItem key={d.path} dir={d} depth={depth} selected={selected} onSelect={onSelect} />
      ))}
      {dir.files.map((f) => {
        const Icon = fileIcon(f.path);
        return (
          <li key={f.path}>
            <button
              type="button"
              className={cx('ub-sh-code-item', f.path === selected && 'ub-sh-code-item--active')}
              style={{ paddingLeft: 8 + depth * 12 + 14 }}
              aria-current={f.path === selected ? 'true' : undefined}
              title={f.path}
              onClick={() => onSelect(f.path)}
            >
              <Icon size={13} aria-hidden className="ub-sh-code-item-icon" />
              <FileName name={baseName(f.path)} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** File name whose extension stays visible when the base name is truncated. */
function FileName({ name }: { name: string }) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return <span className="ub-sh-code-item-name">{name}</span>;
  return (
    <span className="ub-sh-code-item-name ub-sh-code-item-name--split">
      <span className="ub-sh-code-item-base">{name.slice(0, dot)}</span>
      <span className="ub-sh-code-item-ext">{name.slice(dot)}</span>
    </span>
  );
}

function FolderItem({
  dir,
  depth,
  selected,
  onSelect,
}: {
  dir: FileTreeDir;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <li>
      <button
        type="button"
        className="ub-sh-code-item ub-sh-code-item--dir"
        style={{ paddingLeft: 8 + depth * 12 }}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={12} aria-hidden /> : <ChevronRight size={12} aria-hidden />}
        {open ? <FolderOpen size={13} aria-hidden className="ub-sh-code-item-icon" /> : <Folder size={13} aria-hidden className="ub-sh-code-item-icon" />}
        <span className="ub-sh-code-item-name">{dir.name}</span>
      </button>
      {open && <FileTree dir={dir} depth={depth + 1} selected={selected} onSelect={onSelect} />}
    </li>
  );
}
