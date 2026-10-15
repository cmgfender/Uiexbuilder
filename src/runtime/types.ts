/**
 * Contract of the designer preview runtime (implemented in src/runtime/*).
 *
 * The runtime renders an Extension's node tree with the registry `preview` components, in two modes:
 *  - 'design'  : static, selectable rendering used by the canvas (events are not executed;
 *                conditions are ignored but reported; repeats render all items; empty containers
 *                get drop placeholders; overlays are drawn inline in a storyboard by the canvas).
 *  - 'preview' : fully interactive simulation of the card inside HubSpot (state, bindings,
 *                event actions, overlays, alerts, iframe modal, mock data sources & functions).
 *
 * Public API (import from 'src/runtime'):
 *   <RuntimeProvider project extension mode resetKey>  — owns state values & simulated host.
 *   useRuntime(): RuntimeApi                           — access from any descendant.
 *   <NodeRenderer nodeId scope? />                     — renders a node and its subtree.
 *   <ExtensionRenderer />                              — renders the root's children (the card body).
 *   <PreviewHost />                                    — renders alerts, open overlays and iframe
 *                                                        modal; place it inside the card frame.
 *   <DropPlaceholder parentId label />                 — design-mode empty-container drop target.
 *
 * DOM contract used by the canvas (selection outlines, hover, drag & drop):
 *   - Each rendered node's outermost element carries data-node-id="<id>" and data-node-type="<type>".
 *   - Repeat clones after the first carry data-uiex-clone="<index>".
 *   - Nodes whose `condition` evaluates falsy in design mode carry data-uiex-cond="false".
 *   - A design-mode empty container renders <div data-drop-placeholder-for="<parentId>">.
 *   - Overlay storyboard items are rendered by the canvas via <NodeRenderer nodeId={overlayId}
 *     overlayPresentation="inline" />.
 */
import type { ReactNode } from 'react';
import type { ActionStep, AlertType, Extension, LogLevel, NodeId, Project } from '../model/types';
import type { Scope } from './expr';

export interface RuntimeAlert {
  id: string;
  type: AlertType;
  title?: string;
  message: string;
}

export interface RuntimeLogEntry {
  id: string;
  at: number;
  level: LogLevel | 'action';
  message: string;
  detail?: unknown;
}

export interface IframeModalState {
  uri: string;
  title: string;
  width: number;
  height: number;
  flush?: boolean;
}

export interface DataSourceState {
  data: unknown;
  loading: boolean;
  error: string | null;
}

export interface RuntimeApi {
  mode: 'design' | 'preview';
  project: Project;
  extension: Extension;
  /** Base scope: state values, setters (set<Name>), data sources (+Loading/+Error), context. */
  scope: Scope;
  stateValues: Record<string, unknown>;
  setStateValue: (name: string, value: unknown) => void;
  dataSources: Record<string, DataSourceState>;
  /** Re-runs a data source (simulated latency, mock data). */
  runDataSource: (dataSourceId: string) => Promise<void>;
  /** Executes event action steps. `local` adds handler params / repeat items to the scope. */
  runActions: (steps: ActionStep[], local?: Scope) => Promise<void>;
  /** Fires a node's event (used by NodeRenderer's `trigger`). */
  fireEvent: (nodeId: NodeId, eventName: string, args: unknown[], local?: Scope) => void;
  /** Open overlay node ids (Modal/Panel), in opening order. */
  openOverlays: NodeId[];
  openOverlay: (overlayNodeId: NodeId) => void;
  /** Close by overlay node id or by the overlay's `id` prop value. */
  closeOverlay: (idOrOverlayId: string) => void;
  alerts: RuntimeAlert[];
  dismissAlert: (id: string) => void;
  iframeModal: IframeModalState | null;
  closeIframeModal: () => void;
  logs: RuntimeLogEntry[];
  clearLogs: () => void;
  /** Reset state values, data sources, overlays and alerts to their initial values. */
  reset: () => void;
}

export interface NodeRendererProps {
  nodeId: NodeId;
  /** Additional scope (repeat item/index from ancestors). */
  scope?: Scope;
  /** For overlay nodes rendered directly: 'inline' (designer storyboard) or 'open'. */
  overlayPresentation?: 'inline' | 'open';
}

export interface DropPlaceholderProps {
  parentId: NodeId;
  slot?: string;
  label?: string;
  children?: ReactNode;
}
