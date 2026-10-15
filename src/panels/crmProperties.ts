/**
 * Catalog of commonly used HubSpot CRM properties per object type. Powers the property pickers of
 * the data source editors (suggestions only — any internal property name can be typed).
 */
import { CRM_OBJECT_TYPES } from '../registry/constants';

export type CrmPropertyType = 'string' | 'number' | 'date' | 'datetime' | 'enumeration' | 'bool' | 'phone_number';

export interface CrmPropertyInfo {
  /** Internal property name, e.g. `firstname`. */
  name: string;
  /** Label shown in HubSpot, e.g. `First name`. */
  label: string;
  type: CrmPropertyType;
}

const p = (name: string, label: string, type: CrmPropertyType = 'string'): CrmPropertyInfo => ({ name, label, type });

export const COMMON_PROPERTIES: Record<string, CrmPropertyInfo[]> = {
  contacts: [
    p('firstname', 'First name'),
    p('lastname', 'Last name'),
    p('email', 'Email'),
    p('phone', 'Phone number', 'phone_number'),
    p('mobilephone', 'Mobile phone number', 'phone_number'),
    p('jobtitle', 'Job title'),
    p('company', 'Company name'),
    p('website', 'Website URL'),
    p('address', 'Street address'),
    p('city', 'City'),
    p('state', 'State/Region'),
    p('zip', 'Postal code'),
    p('country', 'Country/Region'),
    p('lifecyclestage', 'Lifecycle stage', 'enumeration'),
    p('hs_lead_status', 'Lead status', 'enumeration'),
    p('hubspot_owner_id', 'Contact owner', 'enumeration'),
    p('createdate', 'Create date', 'datetime'),
    p('lastmodifieddate', 'Last modified date', 'datetime'),
    p('notes_last_contacted', 'Last contacted', 'datetime'),
    p('num_associated_deals', 'Number of associated deals', 'number'),
    p('hs_object_id', 'Record ID', 'number'),
  ],
  companies: [
    p('name', 'Company name'),
    p('domain', 'Company domain name'),
    p('website', 'Website URL'),
    p('industry', 'Industry', 'enumeration'),
    p('phone', 'Phone number', 'phone_number'),
    p('city', 'City'),
    p('state', 'State/Region'),
    p('country', 'Country/Region'),
    p('numberofemployees', 'Number of employees', 'number'),
    p('annualrevenue', 'Annual revenue', 'number'),
    p('lifecyclestage', 'Lifecycle stage', 'enumeration'),
    p('type', 'Type', 'enumeration'),
    p('description', 'Description'),
    p('hubspot_owner_id', 'Company owner', 'enumeration'),
    p('createdate', 'Create date', 'datetime'),
    p('hs_lastmodifieddate', 'Last modified date', 'datetime'),
    p('num_associated_contacts', 'Number of associated contacts', 'number'),
    p('num_associated_deals', 'Number of associated deals', 'number'),
    p('linkedin_company_page', 'LinkedIn company page'),
    p('hs_object_id', 'Record ID', 'number'),
  ],
  deals: [
    p('dealname', 'Deal name'),
    p('amount', 'Amount', 'number'),
    p('dealstage', 'Deal stage', 'enumeration'),
    p('pipeline', 'Pipeline', 'enumeration'),
    p('closedate', 'Close date', 'datetime'),
    p('dealtype', 'Deal type', 'enumeration'),
    p('hubspot_owner_id', 'Deal owner', 'enumeration'),
    p('description', 'Deal description'),
    p('hs_priority', 'Priority', 'enumeration'),
    p('hs_next_step', 'Next step'),
    p('hs_deal_stage_probability', 'Deal probability', 'number'),
    p('hs_forecast_amount', 'Forecast amount', 'number'),
    p('hs_acv', 'Annual contract value', 'number'),
    p('hs_arr', 'Annual recurring revenue', 'number'),
    p('hs_mrr', 'Monthly recurring revenue', 'number'),
    p('hs_tcv', 'Total contract value', 'number'),
    p('hs_is_closed_won', 'Is closed won', 'bool'),
    p('createdate', 'Create date', 'datetime'),
    p('hs_lastmodifieddate', 'Last modified date', 'datetime'),
    p('num_associated_contacts', 'Number of associated contacts', 'number'),
    p('hs_object_id', 'Record ID', 'number'),
  ],
  tickets: [
    p('subject', 'Ticket name'),
    p('content', 'Ticket description'),
    p('hs_pipeline', 'Pipeline', 'enumeration'),
    p('hs_pipeline_stage', 'Ticket status', 'enumeration'),
    p('hs_ticket_priority', 'Priority', 'enumeration'),
    p('hs_ticket_category', 'Category', 'enumeration'),
    p('source_type', 'Source', 'enumeration'),
    p('hubspot_owner_id', 'Ticket owner', 'enumeration'),
    p('hs_resolution', 'Resolution', 'enumeration'),
    p('createdate', 'Create date', 'datetime'),
    p('hs_lastmodifieddate', 'Last modified date', 'datetime'),
    p('closed_date', 'Close date', 'datetime'),
    p('time_to_close', 'Time to close', 'number'),
    p('hs_num_times_contacted', 'Number of times contacted', 'number'),
    p('hs_object_id', 'Record ID', 'number'),
  ],
  line_items: [
    p('name', 'Name'),
    p('quantity', 'Quantity', 'number'),
    p('price', 'Unit price', 'number'),
    p('amount', 'Net price', 'number'),
    p('hs_sku', 'SKU'),
    p('description', 'Description'),
    p('hs_product_id', 'Product ID', 'number'),
    p('discount', 'Unit discount', 'number'),
    p('hs_discount_percentage', 'Discount percentage', 'number'),
    p('recurringbillingfrequency', 'Billing frequency', 'enumeration'),
    p('hs_recurring_billing_period', 'Term'),
    p('hs_term_in_months', 'Term (months)', 'number'),
    p('createdate', 'Create date', 'datetime'),
    p('hs_object_id', 'Record ID', 'number'),
  ],
  products: [
    p('name', 'Name'),
    p('price', 'Unit price', 'number'),
    p('hs_sku', 'SKU'),
    p('description', 'Description'),
    p('hs_cost_of_goods_sold', 'Unit cost', 'number'),
    p('hs_product_type', 'Product type', 'enumeration'),
    p('recurringbillingfrequency', 'Billing frequency', 'enumeration'),
    p('hs_recurring_billing_period', 'Term'),
    p('hs_url', 'URL'),
    p('hs_images', 'Image URL'),
    p('createdate', 'Create date', 'datetime'),
    p('hs_object_id', 'Record ID', 'number'),
  ],
};

/** Normalises an object type name or id ('0-3', 'deal', 'DEALS') to a catalog key ('deals'). */
export function objectTypeKey(objectType: string | undefined | null): string {
  const raw = (objectType ?? '').trim();
  if (!raw) return '';
  const byId = CRM_OBJECT_TYPES.find((t) => t.typeId === raw);
  if (byId) return byId.value;
  const lower = raw.toLowerCase();
  const candidates = [lower, `${lower}s`, lower.endsWith('y') ? `${lower.slice(0, -1)}ies` : lower];
  const byName = CRM_OBJECT_TYPES.find((t) => candidates.includes(t.value));
  return byName ? byName.value : lower;
}

/** Display label of an object type ('0-3' -> 'Deals'; custom ids are returned as-is). */
export function objectTypeLabel(objectType: string | undefined | null): string {
  const key = objectTypeKey(objectType);
  return CRM_OBJECT_TYPES.find((t) => t.value === key)?.label ?? (objectType || 'records');
}

/** Object type id of a name or id ('deals' -> '0-3'); unknown values are returned unchanged. */
export function objectTypeId(objectType: string): string {
  const key = objectTypeKey(objectType);
  return CRM_OBJECT_TYPES.find((t) => t.value === key)?.typeId ?? objectType;
}

/** Common properties for one object type (empty for unknown / custom objects). */
export function propertiesFor(objectType: string | undefined | null): CrmPropertyInfo[] {
  return COMMON_PROPERTIES[objectTypeKey(objectType)] ?? [];
}

/** Common properties for several object types, de-duplicated by name (first label wins). */
export function propertySuggestions(objectTypes: Array<string | undefined | null>): CrmPropertyInfo[] {
  const seen = new Set<string>();
  const out: CrmPropertyInfo[] = [];
  for (const t of objectTypes) {
    for (const info of propertiesFor(t)) {
      if (seen.has(info.name)) continue;
      seen.add(info.name);
      out.push(info);
    }
  }
  return out;
}

/** Turns a property name into a readable label: 'hs_lead_status' -> 'Lead status'. */
export function humanizeProperty(name: string): string {
  const words = name
    .replace(/^hs_/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

/** HubSpot label of a known property, else a humanised name. */
export function propertyLabel(name: string, objectTypes: Array<string | undefined | null> = []): string {
  for (const t of objectTypes) {
    const hit = propertiesFor(t).find((x) => x.name === name);
    if (hit) return hit.label;
  }
  for (const list of Object.values(COMMON_PROPERTIES)) {
    const hit = list.find((x) => x.name === name);
    if (hit) return hit.label;
  }
  return humanizeProperty(name);
}

/** A few sensible properties to start a new data source with. */
export function defaultPropertiesFor(objectType: string | undefined | null): string[] {
  switch (objectTypeKey(objectType)) {
    case 'contacts':
      return ['firstname', 'lastname', 'email'];
    case 'companies':
      return ['name', 'domain', 'industry'];
    case 'deals':
      return ['dealname', 'amount', 'dealstage'];
    case 'tickets':
      return ['subject', 'hs_pipeline_stage', 'hs_ticket_priority'];
    case 'line_items':
      return ['name', 'quantity', 'price'];
    case 'products':
      return ['name', 'price', 'hs_sku'];
    default:
      return ['hs_object_id'];
  }
}
