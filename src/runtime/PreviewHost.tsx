/**
 * <PreviewHost> draws what HubSpot draws on top of a card: open Modals / Panels, the iframe modal
 * and Tooltip bubbles. It is an absolutely positioned layer (`.hsp-overlay-host`) that fills the
 * nearest positioned ancestor — place it inside the card frame. The layer itself ignores the
 * pointer so the card below stays usable; only its interactive children (dialogs) catch clicks.
 * Alerts added with actions.addAlert are not drawn here: <ExtensionRenderer> shows them above the
 * card content (see PreviewAlerts) so they never cover fields or buttons.
 */
import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type RefObject } from 'react';
import { X } from 'lucide-react';
import { useInternalRuntime, type TooltipState } from './context';
import { resolvePropValue, type Scope } from './expr';
import { NodeRenderer } from './NodeRenderer';
import type { IframeModalState } from './types';

const IFRAME_HEADER_HEIGHT = 48;

export function PreviewHost() {
  const rt = useInternalRuntime('PreviewHost');
  const hostRef = useRef<HTMLDivElement>(null);
  const { registerHost } = rt.controls;
  useEffect(() => registerHost(), [registerHost]);

  const preview = rt.mode === 'preview';
  return (
    <div ref={hostRef} className="hsp-overlay-host hsp-rt-host" data-uiex-overlay-host="">
      {preview &&
        rt.overlayEntries.map((o) => (
          <NodeRenderer key={o.id} nodeId={o.id} scope={o.scope} overlayPresentation="open" />
        ))}
      {preview && rt.iframeModal && <IframeModal modal={rt.iframeModal} onClose={rt.closeIframeModal} />}
      {preview && rt.tooltip && <TooltipBubble tooltip={rt.tooltip} hostRef={hostRef} baseScope={rt.scope} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Iframe modal
// ---------------------------------------------------------------------------

/** Only http(s) pages are loaded; anything else (javascript:, data:, ...) is refused. */
function safeIframeUrl(uri: string): string | null {
  try {
    const url = new URL(uri, window.location.href);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function IframeModal({ modal, onClose }: { modal: IframeModalState; onClose: () => void }) {
  const src = safeIframeUrl(modal.uri);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Focus moves into the dialog and returns to the element that opened it on close.
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      const current = document.activeElement;
      if ((!current || current === document.body) && opener && opener !== document.body && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  };
  // Requested size, clamped to the host by max-width / max-height in CSS.
  const style: CSSProperties = { width: modal.width, height: modal.height + IFRAME_HEADER_HEIGHT };
  return (
    <div className="hsp-rt-iframe-layer">
      <div
        ref={dialogRef}
        className={`hsp-rt-iframe-dialog${modal.flush ? ' hsp-rt-iframe-flush' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={modal.title || 'Iframe modal'}
        tabIndex={-1}
        style={style}
        onKeyDown={onKeyDown}
      >
        <div className="hsp-rt-iframe-header">
          <span className="hsp-rt-iframe-title" title={modal.title}>
            {modal.title}
          </span>
          <button type="button" className="hsp-rt-iframe-close" aria-label="Close" onClick={onClose}>
            <X size={18} strokeWidth={2.25} aria-hidden="true" />
          </button>
        </div>
        <div className="hsp-rt-iframe-body">
          {src ? (
            <iframe className="hsp-rt-iframe" src={src} title={modal.title || 'Iframe modal'} />
          ) : (
            <div className="hsp-rt-iframe-invalid">
              Cannot preview “{modal.uri || '(empty URL)'}”: only http(s) URLs can be opened in an iframe modal.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tooltip bubble
// ---------------------------------------------------------------------------

const PLACEMENTS = ['top', 'bottom', 'left', 'right'] as const;
type Placement = (typeof PLACEMENTS)[number];

function TooltipBubble({
  tooltip,
  hostRef,
  baseScope,
}: {
  tooltip: TooltipState;
  hostRef: RefObject<HTMLDivElement>;
  baseScope: Scope;
}) {
  const rt = useInternalRuntime('PreviewHost');
  const node = rt.extension.nodes[tooltip.nodeId];
  if (!node) return null;
  const raw = node.props.placement;
  const resolved = raw === undefined ? undefined : resolvePropValue(raw, { ...baseScope, ...(tooltip.scope ?? {}) });
  const placement: Placement = PLACEMENTS.includes(resolved as Placement) ? (resolved as Placement) : 'top';

  // The host is mounted before any hover can happen, so its bounds are available while rendering.
  const host = hostRef.current?.getBoundingClientRect();
  const hx = host?.left ?? 0;
  const hy = host?.top ?? 0;
  const a = tooltip.anchor;
  const position: Record<Placement, { left: number; top: number }> = {
    top: { left: a.left - hx + a.width / 2, top: a.top - hy },
    bottom: { left: a.left - hx + a.width / 2, top: a.top - hy + a.height },
    left: { left: a.left - hx, top: a.top - hy + a.height / 2 },
    right: { left: a.left - hx + a.width, top: a.top - hy + a.height / 2 },
  };
  return (
    <div className={`hsp-rt-tooltip hsp-rt-tooltip-${placement}`} style={position[placement]} data-tooltip-for={tooltip.ownerId}>
      <NodeRenderer nodeId={tooltip.nodeId} scope={tooltip.scope} />
    </div>
  );
}
