/**
 * Canvas toolbar: selection breadcrumbs (design) or the preview banner (preview), the HubSpot
 * chrome toggle and the zoom control. Subscribes only to what it shows, so selection changes
 * re-render this strip and never the node tree.
 */
import { memo, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Monitor, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { selectActiveExtension, useEditor, type EditorState } from '../model/store';
import { useRuntime } from '../runtime';
import { getComponent } from '../registry';
import { Button, IconButton, Menu, Switch, cx, useMenu } from '../ui';
import { PreviewDataNote, RecordPicker } from '../connect/ui';
import { ancestorChain, displayLabel } from './nodeActions';
import { MAX_ZOOM, MIN_ZOOM, ZOOM_PRESETS, nextZoom, useCanvasView } from './stores';

interface Crumb {
  id: string;
  label: string;
  type: string;
}

const crumbCache = new WeakMap<object, { id: string | null; key: string }>();

/** Selection breadcrumbs as a stable string (so the selector only re-renders on real changes). */
function crumbsKey(s: EditorState): string {
  const ext = selectActiveExtension(s);
  const id = s.selectedNodeId;
  if (!id || !ext.nodes[id]) return '';
  const cached = crumbCache.get(ext.nodes);
  if (cached && cached.id === id) return cached.key;
  const crumbs: Crumb[] = ancestorChain(ext, id).map((nid) => {
    const node = ext.nodes[nid];
    return { id: nid, label: displayLabel(node), type: node.type };
  });
  const key = JSON.stringify(crumbs);
  crumbCache.set(ext.nodes, { id, key });
  return key;
}

const ROOT_LABEL: Record<string, string> = { card: 'Card', settings: 'Settings page', home: 'App home' };

function Breadcrumbs() {
  const key = useEditor(crumbsKey);
  const rootName = useEditor((s) => {
    const ext = selectActiveExtension(s);
    return ext.name || ROOT_LABEL[ext.kind] || 'Card';
  });
  const select = useEditor((s) => s.select);
  const hover = useEditor((s) => s.hover);
  const crumbs: Crumb[] = key ? (JSON.parse(key) as Crumb[]) : [];
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    // Keep the selected (last) crumb visible when the trail is long.
    const el = listRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [key]);

  return (
    <nav className="ub-cv-crumbs" aria-label="Selection path">
      <ol ref={listRef} className="ub-cv-crumbs__list">
        <li className="ub-cv-crumbs__item">
          <button
            type="button"
            className={cx('ub-cv-crumb', crumbs.length === 0 && 'ub-cv-crumb--current')}
            onClick={() => select(null)}
            title={`${rootName} — clear the selection`}
            aria-current={crumbs.length === 0 ? 'location' : undefined}
          >
            {rootName}
          </button>
        </li>
        {crumbs.map((c, i) => {
          const Icon = getComponent(c.type)?.icon;
          const last = i === crumbs.length - 1;
          return (
            <li key={c.id} className="ub-cv-crumbs__item">
              <ChevronRight size={12} className="ub-cv-crumbs__sep" aria-hidden />
              <button
                type="button"
                className={cx('ub-cv-crumb', last && 'ub-cv-crumb--current')}
                aria-current={last ? 'location' : undefined}
                title={c.label}
                onClick={() => select(c.id)}
                onMouseEnter={() => hover(c.id)}
                onMouseLeave={() => hover(null)}
              >
                {Icon && <Icon size={12} aria-hidden />}
                <span className="ub-cv-crumb__text">{c.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {crumbs.length === 0 && <span className="ub-cv-crumbs__hint">Click a component to select it · right-click for actions</span>}
    </nav>
  );
}

function PreviewBanner() {
  const rt = useRuntime();
  const setMode = useEditor((s) => s.setMode);
  const resetPreview = useEditor((s) => s.resetPreview);
  return (
    <div className="ub-cv-preview-banner">
      <span className="ub-cv-preview-banner__text" role="status">
        <span className="ub-cv-live-dot" aria-hidden />
        <strong>Preview</strong> — <PreviewDataNote />
      </span>
      <Button
        size="sm"
        icon={<RotateCcw size={13} aria-hidden />}
        title="Reset state, data, overlays and alerts to their initial values"
        onClick={() => {
          resetPreview();
          rt.reset();
        }}
      >
        Reset
      </Button>
      <Button size="sm" variant="primary" icon={<X size={13} aria-hidden />} onClick={() => setMode('design')} title="Back to the designer">
        Exit preview
      </Button>
    </div>
  );
}

function ZoomControl() {
  const zoom = useCanvasView((s) => s.zoom);
  const setZoom = useCanvasView((s) => s.setZoom);
  const requestFit = useCanvasView((s) => s.requestFit);
  const menu = useMenu();
  const pct = `${Math.round(zoom * 100)}%`;
  return (
    <div className="ub-cv-zoom-ctl" role="group" aria-label="Zoom">
      <IconButton size="sm" label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom(nextZoom(zoom, -1))}>
        <ZoomOut size={14} />
      </IconButton>
      <button
        type="button"
        className="ub-cv-zoom-value"
        aria-haspopup="menu"
        aria-expanded={!!menu.position}
        title="Zoom level"
        aria-label={`Zoom level ${pct}`}
        onClick={(e) => menu.openAt(e.currentTarget)}
      >
        {pct}
        <ChevronDown size={12} aria-hidden />
      </button>
      <IconButton size="sm" label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom(nextZoom(zoom, 1))}>
        <ZoomIn size={14} />
      </IconButton>
      {menu.position && (
        <Menu
          x={menu.position.x}
          y={menu.position.y}
          onClose={menu.close}
          items={[
            ...ZOOM_PRESETS.map((z) => ({
              label: (
                <span className={cx('ub-cv-zoom-item', Math.abs(z - zoom) < 0.001 && 'ub-cv-zoom-item--on')}>
                  {Math.round(z * 100)}%
                </span>
              ),
              onSelect: () => setZoom(z),
            })),
            { label: '', separator: true },
            { label: 'Fit to width', onSelect: requestFit },
          ]}
        />
      )}
    </div>
  );
}

function ChromeToggle() {
  const chrome = useCanvasView((s) => s.chrome);
  const setChrome = useCanvasView((s) => s.setChrome);
  return (
    <span className="ub-cv-chrome-toggle" title="Show the card inside a HubSpot-like page">
      <Monitor size={14} aria-hidden />
      <Switch checked={chrome} onChange={setChrome} label="HubSpot chrome" />
    </span>
  );
}

export const CanvasToolbar = memo(function CanvasToolbar() {
  const mode = useEditor((s) => s.mode);
  return (
    <div className={cx('ub-cv-toolbar', mode === 'preview' && 'ub-cv-toolbar--preview')} role="toolbar" aria-label="Canvas toolbar">
      {mode === 'preview' ? <PreviewBanner /> : <Breadcrumbs />}
      <div className="ub-cv-toolbar__right">
        <RecordPicker />
        <ChromeToggle />
        <span className="ub-cv-toolbar__divider" aria-hidden />
        <ZoomControl />
      </div>
    </div>
  );
});
