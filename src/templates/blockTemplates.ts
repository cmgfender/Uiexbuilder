/**
 * Drop-in blocks (BLOCK_TEMPLATES): small, well-composed snippets inserted with one click or by
 * dragging onto the canvas. Blocks that need state declare it in `state`; the insert flow adds any
 * variable the extension does not have yet (matched by name).
 */
import {
  ChartColumn,
  Columns2,
  Gauge,
  Heading,
  Inbox,
  KeyRound,
  LayoutPanelTop,
  ListCollapse,
  LoaderCircle,
  PanelTop,
  Info,
  RectangleHorizontal,
  Search,
  ShieldAlert,
  Table,
  TextCursorInput,
  TrendingUp,
} from 'lucide-react';
import type { BlockTemplate } from './catalog';
import { blockState, steps, t } from './builders';

export const BLOCK_TEMPLATES: BlockTemplate[] = [
  {
    id: 'key-value',
    name: 'Key/value summary',
    description: 'Label and value pairs, like a record’s key properties.',
    icon: KeyRound,
    keywords: ['description list', 'properties', 'details', 'summary'],
    template: {
      type: 'DescriptionList',
      props: { direction: 'row' },
      children: [t.item('Owner', 'Jamie Rivera'), t.item('Stage', 'Negotiation'), t.item('Last contacted', 'Oct 12, 2026')],
    },
  },
  {
    id: 'stat-row',
    name: 'Stat row',
    description: 'Three key numbers with trends.',
    icon: TrendingUp,
    keywords: ['statistics', 'kpi', 'metrics', 'numbers'],
    template: {
      type: 'Statistics',
      children: [
        t.stat('Open deals', 12, { value: '8%', direction: 'increase' }),
        t.stat('Pipeline value', '$48,200', { value: '3.1%', direction: 'increase' }),
        t.stat('Win rate', '27%', { value: '1.4%', direction: 'decrease' }),
      ],
    },
  },
  {
    id: 'form-submit',
    name: 'Form with submit',
    description: 'Name, email and message fields with a submit button and a confirmation.',
    icon: TextCursorInput,
    keywords: ['form', 'inputs', 'submit', 'contact form'],
    template: {
      type: 'Form',
      events: {
        onSubmit: steps({
          type: 'addAlert',
          alertType: 'success',
          title: 'Form submitted',
          message: 'Thanks, {{ event.targetValue.name || "friend" }}! We received your message.',
        }),
      },
      children: [
        t.column(
          [
            { type: 'Input', props: { label: 'Name', name: 'name', required: true, placeholder: 'Jane Doe' } },
            { type: 'Input', props: { label: 'Email', name: 'email', required: true, placeholder: 'jane@company.com' } },
            { type: 'TextArea', props: { label: 'Message', name: 'message', rows: 3, placeholder: 'How can we help?' } },
            { type: 'Button', props: { type: 'submit', variant: 'primary' }, text: 'Submit' },
          ],
          'small',
        ),
      ],
    },
  },
  {
    id: 'two-columns',
    name: 'Two columns',
    description: 'A row with two equal columns that share the width.',
    icon: Columns2,
    keywords: ['layout', 'columns', 'side by side', 'flex', 'box'],
    template: {
      type: 'Flex',
      props: { direction: 'row', gap: 'medium' },
      children: [
        { type: 'Box', props: { flex: 1 }, children: [t.column([t.bold('Left column'), t.text('Content for the first column.')], 'extra-small')] },
        { type: 'Box', props: { flex: 1 }, children: [t.column([t.bold('Right column'), t.text('Content for the second column.')], 'extra-small')] },
      ],
    },
  },
  {
    id: 'section-tile',
    name: 'Section tile',
    description: 'A bordered tile with a heading and text to group related content.',
    icon: PanelTop,
    keywords: ['tile', 'card', 'section', 'group'],
    template: {
      type: 'Tile',
      children: [t.column([t.heading('Section title'), t.text('Group related information together in a tile.')], 'small')],
    },
  },
  {
    id: 'info-alert',
    name: 'Info alert',
    description: 'A highlighted message that calls out important information.',
    icon: Info,
    keywords: ['alert', 'banner', 'notice', 'callout', 'message'],
    template: { type: 'Alert', props: { title: 'Good to know', variant: 'info' }, text: 'This customer is on the annual plan and renews on March 1.' },
  },
  {
    id: 'table',
    name: 'Table',
    description: 'A table with a header row and three rows of data.',
    icon: Table,
    keywords: ['table', 'grid', 'rows', 'columns', 'list'],
    template: {
      type: 'Table',
      props: { bordered: true },
      children: [
        { type: 'TableHead', children: [{ type: 'TableRow', children: [t.header('Name'), t.header('Status'), t.header('Amount', { align: 'right' })] }] },
        {
          type: 'TableBody',
          children: [
            { type: 'TableRow', children: [t.cell('Acme Corp'), t.cell('Active'), t.cell('$12,500', { align: 'right' })] },
            { type: 'TableRow', children: [t.cell('Globex Inc.'), t.cell('Trial'), t.cell('$4,800', { align: 'right' })] },
            { type: 'TableRow', children: [t.cell('Initech'), t.cell('Churned'), t.cell('$0', { align: 'right' })] },
          ],
        },
      ],
    },
  },
  {
    id: 'button-row',
    name: 'Button row',
    description: 'A primary action with secondary actions; extra buttons collapse into “More”.',
    icon: RectangleHorizontal,
    keywords: ['buttons', 'actions', 'toolbar'],
    template: {
      type: 'ButtonRow',
      children: [
        { type: 'Button', props: { variant: 'primary' }, text: 'Save' },
        { type: 'Button', props: { variant: 'secondary' }, text: 'Preview' },
        { type: 'Button', props: { variant: 'secondary' }, text: 'Cancel' },
      ],
    },
  },
  {
    id: 'empty-state',
    name: 'Empty state',
    description: 'An illustration, message and call to action for when there is no data.',
    icon: Inbox,
    keywords: ['empty', 'no data', 'placeholder', 'zero state'],
    template: {
      type: 'EmptyState',
      props: { title: 'Nothing here yet', imageName: 'emptyStateCharts', layout: 'vertical' },
      children: [t.column([t.text('Once records are added they show up here.'), { type: 'Button', props: { variant: 'primary', size: 'small' }, text: 'Add a record' }], 'small')],
    },
  },
  {
    id: 'loading-state',
    name: 'Loading state',
    description: 'A spinner shown while isLoading is true, then the content.',
    icon: LoaderCircle,
    keywords: ['loading', 'spinner', 'condition', 'wait'],
    state: [blockState('isLoading', 'boolean', true, 'Set to false once your data has loaded')],
    template: t.column(
      [
        { type: 'LoadingSpinner', props: { label: 'Loading…', showLabel: true, layout: 'centered' }, condition: 'isLoading' },
        { type: 'Text', condition: '!isLoading', text: 'Your content appears here once loading has finished.' },
      ],
      'small',
    ),
  },
  {
    id: 'confirm-button',
    name: 'Confirm button',
    description: 'A button that asks for confirmation in a modal before acting.',
    icon: ShieldAlert,
    keywords: ['modal', 'confirm', 'dialog', 'delete', 'overlay'],
    template: {
      type: 'Button',
      props: { variant: 'destructive' },
      text: 'Delete record',
      slots: {
        overlay: [
          {
            type: 'Modal',
            props: { id: 'confirm-delete', title: 'Delete this record?', variant: 'danger', width: 'small' },
            children: [
              { type: 'ModalBody', children: [t.text('This permanently deletes the record. You can’t undo this.')] },
              {
                type: 'ModalFooter',
                children: [
                  {
                    type: 'Button',
                    props: { variant: 'destructive' },
                    text: 'Delete',
                    events: {
                      onClick: steps(
                        { type: 'addAlert', alertType: 'success', title: 'Record deleted', message: 'The record was deleted.' },
                        { type: 'closeOverlay', overlayNodeId: '@confirm-delete' },
                      ),
                    },
                  },
                  {
                    type: 'Button',
                    props: { variant: 'secondary' },
                    text: 'Cancel',
                    events: { onClick: steps({ type: 'closeOverlay', overlayNodeId: '@confirm-delete' }) },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  },
  {
    id: 'tabs',
    name: 'Tabs with two panels',
    description: 'Switch between two panels of content.',
    icon: LayoutPanelTop,
    keywords: ['tabs', 'panels', 'navigation', 'switch'],
    template: {
      type: 'Tabs',
      props: { defaultSelected: 'overview' },
      children: [
        { type: 'Tab', props: { tabId: 'overview', title: 'Overview' }, children: [t.text('Overview content goes here.')] },
        { type: 'Tab', props: { tabId: 'details', title: 'Details' }, children: [t.text('Details content goes here.')] },
      ],
    },
  },
  {
    id: 'faq',
    name: 'Accordion FAQ',
    description: 'Collapsible questions and answers.',
    icon: ListCollapse,
    keywords: ['accordion', 'faq', 'questions', 'collapse', 'expand'],
    template: t.column(
      [
        { type: 'Accordion', props: { title: 'How is pricing calculated?', defaultOpen: true }, children: [t.text('Pricing is based on the number of seats and the billing term.')] },
        { type: 'Accordion', props: { title: 'Can I change plans later?' }, children: [t.text('Yes — upgrades apply immediately, downgrades at the next renewal.')] },
        { type: 'Accordion', props: { title: 'Where is my data stored?' }, children: [t.text('In the region chosen in the app settings (US, EU or APAC).')] },
      ],
      'extra-small',
    ),
  },
  {
    id: 'progress',
    name: 'Progress tracker',
    description: 'A progress bar with a short status line.',
    icon: Gauge,
    keywords: ['progress', 'bar', 'percent', 'status', 'completion'],
    template: t.column(
      [
        { type: 'ProgressBar', props: { title: 'Implementation progress', value: 3, maxValue: 5, showPercentage: true } },
        t.micro('3 of 5 milestones complete'),
      ],
      'extra-small',
    ),
  },
  {
    id: 'search-results',
    name: 'Search + results',
    description: 'A search box bound to query that filters a list as you type.',
    icon: Search,
    keywords: ['search', 'filter', 'list', 'query', 'repeat'],
    state: [blockState('query', 'string', '', 'Search text typed by the user')],
    template: t.column(
      [
        { type: 'SearchInput', props: { label: 'Search', name: 'query', placeholder: 'Search companies', clearable: true }, binding: { state: 'query' } },
        {
          type: 'List',
          props: { variant: 'unordered-styled' },
          children: [
            {
              type: 'Text',
              repeat: {
                items: "['Acme Corp', 'Globex Corporation', 'Initech', 'Umbrella Labs', 'Stark Industries'].filter((name) => name.toLowerCase().includes(query.trim().toLowerCase()))",
                itemName: 'result',
                indexName: 'index',
              },
              text: '{{ result }}',
            },
          ],
        },
        t.micro('No matches for “{{ query }}”', {
          condition: "!['Acme Corp', 'Globex Corporation', 'Initech', 'Umbrella Labs', 'Stark Industries'].some((name) => name.toLowerCase().includes(query.trim().toLowerCase()))",
        }),
      ],
      'small',
    ),
  },
  {
    id: 'header-action',
    name: 'Header with action',
    description: 'A heading with a supporting line and a button aligned to the right.',
    icon: Heading,
    keywords: ['header', 'title', 'heading', 'toolbar'],
    template: t.row(
      [
        t.column([t.heading('Section title'), t.micro('A short description of this section')], 'flush'),
        { type: 'Button', props: { variant: 'secondary', size: 'small' }, text: 'View all' },
      ],
      { justify: 'between', align: 'center' },
    ),
  },
  {
    id: 'bar-chart',
    name: 'Bar chart',
    description: 'Monthly values as a bar chart with sample data.',
    icon: ChartColumn,
    keywords: ['chart', 'graph', 'bar', 'report', 'visualization'],
    template: {
      type: 'BarChart',
      props: {
        data: [
          { month: 'Jul', deals: 18 },
          { month: 'Aug', deals: 24 },
          { month: 'Sep', deals: 21 },
          { month: 'Oct', deals: 29 },
        ],
        axes: { x: { field: 'month', fieldType: 'category', label: 'Month' }, y: { field: 'deals', fieldType: 'linear', label: 'Deals closed' } },
        options: { title: 'Deals closed per month', showTooltips: true },
      },
    },
  },
];
