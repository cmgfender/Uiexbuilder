/**
 * Renders extension nodes with their registry previews.
 *
 * Per node the renderer:
 *  - resolves props (expressions, {{ }} templates, bound state value) and text;
 *  - applies `condition` (preview: skip when falsy; design: render with data-uiex-cond="false");
 *  - applies `repeat` (one copy per item with item/index in scope; copies after the first carry
 *    data-uiex-clone; an empty/invalid array in design mode renders one stand-in copy flagged
 *    data-uiex-repeat-empty="true");
 *  - renders children (or a drop placeholder for an empty container in design mode) and non-overlay
 *    slots. Overlay slot content (Modal/Panel/Tooltip) is never rendered inline: Modals/Panels open
 *    through PreviewHost when the trigger is clicked, Tooltips show on hover;
 *  - wraps every rendered copy in an error boundary so a broken node shows a selectable red box.
 *    In preview mode an expression that throws (condition, repeat items, a prop or the text) makes
 *    the node fail too, like the generated card would on HubSpot (there the whole card stops
 *    rendering); design mode degrades to '' / undefined so the canvas stays editable.
 *
 * Performance: NodeRenderer is a cheap context consumer; the memoised NodeView does the work and is
 * skipped when its node object (immer keeps unchanged nodes referentially equal), scope and mode
 * are unchanged.
 */
import { Component, memo, useCallback, useEffect, useMemo, type ContextType, type ReactNode } from 'react';
import { getComponent } from '../registry';
import type { ComponentDef, PreviewProps, PreviewRootProps, SlotDef } from '../registry/types';
import { ROOT_TYPE, type ExtensionKind, type UINode } from '../model/types';
import { ControlsContext, useControls, useRenderState } from './context';
import { DropPlaceholder } from './DropPlaceholder';
import { PreviewAlerts } from './PreviewAlerts';
import { CodeTrustNotice } from './CodeTrustNotice';
import { evaluate, resolvePropValue, resolveText, type ExpressionErrorHandler, type Scope } from './expr';
import type { NodeRendererProps } from './types';

const EMPTY_SCOPE: Scope = Object.freeze({}) as Scope;

/**
 * Deepest nesting rendered. Imports reject deeper / cyclic trees (model/normalize.ts); this guard
 * keeps a malformed tree that slipped through from recursing without bound.
 */
export const MAX_RENDER_DEPTH = 250;

/** Repeat copies rendered at most (design mode keeps the canvas light; preview guards runaway arrays). */
export const MAX_DESIGN_REPEAT = 50;
export const MAX_PREVIEW_REPEAT = 1000;

const EMPTY_CARD_LABEL: Record<ExtensionKind, string> = {
  card: 'Drag components here to start building your card',
  settings: 'Drag components here to start building your settings page',
  home: 'Drag components here to start building your app home page',
};

// ---------------------------------------------------------------------------
// Public components
// ---------------------------------------------------------------------------

/** Renders one node (and its subtree). `scope` adds repeat items from ancestors. */
export const NodeRenderer = memo(function NodeRenderer({ nodeId, scope, overlayPresentation, depth = 0 }: NodeRendererProps) {
  const rs = useRenderState('NodeRenderer');
  const node = rs.extension.nodes[nodeId];
  if (!node) return null;
  if (depth > MAX_RENDER_DEPTH) {
    return <NodeErrorBox node={node} message="components are nested too deeply (is a component inside itself?)" />;
  }
  const local = scope ?? EMPTY_SCOPE;
  if (node.type === ROOT_TYPE) {
    return (
      <>
        {node.children.map((id) => (
          <NodeRenderer key={id} nodeId={id} scope={local} depth={depth + 1} />
        ))}
      </>
    );
  }
  if (rs.mode === 'design' && node.hiddenInDesigner) return null;

  const overlayId = node.slots?.overlay?.[0];
  const overlayChild = overlayId ? rs.extension.nodes[overlayId] : undefined;
  const boundName = node.binding?.state;
  const hasBoundValue = !!boundName && !!rs.extension.state?.some((v) => v.name === boundName);
  return (
    <NodeView
      node={node}
      overlayChild={overlayChild}
      local={local}
      base={rs.scope}
      mode={rs.mode}
      overlayPresentation={overlayPresentation}
      hasBoundValue={hasBoundValue}
      boundValue={hasBoundValue && boundName ? rs.stateValues[boundName] : undefined}
      hostMounted={rs.hostMounted}
      depth={depth}
    />
  );
});

/** Renders the extension root's children: the card body (preview alerts above it). */
export function ExtensionRenderer() {
  const rs = useRenderState('ExtensionRenderer');
  const root = rs.extension.nodes[rs.extension.rootId];
  if (!root) return null;
  if (root.children.length === 0) {
    return rs.mode === 'design' ? (
      <DropPlaceholder parentId={root.id} label={EMPTY_CARD_LABEL[rs.extension.kind] ?? EMPTY_CARD_LABEL.card} />
    ) : (
      <PreviewAlerts />
    );
  }
  return (
    <>
      <CodeTrustNotice />
      {rs.mode === 'preview' && <PreviewAlerts />}
      {root.children.map((id) => (
        <NodeRenderer key={id} nodeId={id} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Node view (memoised) and repeat handling
// ---------------------------------------------------------------------------

interface NodeViewProps {
  node: UINode;
  /** First node in the `overlay` slot (Modal / Panel / Tooltip), if any. */
  overlayChild?: UINode;
  /** Local scope from ancestors (repeat items). */
  local: Scope;
  /** Base runtime scope. */
  base: Scope;
  mode: 'design' | 'preview';
  overlayPresentation?: 'inline' | 'open';
  hasBoundValue: boolean;
  boundValue: unknown;
  hostMounted: boolean;
  /** Nesting depth of this node (see MAX_RENDER_DEPTH). */
  depth: number;
}

const NodeView = memo(function NodeView(props: NodeViewProps) {
  const { node, local, base, mode } = props;
  const def = getComponent(node.type);
  if (!def) return <NodeErrorBox node={node} message={`Unknown component type "${node.type}"`} />;

  if (!node.repeat) {
    return (
      <NodeErrorBoundary node={node} resetKeys={[base, local, mode]}>
        <NodeInstance {...props} def={def} copy={0} />
      </NodeErrorBoundary>
    );
  }

  const { items: itemsExpr, itemName, indexName, key: keyExpr } = node.repeat;
  const result = evaluate(itemsExpr ?? '', { ...base, ...local });
  if (!result.ok && !result.blocked && mode === 'preview') {
    return (
      <NodeErrorBoundary node={node} resetKeys={[base, local, mode]}>
        <Throw error={new PreviewExpressionError(itemsExpr ?? '', result.error)} />
      </NodeErrorBoundary>
    );
  }
  const items = result.ok && Array.isArray(result.value) ? (result.value as unknown[]) : null;

  if (!items || items.length === 0) {
    if (mode !== 'design') return null;
    // Design mode: draw one stand-in copy so the node stays visible and selectable.
    const standIn: Scope = { ...local, [itemName]: undefined, [indexName]: 0 };
    return (
      <NodeErrorBoundary node={node} resetKeys={[base, local, mode]}>
        <NodeInstance {...props} local={standIn} def={def} copy={0} repeatEmpty />
      </NodeErrorBoundary>
    );
  }

  const limit = mode === 'design' ? MAX_DESIGN_REPEAT : MAX_PREVIEW_REPEAT;
  const usedKeys = new Set<string>();
  return (
    <>
      {items.slice(0, limit).map((item, index) => {
        const copyScope: Scope = { ...local, [itemName]: item, [indexName]: index };
        let key = `i:${index}`;
        if (keyExpr?.trim()) {
          const k = evaluate(keyExpr, { ...base, ...copyScope });
          if (k.ok && (typeof k.value === 'string' || typeof k.value === 'number')) key = `k:${k.value}`;
        }
        // Duplicate keys would confuse React's reconciliation; fall back to the index.
        if (usedKeys.has(key)) key = `${key}#${index}`;
        usedKeys.add(key);
        return (
          <NodeErrorBoundary key={key} node={node} copy={index} resetKeys={[base, item, index, mode]}>
            <NodeInstance {...props} local={copyScope} def={def} copy={index} />
          </NodeErrorBoundary>
        );
      })}
    </>
  );
});

// ---------------------------------------------------------------------------
// One rendered copy of a node
// ---------------------------------------------------------------------------

interface NodeInstanceProps extends NodeViewProps {
  def: ComponentDef;
  /** Repeat index of this copy (0 for non-repeated nodes). */
  copy: number;
  repeatEmpty?: boolean;
}

const overlaySlotCache = new WeakMap<SlotDef, boolean>();

/** Slots that hold overlays (Modal/Panel/Tooltip) are never rendered inline. */
function isOverlaySlot(slot: SlotDef): boolean {
  let cached = overlaySlotCache.get(slot);
  if (cached === undefined) {
    cached = slot.accepts.some((type) => {
      const d = getComponent(type);
      return !!d && (!!d.overlay || !!d.slotOnly);
    });
    overlaySlotCache.set(slot, cached);
  }
  return cached;
}

/** A Tooltip-like overlay child: slot-only, shown on hover (not opened like Modal/Panel). */
function isTooltipNode(node: UINode | undefined): node is UINode {
  if (!node) return false;
  const d = getComponent(node.type);
  return !!d && !!d.slotOnly && !d.overlay;
}

function NodeInstance({
  node,
  def,
  overlayChild,
  local,
  base,
  mode,
  overlayPresentation,
  hasBoundValue,
  boundValue,
  hostMounted,
  copy,
  repeatEmpty,
  depth,
}: NodeInstanceProps) {
  const controls = useControls('NodeRenderer');
  const full = useMemo<Scope>(() => ({ ...base, ...local }), [base, local]);
  const nodeId = node.id;

  const trigger = useCallback<PreviewProps['trigger']>(
    (eventName, ...args) => {
      // Design mode is static; the live check also covers callbacks fired after a mode switch
      // (e.g. an open Modal reporting onClose while unmounting).
      if (mode === 'preview' && controls.isPreview()) controls.fireEvent(nodeId, eventName, args, local);
    },
    [mode, controls, nodeId, local],
  );
  const closeSelf = useCallback(() => controls.closeOverlay(nodeId), [controls, nodeId]);
  const overlay = useMemo<PreviewProps['overlay']>(
    () => (def.overlay ? { presentation: overlayPresentation ?? 'inline', close: closeSelf } : undefined),
    [def.overlay, overlayPresentation, closeSelf],
  );

  // ---- expression failures (preview: the node fails, as the card would on HubSpot)
  let failure: PreviewExpressionError | null = null;
  const onError: ExpressionErrorHandler | undefined =
    mode === 'preview'
      ? (code, error) => {
          failure ??= new PreviewExpressionError(code, error);
        }
      : undefined;

  // ---- condition (preview: skip when falsy; design: render flagged)
  let conditionFalse = false;
  if (node.condition?.trim()) {
    const r = evaluate(node.condition, full);
    if (!r.ok && !r.blocked) onError?.(node.condition, r.error);
    // A condition that may not run (untrusted code) shows the node rather than hiding it.
    conditionFalse = r.ok ? !r.value : !r.blocked;
  }
  const skipped = conditionFalse && mode === 'preview' && !failure;

  const tooltipNode = mode === 'preview' && !skipped && isTooltipNode(overlayChild) ? overlayChild : undefined;
  const tooltipId = tooltipNode?.id;
  // A trigger that disappears while hovered (condition, repeat, edit) must not leave its bubble behind.
  useEffect(() => {
    if (!tooltipId) return undefined;
    return () => controls.hideTooltip(tooltipId);
  }, [controls, tooltipId]);

  if (skipped) return null;
  if (failure) throw failure;

  // ---- props & text
  const props: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(node.props)) {
    const resolved = resolvePropValue(value, full, onError);
    if (resolved !== undefined) props[name] = resolved;
  }
  if (node.binding && def.valueBinding && hasBoundValue && boundValue !== undefined) {
    props[def.valueBinding.prop] = boundValue;
  }
  const text = resolveText(node.text, full, onError);
  if (failure) throw failure;

  // ---- children & slots
  let children: ReactNode = undefined;
  if (def.children.mode === 'nodes') {
    if (node.children.length > 0) {
      children = node.children.map((id) => <NodeRenderer key={id} nodeId={id} scope={local} depth={depth + 1} />);
    } else if (mode === 'design') {
      children = <DropPlaceholder parentId={node.id} label={def.children.placeholder} />;
    }
  }
  const slots: Record<string, ReactNode> = {};
  for (const slot of def.slots ?? []) {
    if (isOverlaySlot(slot)) continue;
    const ids = node.slots?.[slot.name] ?? [];
    if (ids.length > 0) slots[slot.name] = ids.map((id) => <NodeRenderer key={id} nodeId={id} scope={local} depth={depth + 1} />);
  }

  // ---- root props (DOM contract for the canvas)
  const rootProps: PreviewRootProps = { 'data-node-id': node.id, 'data-node-type': node.type };
  if (copy > 0) rootProps['data-uiex-clone'] = String(copy);
  if (conditionFalse) rootProps['data-uiex-cond'] = 'false';
  if (repeatEmpty) rootProps['data-uiex-repeat-empty'] = 'true';
  if (tooltipNode && tooltipId) {
    // Without a PreviewHost to draw the bubble, fall back to the native title tooltip.
    if (!hostMounted) rootProps.title = resolveText(tooltipNode.text, full);
    rootProps.onMouseEnter = (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      controls.showTooltip({
        nodeId: tooltipId,
        ownerId: nodeId,
        scope: local,
        anchor: { left: r.left, top: r.top, width: r.width, height: r.height },
      });
    };
    rootProps.onMouseLeave = () => controls.hideTooltip(tooltipId);
  }

  const Preview = def.preview;
  return (
    <Preview
      node={node}
      props={props}
      text={text}
      slots={slots}
      mode={mode}
      rootProps={rootProps}
      trigger={trigger}
      overlay={overlay}
    >
      {children}
    </Preview>
  );
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** An expression of a node failed while rendering in preview mode. */
export class PreviewExpressionError extends Error {
  constructor(
    readonly code: string,
    readonly reason: string,
  ) {
    super(
      `“${code.length > 80 ? `${code.slice(0, 77)}…` : code}” failed — ${reason}. On HubSpot this error stops the whole card ` +
        'from rendering; guard values that load later (e.g. `x?.y`, or a condition on the data source’s Loading flag).',
    );
    this.name = 'PreviewExpressionError';
  }
}

function Throw({ error }: { error: Error }): null {
  throw error;
}

function NodeErrorBox({ node, message, copy = 0 }: { node: UINode; message: string; copy?: number }) {
  const label = getComponent(node.type)?.label ?? node.type;
  return (
    <div
      className="hsp-rt-error"
      role="alert"
      data-node-id={node.id}
      data-node-type={node.type}
      data-uiex-clone={copy > 0 ? String(copy) : undefined}
    >
      <strong className="hsp-rt-error-title">{label}</strong> could not be rendered: {message}
    </div>
  );
}

interface BoundaryProps {
  node: UINode;
  copy?: number;
  /** Rendering is retried when the node or any of these values change. */
  resetKeys: unknown[];
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

/** Catches errors thrown by a node's preview so one broken node never blanks the canvas. */
class NodeErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  static contextType = ControlsContext;
  declare context: ContextType<typeof ControlsContext>;
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown) {
    // Reported once per node and message (the console panel explains it).
    if (error instanceof Error) this.context?.reportNodeError?.(this.props.node.id, error.message);
  }

  componentDidUpdate(prev: BoundaryProps) {
    if (!this.state.error) return;
    const keysChanged =
      prev.resetKeys.length !== this.props.resetKeys.length ||
      prev.resetKeys.some((k, i) => !Object.is(k, this.props.resetKeys[i]));
    if (prev.node !== this.props.node || keysChanged) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return <NodeErrorBox node={this.props.node} copy={this.props.copy} message={this.state.error.message} />;
    }
    return this.props.children;
  }
}
