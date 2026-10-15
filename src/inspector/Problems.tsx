/**
 * Problems for the selected node: validateProject() filtered by node id, recomputed (debounced)
 * after document changes. Clicking a problem jumps to the related field / tab.
 */
import { useEffect, useRef, useState } from 'react';
import { CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { useEditor, type RightPanelTab } from '../model/store';
import type { NodeId } from '../model/types';
import { validateProject, type Issue } from '../model/validate';
import { cx } from '../ui';

export const NODE_PROBLEMS_DEBOUNCE_MS = 250;

function nodeIssues(nodeId: NodeId, extensionId: string): Issue[] {
  try {
    const order = { error: 0, warning: 1, info: 2 } as const;
    return validateProject(useEditor.getState().project)
      .filter((i) => i.nodeId === nodeId && (!i.extensionId || i.extensionId === extensionId))
      .sort((a, b) => order[a.severity] - order[b.severity]);
  } catch {
    return [];
  }
}

/** Issues for a node, recomputed after edits (debounced). */
export function useNodeIssues(nodeId: NodeId, extensionId: string): Issue[] {
  const [issues, setIssues] = useState<Issue[]>(() => nodeIssues(nodeId, extensionId));
  const project = useEditor((s) => s.project);
  const first = useRef(true);
  useEffect(() => {
    setIssues(nodeIssues(nodeId, extensionId));
    first.current = true;
  }, [nodeId, extensionId]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => setIssues(nodeIssues(nodeId, extensionId)), NODE_PROBLEMS_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [project, nodeId, extensionId]);
  return issues;
}

/** Tab that holds the field an issue refers to. */
export function issueTab(issue: Issue): RightPanelTab {
  const f = issue.field ?? '';
  if (f.startsWith('event:')) return 'events';
  if (f === 'condition' || f === 'repeat' || f.startsWith('repeat')) return 'advanced';
  return 'properties';
}

const esc = (s: string) => s.replace(/["\\]/g, '\\$&');

/** Scrolls to and focuses the element for an issue's field (after the tab switch rendered). */
export function revealField(issue: Issue): void {
  const f = issue.field ?? '';
  const selector = f.startsWith('event:')
    ? `[data-event="${esc(f.slice(6))}"]`
    : f === 'condition' || f.startsWith('repeat')
      ? `[data-adv="${esc(f.startsWith('repeat') ? 'repeat' : 'condition')}"]`
      : f === 'binding'
        ? '[data-section="binding"]'
        : f === 'text'
          ? '[data-prop="__text"]'
          : `[data-prop="${esc(f)}"]`;
  // Two frames: the selection / tab switch that precedes this call has rendered by then.
  const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: () => void) => setTimeout(cb, 16);
  frame(() => frame(() => {
    const el = document.querySelector<HTMLElement>(`.ub-insp ${selector}`);
    if (!el) return;
    el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    el.classList.add('ub-insp-flash');
    setTimeout(() => el.classList.remove('ub-insp-flash'), 1200);
    el.querySelector<HTMLElement>('input, textarea, select, button')?.focus({ preventScroll: true });
  }));
}

const ICONS = { error: CircleAlert, warning: TriangleAlert, info: Info } as const;

export function NodeProblems({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="ub-insp-problems" aria-label="Problems with this component">
      {issues.map((issue) => {
        const Icon = ICONS[issue.severity];
        return (
          <li key={issue.id}>
            <button
              type="button"
              className={cx('ub-insp-problem', `is-${issue.severity}`)}
              title={issue.field ? 'Show the related setting' : undefined}
              onClick={() => {
                useEditor.getState().setRightPanel(issueTab(issue));
                revealField(issue);
              }}
            >
              <Icon size={13} aria-hidden />
              <span>{issue.message}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
