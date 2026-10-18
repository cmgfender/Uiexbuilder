// @vitest-environment node
/**
 * Power-user features without code export ordinary, type-correct TSX: visual conditions (Show when,
 * If steps, list filters), shaped lists (filter / sort / limit / formats as computed values),
 * Rules in actions (alert type / message, set-state values, copy text) and pasted settings.
 * Every generated card type-checks strictly against the real @hubspot/ui-extensions and the
 * document validates without errors.
 */
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createExtension, createProject } from '../model/factory';
import type { ActionStep, Extension, NodeTemplate, Project, StateVar } from '../model/types';
import { validateProject } from '../model/validate';
import { conditionToExpr, declaredSubjectType, type ConditionSet } from '../inspector/power-conditions';
import { rulesToExpr } from '../inspector/rules';
import { shapeToExpr, type ListShape } from '../power/shape';
import { formatDiagnostics, scratchDir, typecheck, writeFiles } from '../test/typecheck';
import { generateExtensionSource, generateProjectFiles } from './index';

let n = 0;
const step = (s: Record<string, unknown>): ActionStep => ({ id: `a_${++n}`, ...s }) as unknown as ActionStep;
const st = (name: string, type: StateVar['type'], initial: StateVar['initial']): StateVar => ({ id: `s_${name}`, name, type, initial });

const STATE: StateVar[] = [
  st('count', 'number', 3),
  st('maybe', 'number', null),
  st('search', 'string', ''),
  st('label', 'string', null),
  st('open', 'boolean', false),
  st('tags', 'array', ['a']),
  st('anything', 'any', null),
];

function cond(ext: Pick<Extension, 'state' | 'dataSources'>, set: ConditionSet): string {
  return conditionToExpr(set, { typeOf: (s) => declaredSubjectType(ext, s) });
}

function buildProject(): Project {
  const ext = createExtension({ kind: 'card', name: 'Power User Card', content: [] });
  ext.state = STATE;
  ext.dataSources = [
    { id: 'd_deals', kind: 'associations', name: 'deals', toObjectType: '0-3', properties: ['dealname', 'amount', 'closedate', 'hs_deal_stage_probability'], pageLength: 25 },
    { id: 'd_contact', kind: 'crmProperties', name: 'contact', properties: ['email', 'firstname', 'num_notes'] },
    { id: 'd_api', kind: 'fetch', name: 'api', url: 'https://api.example.com/items', method: 'GET', runOnMount: true },
  ];
  // Every operator on every kind of subject.
  const everyCheck: ConditionSet = {
    groups: [
      [
        { subject: 'count', op: 'gt', value: { kind: 'literal', value: 2 } },
        { subject: 'count', op: 'eq', value: { kind: 'literal', value: 3 } },
        { subject: 'maybe', op: 'lte', value: { kind: 'literal', value: 10 } },
        { subject: 'maybe', op: 'eq', value: { kind: 'literal', value: 1 } },
        { subject: 'search', op: 'contains', value: { kind: 'literal', value: 'Acme' } },
        { subject: 'search', op: 'gte', value: { kind: 'literal', value: 5 } },
        { subject: 'search', op: 'lt', value: { kind: 'literal', value: '2026-01-01' } },
        { subject: 'label', op: 'empty' },
        { subject: 'label', op: 'neq', value: { kind: 'literal', value: 'x' } },
      ],
      [
        { subject: 'open', op: 'isTrue' },
        { subject: 'tags', op: 'notEmpty' },
        { subject: 'tags', op: 'notContains', value: { kind: 'ref', expr: 'search' } },
        { subject: 'anything', op: 'gt', value: { kind: 'ref', expr: 'count' } },
      ],
      [
        { subject: 'deals', op: 'notEmpty' },
        { subject: 'open', op: 'eq', value: { kind: 'literal', value: false } },
        { subject: 'deals.length', op: 'gte', value: { kind: 'ref', expr: 'count' } },
        { subject: 'contact.num_notes', op: 'gt', value: { kind: 'literal', value: 3 } },
        { subject: 'contact.email', op: 'contains', value: { kind: 'literal', value: '@acme' } },
        { subject: 'dealsLoading', op: 'isFalse' },
        { subject: 'dealsError', op: 'isFalse' },
        { subject: 'context.user.id', op: 'gt', value: { kind: 'literal', value: 0 } },
        { subject: 'context.user.email', op: 'contains', value: { kind: 'literal', value: 'hubspot' } },
        { subject: 'api', op: 'isTrue' },
        { subject: 'count + 1', op: 'lt', value: { kind: 'ref', expr: 'maybe' } },
      ],
    ],
  };
  const big: ListShape = {
    source: 'deals',
    filter: cond(ext, {
      groups: [
        [
          { subject: 'row.properties.amount', op: 'gt', value: { kind: 'literal', value: 1000 } },
          { subject: 'row.properties.dealname', op: 'contains', value: { kind: 'ref', expr: 'search' } },
        ],
      ],
    }),
    sort: { field: ['properties', 'amount'], dir: 'desc', as: 'number' },
    limit: 5,
    formats: [
      { name: 'amountFormatted', field: ['properties', 'amount'], kind: 'currency', currency: 'EUR', decimals: 2 },
      { name: 'probability', field: ['properties', 'hs_deal_stage_probability'], kind: 'percent' },
      { name: 'closeDate', field: ['properties', 'closedate'], kind: 'date' },
      { name: 'closesIn', field: ['properties', 'closedate'], kind: 'relative' },
      { name: 'amountNumber', field: ['properties', 'amount'], kind: 'number', decimals: 1 },
    ],
  };
  ext.computed = [
    { id: 'c_big', name: 'bigDeals', expr: shapeToExpr(big), description: 'deals, filtered and sorted' },
    { id: 'c_tags', name: 'sortedTags', expr: shapeToExpr({ source: 'tags', sort: { field: ['length'], dir: 'asc', as: 'number' } }) },
    { id: 'c_api', name: 'apiItems', expr: shapeToExpr({ source: 'api.items', sort: { field: ['first name'], dir: 'desc', as: 'text' }, limit: 0 }) },
    { id: 'c_top', name: 'topOfBig', expr: shapeToExpr({ source: 'bigDeals', limit: 1 }) },
  ];

  const alertTypeRules = rulesToExpr({
    subject: 'count',
    cases: [
      { op: '>=', when: 80, then: 'success' },
      { op: '>=', when: 40, then: 'warning' },
    ],
    otherwise: 'danger',
  });
  const content: NodeTemplate[] = [
    { type: 'Text', name: 'Every check', condition: cond(ext, everyCheck), text: 'Shown' },
    {
      type: 'Table',
      children: [
        {
          type: 'TableBody',
          children: [
            {
              type: 'TableRow',
              repeat: { items: 'bigDeals', itemName: 'deal', indexName: 'i', key: 'deal.toObjectId' },
              children: [
                { type: 'TableCell', children: [{ type: 'Text', text: '{{ deal.properties.dealname }} {{ deal.amountFormatted }} {{ deal.closesIn }}' }] },
                {
                  type: 'TableCell',
                  children: [
                    {
                      type: 'Tag',
                      props: { variant: { $expr: rulesToExpr({ subject: 'Number(deal.properties.amount)', cases: [{ op: '>=', when: 10000, then: 'success' }], otherwise: 'default' }) } },
                      condition: cond(ext, { groups: [[{ subject: 'deal.properties.closedate', op: 'notEmpty' }]] }),
                      text: '{{ deal.closeDate }}',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      type: 'Input',
      props: { label: 'Search', name: 'search' },
      binding: { state: 'search' },
      events: {
        onChange: [
          step({
            type: 'if',
            condition: cond(ext, {
              groups: [[{ subject: 'value', op: 'contains', value: { kind: 'literal', value: 'vip' } }], [{ subject: 'value', op: 'empty' }]],
            }),
            then: [step({ type: 'setState', state: 'open', value: rulesToExpr({ subject: 'value', cases: [{ op: '===', when: 'vip', then: true }], otherwise: false }) })],
            else: [],
          }),
        ],
      },
    },
    {
      type: 'Button',
      text: 'Check',
      events: {
        onClick: [
          step({ type: 'addAlert', alertType: 'info', alertTypeExpr: alertTypeRules, title: '{{ (count) > 1 ? "Many" : "One" }}', message: '{{ (count) >= 80 ? "Great" : "Keep going" }}' }),
          // A hand-written type expression that is not rules is cast.
          step({ type: 'addAlert', alertType: 'info', alertTypeExpr: 'search', title: '', message: 'x' }),
          step({ type: 'setState', state: 'count', value: rulesToExpr({ subject: 'count', cases: [{ op: '<', when: 10, then: 10 }], otherwise: 0 }) }),
          step({ type: 'setState', state: 'label', value: rulesToExpr({ subject: 'search', cases: [{ op: '!==', when: '', then: 'Searching' }], otherwise: 'Idle' }) }),
          step({ type: 'setState', state: 'open', value: rulesToExpr({ subject: 'tags.length', cases: [{ op: '>', when: 0, then: true }], otherwise: false }) }),
          step({ type: 'copyToClipboard', text: '{{ (contact.email) !== null ? "Has email" : "No email" }}' }),
          step({
            type: 'if',
            condition: cond(ext, { groups: [[{ subject: 'bigDeals', op: 'notEmpty' }, { subject: 'count', op: 'neq', value: { kind: 'ref', expr: 'maybe' } }]] }),
            then: [step({ type: 'log', level: 'info', message: 'ok' })],
            else: [],
          }),
        ],
      },
    },
  ];
  const withContent = createExtension({ kind: 'card', name: 'Power User Card', content });
  Object.assign(withContent, { state: ext.state, dataSources: ext.dataSources, computed: ext.computed });
  withContent.mock.dataSources.d_deals = [{ toObjectId: 1, properties: { dealname: 'A', amount: '5000', closedate: '2026-01-02', hs_deal_stage_probability: '0.5' } }];
  withContent.mock.dataSources.d_api = { items: [{ 'first name': 'Ada' }] };
  const project = createProject('Power User App', [withContent]);
  project.app.permittedUrls.fetch = ['https://api.example.com'];
  return project;
}

let project: Project;
let dir = '';

beforeAll(() => {
  project = buildProject();
  dir = scratchDir('codegen-power-user');
});

describe('power-user features export type-correct TSX', () => {
  it('type-checks strictly against @hubspot/ui-extensions', () => {
    const files = generateProjectFiles(project);
    writeFiles(dir, files);
    const tsx = files.filter((f) => f.path.endsWith('.tsx')).map((f) => path.join(dir, f.path));
    expect(tsx.length).toBeGreaterThan(0);
    expect(formatDiagnostics(typecheck(tsx))).toBe('');
  });

  it('is ordinary code: conditions, shaped lists and rules appear as written', () => {
    const src = generateExtensionSource(project, project.extensions[0]);
    expect(src).toContain('const bigDeals: any = [...(deals ?? [])]');
    expect(src).toContain('.filter((row) => Number(row.properties.amount) > 1000 && String(row.properties.dealname ?? "").toLowerCase().includes(String(search ?? "").toLowerCase()))');
    expect(src).toContain('.sort((a, b) => Number(b.properties.amount ?? 0) - Number(a.properties.amount ?? 0))');
    expect(src).toContain('type: (count) >= 80 ? "success" : (count) >= 40 ? "warning" : "danger"');
    expect(src).toContain('type: (search) as any');
    expect(src).toContain('String(label ?? "").length === 0');
  });

  it('validates without errors', () => {
    const errors = validateProject(project).filter((i) => i.severity === 'error');
    expect(errors.map((e) => `${e.rule}: ${e.message}`)).toEqual([]);
  });
});
