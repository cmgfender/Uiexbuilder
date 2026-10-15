/**
 * Data source kinds: friendly names, descriptions, plain-language summaries and the defaults
 * used when a new source is added from the Data panel.
 */
import { Globe, IdCard, Network, Search, SquareFunction, type LucideIcon } from 'lucide-react';
import { newId } from '../model/ids';
import type { AppFunction, DataSource, DataSourceKind, Extension } from '../model/types';
import { defaultPropertiesFor, objectTypeId, objectTypeLabel } from './crmProperties';
import { uniqueDeclaredName } from './names';

export interface DataSourceKindInfo {
  kind: DataSourceKind;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Only available on CRM record locations. */
  crmOnly: boolean;
}

export const DATA_SOURCE_KINDS: DataSourceKindInfo[] = [
  {
    kind: 'crmProperties',
    label: 'Current record properties',
    description: 'Read properties of the record the card is on, like name or email.',
    icon: IdCard,
    crmOnly: true,
  },
  {
    kind: 'associations',
    label: 'Associated records',
    description: 'List records associated with this one, such as its deals or contacts.',
    icon: Network,
    crmOnly: true,
  },
  {
    kind: 'crmSearch',
    label: 'Search CRM records',
    description: 'Find records of any type with filters, sorting and a search query.',
    icon: Search,
    crmOnly: false,
  },
  {
    kind: 'fetch',
    label: 'External API',
    description: 'Call an HTTPS endpoint with hubspot.fetch and use the JSON response.',
    icon: Globe,
    crmOnly: false,
  },
  {
    kind: 'function',
    label: 'App function',
    description: 'Run server-side code (hubspot.serverless) that can use secrets and the HubSpot API.',
    icon: SquareFunction,
    crmOnly: false,
  },
];

export function kindInfo(kind: DataSourceKind): DataSourceKindInfo {
  return DATA_SOURCE_KINDS.find((k) => k.kind === kind) ?? DATA_SOURCE_KINDS[0];
}

/** True when the extension renders on a CRM record (record properties / associations available). */
export function isCrmRecordExtension(ext: Extension): boolean {
  return ext.kind === 'card';
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** URL without scheme, e.g. `api.example.com/items` (long URLs are shortened). */
export function shortUrl(url: string): string {
  const s = (url ?? '').trim().replace(/^https?:\/\//i, '');
  if (!s) return 'no URL yet';
  return s.length > 42 ? `${s.slice(0, 41)}…` : s;
}

/** One-line plain-language summary shown in the data source list. */
export function summarizeDataSource(ds: DataSource, functions: AppFunction[] = []): string {
  switch (ds.kind) {
    case 'crmProperties': {
      const n = (ds.properties ?? []).length;
      return n === 0 ? 'No properties selected yet' : `${plural(n, 'property', 'properties')} of current record`;
    }
    case 'associations': {
      const base = `Associated ${objectTypeLabel(ds.toObjectType).toLowerCase()}`;
      const n = (ds.properties ?? []).length;
      return n ? `${base} · ${plural(n, 'property', 'properties')}` : base;
    }
    case 'crmSearch': {
      const base = `Search ${objectTypeLabel(ds.objectType).toLowerCase()}`;
      const n = (ds.filters ?? []).length;
      return n ? `${base} · ${plural(n, 'filter')}` : base;
    }
    case 'fetch':
      return `${ds.method ?? 'GET'} ${shortUrl(ds.url)}`;
    case 'function': {
      const fn = functions.find((f) => f.id === ds.functionId);
      return fn ? `Runs ${fn.uid}` : 'No function selected';
    }
  }
}

/** Value-shape hint for a data source (`record.firstname`, `deals[0].properties.amount`, ...). */
export function usageExample(ds: DataSource): { template: string; expression: string } {
  switch (ds.kind) {
    case 'crmProperties': {
      const prop = ds.properties?.[0] ?? 'firstname';
      const path = /^[A-Za-z_$][\w$]*$/.test(prop) ? `${ds.name}.${prop}` : `${ds.name}['${prop}']`;
      return { template: `{{ ${path} }}`, expression: path };
    }
    case 'associations':
    case 'crmSearch': {
      const prop = ds.properties?.[0] ?? 'hs_object_id';
      return { template: `{{ ${ds.name}.length }}`, expression: `${ds.name}[0]?.properties.${prop}` };
    }
    case 'fetch':
    case 'function':
      return { template: `{{ JSON.stringify(${ds.name}) }}`, expression: ds.name };
  }
}

/** A complete, sensible new data source of the given kind. */
export function createDataSource(
  kind: DataSourceKind,
  ext: Extension,
  functions: AppFunction[],
): DataSource {
  const entityName = (base: string) => uniqueDeclaredName(ext, base, { kind: 'dataSource', id: '__new__', dsKind: kind });
  const current = ext.kind === 'card' ? ext.objectTypes?.[0] ?? 'contacts' : 'contacts';
  const id = newId('d');
  switch (kind) {
    case 'crmProperties':
      return { id, kind, name: entityName('record'), properties: defaultPropertiesFor(current), formatted: false };
    case 'associations': {
      const target = current === 'deals' ? 'contacts' : 'deals';
      const label = objectTypeLabel(target);
      return {
        id,
        kind,
        name: entityName(`associated ${label}`),
        toObjectType: objectTypeId(target),
        properties: defaultPropertiesFor(target),
        pageLength: 10,
        formatted: false,
      };
    }
    case 'crmSearch':
      return {
        id,
        kind,
        name: entityName('search results'),
        objectType: objectTypeId('deals'),
        properties: defaultPropertiesFor('deals'),
        query: '',
        filters: [],
        sorts: [],
        pageLength: 10,
        formatted: false,
      };
    case 'fetch':
      return {
        id,
        kind,
        name: entityName('api data'),
        url: 'https://api.example.com/items',
        method: 'GET',
        runOnMount: true,
      };
    case 'function':
      return {
        id,
        kind,
        name: entityName('function result'),
        functionId: functions[0]?.id ?? '',
        parameters: '',
        propertiesToSend: [],
        runOnMount: true,
      };
  }
}
