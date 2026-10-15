/**
 * CRM object type metadata: the standard objects (ids, labels, display properties) and resolution of
 * any accepted spelling ("contacts", "contact", "0-1", "p_projects", "2-123", "p123_projects") to
 * the name used by cards, the object type id and the path segment used for HubSpot API calls.
 */
import type { CrmObjectTypeInfo } from '../../src/connect/types';
import type { HubSpotApi } from './types';
import { HubSpotApiError } from './types';
import { ConnectorError } from './http';

export interface StandardObjectType {
  objectType: string;
  objectTypeId: string;
  label: string;
  pluralLabel: string;
  primaryDisplayProperty: string;
  secondaryDisplayProperties: string[];
  /** Properties combined into the record picker label (default: primary only). */
  labelProperties?: string[];
  /** Searchable with CRM search + has pipelines. */
  hasPipelines?: boolean;
  /** Accepted aliases (singular). */
  aliases?: string[];
}

export const STANDARD_OBJECT_TYPES: StandardObjectType[] = [
  { objectType: 'contacts', objectTypeId: '0-1', label: 'Contact', pluralLabel: 'Contacts', primaryDisplayProperty: 'firstname', secondaryDisplayProperties: ['email'], labelProperties: ['firstname', 'lastname'], aliases: ['contact'] },
  { objectType: 'companies', objectTypeId: '0-2', label: 'Company', pluralLabel: 'Companies', primaryDisplayProperty: 'name', secondaryDisplayProperties: ['domain'], aliases: ['company'] },
  { objectType: 'deals', objectTypeId: '0-3', label: 'Deal', pluralLabel: 'Deals', primaryDisplayProperty: 'dealname', secondaryDisplayProperties: ['amount'], hasPipelines: true, aliases: ['deal'] },
  { objectType: 'tickets', objectTypeId: '0-5', label: 'Ticket', pluralLabel: 'Tickets', primaryDisplayProperty: 'subject', secondaryDisplayProperties: ['hs_pipeline_stage'], hasPipelines: true, aliases: ['ticket'] },
  { objectType: 'products', objectTypeId: '0-7', label: 'Product', pluralLabel: 'Products', primaryDisplayProperty: 'name', secondaryDisplayProperties: ['price'], aliases: ['product'] },
  { objectType: 'line_items', objectTypeId: '0-8', label: 'Line item', pluralLabel: 'Line items', primaryDisplayProperty: 'name', secondaryDisplayProperties: ['price'], aliases: ['line_item'] },
  { objectType: 'quotes', objectTypeId: '0-14', label: 'Quote', pluralLabel: 'Quotes', primaryDisplayProperty: 'hs_title', secondaryDisplayProperties: ['hs_expiration_date'], aliases: ['quote'] },
  { objectType: 'calls', objectTypeId: '0-48', label: 'Call', pluralLabel: 'Calls', primaryDisplayProperty: 'hs_call_title', secondaryDisplayProperties: ['hs_timestamp'], aliases: ['call'] },
  { objectType: 'meetings', objectTypeId: '0-47', label: 'Meeting', pluralLabel: 'Meetings', primaryDisplayProperty: 'hs_meeting_title', secondaryDisplayProperties: ['hs_meeting_start_time'], aliases: ['meeting'] },
  { objectType: 'tasks', objectTypeId: '0-27', label: 'Task', pluralLabel: 'Tasks', primaryDisplayProperty: 'hs_task_subject', secondaryDisplayProperties: ['hs_task_status'], aliases: ['task'] },
  { objectType: 'notes', objectTypeId: '0-46', label: 'Note', pluralLabel: 'Notes', primaryDisplayProperty: 'hs_note_body', secondaryDisplayProperties: ['hs_timestamp'], aliases: ['note'] },
  { objectType: 'emails', objectTypeId: '0-49', label: 'Email', pluralLabel: 'Emails', primaryDisplayProperty: 'hs_email_subject', secondaryDisplayProperties: ['hs_timestamp'], aliases: ['email'] },
  { objectType: 'invoices', objectTypeId: '0-53', label: 'Invoice', pluralLabel: 'Invoices', primaryDisplayProperty: 'hs_number', secondaryDisplayProperties: ['hs_invoice_status'], aliases: ['invoice'] },
  { objectType: 'orders', objectTypeId: '0-123', label: 'Order', pluralLabel: 'Orders', primaryDisplayProperty: 'hs_order_name', secondaryDisplayProperties: ['hs_total_price'], hasPipelines: true, aliases: ['order'] },
  { objectType: 'carts', objectTypeId: '0-142', label: 'Cart', pluralLabel: 'Carts', primaryDisplayProperty: 'hs_cart_name', secondaryDisplayProperties: ['hs_total_price'], aliases: ['cart'] },
  { objectType: 'subscriptions', objectTypeId: '0-69', label: 'Subscription', pluralLabel: 'Subscriptions', primaryDisplayProperty: 'hs_name', secondaryDisplayProperties: ['hs_status'], aliases: ['subscription'] },
  { objectType: 'leads', objectTypeId: '0-136', label: 'Lead', pluralLabel: 'Leads', primaryDisplayProperty: 'hs_lead_name', secondaryDisplayProperties: ['hs_pipeline_stage'], hasPipelines: true, aliases: ['lead'] },
  { objectType: 'appointments', objectTypeId: '0-421', label: 'Appointment', pluralLabel: 'Appointments', primaryDisplayProperty: 'hs_appointment_name', secondaryDisplayProperties: ['hs_appointment_start'], hasPipelines: true, aliases: ['appointment'] },
  { objectType: 'courses', objectTypeId: '0-410', label: 'Course', pluralLabel: 'Courses', primaryDisplayProperty: 'hs_course_name', secondaryDisplayProperties: [], hasPipelines: true, aliases: ['course'] },
  { objectType: 'listings', objectTypeId: '0-420', label: 'Listing', pluralLabel: 'Listings', primaryDisplayProperty: 'hs_name', secondaryDisplayProperties: ['hs_price'], hasPipelines: true, aliases: ['listing'] },
  { objectType: 'services', objectTypeId: '0-162', label: 'Service', pluralLabel: 'Services', primaryDisplayProperty: 'hs_name', secondaryDisplayProperties: ['hs_pipeline_stage'], hasPipelines: true, aliases: ['service'] },
];

const STANDARD_BY_KEY = new Map<string, StandardObjectType>();
for (const t of STANDARD_OBJECT_TYPES) {
  STANDARD_BY_KEY.set(t.objectType, t);
  STANDARD_BY_KEY.set(t.objectTypeId, t);
  for (const a of t.aliases ?? []) STANDARD_BY_KEY.set(a, t);
}

export function findStandardObjectType(input: string): StandardObjectType | undefined {
  return STANDARD_BY_KEY.get(input.toLowerCase());
}

export const OBJECT_TYPE_PATTERN = /^[A-Za-z0-9_-]+$/;

export function assertObjectTypeParam(value: string | undefined, what = 'object type'): string {
  if (!value || value.length > 100 || !OBJECT_TYPE_PATTERN.test(value)) {
    throw new ConnectorError(400, 'bad_request', `"${(value ?? '').slice(0, 40)}" isn't a valid ${what}.`);
  }
  return value;
}

/** HubSpot custom object schema (subset of GET /crm/v3/schemas). */
export interface HubSpotSchema {
  id?: string;
  name: string;
  objectTypeId: string;
  fullyQualifiedName?: string;
  labels?: { singular?: string; plural?: string };
  primaryDisplayProperty?: string;
  secondaryDisplayProperties?: string[];
  archived?: boolean;
}

export interface ResolvedObjectType {
  /** Name for cards / the builder ("contacts", "p_projects"). */
  objectType: string;
  objectTypeId: string;
  /** Path segment for HubSpot API calls. */
  apiPath: string;
  info: CrmObjectTypeInfo;
  labelProperties: string[];
}

export function standardInfo(t: StandardObjectType): CrmObjectTypeInfo {
  return {
    objectType: t.objectType,
    objectTypeId: t.objectTypeId,
    label: t.label,
    pluralLabel: t.pluralLabel,
    primaryDisplayProperty: t.primaryDisplayProperty,
    secondaryDisplayProperties: [...t.secondaryDisplayProperties],
    custom: false,
  };
}

export function schemaInfo(s: HubSpotSchema): CrmObjectTypeInfo {
  const singular = s.labels?.singular || s.name;
  return {
    objectType: `p_${s.name}`,
    objectTypeId: s.objectTypeId,
    label: singular,
    pluralLabel: s.labels?.plural || singular,
    primaryDisplayProperty: s.primaryDisplayProperty || 'hs_object_id',
    secondaryDisplayProperties: Array.isArray(s.secondaryDisplayProperties) ? s.secondaryDisplayProperties.filter((p) => typeof p === 'string') : [],
    custom: true,
  };
}

/** Request-scoped resolver; fetches custom object schemas at most once. */
export class ObjectTypeResolver {
  private schemas: Promise<HubSpotSchema[] | null> | null = null;

  constructor(private readonly api: HubSpotApi) {}

  /** Custom object schemas, or null when the connection lacks the custom-object scope. */
  loadSchemas(): Promise<HubSpotSchema[] | null> {
    if (!this.schemas) {
      this.schemas = this.api
        .request<{ results?: HubSpotSchema[] }>('GET', '/crm/v3/schemas')
        .then((r) => (r?.results ?? []).filter((s) => s && typeof s.name === 'string' && typeof s.objectTypeId === 'string' && !s.archived))
        .catch((err: unknown) => {
          if (err instanceof HubSpotApiError && (err.code === 'missing_scope' || err.code === 'forbidden')) return null;
          throw err;
        });
    }
    return this.schemas;
  }

  async resolve(input: string): Promise<ResolvedObjectType> {
    assertObjectTypeParam(input);
    const std = findStandardObjectType(input);
    if (std) {
      return { objectType: std.objectType, objectTypeId: std.objectTypeId, apiPath: std.objectType, info: standardInfo(std), labelProperties: std.labelProperties ?? [std.primaryDisplayProperty] };
    }
    const isCustomId = /^2-\d+$/.test(input);
    const isCustomName = /^p\d*_/i.test(input);
    if (isCustomId || isCustomName) {
      const schemas = await this.loadSchemas();
      const lower = input.toLowerCase();
      const match = schemas?.find(
        (s) => s.objectTypeId === input || (s.fullyQualifiedName ?? '').toLowerCase() === lower || `p_${s.name}`.toLowerCase() === lower,
      );
      if (match) {
        const info = schemaInfo(match);
        return { objectType: info.objectType, objectTypeId: match.objectTypeId, apiPath: match.objectTypeId, info, labelProperties: [info.primaryDisplayProperty] };
      }
      if (schemas) {
        throw new ConnectorError(404, 'not_found', `There's no custom object called "${input}" in this HubSpot account.`);
      }
      // No schema access: let HubSpot resolve the name itself.
      const info: CrmObjectTypeInfo = {
        objectType: input,
        objectTypeId: input,
        label: input,
        pluralLabel: input,
        primaryDisplayProperty: 'hs_object_id',
        secondaryDisplayProperties: [],
        custom: true,
      };
      return { objectType: input, objectTypeId: input, apiPath: input, info, labelProperties: ['hs_object_id'] };
    }
    // Other HubSpot-defined objects we don't list (e.g. "0-19" or "feedback_submissions").
    const info: CrmObjectTypeInfo = {
      objectType: input,
      objectTypeId: input,
      label: input,
      pluralLabel: input,
      primaryDisplayProperty: 'hs_object_id',
      secondaryDisplayProperties: [],
      custom: false,
    };
    return { objectType: input, objectTypeId: input, apiPath: input, info, labelProperties: ['hs_object_id'] };
  }
}
