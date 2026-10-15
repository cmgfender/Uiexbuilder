import { describe, expect, it } from 'vitest';
import type { CrmPropertyDef, PropertyCatalog } from '../connect';
import { generateUiForSource } from './generators';
import type { DataSource } from '../model/types';
import {
  closestProperty,
  findObjectTypeOption,
  fromPortalDef,
  groupLabel,
  groupProperties,
  hasChoices,
  mergeProperties,
  normalizeObjectTypes,
  objectTypeOptions,
  pipelineStages,
  propertyOptions,
  propertyTypeLabel,
  searchProperties,
} from './portal';
import { FAKE_OBJECT_TYPES, FAKE_PROPERTIES } from './portalTestUtils';

function catalog(list: CrmPropertyDef[] | null, over: Partial<PropertyCatalog> = {}): PropertyCatalog {
  const properties = list ?? [];
  return { connected: true, loading: false, error: null, properties, byName: new Map(properties.map((p) => [p.name, p])), ...over };
}

describe('mergeProperties', () => {
  it('uses the account’s properties when connected (custom ones included, with labels and groups)', () => {
    const merged = mergeProperties([{ objectType: 'contacts', catalog: catalog(FAKE_PROPERTIES['0-1']) }]);
    expect(merged).toMatchObject({ connected: true, fromPortal: true, canVerify: true, loading: false, error: null });
    const color = merged.byName.get('favorite_color')!;
    expect(color).toMatchObject({ label: 'Favorite color', type: 'enumeration', custom: true, group: 'Preferences', source: 'portal' });
    expect(merged.byName.get('firstname')).toMatchObject({ group: 'Contact information', custom: false });
    // Built-in names that the account doesn't have are not suggested.
    expect(merged.byName.has('jobtitle')).toBe(false);
  });

  it('falls back to the built-in suggestions when not connected', () => {
    const merged = mergeProperties([{ objectType: 'contacts', catalog: { connected: false, loading: false, error: null, properties: [] } }]);
    expect(merged).toMatchObject({ connected: false, fromPortal: false, canVerify: false });
    expect(merged.byName.get('jobtitle')).toMatchObject({ label: 'Job title', source: 'builtin', group: 'Contact information' });
  });

  it('falls back per object type while loading or after an error, and then never verifies names', () => {
    const loading = mergeProperties([{ objectType: 'contacts', catalog: catalog(null, { loading: true }) }]);
    expect(loading).toMatchObject({ connected: true, loading: true, fromPortal: false, canVerify: false });
    expect(loading.byName.get('email')?.source).toBe('builtin');

    const failed = mergeProperties([
      { objectType: 'contacts', catalog: catalog(FAKE_PROPERTIES['0-1']) },
      { objectType: 'tickets', catalog: catalog(null, { error: 'Missing permission' }) },
    ]);
    expect(failed).toMatchObject({ fromPortal: true, canVerify: false, error: 'Missing permission' });
    expect(failed.byName.get('favorite_color')?.source).toBe('portal');
    expect(failed.byName.get('subject')?.source).toBe('builtin');
  });

  it('de-duplicates names across object types (first type wins)', () => {
    const merged = mergeProperties([
      { objectType: 'contacts', catalog: null },
      { objectType: 'companies', catalog: null },
    ]);
    const names = merged.properties.map((p) => p.name);
    expect(names.filter((n) => n === 'city')).toHaveLength(1);
    expect(merged.byName.get('city')?.objectType).toBe('contacts');
  });
});

describe('normalizeObjectTypes', () => {
  it('trims, de-duplicates spellings of one type, skips expressions and caps the list', () => {
    expect(normalizeObjectTypes([' contacts ', '0-1', 'CONTACTS', '{{ context.crm.objectTypeId }}', '', null, 'deals'])).toEqual(['contacts', 'deals']);
    expect(normalizeObjectTypes(['contacts', 'companies', 'deals', 'tickets', 'products'])).toHaveLength(4);
  });
});

describe('searchProperties', () => {
  const props = mergeProperties([{ objectType: 'contacts', catalog: catalog(FAKE_PROPERTIES['0-1']) }]).properties;

  it('matches labels and internal names, best first', () => {
    expect(searchProperties(props, 'first').map((p) => p.name)[0]).toBe('firstname');
    expect(searchProperties(props, 'color').map((p) => p.name)).toEqual(['favorite_color']);
    expect(searchProperties(props, 'Renewal').map((p) => p.name)).toEqual(['renewal_date']);
    expect(searchProperties(props, 'lifecycle_stage').map((p) => p.name)).toEqual(['lifecyclestage']);
    expect(searchProperties(props, 'zzz')).toEqual([]);
  });

  it('keeps hidden properties findable but ranks them last', () => {
    expect(searchProperties(props, 'score').map((p) => p.name)).toEqual(['hs_internal_score']);
  });
});

describe('groupProperties', () => {
  it('groups by property group with custom properties first in each group', () => {
    const list = [
      fromPortalDef({ name: 'a', label: 'A', type: 'string', fieldType: 'text', groupName: 'contactinformation', hubspotDefined: true }, 'contacts'),
      fromPortalDef({ name: 'b', label: 'B', type: 'string', fieldType: 'text', groupName: 'other_stuff', hubspotDefined: true }, 'contacts'),
      fromPortalDef({ name: 'c', label: 'C', type: 'string', fieldType: 'text', groupName: 'contactinformation', hubspotDefined: false }, 'contacts'),
    ];
    expect(groupProperties(list).map((g) => [g.group, g.items.map((p) => p.name)])).toEqual([
      ['Contact information', ['c', 'a']],
      ['Other stuff', ['b']],
    ]);
  });

  it('labels groups in plain language', () => {
    expect(groupLabel('dealinformation')).toBe('Deal information');
    expect(groupLabel('projectinformation')).toBe('Project information');
    expect(groupLabel(undefined)).toBe('Other properties');
  });
});

describe('closestProperty', () => {
  const props = mergeProperties([{ objectType: 'contacts', catalog: catalog(FAKE_PROPERTIES['0-1']) }]).properties;
  it('finds case slips, labels and small typos, else nothing', () => {
    expect(closestProperty('FirstName', props)?.name).toBe('firstname');
    expect(closestProperty('Favorite color', props)?.name).toBe('favorite_color');
    expect(closestProperty('favorit_color', props)?.name).toBe('favorite_color');
    expect(closestProperty('budget', props)).toBeNull();
  });
});

describe('property choices', () => {
  const props = mergeProperties([{ objectType: 'contacts', catalog: catalog(FAKE_PROPERTIES['0-1']) }]);
  it('lists visible options in HubSpot’s order', () => {
    expect(propertyOptions(props.byName.get('lifecyclestage')).map((o) => o.value)).toEqual(['subscriber', 'lead', 'customer']);
    expect(propertyOptions(props.byName.get('favorite_color')).map((o) => o.value)).toEqual(['red', 'blue']);
    expect(hasChoices(props.byName.get('firstname'))).toBe(false);
  });

  it('offers Yes / No for yes-no properties without options and names types plainly', () => {
    expect(propertyOptions({ type: 'bool' }).map((o) => o.label)).toEqual(['Yes', 'No']);
    expect(propertyTypeLabel({ type: 'enumeration', fieldType: 'checkbox' })).toBe('Multiple choice');
    expect(propertyTypeLabel({ type: 'datetime' })).toBe('Date and time');
  });
});

describe('object types', () => {
  it('lists standard objects then the account’s custom objects', () => {
    const options = objectTypeOptions(FAKE_OBJECT_TYPES);
    expect(options[0]).toEqual({ id: '0-1', name: 'contacts', label: 'Contacts', custom: false });
    expect(options.filter((o) => o.custom)).toEqual([{ id: '2-555', name: 'p_projects', label: 'Projects', custom: true }]);
    expect(findObjectTypeOption(options, 'p_projects')?.id).toBe('2-555');
    expect(findObjectTypeOption(options, 'deal')?.id).toBe('0-3');
    expect(objectTypeOptions([]).some((o) => o.custom)).toBe(false);
  });

  it('sorts pipeline stages by display order', () => {
    expect(
      pipelineStages({ id: 'p', label: 'P', displayOrder: 0, stages: [{ id: 'b', label: 'B', displayOrder: 2 }, { id: 'a', label: 'A', displayOrder: 1 }] }).map(
        (s) => s.id,
      ),
    ).toEqual(['a', 'b']);
  });
});

describe('Generate UI labels', () => {
  it('uses the given property and object labels (e.g. the account’s), falling back to built-ins', () => {
    const ds = { id: 'd', kind: 'crmProperties', name: 'record', properties: ['favorite_color', 'firstname'] } as DataSource;
    const labels = { propertyLabel: (n: string) => (n === 'favorite_color' ? 'Favorite color' : undefined) };
    const tpl = generateUiForSource(ds, ['contacts'], labels);
    const list = tpl.children!.find((c) => c.type === 'DescriptionList')!;
    expect(list.children!.map((c) => c.props?.label)).toEqual(['Favorite color', 'First name']);

    const search = { id: 's', kind: 'crmSearch', name: 'projects', objectType: '2-555', properties: ['budget'], filters: [], sorts: [], pageLength: 5 } as DataSource;
    const table = generateUiForSource(search, [], { propertyLabel: () => 'Budget (USD)', objectTypeLabel: () => 'Projects' });
    expect(JSON.stringify(table)).toContain('Budget (USD)');
    expect(JSON.stringify(table)).toContain('No projects found');
  });
});
