/**
 * HubSpot OAuth scopes that HubSpot has retired in favour of granular scopes.
 *
 * Apps on the current developer platform are rejected at deploy time when they still request a
 * retired scope, e.g.: "The scope tickets has been replaced by more specific scopes and is no longer
 * available. Use the following scope(s) instead: crm.objects.tickets.read, crm.objects.tickets.write,
 * crm.schemas.tickets.read, crm.schemas.tickets.write."
 *
 * `readReplacement` is what the builder substitutes automatically (read-only access is all that app
 * cards need for previews and display); `allReplacements` lists every granular scope HubSpot offers
 * so users who need write access can pick them.
 */
export interface RetiredScope {
  scope: string;
  readReplacement: string[];
  allReplacements: string[];
  /** Short human description of what the old scope covered. */
  covers: string;
}

export const RETIRED_SCOPES: Record<string, RetiredScope> = {
  tickets: {
    scope: 'tickets',
    readReplacement: ['crm.objects.tickets.read'],
    allReplacements: ['crm.objects.tickets.read', 'crm.objects.tickets.write', 'crm.schemas.tickets.read', 'crm.schemas.tickets.write'],
    covers: 'tickets',
  },
  'e-commerce': {
    scope: 'e-commerce',
    readReplacement: ['crm.objects.products.read', 'crm.objects.line_items.read'],
    allReplacements: [
      'crm.objects.products.read',
      'crm.objects.products.write',
      'crm.objects.line_items.read',
      'crm.objects.line_items.write',
    ],
    covers: 'products and line items',
  },
};

export function isRetiredScope(scope: string): boolean {
  return Object.prototype.hasOwnProperty.call(RETIRED_SCOPES, scope.trim());
}

/**
 * Replaces retired scopes with their read-only granular replacements, keeping order and removing
 * duplicates. Scopes that are not retired pass through unchanged.
 */
export function modernizeScopes(scopes: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of scopes) {
    const scope = raw.trim();
    const retired = isRetiredScope(scope) ? RETIRED_SCOPES[scope] : null;
    for (const s of retired ? retired.readReplacement : [scope]) {
      if (s && !out.includes(s)) out.push(s);
    }
  }
  return out;
}
