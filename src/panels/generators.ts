/**
 * "Generate UI" for data sources: pure functions returning a ready-made NodeTemplate that shows
 * the data. Every template satisfies the placement rules (canAccept) and the registry's required
 * props / children, so it can be inserted as-is.
 *
 *   crmProperties          -> DescriptionList, one item per property ({{ record.firstname }})
 *   associations/crmSearch -> Flex: LoadingSpinner (while loading), Table whose body row repeats
 *                             over the results, EmptyState (no results)
 *   fetch/function         -> Flex: LoadingSpinner, Text with the JSON result, "Reload" button
 */
import { newId } from '../model/ids';
import type { DataSource, NodeTemplate } from '../model/types';
import { humanizeProperty, objectTypeLabel, propertyLabel } from './crmProperties';

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** `obj.prop` or `obj['prop']` for property names that are not identifiers. */
export function accessPath(obj: string, prop: string): string {
  return IDENT_RE.test(prop) ? `${obj}.${prop}` : `${obj}[${JSON.stringify(prop)}]`;
}

function text(value: string, extra: Partial<NodeTemplate> = {}): NodeTemplate {
  return { type: 'Text', text: value, ...extra };
}

/** The component type at the root of the generated block (for smartInsertTarget). */
export function generatedRootType(ds: DataSource): string {
  return ds.kind === 'crmProperties' ? 'DescriptionList' : 'Flex';
}

export function crmPropertiesBlock(ds: Extract<DataSource, { kind: 'crmProperties' }>, objectTypes: string[] = []): NodeTemplate {
  const props = (ds.properties ?? []).filter(Boolean);
  const items: NodeTemplate[] = props.length
    ? props.map((prop) => ({
        type: 'DescriptionListItem',
        props: { label: propertyLabel(prop, objectTypes) },
        children: [text(`{{ ${accessPath(ds.name, prop)} }}`)],
      }))
    : [{ type: 'DescriptionListItem', props: { label: 'Properties' }, children: [text(`{{ JSON.stringify(${ds.name}) }}`)] }];
  return { type: 'DescriptionList', name: `${humanizeProperty(ds.name)} details`, children: items };
}

export function resultsTableBlock(ds: Extract<DataSource, { kind: 'associations' | 'crmSearch' }>): NodeTemplate {
  const name = ds.name;
  const objectType = ds.kind === 'associations' ? ds.toObjectType : ds.objectType;
  const typeLabel = objectTypeLabel(objectType);
  const idField = ds.kind === 'associations' ? 'toObjectId' : 'objectId';
  const props = (ds.properties ?? []).filter(Boolean);
  const columns: Array<{ label: string; value: string }> = props.length
    ? props.map((prop) => ({ label: propertyLabel(prop, [objectType]), value: `{{ ${accessPath('item.properties', prop)} }}` }))
    : [{ label: 'Record ID', value: `{{ item.${idField} }}` }];
  const lower = typeLabel.toLowerCase();
  const nothing = ds.kind === 'associations' ? `No associated ${lower}` : `No ${lower} found`;
  return {
    type: 'Flex',
    name: `${humanizeProperty(name)} table`,
    props: { direction: 'column', gap: 'small' },
    children: [
      {
        type: 'LoadingSpinner',
        props: { label: `Loading ${lower}…`, showLabel: true },
        condition: `${name}Loading`,
      },
      {
        type: 'Table',
        condition: `!${name}Loading && ${name}.length > 0`,
        children: [
          {
            type: 'TableHead',
            children: [{ type: 'TableRow', children: columns.map((c) => ({ type: 'TableHeader', text: c.label })) }],
          },
          {
            type: 'TableBody',
            children: [
              {
                type: 'TableRow',
                repeat: { items: name, itemName: 'item', indexName: 'index', key: `item.${idField}` },
                children: columns.map((c) => ({ type: 'TableCell', children: [text(c.value)] })),
              },
            ],
          },
        ],
      },
      {
        type: 'EmptyState',
        props: { title: nothing, layout: 'vertical' },
        condition: `!${name}Loading && ${name}.length === 0`,
        children: [
          text(
            ds.kind === 'associations'
              ? `This record has no associated ${lower} yet.`
              : `Nothing matches this search yet.`,
          ),
        ],
      },
    ],
  };
}

export function resultBlock(ds: Extract<DataSource, { kind: 'fetch' | 'function' }>): NodeTemplate {
  const name = ds.name;
  return {
    type: 'Flex',
    name: `${humanizeProperty(name)} result`,
    props: { direction: 'column', gap: 'small' },
    children: [
      { type: 'LoadingSpinner', props: { label: 'Loading…', showLabel: true }, condition: `${name}Loading` },
      text(`{{ JSON.stringify(${name}) }}`),
      {
        type: 'Button',
        text: 'Reload',
        events: { onClick: [{ id: newId('a'), type: 'runDataSource', dataSourceId: ds.id }] },
      },
    ],
  };
}

/** A ready-made block that displays the data source. */
export function generateUiForSource(ds: DataSource, objectTypes: string[] = []): NodeTemplate {
  switch (ds.kind) {
    case 'crmProperties':
      return crmPropertiesBlock(ds, objectTypes);
    case 'associations':
    case 'crmSearch':
      return resultsTableBlock(ds);
    case 'fetch':
    case 'function':
      return resultBlock(ds);
  }
}
