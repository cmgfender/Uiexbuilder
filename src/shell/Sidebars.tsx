/**
 * Left sidebar (Components | Layers | Templates | Data) and right sidebar (Inspector). Both
 * collapse into a slim icon rail.
 */
import { Blocks, Database, Layers, LayoutGrid, PanelLeftClose, PanelLeftOpen, PanelRightOpen, SlidersHorizontal, WandSparkles, Zap } from 'lucide-react';
import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useEditor, type LeftPanelTab, type RightPanelTab } from '../model/store';
import { Inspector } from '../inspector';
import { DataPanel } from '../panels';
import { TemplatesPanel } from '../templates';
import { IconButton, Tabs, cx, tabPanelProps } from '../ui';
import { LayersPanel } from './LayersPanel';
import { Palette } from './Palette';
import {
  LEFT_WIDTH,
  RIGHT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  isLeftCollapsed,
  setLeftSidebarOpen,
  showLeftTab,
  showRightTab,
  useShell,
} from './shellStore';
import { shortcutLabel } from './shortcuts';

const LEFT_TABS: Array<{ value: LeftPanelTab; label: string; icon: typeof Layers; shortcut: string }> = [
  { value: 'components', label: 'Components', icon: LayoutGrid, shortcut: 'tabComponents' },
  { value: 'layers', label: 'Layers', icon: Layers, shortcut: 'tabLayers' },
  { value: 'templates', label: 'Templates', icon: Blocks, shortcut: 'tabTemplates' },
  { value: 'data', label: 'Data', icon: Database, shortcut: 'tabData' },
];

/**
 * Drag handle on a sidebar's inner edge (role="separator"): drag, or ←/→ (Shift: bigger steps),
 * Home / End; double-click restores the default width. The width is persisted with the layout.
 */
function SidebarResizeHandle({ side }: { side: 'left' | 'right' }) {
  const width = useShell((s) => (side === 'left' ? s.leftWidth : s.rightWidth));
  const [dragging, setDragging] = useState(false);
  const set = (w: number) => useShell.getState().setSidebarWidth(side, w);
  // Moving right widens the left sidebar and narrows the right one.
  const dir = side === 'left' ? 1 : -1;
  const label = side === 'left' ? 'Resize left sidebar' : 'Resize inspector';
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const el = e.currentTarget;
    el.setPointerCapture?.(e.pointerId);
    setDragging(true);
    const move = (ev: globalThis.PointerEvent) => set(startW + dir * (ev.clientX - startX));
    const up = () => {
      setDragging(false);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16;
    if (e.key === 'ArrowRight') set(width + dir * step);
    else if (e.key === 'ArrowLeft') set(width - dir * step);
    else if (e.key === 'Home') set(SIDEBAR_MIN_WIDTH);
    else if (e.key === 'End') set(SIDEBAR_MAX_WIDTH);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      className={cx('ub-sh-side-handle', `ub-sh-side-handle--${side}`, dragging && 'ub-sh-side-handle--dragging')}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => set(side === 'left' ? LEFT_WIDTH : RIGHT_WIDTH)}
      onKeyDown={onKeyDown}
    />
  );
}

export function LeftSidebar() {
  const tab = useEditor((s) => s.leftPanel);
  const collapsed = useShell(isLeftCollapsed);

  if (collapsed) {
    return (
      <aside className="ub-sh-left ub-sh-rail" aria-label="Left sidebar (collapsed)">
        <IconButton label="Expand sidebar" onClick={() => setLeftSidebarOpen(true)}>
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
    <aside className="ub-sh-left" aria-label="Components, layers, templates and data" data-tour="palette">
      <SidebarResizeHandle side="left" />
      <div className="ub-sh-left-head">
        <Tabs<LeftPanelTab>
          className="ub-sh-left-tabs"
          aria-label="Left sidebar"
          idBase="ub-sh-left"
          value={tab}
          onChange={(v) => useEditor.getState().setLeftPanel(v)}
          tabs={LEFT_TABS.map((t) => ({ value: t.value, label: t.label }))}
        />
        <IconButton label="Hide sidebar" size="sm" className="ub-sh-left-collapse" onClick={() => setLeftSidebarOpen(false)}>
          <PanelLeftClose size={14} />
        </IconButton>
      </div>
      <div className="ub-sh-left-body" {...tabPanelProps('ub-sh-left', tab)}>
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
    <aside className="ub-sh-right" aria-label="Inspector" data-tour="inspector">
      <SidebarResizeHandle side="right" />
      <div className="ub-sh-right-body">
        <Inspector />
      </div>
    </aside>
  );
}
