/**
 * Events tab: one block per event the component fires, with a plain-language summary of what
 * happens and the action list editor.
 */
import { MousePointerClick, Zap } from 'lucide-react';
import { useEditor } from '../model/store';
import type { Extension, Project, UINode } from '../model/types';
import { getComponent } from '../registry';
import type { ComponentDef, EventDef } from '../registry/types';
import { Badge, EmptyState } from '../ui';
import { ActionList, ParamChips } from './ActionList';
import { countSteps, summarizeHandler, type ActionContext } from './actionModel';

export interface EventsTabProps {
  node: UINode;
  def: ComponentDef;
  ext: Extension;
  project: Project;
}

export function EventsTab({ node, def, ext, project }: EventsTabProps) {
  const events = def.events ?? [];
  if (!events.length) {
    return (
      <div className="ub-insp-tabpanel">
        <EmptyState icon={<MousePointerClick size={20} aria-hidden />} title={`${def.label} has no events`}>
          Interactive components such as buttons, links, inputs, tabs and tables fire events you can attach actions to.
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="ub-insp-tabpanel ub-insp-events">
      {events.map((ev) => (
        <EventBlock key={`${node.id}:${ev.name}`} node={node} def={def} ev={ev} ext={ext} project={project} />
      ))}
    </div>
  );
}

function EventBlock({ node, def, ev, ext, project }: { node: UINode; def: ComponentDef; ev: EventDef; ext: Extension; project: Project }) {
  const setEvent = useEditor((s) => s.setEvent);
  const steps = node.events?.[ev.name] ?? [];
  const params = ev.params.map((p) => p.name);
  const ctx: ActionContext = { project, ext, nodeId: node.id, eventParams: params };
  let required = false;
  try {
    required = !!ev.requiredWhen?.(node.props);
  } catch {
    required = false;
  }
  const boundState = node.binding && def.valueBinding?.event === ev.name ? node.binding.state : null;
  const overlayId = ev.name === 'onClick' ? node.slots?.overlay?.[0] : undefined;
  const overlay = overlayId ? ext.nodes[overlayId] : undefined;
  const n = countSteps(steps);
  const paramTitle = ev.params.map((p) => `${p.name}${p.description ? ` — ${p.description}` : ''}`).join('\n');

  return (
    <section className="ub-insp-event" data-event={ev.name} aria-label={`${ev.label} event`}>
      <header className="ub-insp-event__head">
        <Zap size={13} aria-hidden className="ub-insp-event__icon" />
        <span className="ub-insp-event__label">{ev.label}</span>
        <ParamChips params={params} title={paramTitle} />
        {n > 0 && (
          <Badge tone="select" title={`${n} action${n === 1 ? '' : 's'}`}>
            {n}
          </Badge>
        )}
        <code className="ub-insp-event__name">{ev.name}</code>
      </header>
      {ev.description && <div className="ub-insp-help">{ev.description}</div>}
      {boundState && (
        <div className="ub-insp-note is-info">
          Also updates <code>{boundState}</code> automatically (value binding).
        </div>
      )}
      {overlay && (
        <div className="ub-insp-note is-info">Also opens the attached {getComponent(overlay.type)?.label.toLowerCase() ?? 'overlay'}.</div>
      )}
      {required && steps.length === 0 && !boundState && (
        <div className="ub-insp-note">Required with the current settings — an empty handler is generated until you add actions.</div>
      )}
      <div className="ub-insp-summary" aria-live="polite">
        {summarizeHandler(ev.label, steps, ctx)}
      </div>
      <ActionList
        steps={steps}
        onChange={(next) => setEvent(node.id, ev.name, next)}
        ctx={ctx}
        label={`${ev.label} actions`}
        emptyText="No actions yet — add one to make this interactive."
      />
    </section>
  );
}
