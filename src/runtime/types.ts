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
 *     (A repeated node's condition is evaluated per copy, with the repeat item/index in scope.)
 *   - A design-mode node repeating over an empty/invalid array renders one stand-in copy with
 *     data-uiex-repeat-empty="true" (item undefined, index 0). Preview mode renders nothing.
 *   - A design-mode empty container renders <div data-drop-placeholder-for="<parentId>">
 *     (plus data-drop-slot="<slot>" when the placeholder targets a slot).
 *   - A node whose preview throws renders <div class="hsp-rt-error" data-node-id data-node-type>.
 *   - PreviewHost renders <div class="hsp-overlay-host hsp-rt-host"> (absolute, inset 0).
 *   - Overlay storyboard items are rendered by the canvas via <NodeRenderer nodeId={overlayId}
 *     overlayPresentation="inline" />.
 */
import type { ReactNode } from 'react';
import type { ActionStep, AlertType, Extension, LogLevel, NodeId, Project } from '../model/types';
import type { Scope } from './expr';
import type { ScopeDiagnostics } from './scope';

export interface RuntimeAlert {
  id: string;
  type: AlertType;
  title?: string;
  message: string;
  /** How many times this alert was added in a row (shown as ×N when above 1). */
  count?: number;
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
  /**
   * Base scope: helper functions, state values, setters (set<Name>), data sources
   * (+Loading/+Error), context and computed values.
   */
  scope: Scope;
  /** Helper code / computed value errors of the current scope (optional for API compatibility). */
  diagnostics?: ScopeDiagnostics;
  /** Current state values keyed by state variable name. */
  stateValues: Record<string, unknown>;
  /** Sets a state variable by name (unknown names are ignored). A function value is an updater. */
  setStateValue: (name: string, value: unknown) => void;
  /** Data source values + status keyed by data source id. */
  dataSources: Record<string, DataSourceState>;
  /** Re-runs a data source by id (or name): simulated latency, then fresh mock data. */
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
  /** Nesting depth (set by the renderer for children; guards malformed, cyclic trees). */
  depth?: number;
}

export interface DropPlaceholderProps {
  parentId: NodeId;
  slot?: string;
  label?: string;
  children?: ReactNode;
}

/**
 * Live HubSpot data for the designer preview (provided by src/connect when the user has signed in
 * with HubSpot and picked a sample record). When `RuntimeProviderProps.live` is set, the runtime
 * resolves CRM data sources and the record context from the portal instead of mock data:
 *  - crmProperties  -> getRecordProperties(record.objectTypeId, record.objectId, properties, formatted)
 *  - associations   -> getAssociations(record..., toObjectType, properties, pageLength, formatted)
 *  - crmSearch      -> search(objectType, request)
 *  - context        -> portal / user / crm come from `context` (other fields keep their mock values)
 *  - fetch actions & fetch data sources -> proxyFetch (when provided), avoiding browser CORS limits
 * fetch/function data sources without a live equivalent keep using mock data. Requests are real and
 * asynchronous, so the preview shows genuine loading and error states. Errors surface as
 * `<name>Error` values and console log entries — they never crash the editor.
 */
export interface LiveDataAdapter {
  /** Stable key; when it changes the runtime refetches all live data (e.g. another record picked). */
  key: string;
  context: {
    portal: { id: number; timezone?: string };
    user?: { id?: number; email: string; firstName?: string; lastName?: string };
    /** The sample record. Absent on settings / app home extensions. */
    crm?: { objectId: number; objectTypeId: string };
  };
  getRecordProperties: (
    objectTypeId: string,
    objectId: number,
    properties: string[],
    formatted: boolean,
  ) => Promise<Record<string, string | null>>;
  getAssociations: (
    objectTypeId: string,
    objectId: number,
    request: { toObjectType: string; properties: string[]; pageLength: number; formatted: boolean },
  ) => Promise<import('../connect/types').AssociationResultDTO[]>;
  search: (
    objectType: string,
    request: import('../connect/types').CrmSearchRequestDTO,
  ) => Promise<import('../connect/types').CrmSearchResponseDTO>;
  /** Server-side fetch for preview `hubspot.fetch` calls (optional). */
  proxyFetch?: (request: import('../connect/types').ProxyFetchRequest) => Promise<import('../connect/types').ProxyFetchResponse>;
}
