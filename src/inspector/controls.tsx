/**
 * Shared expression / template controls (used by the inspector and data panels).
 * STUB with working basic behaviour — the inspector module upgrades these (autocomplete, picker,
 * syntax highlighting) without changing the exported signatures.
 */
import type { Extension, NodeId } from '../model/types';
import { TextArea, TextInput } from '../ui';

export interface ScopeVariable {
  /** Text inserted into expressions, e.g. `record.firstname`, `count`, `context.user.email`. */
  name: string;
  kind: 'state' | 'setter' | 'dataSource' | 'property' | 'context' | 'repeat' | 'param';
  /** Short type or description shown in pickers. */
  detail?: string;
}

/** Lists identifiers/paths in scope for a node (and optional event params). */
export function useScopeVariables(ext: Extension, _nodeId?: NodeId | null, eventParams?: string[]): ScopeVariable[] {
  const vars: ScopeVariable[] = [];
  for (const s of ext.state) vars.push({ name: s.name, kind: 'state', detail: s.type });
  for (const d of ext.dataSources) vars.push({ name: d.name, kind: 'dataSource', detail: d.kind });
  vars.push({ name: 'context.user.firstName', kind: 'context' });
  for (const p of eventParams ?? []) vars.push({ name: p, kind: 'param' });
  return vars;
}

export interface ExpressionInputProps {
  value: string;
  onChange: (value: string) => void;
  ext: Extension;
  nodeId?: NodeId | null;
  eventParams?: string[];
  placeholder?: string;
  multiline?: boolean;
  /** Statements mode (custom code) instead of a single expression. */
  statements?: boolean;
  'aria-label'?: string;
}

/** JavaScript expression editor. */
export function ExpressionInput({ value, onChange, placeholder, multiline, ...rest }: ExpressionInputProps) {
  return multiline ? (
    <TextArea code value={value} onChange={onChange} placeholder={placeholder} aria-label={rest['aria-label']} />
  ) : (
    <TextInput code value={value} onChange={onChange} placeholder={placeholder} aria-label={rest['aria-label']} />
  );
}

export interface TemplateInputProps {
  value: string;
  onChange: (value: string) => void;
  ext: Extension;
  nodeId?: NodeId | null;
  eventParams?: string[];
  placeholder?: string;
  multiline?: boolean;
  'aria-label'?: string;
}

/** Text editor supporting {{ expression }} segments. */
export function TemplateInput({ value, onChange, placeholder, multiline, ...rest }: TemplateInputProps) {
  return multiline ? (
    <TextArea value={value} onChange={onChange} placeholder={placeholder} aria-label={rest['aria-label']} />
  ) : (
    <TextInput value={value} onChange={onChange} placeholder={placeholder} aria-label={rest['aria-label']} />
  );
}

export interface VariablePickerProps {
  ext: Extension;
  nodeId?: NodeId | null;
  eventParams?: string[];
  /** Called with the chosen variable path. */
  onPick: (name: string) => void;
}

/** Button + menu listing variables in scope. */
export function VariablePicker(_props: VariablePickerProps) {
  return null;
}
