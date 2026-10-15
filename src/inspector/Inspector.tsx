/**
 * Inspector (right sidebar): edits the selected component — Properties | Events | Advanced — or,
 * with nothing selected, the active extension's settings.
 */
import { CircleHelp } from 'lucide-react';
import { useActiveExtension, useEditor, type RightPanelTab } from '../model/store';
import { ROOT_TYPE, type Extension, type UINode } from '../model/types';
import { getComponent } from '../registry';
import type { ComponentDef } from '../registry/types';
import { Button, EmptyState, Tabs } from '../ui';
import { AdvancedTab } from './AdvancedTab';
import { countSteps } from './actionModel';
import { EventsTab } from './EventsTab';
import { ExtensionSettings } from './ExtensionSettings';
import { NodeHeader } from './NodeHeader';
import { NodeProblems, useNodeIssues } from './Problems';
import { PropertiesTab } from './PropertiesTab';
import './inspector.css';

export function Inspector() {
  const ext = useActiveExtension();
  const project = useEditor((s) => s.project);
  const selectedId = useEditor((s) => s.selectedNodeId);
  const node = selectedId ? ext.nodes[selectedId] : undefined;
  if (!node || node.type === ROOT_TYPE) return <ExtensionSettings ext={ext} project={project} />;
  const def = getComponent(node.type);
  if (!def) return <UnknownComponent node={node} />;
  return <NodeInspector node={node} def={def} ext={ext} />;
}

function UnknownComponent({ node }: { node: UINode }) {
  return (
    <div className="ub-insp">
      <EmptyState icon={<CircleHelp size={20} aria-hidden />} title={`Unknown component “${node.type}”`}>
        This component isn’t in the registry, so it can’t be edited here.
        <div className="ub-insp-row-actions is-center">
          <Button size="sm" variant="danger" onClick={() => useEditor.getState().removeNode(node.id)}>
            Delete it
          </Button>
        </div>
      </EmptyState>
    </div>
  );
}

function NodeInspector({ node, def, ext }: { node: UINode; def: ComponentDef; ext: Extension }) {
  const project = useEditor((s) => s.project);
  const tab = useEditor((s) => s.rightPanel);
  const setTab = useEditor((s) => s.setRightPanel);
  const issues = useNodeIssues(node.id, ext.id);
  const eventCount = (def.events ?? []).filter((e) => countSteps(node.events?.[e.name]) > 0).length;
  const advancedSet = !!node.condition || !!node.repeat;

  const tabs: Array<{ value: RightPanelTab; label: string; badge?: React.ReactNode }> = [
    { value: 'properties', label: 'Properties' },
    {
      value: 'events',
      label: 'Events',
      badge: eventCount ? (
        <span className="ub-insp-tabcount" aria-label={`${eventCount} configured`}>
          {eventCount}
        </span>
      ) : undefined,
    },
    {
      value: 'advanced',
      label: 'Advanced',
      badge: advancedSet ? (
        <span className="ub-insp-tabdot" aria-label="(condition or repeat set)" title="Condition or repeat set" />
      ) : undefined,
    },
  ];

  return (
    <div className="ub-insp" data-node-type-inspected={node.type}>
      <NodeHeader node={node} def={def} ext={ext} project={project} />
      <Tabs<RightPanelTab> className="ub-insp-tabs" value={tab} onChange={setTab} tabs={tabs} />
      <div className="ub-insp-body ub-scroll" role="tabpanel" aria-label={tabs.find((t) => t.value === tab)?.label}>
        <NodeProblems issues={issues} />
        {tab === 'properties' && <PropertiesTab key={node.id} node={node} def={def} ext={ext} />}
        {tab === 'events' && <EventsTab key={node.id} node={node} def={def} ext={ext} project={project} />}
        {tab === 'advanced' && <AdvancedTab key={node.id} node={node} def={def} ext={ext} />}
      </div>
    </div>
  );
}
