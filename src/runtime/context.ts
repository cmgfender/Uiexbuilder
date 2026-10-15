/**
 * React contexts of the preview runtime.
 *
 * Three contexts keep re-renders cheap:
 *  - RuntimeContext  — the full RuntimeApi (changes with every alert / log / state change). Used by
 *                      PreviewHost and builder panels (console, data panel) via useRuntime().
 *  - RenderContext   — what node rendering depends on (extension, mode, scope, state values).
 *                      Changes on document edits and state changes; NodeRenderer splits into a
 *                      cheap consumer and a memoised view so unchanged nodes skip their work.
 *  - ControlsContext — stable callbacks (fire events, overlays, tooltips) backed by refs.
 */
import { createContext, useContext } from 'react';
import type { Extension, NodeId } from '../model/types';
import type { Scope } from './expr';
import type { RuntimeApi } from './types';

/** A Modal/Panel opened by a trigger, with the trigger's local scope (repeat item, ...). */
export interface OpenOverlayEntry {
  id: NodeId;
  scope?: Scope;
}

/** A Tooltip shown while its trigger is hovered (preview mode). */
export interface TooltipState {
  /** The Tooltip node (in the trigger's overlay slot). */
  nodeId: NodeId;
  /** The trigger node. */
  ownerId: NodeId;
  /** The trigger's local scope, so the tooltip text can use repeat items. */
  scope?: Scope;
  /** Trigger bounds in viewport coordinates at hover time. */
  anchor: { left: number; top: number; width: number; height: number };
}

export interface RenderState {
  extension: Extension;
  mode: 'design' | 'preview';
  /** Base scope (state, setters, data sources, context). */
  scope: Scope;
  stateValues: Record<string, unknown>;
  /** A PreviewHost is mounted (tooltips render as bubbles instead of `title` attributes). */
  hostMounted: boolean;
}

export interface RuntimeControls {
  /** Live mode check (also valid in callbacks that outlive a render). */
  isPreview(): boolean;
  fireEvent(nodeId: NodeId, eventName: string, args: unknown[], local?: Scope): void;
  openOverlay(overlayNodeId: NodeId, scope?: Scope): void;
  closeOverlay(idOrOverlayId: string): void;
  showTooltip(tooltip: TooltipState): void;
  hideTooltip(nodeId: NodeId): void;
  /** Called by PreviewHost on mount; returns the unregister function. */
  registerHost(): () => void;
  /** A node failed to render (logged to the console once per node and message). */
  reportNodeError?(nodeId: NodeId, message: string): void;
}

/** RuntimeApi plus the host-only state PreviewHost needs. */
export interface InternalRuntimeApi extends RuntimeApi {
  overlayEntries: OpenOverlayEntry[];
  tooltip: TooltipState | null;
  controls: RuntimeControls;
}

export const RuntimeContext = createContext<InternalRuntimeApi | null>(null);
RuntimeContext.displayName = 'UiexRuntime';
export const RenderContext = createContext<RenderState | null>(null);
RenderContext.displayName = 'UiexRuntimeRender';
export const ControlsContext = createContext<RuntimeControls | null>(null);
ControlsContext.displayName = 'UiexRuntimeControls';

const MISSING_PROVIDER =
  'must be used inside <RuntimeProvider project={…} extension={…} mode="design" | "preview">. ' +
  'Wrap the canvas / preview (and any panel that reads runtime state) in a RuntimeProvider from src/runtime.';

/** Access the preview runtime from any descendant of <RuntimeProvider>. Throws outside one. */
export function useRuntime(): RuntimeApi {
  const api = useContext(RuntimeContext);
  if (!api) throw new Error(`useRuntime() ${MISSING_PROVIDER}`);
  return api;
}

/** Like useRuntime(), but returns null outside a provider (for panels that may render without one). */
export function useOptionalRuntime(): RuntimeApi | null {
  return useContext(RuntimeContext);
}

export function useInternalRuntime(component: string): InternalRuntimeApi {
  const api = useContext(RuntimeContext);
  if (!api) throw new Error(`<${component}> ${MISSING_PROVIDER}`);
  return api;
}

export function useRenderState(component: string): RenderState {
  const state = useContext(RenderContext);
  if (!state) throw new Error(`<${component}> ${MISSING_PROVIDER}`);
  return state;
}

export function useControls(component: string): RuntimeControls {
  const controls = useContext(ControlsContext);
  if (!controls) throw new Error(`<${component}> ${MISSING_PROVIDER}`);
  return controls;
}
