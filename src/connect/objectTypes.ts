/**
 * Client-side object type helpers: every accepted spelling of a standard object ("contacts",
 * "contact", "0-1", "CONTACTS") maps to one canonical key so caches and pickers treat them as the
 * same type. Custom objects ("p_projects", "2-1234567") are resolved through the portal's object
 * type list when it is known.
 */
import { CRM_OBJECT_TYPES } from '../registry/constants';
import type { CrmObjectTypeInfo } from './types';

export interface StandardTypeRef {
  objectType: string;
  objectTypeId: string;
  /** Plural label, e.g. "Contacts". */
  label: string;
}

const STANDARD_BY_KEY = new Map<string, StandardTypeRef>();
for (const t of CRM_OBJECT_TYPES) {
  const ref: StandardTypeRef = { objectType: t.value, objectTypeId: t.typeId, label: t.label };
  STANDARD_BY_KEY.set(t.value, ref);
  STANDARD_BY_KEY.set(t.typeId, ref);
  // Singular alias: contacts → contact, companies → company, line_items → line_item.
  const singular = t.value.endsWith('ies') ? `${t.value.slice(0, -3)}y` : t.value.endsWith('s') ? t.value.slice(0, -1) : t.value;
  if (!STANDARD_BY_KEY.has(singular)) STANDARD_BY_KEY.set(singular, ref);
}

/** The standard object type for any accepted spelling, or undefined (custom / unknown). */
export function findStandardType(input: string | null | undefined): StandardTypeRef | undefined {
  if (!input) return undefined;
  return STANDARD_BY_KEY.get(input.trim().toLowerCase());
}

/**
 * Canonical cache key of an object type: the object type id when it can be determined
 * ('contacts' and '0-1' → '0-1'), otherwise the trimmed, lower-cased input.
 */
export function canonicalObjectType(input: string, known?: readonly CrmObjectTypeInfo[] | null): string {
  const raw = input.trim();
  const std = findStandardType(raw);
  if (std) return std.objectTypeId;
  const lower = raw.toLowerCase();
  const match = known?.find((t) => t.objectTypeId.toLowerCase() === lower || t.objectType.toLowerCase() === lower);
  if (match) return match.objectTypeId;
  return lower;
}

/** True when both spellings name the same object type. */
export function sameObjectType(a: string, b: string, known?: readonly CrmObjectTypeInfo[] | null): boolean {
  return canonicalObjectType(a, known) === canonicalObjectType(b, known);
}

/** Portal info for an object type (by name or id), when the list is known. */
export function findObjectTypeInfo(input: string, known: readonly CrmObjectTypeInfo[] | null | undefined): CrmObjectTypeInfo | undefined {
  if (!known) return undefined;
  const key = canonicalObjectType(input, known);
  return known.find((t) => t.objectTypeId.toLowerCase() === key || t.objectType.toLowerCase() === key);
}

/** Plural, human label for an object type ("Contacts", "Projects"), falling back to the raw name. */
export function objectTypeLabel(input: string, known?: readonly CrmObjectTypeInfo[] | null, form: 'plural' | 'singular' = 'plural'): string {
  const info = findObjectTypeInfo(input, known);
  if (info) return form === 'plural' ? info.pluralLabel : info.label;
  const std = findStandardType(input);
  if (std) return form === 'plural' ? std.label : singularLabel(std.label);
  const name = input.replace(/^p_/, '').replace(/_/g, ' ');
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : input;
}

function singularLabel(plural: string): string {
  if (plural.endsWith('ies')) return `${plural.slice(0, -3)}y`;
  if (plural.endsWith('s')) return plural.slice(0, -1);
  return plural;
}

/** Object type id for a name when it can be determined without the portal ('contacts' → '0-1'). */
export function objectTypeIdOf(input: string, known?: readonly CrmObjectTypeInfo[] | null): string | undefined {
  const std = findStandardType(input);
  if (std) return std.objectTypeId;
  return findObjectTypeInfo(input, known)?.objectTypeId ?? (/^\d+-\d+$/.test(input.trim()) ? input.trim() : undefined);
}
