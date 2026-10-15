/**
 * "Generate UI" for data sources: pure functions returning a ready-made NodeTemplate that shows
 * the data. Every template satisfies the placement rules (canAccept) and the registry's required
 * props / children, so it can be inserted as-is.
 *
 * Every block is a Flex column that covers the loading, error and loaded states, so "with error
 * handling" is the default output:
 *
 *   all kinds              -> LoadingSpinner (while loading), an error Alert showing `{{ xError }}`
 *                             (when the request failed), then the data:
 *   crmProperties          -> + "Try again" button, DescriptionList with one item per property
 *                             ({{ record.firstname }})
 *   associations/crmSearch -> + "Try again" button, Table whose body row repeats over the results,
 *                             EmptyState (loaded, no results)
 *   fetch/function         -> + Text with the JSON result, "Reload" button
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
export function generatedRootType(_ds: DataSource): string {
  return 'Flex';
}

/** Loading spinner shown while the source loads. */
function loadingSpinner(ds: DataSource, label: string): NodeTemplate {
  return { type: 'LoadingSpinner', props: { label, showLabel: true }, condition: `${ds.name}Loading` };
}

/** Shown when the source failed (the hooks / loaders expose the message as `<name>Error`). */
function failedCondition(ds: DataSource): string {
  return `!${ds.name}Loading && ${ds.name}Error`;
}

/** Shown once the source loaded without an error. */
function loadedCondition(ds: DataSource): string {
  return `!${ds.name}Loading && !${ds.name}Error`;
}

function refreshButton(ds: DataSource, label: string, condition?: string): NodeTemplate {
  return {
    type: 'Button',
    text: label,
    ...(condition ? { condition } : {}),
    events: { onClick: [{ id: newId('a'), type: 'runDataSource', dataSourceId: ds.id }] },
  };
}

/** Error alert (+ a "Try again" button unless the block has its own reload button). */
function errorState(ds: DataSource, title: string, retry: boolean): NodeTemplate[] {
  const alert: NodeTemplate = {
    type: 'Alert',
    props: { title, variant: 'error' },
    text: `{{ ${ds.name}Error }}`,
    condition: failedCondition(ds),
  };
  return retry ? [alert, refreshButton(ds, 'Try again', failedCondition(ds))] : [alert];
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
  return {
    type: 'Flex',
    name: `${humanizeProperty(ds.name)} details`,
    props: { direction: 'column', gap: 'small' },
    children: [
      loadingSpinner(ds, 'Loading properties…'),
      ...errorState(ds, 'Couldn’t load the record’s properties', true),
      { type: 'DescriptionList', condition: loadedCondition(ds), children: items },
    ],
  };
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
  const loaded = loadedCondition(ds);
  return {
    type: 'Flex',
    name: `${humanizeProperty(name)} table`,
    props: { direction: 'column', gap: 'small' },
    children: [
      loadingSpinner(ds, `Loading ${lower}…`),
      ...errorState(ds, ds.kind === 'associations' ? `Couldn’t load associated ${lower}` : `Couldn’t search ${lower}`, true),
      {
        type: 'Table',
        condition: `${loaded} && ${name}.length > 0`,
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
        condition: `${loaded} && ${name}.length === 0`,
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
  const label = humanizeProperty(name).toLowerCase();
  return {
    type: 'Flex',
    name: `${humanizeProperty(name)} result`,
    props: { direction: 'column', gap: 'small' },
    children: [
      loadingSpinner(ds, 'Loading…'),
      // The block's Reload button retries after an error.
      ...errorState(ds, ds.kind === 'function' ? `Couldn’t run ${label}` : `Couldn’t load ${label}`, false),
      text(`{{ JSON.stringify(${name}) }}`, { condition: loadedCondition(ds) }),
      refreshButton(ds, 'Reload'),
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
