/**
 * Problems tab: validateProject results grouped by extension. Clicking a problem takes the user to
 * the component / inspector tab / dialog where it can be fixed.
 */
import { useMemo, useState } from 'react';
import { CircleAlert, CircleCheck, Info, LayoutPanelTop, Package, TriangleAlert, WandSparkles } from 'lucide-react';
import { useEditor } from '../model/store';
import { nodeLabel } from '../model/tree';
import { getComponent } from '../registry';
import type { Issue, IssueSeverity } from '../model/validate';
import { EmptyState, cx, useToast } from '../ui';
import { typeLabel } from './actions';
import { navigateToIssue, useProblems } from './problems';
import { quickFixFor } from './quickFixes';
import { ExtensionKindIcon } from './ExtensionKindIcon';

type Filter = 'all' | IssueSeverity;

const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };

export function SeverityIcon({ severity, size = 14 }: { severity: IssueSeverity; size?: number }) {
  if (severity === 'error') return <CircleAlert size={size} className="ub-sh-sev ub-sh-sev--error" aria-label="Error" />;
  if (severity === 'warning') return <TriangleAlert size={size} className="ub-sh-sev ub-sh-sev--warning" aria-label="Warning" />;
  return <Info size={size} className="ub-sh-sev ub-sh-sev--info" aria-label="Info" />;
}

function NodeChip({ type, label }: { type: string; label: string }) {
  const Icon = getComponent(type)?.icon ?? LayoutPanelTop;
  return (
    <span className="ub-sh-prob-where" title={label}>
      <Icon size={11} aria-hidden />
      <span className="ub-sh-prob-where-label">{label}</span>
    </span>
  );
}

export function ProblemsPanel() {
  const issues = useProblems((s) => s.issues);
  const errors = useProblems((s) => s.errors);
  const warnings = useProblems((s) => s.warnings);
  const infos = useProblems((s) => s.infos);
  const failure = useProblems((s) => s.failure);
  const project = useEditor((s) => s.project);
  const activeExtId = useEditor((s) => s.activeExtensionId);
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');

  const groups = useMemo(() => {
    const visible = issues
      .filter((i) => filter === 'all' || i.severity === filter)
      .slice()
      .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
    const byExt = new Map<string, Issue[]>();
    for (const issue of visible) {
      const key = issue.extensionId && project.extensions.some((e) => e.id === issue.extensionId) ? issue.extensionId : '__project';
      if (!byExt.has(key)) byExt.set(key, []);
      byExt.get(key)!.push(issue);
    }
    const ordered: Array<{ key: string; title: string; ext?: (typeof project.extensions)[number]; issues: Issue[] }> = [];
    if (byExt.has('__project')) ordered.push({ key: '__project', title: 'Project & app', issues: byExt.get('__project')! });
    for (const ext of project.extensions) {
      const list = byExt.get(ext.id);
      if (list) ordered.push({ key: ext.id, title: ext.name, ext, issues: list });
    }
    return ordered;
  }, [issues, filter, project.extensions]);

  if (failure) {
    return (
      <div className="ub-sh-prob ub-sh-prob--center">
        <EmptyState icon={<TriangleAlert size={22} />} title="Validation failed">
          {failure}
        </EmptyState>
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <div className="ub-sh-prob ub-sh-prob--center">
        <EmptyState icon={<CircleCheck size={24} className="ub-sh-sev--ok" />} title="No problems — ready to publish">
          Required props, names, references and permissions all check out.
        </EmptyState>
      </div>
    );
  }

  const chip = (value: Filter, label: string, count: number) => (
    <button
      type="button"
      className={cx('ub-sh-chip', filter === value && 'ub-sh-chip--on')}
      aria-pressed={filter === value}
      onClick={() => setFilter(value)}
    >
      {value !== 'all' && <SeverityIcon severity={value} size={12} />}
      {label}
      <span className="ub-sh-chip-count">{count}</span>
    </button>
  );

  return (
    <div className="ub-sh-prob">
      <div className="ub-sh-prob-toolbar">
        {chip('all', 'All', issues.length)}
        {chip('error', 'Errors', errors)}
        {chip('warning', 'Warnings', warnings)}
        {infos > 0 && chip('info', 'Info', infos)}
        <span className="ub-sh-prob-hint">Click a problem to jump to it</span>
      </div>
      <div className="ub-sh-prob-list ub-scroll">
        {groups.length === 0 && <div className="ub-sh-prob-none">No {filter === 'error' ? 'errors' : filter === 'warning' ? 'warnings' : 'messages'}.</div>}
        {groups.map((g) => (
          <section key={g.key} className="ub-sh-prob-group" aria-label={g.title}>
            <div className="ub-sh-prob-group-head">
              {g.ext ? <ExtensionKindIcon kind={g.ext.kind} size={13} /> : <Package size={13} aria-hidden />}
              <span className="ub-sh-prob-group-title">{g.title}</span>
              {g.ext && g.ext.id === activeExtId && <span className="ub-sh-prob-current">current</span>}
              <span className="ub-sh-prob-group-count">{g.issues.length}</span>
            </div>
            <ul className="ub-sh-prob-items">
              {g.issues.map((issue) => {
                const node = g.ext && issue.nodeId ? g.ext.nodes[issue.nodeId] : undefined;
                const fix = quickFixFor(issue, project);
                return (
                  <li key={issue.id} className="ub-sh-prob-row">
                    <button
                      type="button"
                      className={cx('ub-sh-prob-item', `ub-sh-prob-item--${issue.severity}`)}
                      onClick={() => navigateToIssue(issue)}
                      title="Go to problem"
                    >
                      <SeverityIcon severity={issue.severity} />
                      <span className="ub-sh-prob-msg">{issue.message}</span>
                      {node && <NodeChip type={node.type} label={nodeLabel(node, typeLabel(node.type))} />}
                      <span className="ub-sh-prob-rule">{issue.rule}</span>
                    </button>
                    {fix && (
                      <button type="button" className="ub-sh-prob-fix" title={fix.title} onClick={() => toast(fix.apply())}>
                        <WandSparkles size={12} aria-hidden />
                        {fix.label}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
