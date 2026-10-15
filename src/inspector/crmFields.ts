/**
 * Which component props hold CRM property names or object types, so the inspector can offer the
 * portal-aware pickers (src/panels/PropertyPicker) instead of plain text / chips.
 *
 * Detection is by prop shape on CRM components (`@hubspot/ui-extensions/crm`), so new CRM
 * components get the pickers automatically:
 *   - string lists named `properties`, `propertyColumns`, `quickFilterProperties`, … → property list
 *   - strings named `…PropertyName` → one property (date-like names suggest date properties)
 *   - `objectTypeId` strings → object type select (standard + the account's custom objects)
 */
import type { Extension, JsonValue, UINode } from '../model/types';
import type { ComponentDef, PropDef } from '../registry/types';

export const CRM_IMPORT = '@hubspot/ui-extensions/crm';

export interface CrmPropertyField {
  mode: 'multiple' | 'single';
  /** Suggest only properties of this kind. */
  accept?: 'date' | 'number';
  /** HubSpot shows at most this many properties. */
  max?: number;
}

/** HubSpot's documented limits per component (property lists). */
const MAX_PROPERTIES: Record<string, number> = {
  CrmPropertyList: 24,
  CrmAssociationPropertyList: 24,
  CrmDataHighlight: 4,
  CrmStageTracker: 4,
  CrmAssociationStageTracker: 4,
};

export function isCrmComponent(def: Pick<ComponentDef, 'importFrom'> | undefined | null): boolean {
  return !!def && def.importFrom === CRM_IMPORT;
}

/** The property-picker shape of a prop, or null when it isn't a CRM property field. */
export function crmPropertyField(def: Pick<ComponentDef, 'type' | 'importFrom'> | undefined | null, prop: PropDef): CrmPropertyField | null {
  if (!isCrmComponent(def)) return null;
  if (prop.type.kind === 'stringList' && /propert(y|ies)/i.test(prop.name) && !('options' in prop.type && prop.type.options)) {
    return { mode: 'multiple', max: def ? MAX_PROPERTIES[def.type] : undefined };
  }
  if (prop.type.kind === 'string' && /PropertyName$/.test(prop.name)) {
    return { mode: 'single', accept: /date|deadline/i.test(prop.name) ? 'date' : undefined };
  }
  return null;
}

/** A CRM component's `objectTypeId` string prop. */
export function isCrmObjectTypeIdProp(def: Pick<ComponentDef, 'importFrom'> | undefined | null, prop: PropDef): boolean {
  return isCrmComponent(def) && prop.name === 'objectTypeId' && prop.type.kind === 'string';
}

function literalString(v: JsonValue | { $expr: string } | undefined): string | null {
  return typeof v === 'string' && v.trim() !== '' && !v.includes('{{') ? v.trim() : null;
}

/**
 * Object types whose properties a CRM component's property field lists: its own `objectTypeId`
 * when it is a fixed value (a specific record or the associated records), else the card's object
 * types (the current record).
 */
export function crmFieldObjectTypes(node: Pick<UINode, 'props'> | undefined | null, ext: Pick<Extension, 'kind' | 'objectTypes'>): string[] {
  const own = literalString(node?.props?.objectTypeId as JsonValue | undefined);
  if (own) return [own];
  return ext.kind === 'card' ? [...ext.objectTypes] : [];
}

/** A StepIndicator-like prop whose steps can come from a pipeline's stages. */
export function isPipelineStepsProp(def: Pick<ComponentDef, 'type'> | undefined | null, prop: PropDef): boolean {
  return !!def && def.type === 'StepIndicator' && prop.name === 'stepNames' && prop.type.kind === 'stringList';
}
