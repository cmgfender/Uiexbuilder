/** Export: download the HubSpot project, browse every generated file, and deployment steps. */
import { useEffect, useMemo, useState } from 'react';
import {
  CircleCheck,
  Download,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Info,
  SquareFunction,
  TriangleAlert,
} from 'lucide-react';
import { buildProjectZip, formatSource, generateProjectFiles, planExtensionFiles, zipRootFolder } from '../codegen';
import type { GeneratedFile } from '../codegen';
import { downloadFile, serializeProject } from '../model/persistence';
import { useEditor } from '../model/store';
import type { Extension } from '../model/types';
import { validateProject } from '../model/validate';
import { Badge, Button, Dialog, Switch, Tabs, cx, tabPanelProps, useToast } from '../ui';
import { CodeViewer } from '../ui/CodeViewer';
import { Callout, CopyButton, Snippet } from './common';
import type { DialogComponentProps } from './dialogTypes';
import { ExtensionIcon } from './icons';
import { buildTree, deploySteps, exportAdditions, languageOf, type TreeDir } from './exportModel';
import { CARD_LOCATIONS } from './locations';
import { DeployToHubSpotPanel } from './deploy';

type Tab = 'download' | 'hubspot' | 'files' | 'deploy';

function tabFromArg(arg: string | null | undefined): Tab {
  return arg === 'files' || arg === 'deploy' || arg === 'hubspot' ? arg : 'download';
}

export function ExportDialog({ open, onClose, arg }: DialogComponentProps) {
  const [tab, setTab] = useState<Tab>(tabFromArg(arg));
  useEffect(() => {
    if (open) setTab(tabFromArg(arg));
  }, [open, arg]);
  if (!open) return null;
  return (
    <Dialog open={open} onClose={onClose} title="Export project" wide>
      <Tabs<Tab>
        className="ub-pn-dialog-tabs"
        idBase="ub-pn-export"
        aria-label="Export sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'download', label: 'Download' },
          { value: 'hubspot', label: 'Deploy to HubSpot' },
          { value: 'files', label: 'Files' },
          { value: 'deploy', label: 'Deploy with CLI' },
        ]}
      />
      <div className="ub-pn-dialog-pane" {...tabPanelProps('ub-pn-export', tab)}>
        {tab === 'download' && <DownloadTab onClose={onClose} onShowDeploy={() => setTab('deploy')} />}
        {tab === 'hubspot' && <DeployToHubSpotPanel cliFallback={<DeployTab />} onShowCli={() => setTab('deploy')} onClose={onClose} />}
        {tab === 'files' && <FilesTab />}
        {tab === 'deploy' && <DeployTab />}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------



function whereLabel(ext: Extension): string {
  if (ext.kind === 'settings') return 'Settings page';
  if (ext.kind === 'home') return 'App home page';
  const loc = CARD_LOCATIONS.find((l) => l.value === ext.location)?.label ?? ext.location;
  return `${loc} · ${ext.objectTypes.join(', ') || 'no object types'}`;
}

function DownloadTab({ onClose, onShowDeploy }: { onClose: () => void; onShowDeploy: () => void }) {
  const project = useEditor((s) => s.project);
  const toast = useToast();
  const issues = useMemo(() => validateProject(project), [project]);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const additions = useMemo(() => exportAdditions(project), [project]);
  const plans = useMemo(() => planExtensionFiles(project), [project]);
  const blocked = errors.length > 0 && !ack;
  const urlAdds = [...additions.fetch, ...additions.iframe, ...additions.img];

  const showProblems = () => {
    useEditor.getState().setBottomPanel('problems');
    onClose();
  };

  const downloadZip = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const blob = await buildProjectZip(project);
      downloadFile(`${project.name}.zip`, blob, 'application/zip');
      toast(`Downloaded ${project.name}.zip`);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ub-pn-form">
      {errors.length > 0 ? (
        <Callout tone="danger" icon={<TriangleAlert size={14} aria-hidden />} role="alert">
          <div className="ub-pn-strong">
            {errors.length} error{errors.length === 1 ? '' : 's'}
            {warnings.length ? ` and ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''} may stop the project from
            building or uploading.
          </div>
          <div className="ub-pn-row">
            <button type="button" className="ub-pn-link" onClick={showProblems}>
              Show problems
            </button>
            <span className="ub-pn-spacer" />
            <Switch checked={ack} onChange={setAck} label="Export anyway" />
          </div>
        </Callout>
      ) : warnings.length > 0 ? (
        <Callout tone="warning" icon={<TriangleAlert size={14} aria-hidden />}>
          {warnings.length} warning{warnings.length === 1 ? '' : 's'} — the project can be exported.{' '}
          <button type="button" className="ub-pn-link" onClick={showProblems}>
            Show problems
          </button>
        </Callout>
      ) : (
        <Callout tone="success" icon={<CircleCheck size={14} aria-hidden />}>
          No problems found — ready to export.
        </Callout>
      )}

      <div className="ub-pn-summary">
        <section className="ub-pn-card" aria-label="Project">
          <h3 className="ub-pn-h3">Project</h3>
          <dl className="ub-pn-dl">
            <dt>Name</dt>
            <dd>
              <code>{project.name}</code>
            </dd>
            <dt>Platform</dt>
            <dd>{project.platformVersion}</dd>
            <dt>App</dt>
            <dd>{project.app.name}</dd>
            <dt>Auth</dt>
            <dd>
              {project.app.distribution === 'marketplace' ? 'Marketplace' : 'Private'} · {project.app.authType === 'oauth' ? 'OAuth' : 'Static token'}
            </dd>
          </dl>
        </section>
        <section className="ub-pn-card" aria-label="Extensions">
          <h3 className="ub-pn-h3">
            Extensions <Badge>{project.extensions.length}</Badge>
          </h3>
          <ul className="ub-pn-plain">
            {plans.map((p) => (
              <li key={p.ext.id} className="ub-pn-sum-item">
                <ExtensionIcon kind={p.ext.kind} size={13} />
                <span className="ub-pn-sum-item__text">
                  <span>{p.ext.name}</span>
                  <span className="ub-pn-muted">{whereLabel(p.ext)}</span>
                  <code className="ub-pn-path">{p.sourcePath}</code>
                </span>
              </li>
            ))}
          </ul>
          {project.functions.length > 0 && (
            <>
              <h3 className="ub-pn-h3">
                Functions <Badge>{project.functions.length}</Badge>
              </h3>
              <ul className="ub-pn-plain">
                {project.functions.map((f) => (
                  <li key={f.id} className="ub-pn-sum-item">
                    <SquareFunction size={13} aria-hidden />
                    <span className="ub-pn-sum-item__text">
                      <span>{f.uid}</span>
                      <code className="ub-pn-path">src/app/functions/{f.fileName}.js</code>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section className="ub-pn-card" aria-label="Added automatically">
          <h3 className="ub-pn-h3">Added automatically</h3>
          {additions.scopes.length === 0 && urlAdds.length === 0 ? (
            <div className="ub-pn-muted">Your app settings already include everything the extensions need.</div>
          ) : (
            <>
              {additions.scopes.length > 0 && (
                <div className="ub-pn-stack">
                  <span className="ub-pn-muted">Required scopes</span>
                  <div className="ub-pn-chip-list">
                    {additions.scopes.map((s) => (
                      <code key={s} className="ub-pn-tag">
                        {s}
                      </code>
                    ))}
                  </div>
                </div>
              )}
              {urlAdds.length > 0 && (
                <div className="ub-pn-stack">
                  <span className="ub-pn-muted">Permitted URLs</span>
                  <div className="ub-pn-chip-list">
                    {urlAdds.map((u) => (
                      <code key={u} className="ub-pn-tag">
                        {u}
                      </code>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {failure && (
        <Callout tone="danger" icon={<TriangleAlert size={14} aria-hidden />} role="alert">
          Export failed: {failure}
        </Callout>
      )}

      <div className="ub-pn-row ub-pn-row--between ub-pn-export-actions">
        <button type="button" className="ub-pn-link" onClick={onShowDeploy}>
          How do I deploy it?
        </button>
        <span className="ub-pn-row">
          <Button
            icon={<FileJson size={14} aria-hidden />}
            title="Save the builder document to re-import later"
            onClick={() => {
              downloadFile(`${project.name}.uiex.json`, serializeProject(project), 'application/json');
              toast(`Downloaded ${project.name}.uiex.json`);
            }}
          >
            Download builder file (.uiex.json)
          </Button>
          <Button
            variant="primary"
            icon={<Download size={14} aria-hidden />}
            disabled={busy || blocked}
            title={blocked ? 'Fix the errors or turn on “Export anyway”' : undefined}
            onClick={() => void downloadZip()}
          >
            {busy ? 'Building…' : 'Download project (.zip)'}
          </Button>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------



function fileIcon(path: string) {
  const lang = languageOf(path);
  if (lang === 'json') return FileJson;
  if (lang === 'markdown' || lang === 'text') return FileText;
  return FileCode2;
}

function FilesTab() {
  const project = useEditor((s) => s.project);
  const generated = useMemo((): { files: GeneratedFile[]; error: string | null } => {
    try {
      return { files: generateProjectFiles(project), error: null };
    } catch (e) {
      return { files: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, [project]);
  const files = generated.files;
  const tree = useMemo(() => buildTree(files), [files]);
  const defaultPath = files.find((f) => f.path.endsWith('.tsx'))?.path ?? files[0]?.path ?? '';
  const [selected, setSelected] = useState(defaultPath);
  const [pretty, setPretty] = useState(true);
  const [formatted, setFormatted] = useState<{ key: string; code: string } | null>(null);
  const file = files.find((f) => f.path === selected) ?? files.find((f) => f.path === defaultPath) ?? null;
  const key = file ? `${file.path}\u0000${file.contents}` : '';

  useEffect(() => {
    if (!file || !pretty || file.path === '.uiex.json') return;
    let alive = true;
    void formatSource(file.contents, file.path).then((code) => {
      if (alive) setFormatted({ key, code });
    });
    return () => {
      alive = false;
    };
  }, [file, pretty, key]);

  const code = file ? (pretty && formatted?.key === key ? formatted.code : file.contents) : '';
  const formatting = !!file && pretty && file.path !== '.uiex.json' && formatted?.key !== key;

  if (generated.error) {
    return (
      <Callout tone="danger" icon={<TriangleAlert size={14} aria-hidden />} role="alert">
        Code generation failed: {generated.error}
      </Callout>
    );
  }

  return (
    <div className="ub-pn-files">
      <nav className="ub-pn-files__tree ub-scroll" aria-label="Project files">
        <div className="ub-pn-tree-root">
          <FolderOpen size={13} aria-hidden /> {zipRootFolder(project)}
        </div>
        <TreeView dir={tree} depth={0} selected={file?.path ?? ''} onSelect={setSelected} />
      </nav>
      <div className="ub-pn-files__main">
        <div className="ub-pn-files__toolbar">
          <code className="ub-pn-path" title={file?.path}>
            {file?.path}
          </code>
          <span className="ub-pn-spacer" />
          {formatting && <span className="ub-pn-muted">Formatting…</span>}
          <Switch checked={pretty} onChange={setPretty} label="Prettier" />
          {file && <CopyButton text={code} label="Copy file contents" />}
          {file && (
            <Button
              size="sm"
              variant="ghost"
              icon={<Download size={13} aria-hidden />}
              onClick={() => downloadFile(file.path.split('/').pop() ?? 'file.txt', code, languageOf(file.path) === 'json' ? 'application/json' : 'text/plain')}
            >
              Download
            </Button>
          )}
        </div>
        <div className="ub-pn-files__code">
          {file ? <CodeViewer code={code} language={languageOf(file.path)} lineNumbers className="ub-pn-files__viewer" /> : null}
        </div>
      </div>
    </div>
  );
}

function TreeView({ dir, depth, selected, onSelect }: { dir: TreeDir; depth: number; selected: string; onSelect: (path: string) => void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  return (
    <ul className="ub-pn-tree" aria-label={depth === 0 ? 'Project files' : undefined}>
      {dir.dirs.map((d) => {
        const isOpen = !collapsed.has(d.path);
        return (
          <li key={d.path}>
            <button
              type="button"
              aria-expanded={isOpen}
              className="ub-pn-tree__item ub-pn-tree__item--dir"
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() =>
                setCollapsed((c) => {
                  const next = new Set(c);
                  if (next.has(d.path)) next.delete(d.path);
                  else next.add(d.path);
                  return next;
                })
              }
            >
              {isOpen ? <FolderOpen size={13} aria-hidden /> : <Folder size={13} aria-hidden />}
              <span className="ub-pn-tree__name">{d.name}</span>
            </button>
            {isOpen && <TreeView dir={d} depth={depth + 1} selected={selected} onSelect={onSelect} />}
          </li>
        );
      })}
      {dir.files.map((f) => {
        const Icon = fileIcon(f.path);
        const name = f.path.split('/').pop();
        return (
          <li key={f.path}>
            <button
              type="button"
              aria-current={f.path === selected ? 'true' : undefined}
              className={cx('ub-pn-tree__item', f.path === selected && 'ub-pn-tree__item--active')}
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => onSelect(f.path)}
              title={f.path}
            >
              <Icon size={13} aria-hidden />
              <span className="ub-pn-tree__name">{name}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Deploy
// ---------------------------------------------------------------------------




function DeployTab() {
  const project = useEditor((s) => s.project);
  const steps = useMemo(() => deploySteps(project), [project]);
  return (
    <div className="ub-pn-form">
      <Callout tone="info" icon={<Info size={14} aria-hidden />}>
        Deploy with the HubSpot CLI from a terminal. You need a HubSpot account with developer projects enabled.
      </Callout>
      <ol className="ub-pn-steps">
        {steps.map((s, i) => (
          <li key={i} className="ub-pn-step">
            <span className="ub-pn-step__num" aria-hidden>
              {i + 1}
            </span>
            <div className="ub-pn-step__body">
              <div className="ub-pn-strong">{s.title}</div>
              {s.body && <div className="ub-pn-muted">{s.body}</div>}
              {s.commands?.map((c) => <Snippet key={c} code={c} block />)}
            </div>
          </li>
        ))}
      </ol>
      <a
        className="ub-pn-link ub-pn-link--icon"
        href="https://developers.hubspot.com/docs/apps/developer-platform/build-apps/create-an-app"
        target="_blank"
        rel="noreferrer"
      >
        HubSpot developer platform docs
      </a>
    </div>
  );
}
