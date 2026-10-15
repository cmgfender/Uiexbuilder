/**
 * Test fixtures for code generation: a project exercising every feature of the document model,
 * and a "kitchen sink" project generated from the whole component registry. Used by the codegen
 * tests (type-check, bundling, formatting) and handy for other modules' tests.
 */
import { ALL_COMPONENTS } from '../registry';
import type { ComponentDef } from '../registry/types';
import { createAppFunction, createExtension, createProject } from '../model/factory';
import { isAvailableIn } from '../model/rules';
import type { ActionStep, DataSource, Extension, NodeTemplate, Project, StateVar } from '../model/types';

/** An action step without its id (distributes over the ActionStep union). */
type StepInput = ActionStep extends infer U ? (U extends ActionStep ? Omit<U, 'id'> : never) : never;

let stepCounter = 0;
/** Adds a deterministic id to an action step. */
function s(step: StepInput): ActionStep {
  stepCounter += 1;
  return { ...step, id: `a_fixture${stepCounter}` } as ActionStep;
}

function state(name: string, type: StateVar['type'], initial: StateVar['initial'], description?: string): StateVar {
  return { id: `s_${name}`, name, type, initial, ...(description ? { description } : {}) };
}

/** The template a component is created from in the palette. */
export function templateFor(def: ComponentDef): NodeTemplate {
  if (def.create) return def.create();
  if (def.children.mode === 'text') return { type: def.type, text: def.children.defaultText ?? def.label };
  return { type: def.type };
}

// ---------------------------------------------------------------------------
// Feature project
// ---------------------------------------------------------------------------

/** A project exercising every action type, data source kind, state type, binding, condition, repeat and overlay. */
export function createFeatureProject(): Project {
  stepCounter = 0;
  const project = createProject('Feature Test App');
  const quoteFn = { ...createAppFunction([], 'getQuote'), id: 'f_quote', uid: 'get_quote' };
  const endpointFn = {
    ...createAppFunction([quoteFn], 'publicStatus'),
    id: 'f_status',
    uid: 'public_status',
    endpoint: { path: '/api/status', methods: ['GET' as const, 'POST' as const] },
    secretKeys: ['API_TOKEN'],
  };
  project.functions = [quoteFn, endpointFn];

  const dataSources: DataSource[] = [
    { id: 'ds_contact', kind: 'crmProperties', name: 'contact', properties: ['firstname', 'lastname', 'email', 'amount', 'company'], formatted: true },
    { id: 'ds_deals', kind: 'associations', name: 'deals', toObjectType: '0-3', properties: ['dealname', 'amount'], pageLength: 10 },
    {
      id: 'ds_companies',
      kind: 'crmSearch',
      name: 'companies',
      objectType: 'companies',
      properties: ['name', 'domain', 'city'],
      query: '{{ name }}',
      filters: [
        { propertyName: 'city', operator: 'EQ', value: 'Boston' },
        { propertyName: 'hs_object_id', operator: 'IN', value: '1, 2, 3' },
        { propertyName: 'numberofemployees', operator: 'BETWEEN', value: '10,200' },
        { propertyName: 'domain', operator: 'HAS_PROPERTY', value: '' },
        { propertyName: 'name', operator: 'EQ', value: '{{ contact.company }}' },
      ],
      sorts: [{ propertyName: 'name', direction: 'ASCENDING' }],
      pageLength: 5,
      formatted: true,
    },
    { id: 'ds_weather', kind: 'fetch', name: 'weather', url: 'https://api.example.com/weather?city={{ name }}', method: 'GET', runOnMount: true },
    { id: 'ds_post', kind: 'fetch', name: 'postData', url: 'https://data.example.org/items', method: 'POST', body: '{ count, name }', runOnMount: false },
    {
      id: 'ds_quote',
      kind: 'function',
      name: 'quote',
      functionId: 'f_quote',
      parameters: '{ amount: Number(contact.amount ?? 0), count }',
      propertiesToSend: ['amount'],
      runOnMount: true,
    },
  ];

  const allActions: ActionStep[] = [
    s({ type: 'refreshObjectProperties' }),
    s({ type: 'reloadPage' }),
    s({ type: 'openIframeModal', uri: 'https://embed.example.com/view?id={{ context.crm.objectId }}', title: 'Embed {{ name }}', width: 800, height: 600, flush: true }),
    s({ type: 'copyToClipboard', text: '{{ contact.email }}' }),
    s({ type: 'runDataSource', dataSourceId: 'ds_weather' }),
    s({ type: 'runDataSource', dataSourceId: 'ds_contact' }),
    s({ type: 'runDataSource', dataSourceId: 'ds_quote' }),
    s({ type: 'runDataSource', dataSourceId: 'ds_missing' }),
    s({
      type: 'fetch',
      url: 'https://api.example.com/save',
      method: 'POST',
      body: '{ name, count }',
      resultState: 'anything',
      onSuccess: [
        s({ type: 'addAlert', alertType: 'success', title: 'Saved', message: 'Saved record {{ response.id }}' }),
        s({
          type: 'fetch',
          url: 'https://api.example.com/next/{{ response.id }}',
          method: 'GET',
          onSuccess: [s({ type: 'setState', state: 'items', value: 'response.items' })],
        }),
      ],
      onError: [s({ type: 'addAlert', alertType: 'danger', title: 'Failed', message: '{{ error.message }}' })],
    }),
    s({
      type: 'runFunction',
      functionId: 'f_quote',
      parameters: '{ name }',
      propertiesToSend: ['email'],
      resultState: 'anything',
      onSuccess: [s({ type: 'log', level: 'info', message: '{{ response }}' })],
    }),
    s({ type: 'runFunction', functionId: 'f_status' }),
    s({
      type: 'if',
      condition: 'count > 5',
      then: [s({ type: 'setState', state: 'status', value: "'warning'" })],
      else: [s({ type: 'setState', state: 'status', value: "'default'" })],
    }),
    s({ type: 'if', condition: 'enabled || count === 0', then: [], else: [s({ type: 'log', level: 'warn', message: 'disabled' })] }),
    s({
      type: 'custom',
      code: '  const total = items.length; // count the items\n  logger.info(`total ${total}`);\n  actions.addAlert({ type: "info", message: String(total) });',
    }),
    s({ type: 'custom', code: 'if (!enabled) return;\nawait hubspot.fetch("https://api.example.com/ping");' }),
    s({ type: 'closeOverlay', overlayNodeId: '@details-modal' }),
  ];

  const card = createExtension({
    name: 'Feature Card',
    objectTypes: ['contacts', 'deals', 'p_my_object'],
    content: [
      {
        type: 'Flex',
        props: { direction: 'column', gap: 'small' },
        children: [
          { type: 'Heading', text: 'Hello {{ contact.firstname }}!' },
          { type: 'Text', text: '{{ count }}' },
          { type: 'Text', text: 'Plain text with {braces} & <tags>' },
          { type: 'Text', text: '  padded  ' },
          { type: 'Text', text: 'Line 1\nLine 2' },
          { type: 'Text', text: 'Quote: "it\'s" `tick` ${not} {{ name }} and {{ count + 1 }}' },
          {
            type: 'Text',
            props: { format: { fontWeight: 'bold', italic: true }, variant: { $expr: "count > 1 ? 'microcopy' : 'bodytext'" }, inline: true },
            text: 'Formatted',
          },
          {
            type: 'Button',
            props: { variant: { $expr: 'status' }, disabled: false, size: 'small' },
            text: 'Increment',
            events: {
              onClick: [
                s({ type: 'setState', state: 'count', value: 'count + 1' }),
                s({ type: 'addAlert', alertType: 'success', title: 'Count is {{ count }}', message: 'Now {{ count + 1 }}' }),
                s({ type: 'log', level: 'info', message: 'clicked {{ count }}' }),
              ],
            },
          },
          { type: 'Input', props: { label: 'Name', name: 'name', placeholder: 'Type "a name"' }, binding: { state: 'name' }, events: { onChange: [s({ type: 'log', level: 'debug', message: '{{ value }}' })] } },
          { type: 'NumberInput', props: { label: 'Count', name: 'count' }, binding: { state: 'count' } },
          {
            type: 'Checkbox',
            props: { name: 'enabled', value: 'yes' },
            text: 'Enabled',
            binding: { state: 'enabled' },
            events: { onChange: [s({ type: 'log', level: 'info', message: '{{ checked }} {{ value }}' })] },
          },
          { type: 'DateInput', props: { label: 'Date', name: 'date' }, binding: { state: 'selectedDate' } },
          {
            type: 'Select',
            props: { label: 'Status', name: 'status', options: [{ label: 'Default', value: 'default' }, { label: '{{ name }}', value: 'warning' }] },
            binding: { state: 'status' },
          },
          { type: 'Toggle', props: { label: 'Enabled', name: 'toggle' }, binding: { state: 'enabled' } },
          { type: 'ProgressBar', props: { value: '{{ count }}', maxValue: '{{ name }}', valueMax: '{{ status }}', title: 'Progress {{ count }}' } },
          { type: 'Image', props: { src: 'https://images.example.com/logo.png', alt: 'Logo', width: 120 } },
          { type: 'Link', props: { href: { $expr: '`https://example.com/${name}`' } }, text: 'Profile' },
          {
            type: 'Button',
            text: 'Open details',
            slots: {
              overlay: [
                {
                  type: 'Modal',
                  props: { id: 'details-modal', title: 'Details for {{ contact.firstname }}', width: 'medium' },
                  events: { onOpen: [s({ type: 'log', level: 'info', message: 'opened' })] },
                  children: [
                    { type: 'ModalBody', children: [{ type: 'Text', text: 'Modal body {{ count }}' }] },
                    {
                      type: 'ModalFooter',
                      children: [
                        {
                          type: 'Button',
                          props: { variant: 'primary' },
                          text: 'Close',
                          events: { onClick: [s({ type: 'closeOverlay', overlayNodeId: '@details-modal' })] },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
          { type: 'Button', text: 'Hover me', slots: { overlay: [{ type: 'Tooltip', text: 'A tip with {{ count }}' }] } },
          { type: 'Button', text: 'Run everything', events: { onClick: allActions } },
          // Repeat with custom index name, inside a Flex
          { type: 'Text', repeat: { items: 'items', itemName: 'item', indexName: 'i' }, text: '{{ i }}: {{ item.label }}' },
          // Repeat with key, handler inside the repeat and a nested repeat with a condition
          {
            type: 'Tile',
            repeat: { items: 'deals', itemName: 'deal', indexName: 'dealIndex', key: 'deal.toObjectId' },
            children: [
              { type: 'Text', text: '{{ deal.properties.dealname }}' },
              {
                type: 'Button',
                text: 'Select deal',
                events: {
                  onClick: [
                    s({ type: 'setState', state: 'name', value: 'deal.properties.dealname' }),
                    s({ type: 'log', level: 'info', message: 'Selected {{ dealIndex }}' }),
                  ],
                },
              },
              { type: 'Button', text: 'Event in repeat', events: { onClick: [s({ type: 'log', level: 'info', message: '{{ event.type }} {{ deal.toObjectId }}' })] } },
              {
                type: 'Tag',
                repeat: { items: 'deal.associationTypes', itemName: 'assoc', indexName: 'k' },
                condition: 'assoc.label',
                text: '{{ assoc.label }}',
              },
            ],
          },
          { type: 'Alert', condition: 'contactError', props: { title: 'Error', variant: 'danger' }, text: '{{ contactError }}' },
          { type: 'LoadingSpinner', condition: 'weatherLoading || quoteLoading', props: { label: 'Loading' } },
          { type: 'Text', repeat: { items: 'companies.filter((c) => c.objectId > 0)', itemName: 'company', indexName: 'index' }, condition: 'company.properties.name', text: '{{ company.properties.name }}' },
          { type: 'Text', repeat: { items: 'items', itemName: 'unused', indexName: 'idx', key: "'row-' + idx" }, text: 'Row' },
          {
            type: 'Table',
            props: { paginated: true, pageCount: 5, bordered: true },
            binding: { state: 'page' },
            children: [
              {
                type: 'TableHead',
                children: [
                  {
                    type: 'TableRow',
                    children: [
                      { type: 'TableHeader', props: { sortDirection: 'none' }, text: 'Name' },
                      { type: 'TableHeader', props: { sortDirection: 'ascending' }, binding: { state: 'sort' }, text: 'Amount' },
                    ],
                  },
                ],
              },
              {
                type: 'TableBody',
                children: [
                  {
                    type: 'TableRow',
                    repeat: { items: 'deals', itemName: 'row', indexName: 'rowIndex', key: 'row.toObjectId' },
                    children: [
                      { type: 'TableCell', children: [{ type: 'Text', text: '{{ row.properties.dealname }}' }] },
                      { type: 'TableCell', props: { align: 'right' }, children: [{ type: 'Text', text: '{{ row.properties.amount }}' }] },
                    ],
                  },
                ],
              },
            ],
          },
          { type: 'Text', text: '{{ weather?.temperature }} / {{ quote }} / {{ postData }} / {{ anything }} / {{ filters.a }}' },
          { type: 'Text', text: 'Hi {{ nullableName }}' },
          { type: 'Input', props: { label: 'Nullable', name: 'nullable' }, binding: { state: 'nullableName' } },
          { type: 'Button', text: 'Empty handlers', events: { onClick: [] } },
          { type: 'Box', children: [] },
        ],
      },
      { type: 'Text', condition: 'enabled', text: 'Root conditional' },
      { type: 'Tag', repeat: { items: 'items', itemName: 'item', indexName: 'index' }, text: '{{ item.label }}' },
    ],
  });
  card.objectTypes = ['contacts', 'deals', 'p_my_object'];
  card.description = 'Every feature of the builder in one card.';
  card.state = [
    state('count', 'number', 0, 'How many times the button was clicked'),
    state('name', 'string', ''),
    state('enabled', 'boolean', false),
    state('items', 'array', [{ label: 'A' }, { label: 'B' }]),
    state('filters', 'object', { a: 1, nested: { b: 'two' } }),
    state('anything', 'any', null),
    state('status', 'string', 'default'),
    state('selectedDate', 'object', null),
    state('nullableName', 'string', null),
    state('page', 'number', 1),
    state('sort', 'string', 'ascending'),
  ];
  card.dataSources = dataSources;

  const sidebar = createExtension({
    name: 'Sidebar Actions',
    location: 'crm.record.sidebar',
    objectTypes: ['tickets'],
    existing: [card],
    content: [
      {
        type: 'CrmActionButton',
        props: { actionType: 'SEND_EMAIL', actionContext: { objectTypeId: '0-1', objectId: 1 }, variant: 'primary' },
        text: 'Send email',
        events: { onError: [s({ type: 'log', level: 'error', message: '{{ errors }}' })] },
      },
      { type: 'Button', text: 'Refresh', events: { onClick: [s({ type: 'refreshObjectProperties' })] } },
    ],
  });

  const settings = createExtension({
    kind: 'settings',
    name: 'Settings',
    existing: [card, sidebar],
    content: [
      {
        type: 'Flex',
        props: { direction: 'column', gap: 'medium' },
        children: [
          { type: 'Input', props: { label: 'API key', name: 'apiKey', type: 'password' }, binding: { state: 'apiKey' } },
          {
            type: 'Button',
            props: { variant: 'primary' },
            text: 'Save',
            events: {
              onClick: [
                s({
                  type: 'fetch',
                  url: 'https://settings.example.com/save',
                  method: 'PUT',
                  body: '{ apiKey }',
                  onSuccess: [s({ type: 'addAlert', alertType: 'success', title: '', message: 'Saved' })],
                }),
              ],
            },
          },
          {
            type: 'Button',
            text: 'Other actions',
            events: {
              onClick: [
                s({ type: 'refreshObjectProperties' }),
                s({ type: 'closeOverlay', overlayNodeId: '@help-panel' }),
                s({ type: 'reloadPage' }),
                s({ type: 'copyToClipboard', text: 'static text' }),
                s({ type: 'openIframeModal', uri: 'https://help.example.com', title: '', width: 600, height: 400 }),
              ],
            },
          },
          {
            type: 'Link',
            props: { href: 'https://example.com' },
            text: 'Help',
            slots: {
              overlay: [
                {
                  type: 'Panel',
                  props: { id: 'help-panel', title: 'Help' },
                  children: [{ type: 'PanelBody', children: [{ type: 'PanelSection', children: [{ type: 'Text', text: 'Help text' }] }] }],
                },
              ],
            },
          },
        ],
      },
    ],
  });
  settings.state = [state('apiKey', 'string', '')];

  const home = createExtension({
    kind: 'home',
    name: 'App Home',
    existing: [card, sidebar, settings],
    content: [
      { type: 'Heading', text: 'Recent deals' },
      {
        type: 'Table',
        children: [
          {
            type: 'TableBody',
            children: [
              {
                type: 'TableRow',
                repeat: { items: 'recentDeals', itemName: 'deal', indexName: 'index', key: 'deal.objectId' },
                children: [{ type: 'TableCell', children: [{ type: 'Text', text: '{{ deal.properties.dealname }}' }] }],
              },
            ],
          },
        ],
      },
      {
        type: 'Button',
        text: 'Reload',
        events: {
          onClick: [
            s({ type: 'runDataSource', dataSourceId: 'ds_recent' }),
            s({ type: 'openIframeModal', uri: 'https://{{ context.portal.id }}.example.com/x', title: 'Portal', width: 500, height: 300 }),
          ],
        },
      },
    ],
  });
  home.dataSources = [
    {
      id: 'ds_recent',
      kind: 'crmSearch',
      name: 'recentDeals',
      objectType: '0-3',
      properties: ['dealname', 'amount'],
      filters: [],
      sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
      pageLength: 10,
    },
  ];

  project.extensions = [card, sidebar, settings, home];
  project.app.permittedUrls.fetch = ['https://api.example.com/'];
  return project;
}

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

/**
 * Documents that are valid but awkward to generate: names that shadow imports and helpers,
 * entries that would redeclare a name, typed state inside nested literal props, repeat variables
 * shadowing outer names and event params, conditional / repeated overlays and quoted text.
 */
export function createEdgeCaseProject(): Project {
  stepCounter = 0;
  const project = createProject('Edge Cases');
  project.functions = [{ ...createAppFunction([], 'echo'), id: 'f_echo', uid: 'echo' }];
  const card = createExtension({
    name: 'Edge Card',
    content: [
      // Document names equal to imports (`Text`, `Button`, `logger`, `hubspot`) and helpers.
      { type: 'Text', text: "Don't {{ Text }} {{ logger }} {{ toText }} {{ contact }} {{ count }}" },
      { type: 'Heading', text: 'Say "hi"' },
      {
        type: 'Flex',
        repeat: { items: 'asArray', itemName: 'Button', indexName: 'hubspot' },
        children: [
          {
            type: 'Button',
            text: '{{ Button.name }} #{{ hubspot }}',
            events: {
              onClick: [
                s({ type: 'log', level: 'info', message: 'Clicked {{ Button.name }}' }),
                s({ type: 'fetch', url: 'https://api.example.com/items', method: 'GET', resultState: 'useCrmSearch' }),
                s({ type: 'runFunction', functionId: 'f_echo', parameters: '{ index: hubspot }' }),
                s({ type: 'setState', state: 'count', value: 'count + 1' }),
              ],
            },
          },
          // Repeat variables shadowing outer repeat variables and an event param (`value`).
          {
            type: 'Input',
            repeat: { items: 'Button.fields', itemName: 'value', indexName: 'hubspot' },
            props: { label: '{{ value.label }}', name: 'field' },
            events: { onChange: [s({ type: 'setState', state: 'count', value: 'value.length + hubspot' })] },
          },
        ],
      },
      // Typed state in nested literal props (object fields, options, dates).
      { type: 'Text', props: { format: { fontWeight: '{{ weight }}', italic: '{{ count }}' } }, text: 'Nested' },
      {
        type: 'Select',
        props: { label: 'Pick', name: 'pick', options: [{ label: '{{ count }}', value: '{{ count }}' }, { label: 'B', value: '{{ weight }}' }] },
      },
      { type: 'DateInput', props: { label: 'Date', name: 'date', value: { year: '{{ weight }}', month: '{{ count }}', date: 1 } } },
      // Conditional overlay.
      {
        type: 'Button',
        text: 'Open',
        slots: {
          overlay: [
            {
              type: 'Modal',
              condition: 'count > 0',
              props: { id: 'edge-modal', title: 'Edge' },
              children: [
                {
                  type: 'ModalBody',
                  children: [{ type: 'Button', text: 'Close', events: { onClick: [s({ type: 'closeOverlay', overlayNodeId: '@edge-modal' })] } }],
                },
              ],
            },
          ],
        },
      },
    ],
  });
  card.state = [
    state('Text', 'string', 'text'),
    state('logger', 'string', 'log'),
    state('toText', 'string', 'converted'),
    state('asArray', 'array', [{ name: 'A', fields: [{ label: 'One' }] }]),
    state('count', 'number', 0),
    state('weight', 'string', 'bold'),
    state('useCrmSearch', 'any', null),
    state('contact', 'string', ''),
    // Would redeclare names: skipped by codegen (validation reports them).
    state('setCount', 'number', 1),
    state('count', 'string', 'duplicate'),
    state('context', 'string', 'shadow'),
  ];
  card.dataSources = [
    // Collides with the `contact` state: skipped.
    { id: 'ds_contact', kind: 'crmProperties', name: 'contact', properties: ['email'] },
    // Shadows React's useState (imported under an alias).
    { id: 'ds_use_state', kind: 'fetch', name: 'useState', url: 'https://api.example.com/state', method: 'GET', runOnMount: true },
  ];
  project.extensions = [card];
  return project;
}

// ---------------------------------------------------------------------------
// Kitchen sink
// ---------------------------------------------------------------------------

/** Log action that reads every param of an event, so the handler declares all of them. */
function logParams(params: string[]): ActionStep[] {
  if (params.length === 0) return [s({ type: 'log', level: 'info', message: 'event' })];
  return [s({ type: 'log', level: 'info', message: params.map((p) => `{{ ${p} }}`).join(' ') })];
}

/** Adds handlers for every declared event of the template's root (variant events only when selected). */
function withEvents(def: ComponentDef, tpl: NodeTemplate, states: StateVar[]): NodeTemplate {
  const props = Object.fromEntries(Object.entries(tpl.props ?? {}).filter(([, v]) => !(v && typeof v === 'object' && '$expr' in v)));
  const events: Record<string, ActionStep[]> = { ...(tpl.events ?? {}) };
  for (const event of def.events ?? []) {
    // Events that only exist in some variants of a discriminated union (requiredWhen) are only
    // valid when the template selects that variant.
    if (event.requiredWhen && !event.requiredWhen(props)) continue;
    events[event.name] = [...(events[event.name] ?? []), ...logParams(event.params.map((p) => p.name))];
  }
  const out: NodeTemplate = { ...tpl, events };
  const vb = def.valueBinding;
  const bindingEvent = vb ? def.events?.find((e) => e.name === vb.event) : undefined;
  if (vb && (!bindingEvent?.requiredWhen || bindingEvent.requiredWhen(props))) {
    const name = `${def.type.replace(/[^A-Za-z0-9]/g, '').replace(/^./, (c) => c.toLowerCase())}Value`;
    states.push(state(name, vb.stateType, vb.initial));
    out.binding = { state: name };
  }
  return out;
}

/**
 * Wraps a template so it sits in a valid parent: inside its first listed parent (recursively), or
 * in the overlay slot of the first root-level trigger that accepts it (overlays, slot-only types).
 */
export function placeTemplate(def: ComponentDef, tpl: NodeTemplate, depth = 0): NodeTemplate {
  if (depth > 8) return tpl;
  if (def.overlay || def.slotOnly) {
    const trigger = ALL_COMPONENTS.find((d) => d.slots?.some((slot) => slot.accepts.includes(def.type)) && !d.parents?.length);
    if (!trigger) return tpl;
    const host = templateFor(trigger);
    const slotName = trigger.slots!.find((slot) => slot.accepts.includes(def.type))!.name;
    return placeTemplate(trigger, { ...host, slots: { ...(host.slots ?? {}), [slotName]: [tpl] } }, depth + 1);
  }
  if (def.parents && def.parents.length > 0) {
    const parentDef = ALL_COMPONENTS.find((d) => d.type === def.parents![0]);
    if (!parentDef) return tpl;
    const parentTpl = templateFor(parentDef);
    return placeTemplate(parentDef, { ...parentTpl, children: [tpl] }, depth + 1);
  }
  return tpl;
}

/**
 * Every registered component, created from its palette template with all events wired and its
 * value bound to state, placed in a valid parent inside the first extension (CRM record tab card,
 * settings page or app home) where it is available.
 */
export function createKitchenSinkProject(): Project {
  stepCounter = 0;
  const project = createProject('Kitchen Sink');
  const card = createExtension({ name: 'Kitchen Sink', location: 'crm.record.tab', objectTypes: ['contacts'] });
  const settings = createExtension({ kind: 'settings', name: 'Kitchen Settings', existing: [card] });
  const home = createExtension({ kind: 'home', name: 'Kitchen Home', existing: [card, settings] });
  const extensions: Extension[] = [card, settings, home];
  const contents = new Map<Extension, NodeTemplate[]>(extensions.map((e) => [e, []]));
  const states = new Map<Extension, StateVar[]>(extensions.map((e) => [e, []]));

  for (const def of ALL_COMPONENTS) {
    const target = extensions.find((e) => isAvailableIn(def, e));
    if (!target) continue;
    const tpl = withEvents(def, templateFor(def), states.get(target)!);
    contents.get(target)!.push(placeTemplate(def, tpl));
  }

  project.extensions = extensions.map((ext) => {
    const built = createExtension({
      kind: ext.kind,
      name: ext.name,
      location: ext.location,
      objectTypes: ext.objectTypes,
      content: contents.get(ext)!,
    });
    return { ...built, id: ext.id, uid: ext.uid, fileName: ext.fileName, state: states.get(ext)! };
  });
  return project;
}

// ---------------------------------------------------------------------------
// Power project: computed values + helper code
// ---------------------------------------------------------------------------

/** Helper code mixing untyped JavaScript and TypeScript (and a name that clashes with `toText`). */
export const POWER_HELPERS = `// Untyped JavaScript helpers get \`any\` parameters in the export.
function formatMoney(value, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value) || 0);
}

const sumBy = (list, key) => list.reduce((total, row) => total + Number(row[key] ?? 0), 0);

export const TAX_RATE = 0.2;

function pluralize(n: number, word: string): string {
  return \`\${n} \${word}\${n === 1 ? '' : 's'}\`;
}

const byName = ({ name: a }, { name: b }) => String(a).localeCompare(String(b));

/** Clashes with the generated toText helper (which is renamed). */
function toText(value) {
  return value === undefined ? '?' : String(value);
}

function logTotal(total: number): void {
  logger.info(\`total \${total}\`);
}
`;

/** A card using computed values (in order, multi-line, calling helpers and setters) and helpers. */
export function createPowerProject(): Project {
  stepCounter = 0;
  const project = createProject('Power Test App');
  const card = createExtension({
    name: 'Power Card',
    content: [
      {
        type: 'Flex',
        props: { direction: 'column', gap: 'small' },
        children: [
          { type: 'Heading', text: '{{ greeting }}' },
          { type: 'Text', text: '{{ label }}: {{ formatMoney(totalWithTax) }} (raw {{ toText(total) }})' },
          { type: 'Text', text: 'Big order', condition: 'isBig' },
          { type: 'Tag', props: { variant: { $expr: "isBig ? 'success' : 'default'" } }, text: '{{ pluralize(count, "unit") }}' },
          {
            type: 'Text',
            repeat: { items: 'sorted', itemName: 'row', indexName: 'i' },
            text: '{{ i + 1 }}. {{ row.name }} — {{ formatMoney(row.amount) }}',
          },
          { type: 'Input', props: { label: 'Filter', name: 'query' }, binding: { state: 'query' } },
          {
            type: 'Button',
            text: 'Add one',
            events: {
              onClick: [
                s({ type: 'custom', code: 'increment();\nlogTotal(total);' }),
                s({ type: 'addAlert', alertType: 'info', title: 'Total', message: '{{ formatMoney(totalWithTax) }}' }),
              ],
            },
          },
          { type: 'Text', text: 'Quote: {{ quote?.price ?? "n/a" }} for {{ contact.firstname }}' },
        ],
      },
    ],
  });
  card.state = [
    state('count', 'number', 2),
    state('query', 'string', ''),
    state('items', 'array', [
      { name: 'Widget', amount: 10 },
      { name: 'Gadget', amount: 25.5 },
    ]),
  ];
  card.dataSources = [
    { id: 'ds_contact', kind: 'crmProperties', name: 'contact', properties: ['firstname', 'amount'] },
    { id: 'ds_quote', kind: 'fetch', name: 'quote', url: 'https://api.example.com/quote', method: 'GET', runOnMount: true },
  ];
  card.helpers = POWER_HELPERS;
  card.computed = [
    { id: 'c_total', name: 'total', expr: "sumBy(items, 'amount')" },
    { id: 'c_tax', name: 'totalWithTax', expr: 'total * (1 + TAX_RATE)', description: 'Total including tax' },
    { id: 'c_label', name: 'label', expr: "pluralize(items.length, 'item')" },
    { id: 'c_greeting', name: 'greeting', expr: "`Hi ${contact.firstname ?? 'there'}`" },
    {
      id: 'c_filtered',
      name: 'sorted',
      expr: "items\n  .filter((row) => row.name.toLowerCase().includes(query.toLowerCase()))\n  .sort(byName)",
    },
    { id: 'c_big', name: 'isBig', expr: 'count > 3 && total > 10' },
    { id: 'c_inc', name: 'increment', expr: '() => setCount(count + 1)' },
    { id: 'c_bad', name: 'count', expr: '1' },
    { id: 'c_empty', name: 'unused', expr: '' },
  ];
  project.extensions = [card];
  return project;
}
