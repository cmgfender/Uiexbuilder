import { describe, expect, it } from 'vitest';
import { RETIRED_SCOPES, isRetiredScope, modernizeScopes } from './scopes';

describe('retired HubSpot scopes', () => {
  it('replaces retired scopes with their granular read scopes, keeping order and removing duplicates', () => {
    expect(modernizeScopes(['oauth', 'tickets', 'crm.objects.contacts.read', 'crm.objects.tickets.read'])).toEqual([
      'oauth',
      'crm.objects.tickets.read',
      'crm.objects.contacts.read',
    ]);
    expect(modernizeScopes(['e-commerce'])).toEqual(['crm.objects.products.read', 'crm.objects.line_items.read']);
    expect(modernizeScopes([' tickets '])).toEqual(['crm.objects.tickets.read']);
  });

  it('knows which scopes HubSpot retired', () => {
    expect(isRetiredScope('tickets')).toBe(true);
    expect(isRetiredScope('crm.objects.tickets.read')).toBe(false);
    expect(RETIRED_SCOPES.tickets.allReplacements).toContain('crm.schemas.tickets.write');
  });
});
