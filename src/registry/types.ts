import type { ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { ExtensionKind, ExtensionLocation, JsonValue, NodeTemplate, StateVarType, UINode } from '../model/types';

/**
 * The component registry describes every HubSpot UI extension component the builder supports:
 * how it appears in the palette, which props the inspector edits, how codegen emits it and how the
 * designer previews it. Prop names/types MUST match @hubspot/ui-extensions exactly, because the
 * generated TSX is type-checked against the real package in tests.
 */

export type ComponentCategory =
  | 'Layout'
  | 'Text & content'
  | 'Buttons & links'
  | 'Forms & inputs'
  | 'Data display'
  | 'Tables'
  | 'Feedback & status'
  | 'Overlays'
  | 'Charts'
  | 'CRM data'
  | 'CRM actions';

export const CATEGORY_ORDER: ComponentCategory[] = [
  'Layout',
  'Text & content',
  'Buttons & links',
  'Forms & inputs',
  'Data display',
  'Tables',
  'Feedback & status',
  'Overlays',
  'Charts',
  'CRM data',
  'CRM actions',
];

export interface EnumOption {
  value: string | number | boolean;
  label?: string;
}

/** Describes how a prop is edited in the inspector and how its value is shaped. */
export type PropType =
  | { kind: 'string'; multiline?: boolean; placeholder?: string }
  | { kind: 'number'; min?: number; max?: number; step?: number; integer?: boolean }
  | { kind: 'boolean' }
  | { kind: 'enum'; options: EnumOption[] }
  /** HubSpot href: string URL (or { url, external } object when `external` is toggled). */
  | { kind: 'href' }
  | { kind: 'url' }
  /** One of the HubSpot icon names (see ICON_NAMES in ./constants). */
  | { kind: 'icon' }
  /**
   * Array of { label, value, description? } used by Select / MultiSelect / ToggleGroup.
   * `optionFields` lists the per-option keys the HubSpot option type accepts besides label/value
   * (Select/MultiSelect: none; ToggleGroup: description, initialIsChecked, readOnly). Option
   * literals are type-checked in generated code, so editors must not add other keys. When omitted,
   * editors offer label/value plus `description`.
   */
  | { kind: 'options'; optionFields?: Array<'description' | 'initialIsChecked' | 'readOnly'> }
  /** string[] */
  | { kind: 'stringList'; placeholder?: string }
  /** { year, month, date } — month is 0-based as in @hubspot/ui-extensions BaseDate. */
  | { kind: 'date' }
  /** { hours, minutes } */
  | { kind: 'time' }
  /**
   * Arbitrary JSON (objects/arrays) edited as JSON text, e.g. chart data, CRM filters.
   * `template` is the value inserted when the user first enables the prop.
   */
  | { kind: 'json'; template?: JsonValue; hint?: string }
  /**
   * An object with a fixed set of sub-fields (e.g. Text `format`, Chart `axes`).
   * Each field is edited with its own control; the stored value is a plain object.
   */
  | { kind: 'object'; fields: PropDef[] };

export type PropGroup = 'Content' | 'Appearance' | 'Layout' | 'Behavior' | 'Validation' | 'Data' | 'Advanced';

export interface PropDef {
  /** Exact prop name in @hubspot/ui-extensions. */
  name: string;
  label: string;
  type: PropType;
  description?: string;
  group?: PropGroup;
  /** HubSpot's own default when the prop is omitted (informational; shown as placeholder). */
  defaultValue?: JsonValue;
  /** The TS type requires this prop. Codegen/validation will flag missing values. */
  required?: boolean;
  /**
   * The TS type requires this prop only in some variants of a discriminated union, selected by the
   * node's literal props (e.g. Table `pageCount` when `paginated` is true). Validation can flag a
   * missing value when the predicate passes. `required` stays unset for such props.
   */
  requiredWhen?: (props: Record<string, unknown>) => boolean;
  /** Allow switching to an expression ({ $expr }). Defaults to true. */
  bindable?: boolean;
  /** Hide this prop in the inspector unless the predicate passes (given the node's literal props). */
  visibleWhen?: (props: Record<string, unknown>) => boolean;
  deprecated?: boolean;
}

export interface EventParam {
  /** Identifier available to action steps / expressions inside the handler, e.g. `value`. */
  name: string;
  description?: string;
}

export interface EventDef {
  /** Exact event prop name, e.g. onClick, onChange, onSubmit. */
  name: string;
  label: string;
  description?: string;
  /**
   * Positional params of the generated handler, in the order HubSpot passes them.
   * e.g. onChange(value) -> [{ name: 'value' }]; onClick(event, reactions) -> [{ name: 'event' }].
   * Form onSubmit -> [{ name: 'event' }] with `event.targetValue` holding the form values.
   */
  params: EventParam[];
  /**
   * The TS type requires a handler in some variants of a discriminated union, selected by the
   * node's literal props (e.g. Table `onPageChange` when `paginated` is true, TableHeader
   * `onSortChange` when `sortDirection` is set). Codegen emits a no-op handler when the predicate
   * passes and no actions/binding are configured, so the output still type-checks.
   */
  requiredWhen?: (props: Record<string, unknown>) => boolean;
}

export interface SlotDef {
  /** Prop name that accepts a ReactNode, e.g. 'overlay'. */
  name: string;
  label: string;
  /** Allowed node types for this slot, e.g. ['Modal', 'Panel']. */
  accepts: string[];
  /** Maximum number of nodes (overlay: 1). */
  max?: number;
  description?: string;
}

export interface ChildrenDef {
  /**
   * 'none'  - no children
   * 'text'  - children is a text string (node.text, supports {{ }} interpolation)
   * 'nodes' - children are nested components (node.children)
   */
  mode: 'none' | 'text' | 'nodes';
  /** For 'nodes': allowed child types. Omit to allow any type whose `parents` permits it. */
  accepts?: string[];
  /** For 'text': default text when created. */
  defaultText?: string;
  /** Label for the drop placeholder shown in empty containers. */
  placeholder?: string;
  /** For 'nodes': the TS type requires at least one child (e.g. Box `children: ReactNode`). */
  required?: boolean;
}

/** How an input's value can be two-way bound to a state variable. */
export interface ValueBindingDef {
  /** Controlled value prop, e.g. 'value' or 'checked'. */
  prop: string;
  /** Change event that delivers the new value as its first param, e.g. 'onChange'. */
  event: string;
  /** State variable type to create when binding to a new variable. */
  stateType: StateVarType;
  /** Initial value of a newly created bound state variable. */
  initial: JsonValue;
}

/**
 * Overlay behaviour (Modal / Panel). Overlays are placed in a trigger's `overlay` slot and are
 * opened by clicking the trigger; they are closed with actions.closeOverlay(<id prop>).
 */
export interface OverlayDef {
  /** Prop holding the overlay id (always 'id' for Modal/Panel). */
  idProp: string;
}

/**
 * Attributes the renderer asks a preview to put on its outermost DOM element. Spread them as-is
 * (merge `className` with your own). In preview mode the runtime may add hover handlers / title to
 * show a Tooltip overlay attached to the component.
 */
export interface PreviewRootProps {
  'data-node-id': string;
  'data-node-type': string;
  'data-uiex-clone'?: string;
  'data-uiex-cond'?: string;
  /** Design mode: the node repeats over an empty/invalid array and is drawn once as a stand-in. */
  'data-uiex-repeat-empty'?: string;
  className?: string;
  title?: string;
  onMouseEnter?: (e: React.MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (e: React.MouseEvent<HTMLElement>) => void;
}

/** Props passed by the renderer to a component's designer preview. */
export interface PreviewProps {
  node: UINode;
  /**
   * Resolved prop values: expressions evaluated, {{ }} templates interpolated, bound values
   * injected. Props absent from node.props are absent here (apply HubSpot defaults yourself).
   */
  props: Record<string, any>;
  /** Resolved text content (children mode 'text'). */
  text: string;
  /**
   * Rendered child nodes (children mode 'nodes'). In design mode an empty container receives a
   * drop placeholder element here, so always render `children` where children belong.
   */
  children?: ReactNode;
  /** Rendered slot content keyed by slot name (rarely needed; overlays are handled by runtime). */
  slots: Record<string, ReactNode>;
  mode: 'design' | 'preview';
  /**
   * MUST be spread onto the outermost DOM element the preview renders. Carries `data-node-id`
   * (used for selection, hover outlines and drag & drop) plus className hooks.
   */
  rootProps: PreviewRootProps;
  /**
   * Fire one of the node's events (preview mode only; a no-op in design mode). For triggers with
   * an `overlay` slot, firing 'onClick' also opens the overlay.
   * Inputs: call trigger('onChange', newValue) — bound state updates automatically.
   */
  trigger: (eventName: string, ...args: unknown[]) => void;
  /**
   * For overlay components (Modal/Panel) only. While presentation is 'open', the Modal/Panel
   * previews fire their own `onOpen` (once the open transition has finished) and `onClose` (when
   * they unmount after having opened) through `trigger`; the runtime must not fire these itself.
   */
  overlay?: {
    /** 'inline': draw as a static block in the designer storyboard. 'open': draw as a real overlay. */
    presentation: 'inline' | 'open';
    close: () => void;
  };
}

export interface ComponentDef {
  /**
   * JSX tag emitted by codegen and unique registry key. Usually the export name (e.g. 'Button');
   * compound sub-components use dotted names (e.g. 'Dropdown.ButtonItem').
   */
  type: string;
  /** Identifier imported from `importFrom` when it differs from `type` (e.g. 'Dropdown'). */
  importName?: string;
  label: string;
  category: ComponentCategory;
  description: string;
  /** Lucide icon component used in the palette and layers tree. */
  icon: LucideIcon;
  docsUrl?: string;
  importFrom: '@hubspot/ui-extensions' | '@hubspot/ui-extensions/crm';
  props: PropDef[];
  events?: EventDef[];
  slots?: SlotDef[];
  children: ChildrenDef;
  /** Must be a direct child of one of these types (e.g. TableRow -> TableHead/TableBody/TableFooter). */
  parents?: string[];
  /** Extension locations where this component is available (CRM components). Omit = everywhere. */
  locations?: ExtensionLocation[];
  /** Extension kinds where this component is available. Omit = everywhere. */
  kinds?: ExtensionKind[];
  valueBinding?: ValueBindingDef;
  /** Modal / Panel: opened by a trigger, closed with actions.closeOverlay(id). Implies slotOnly. */
  overlay?: OverlayDef;
  /** Can only be placed in a slot (e.g. Tooltip in a trigger's `overlay` slot). */
  slotOnly?: boolean;
  /** Default subtree created when dropped from the palette. Omit = `{ type }` with no props. */
  create?: () => NodeTemplate;
  /** Hide from the palette (still insertable as a child of its parent). */
  hiddenFromPalette?: boolean;
  /** Extra search keywords for the palette. */
  keywords?: string[];
  deprecated?: boolean;
  preview: ComponentType<PreviewProps>;
}
