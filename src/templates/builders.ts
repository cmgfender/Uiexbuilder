/**
 * Small builders used by the template catalog: action steps, state variables, data sources and
 * complete extensions. Every call creates fresh ids so templates can be instantiated many times.
 */
import { createExtension } from '../model/factory';
import { newId } from '../model/ids';
import type {
  ActionStep,
  AppFunction,
  CardLocation,
  ComputedValue,
  DataSource,
  Extension,
  ExtensionKind,
  JsonValue,
  NodeTemplate,
  PreviewMockData,
  StateVar,
  StateVarType,
} from '../model/types';

/** An action step without its id (distributes over the ActionStep union). */
export type StepInput = ActionStep extends infer U ? (U extends ActionStep ? Omit<U, 'id'> : never) : never;

/** Adds a fresh id to an action step (nested steps are built with `steps()` and have their own). */
export function step(input: StepInput): ActionStep {
  return { ...input, id: newId('a') } as ActionStep;
}

/** A list of steps with fresh ids. */
export function steps(...inputs: StepInput[]): ActionStep[] {
  return inputs.map(step);
}

export function stateVar(name: string, type: StateVarType, initial: JsonValue, description?: string): StateVar {
  return { id: newId('s'), name, type, initial, ...(description ? { description } : {}) };
}

/** A state variable without id (block templates). */
export function blockState(name: string, type: StateVarType, initial: JsonValue, description?: string): Omit<StateVar, 'id'> {
  return { name, type, initial, ...(description ? { description } : {}) };
}

/** A computed value (derived on every render; see Extension.computed). */
export function computedValue(name: string, expr: string, description?: string): ComputedValue {
  return { id: `c_${newId('n').slice(2)}`, name, expr, ...(description ? { description } : {}) };
}

type DataSourceInput = DataSource extends infer U ? (U extends DataSource ? Omit<U, 'id'> : never) : never;

export function dataSource(input: DataSourceInput): DataSource {
  return { ...input, id: newId('d') } as DataSource;
}

/** Node template helpers for the most common building blocks. */
export const t = {
  text: (text: string, props?: NodeTemplate['props'], extra?: Partial<NodeTemplate>): NodeTemplate => ({
    type: 'Text',
    ...(props ? { props } : {}),
    text,
    ...extra,
  }),
  bold: (text: string, extra?: Partial<NodeTemplate>): NodeTemplate => ({ type: 'Text', props: { format: { fontWeight: 'bold' } }, text, ...extra }),
  micro: (text: string, extra?: Partial<NodeTemplate>): NodeTemplate => ({ type: 'Text', props: { variant: 'microcopy' }, text, ...extra }),
  heading: (text: string, extra?: Partial<NodeTemplate>): NodeTemplate => ({ type: 'Heading', text, ...extra }),
  column: (children: NodeTemplate[], gap = 'small', extra?: Partial<NodeTemplate>): NodeTemplate => ({
    type: 'Flex',
    props: { direction: 'column', gap },
    children,
    ...extra,
  }),
  row: (children: NodeTemplate[], props: NodeTemplate['props'] = {}, extra?: Partial<NodeTemplate>): NodeTemplate => ({
    type: 'Flex',
    props: { direction: 'row', gap: 'small', ...props },
    children,
    ...extra,
  }),
  item: (label: string, value: NodeTemplate | string): NodeTemplate => ({
    type: 'DescriptionListItem',
    props: { label },
    children: [typeof value === 'string' ? { type: 'Text', text: value } : value],
  }),
  /** StatisticsItem with an optional trend (`trend` props: value, direction and optional color). */
  stat: (label: string, number: string | number, trend?: NodeTemplate['props']): NodeTemplate => ({
    type: 'StatisticsItem',
    props: { label, number },
    ...(trend ? { children: [{ type: 'StatisticsTrend', props: { ...trend } }] } : {}),
  }),
  cell: (child: NodeTemplate | string, props?: NodeTemplate['props']): NodeTemplate => ({
    type: 'TableCell',
    ...(props ? { props } : {}),
    children: [typeof child === 'string' ? { type: 'Text', text: child } : child],
  }),
  header: (text: string, props?: NodeTemplate['props']): NodeTemplate => ({ type: 'TableHeader', ...(props ? { props } : {}), text }),
};

/** `{ objectTypeId, objectId }` action context of the current record (CRM action components). */
export const CURRENT_RECORD_CONTEXT = {
  objectTypeId: '{{ context.crm.objectTypeId }}',
  objectId: '{{ context.crm.objectId }}',
};

export interface MakeExtensionOptions {
  existing: Extension[];
  kind?: ExtensionKind;
  name: string;
  description?: string;
  location?: CardLocation;
  objectTypes?: string[];
  content: NodeTemplate[];
  state?: StateVar[];
  dataSources?: DataSource[];
  computed?: ComputedValue[];
  /** Adjusts the default mock data (record properties, context, data source / function mocks). */
  mock?: (mock: PreviewMockData) => void;
}

/** Builds a complete extension (fresh ids) from template parts. */
export function makeExtension(opts: MakeExtensionOptions): Extension {
  const ext = createExtension({
    kind: opts.kind ?? 'card',
    name: opts.name,
    location: opts.location,
    objectTypes: opts.objectTypes,
    content: opts.content,
    existing: opts.existing,
  });
  ext.description = opts.description ?? '';
  ext.state = opts.state ?? [];
  ext.dataSources = opts.dataSources ?? [];
  if (opts.computed?.length) ext.computed = opts.computed;
  opts.mock?.(ext.mock);
  return ext;
}

/** Points the mock context at a record of the given object type. */
export function mockRecord(mock: PreviewMockData, objectTypeId: string, objectId: number, properties: Record<string, string> = {}): void {
  mock.context.crm = { objectTypeId, objectId };
  mock.properties = { ...mock.properties, hs_object_id: String(objectId), ...properties };
}

/** An app function template (ids and unique names are assigned when the template is used). */
export function appFunction(fileName: string, uid: string, code: string): AppFunction {
  return { id: newId('f'), uid, fileName, code, secretKeys: [] };
}

// ---------------------------------------------------------------------------
// Expression snippets shared by templates (plain JavaScript that also type-checks as TS)
// ---------------------------------------------------------------------------

/** `$48,000` formatting of any numeric-ish value. */
export const money = (expr: string) =>
  `Number((${expr}) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })`;

/** `Dec 1, 2026` formatting of an ISO date / timestamp string (em dash when empty). */
export const shortDate = (expr: string) =>
  `${expr} ? new Date(${expr}).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'`;

/**
 * Label of a deal stage. The data sources ask HubSpot to format `dealstage` (propertiesToFormat:
 * ['dealstage']), which gives the stage's label in any pipeline; the default pipeline's ids are
 * mapped too, so an unformatted id still reads well.
 */
export const dealStageLabel = (expr: string) =>
  `new Map([['appointmentscheduled', 'Appointment scheduled'], ['qualifiedtobuy', 'Qualified to buy'], ` +
  `['presentationscheduled', 'Presentation scheduled'], ['decisionmakerboughtin', 'Decision maker bought in'], ` +
  `['contractsent', 'Contract sent'], ['closedwon', 'Closed won'], ['closedlost', 'Closed lost']]).get(${expr}) || ${expr} || '—'`;

/**
 * Tag variant of a deal from HubSpot's calculated `hs_is_closed_won` / `hs_is_closed` (right for
 * every pipeline, unlike stage ids). `props` is the deal's properties object expression.
 */
export const dealStageVariant = (props: string) =>
  `${props}.hs_is_closed_won === 'true' ? 'success' : ${props}.hs_is_closed === 'true' ? 'error' : 'info'`;

/** Properties a deals table / won count needs, and the formatting that gives stage labels. */
export const DEAL_ROW_PROPERTIES = ['dealname', 'amount', 'dealstage', 'hs_is_closed_won', 'hs_is_closed'];
export const DEAL_STAGE_FORMAT = ['dealstage'];

/** Number of closed-won deals in a list of association / search results. */
export const wonCount = (list: string) => `${list}.filter((d) => d.properties.hs_is_closed_won === 'true').length`;
