/**
 * Left sidebar (Components | Layers | Templates | Data) and right sidebar (Inspector). Both
 * collapse into a slim icon rail.
 */
import { Blocks, Database, Layers, LayoutGrid, PanelLeftClose, PanelLeftOpen, PanelRightOpen, SlidersHorizontal, WandSparkles, Zap } from 'lucide-react';
import { useEditor, type LeftPanelTab, type RightPanelTab } from '../model/store';
import { Inspector } from '../inspector';
import { DataPanel } from '../panels';
import { TemplatesPanel } from '../templates';
import { IconButton, Tabs } from '../ui';
import { LayersPanel } from './LayersPanel';
import { Palette } from './Palette';
import { showLeftTab, showRightTab, useShell } from './shellStore';
import { shortcutLabel } from './shortcuts';

const LEFT_TABS: Array<{ value: LeftPanelTab; label: string; icon: typeof Layers; shortcut: string }> = [
  { value: 'components', label: 'Components', icon: LayoutGrid, shortcut: 'tabComponents' },
  { value: 'layers', label: 'Layers', icon: Layers, shortcut: 'tabLayers' },
  { value: 'templates', label: 'Templates', icon: Blocks, shortcut: 'tabTemplates' },
  { value: 'data', label: 'Data', icon: Database, shortcut: 'tabData' },
];

export function LeftSidebar() {
  const tab = useEditor((s) => s.leftPanel);
  const collapsed = useShell((s) => s.leftCollapsed);

  if (collapsed) {
    return (
      <aside className="ub-sh-left ub-sh-rail" aria-label="Left sidebar (collapsed)">
        <IconButton label="Expand sidebar" onClick={() => useShell.getState().setLeftCollapsed(false)}>
          <PanelLeftOpen size={16} />
        </IconButton>
        <span className="ub-sh-rail-sep" aria-hidden />
        {LEFT_TABS.map((t) => (
          <IconButton key={t.value} label={`${t.label} (${shortcutLabel(t.shortcut)})`} active={tab === t.value} onClick={() => showLeftTab(t.value)}>
            <t.icon size={16} />
          </IconButton>
        ))}
      </aside>
    );
  }

  return (
    <aside className="ub-sh-left" aria-label="Components, layers, templates and data">
      <div className="ub-sh-left-head">
        <Tabs<LeftPanelTab>
          className="ub-sh-left-tabs"
          value={tab}
          onChange={(v) => useEditor.getState().setLeftPanel(v)}
          tabs={LEFT_TABS.map((t) => ({ value: t.value, label: t.label }))}
        />
        <IconButton label="Hide sidebar" size="sm" className="ub-sh-left-collapse" onClick={() => useShell.getState().setLeftCollapsed(true)}>
          <PanelLeftClose size={14} />
        </IconButton>
      </div>
      <div className="ub-sh-left-body" role="tabpanel" aria-label={LEFT_TABS.find((t) => t.value === tab)?.label}>
        {tab === 'components' && <Palette />}
        {tab === 'layers' && <LayersPanel />}
        {tab === 'templates' && (
          <div className="ub-sh-left-scroll ub-scroll">
            <TemplatesPanel />
          </div>
        )}
        {tab === 'data' && (
          <div className="ub-sh-left-scroll ub-scroll">
            <DataPanel />
          </div>
        )}
      </div>
    </aside>
  );
}

const RIGHT_TABS: Array<{ value: RightPanelTab; label: string; icon: typeof Layers }> = [
  { value: 'properties', label: 'Properties', icon: SlidersHorizontal },
  { value: 'events', label: 'Events', icon: Zap },
  { value: 'advanced', label: 'Advanced', icon: WandSparkles },
];

export function RightSidebar() {
  const collapsed = useShell((s) => s.rightCollapsed);
  const tab = useEditor((s) => s.rightPanel);
  if (collapsed) {
    return (
      <aside className="ub-sh-right ub-sh-rail" aria-label="Inspector (collapsed)">
        <IconButton label="Expand inspector" onClick={() => useShell.getState().setRightCollapsed(false)}>
          <PanelRightOpen size={16} />
        </IconButton>
        <span className="ub-sh-rail-sep" aria-hidden />
        {RIGHT_TABS.map((t) => (
          <IconButton key={t.value} label={t.label} active={tab === t.value} onClick={() => showRightTab(t.value)}>
            <t.icon size={16} />
          </IconButton>
        ))}
      </aside>
    );
  }
  return (
    <aside className="ub-sh-right" aria-label="Inspector">
      <div className="ub-sh-right-body">
        <Inspector />
      </div>
    </aside>
  );
}
