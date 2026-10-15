/**
 * Starter extensions (PROJECT_TEMPLATES): complete, realistic cards / pages that show HubSpot best
 * practices — CRM data hooks with loading and error states, bound inputs, plain-language actions,
 * overlays closed with closeOverlay, app functions for server-side logic and mock data for the
 * designer preview. Every template validates without errors and generates code that type-checks
 * (see templates.test.ts).
 */
import type { ExtensionTemplate } from './catalog';
import {
  appFunction,
  computedValue,
  CURRENT_RECORD_CONTEXT,
  dataSource,
  dealStageLabel,
  dealStageVariant,
  makeExtension,
  mockRecord,
  money,
  shortDate,
  stateVar,
  steps,
  t,
} from './builders';
import type { NodeTemplate } from '../model/types';

// ---------------------------------------------------------------------------
// Shared expression snippets
// ---------------------------------------------------------------------------

const LIFECYCLE_LABEL =
  "new Map([['subscriber', 'Subscriber'], ['lead', 'Lead'], ['marketingqualifiedlead', 'Marketing qualified lead'], " +
  "['salesqualifiedlead', 'Sales qualified lead'], ['opportunity', 'Opportunity'], ['customer', 'Customer'], " +
  "['evangelist', 'Evangelist'], ['other', 'Other']]).get(contact.lifecyclestage) || 'No lifecycle stage'";
const LIFECYCLE_VARIANT =
  "contact.lifecyclestage === 'customer' || contact.lifecyclestage === 'evangelist' ? 'success' : " +
  "contact.lifecyclestage === 'opportunity' ? 'warning' : contact.lifecyclestage ? 'info' : 'default'";
const LEAD_STATUS_LABEL =
  "new Map([['NEW', 'New'], ['OPEN', 'Open'], ['IN_PROGRESS', 'In progress'], ['OPEN_DEAL', 'Open deal'], " +
  "['UNQUALIFIED', 'Unqualified'], ['ATTEMPTED_TO_CONTACT', 'Attempted to contact'], ['CONNECTED', 'Connected'], " +
  "['BAD_TIMING', 'Bad timing']]).get(contact.hs_lead_status) || '—'";
const PRIORITY_LABEL =
  "new Map([['URGENT', 'Urgent'], ['HIGH', 'High priority'], ['MEDIUM', 'Medium priority'], ['LOW', 'Low priority']])" +
  ".get(ticket.hs_ticket_priority) || 'No priority'";
const PRIORITY_VARIANT =
  "ticket.hs_ticket_priority === 'URGENT' || ticket.hs_ticket_priority === 'HIGH' ? 'danger' : " +
  "ticket.hs_ticket_priority === 'MEDIUM' ? 'warning' : ticket.hs_ticket_priority === 'LOW' ? 'info' : 'default'";

/** A table of deals over a list of association / search results (`row.properties.*`). */
function dealsTable(items: string, itemName: string, key: string, dateProp: string, dateLabel: string): NodeTemplate {
  return {
    type: 'Table',
    props: { bordered: true },
    children: [
      {
        type: 'TableHead',
        children: [
          {
            type: 'TableRow',
            children: [t.header('Deal'), t.header('Stage'), t.header(dateLabel), t.header('Amount', { align: 'right' })],
          },
        ],
      },
      {
        type: 'TableBody',
        children: [
          {
            type: 'TableRow',
            name: 'Deal row',
            repeat: { items, itemName, indexName: 'index', key },
            children: [
              t.cell(`{{ ${itemName}.properties.dealname || 'Untitled deal' }}`),
              t.cell({
                type: 'Tag',
                props: { variant: { $expr: dealStageVariant(`${itemName}.properties.dealstage`) } },
                text: `{{ ${dealStageLabel(`${itemName}.properties.dealstage`)} }}`,
              }),
              t.cell(`{{ ${shortDate(`${itemName}.properties.${dateProp}`)} }}`),
              t.cell(`{{ ${money(`${itemName}.properties.amount`)} }}`, { align: 'right' }),
            ],
          },
        ],
      },
    ],
  };
}

const sumAmounts = (list: string) => `${list}.reduce((sum, d) => sum + Number(d.properties.amount || 0), 0)`;

// ---------------------------------------------------------------------------
// App function sources
// ---------------------------------------------------------------------------

const GENERATE_QUOTE_CODE = `// Generates a price quote on HubSpot's servers, so pricing rules never ship to the browser.
// Called from the "Quote builder" card with:
//   hubspot.serverless('<uid>', { parameters: { plan, seats, term }, propertiesToSend: ['dealname', 'amount'] })

const PRICES = { starter: 20, professional: 50, enterprise: 120 };

exports.main = async (context = {}) => {
  const { plan = 'professional', seats = 1, term = 12 } = context.parameters || {};
  const deal = context.propertiesToSend || {};
  const unitPrice = PRICES[plan] || PRICES.professional;
  const months = Number(term) || 12;
  const subtotal = unitPrice * Number(seats) * months;
  const termDiscount = months >= 36 ? 0.15 : months >= 24 ? 0.1 : 0;
  const discount = Math.round(subtotal * termDiscount);
  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return {
    quoteNumber: \`Q-\${Date.now().toString(36).toUpperCase()}\`,
    dealName: deal.dealname || 'Untitled deal',
    plan,
    seats: Number(seats),
    term: months,
    unitPrice,
    subtotal,
    discount,
    total: subtotal - discount,
    validUntil,
  };
};
`;

const SAVE_SETTINGS_CODE = `// Saves the app's settings for the current HubSpot account.
// Called from the settings page with:
//   hubspot.serverless('<uid>', { parameters: { settings } })
// Store the values in your own backend (or HubSpot's app settings storage) here. Keep secrets such
// as API keys in the function's secretKeys rather than in the card.

exports.main = async (context = {}) => {
  const settings = (context.parameters && context.parameters.settings) || {};
  if (!settings.apiKey) {
    throw new Error('An API key is required.');
  }
  if (settings.notifyEmail && !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(settings.notifyEmail)) {
    throw new Error('The notification email is not a valid email address.');
  }
  return { ok: true, savedAt: new Date().toISOString(), region: settings.region || 'us' };
};
`;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export const PROJECT_TEMPLATES: ExtensionTemplate[] = [
  // 1 ---------------------------------------------------------------------
  {
    id: 'contact-summary',
    name: 'Contact summary',
    description: 'Name, lifecycle stage and key details of the current contact, with email, copy and refresh actions.',
    kind: 'card',
    location: 'crm.record.tab',
    objectTypes: ['contacts'],
    tags: ['CRM properties', 'Actions'],
    build: (existing) => {
      const contact = dataSource({
        kind: 'crmProperties',
        name: 'contact',
        properties: ['firstname', 'lastname', 'email', 'phone', 'jobtitle', 'company', 'lifecyclestage', 'hs_lead_status', 'city', 'country'],
      });
      return makeExtension({
        existing,
        name: 'Contact Summary',
        description: 'Key details of the current contact at a glance.',
        location: 'crm.record.tab',
        objectTypes: ['contacts'],
        dataSources: [contact],
        content: [
          t.column(
            [
              t.row(
                [
                  t.column(
                    [
                      t.heading("{{ [contact.firstname, contact.lastname].filter(Boolean).join(' ') || 'Unnamed contact' }}", { name: 'Full name' }),
                      t.micro("{{ [contact.jobtitle, contact.company].filter(Boolean).join(' at ') || 'No job title yet' }}"),
                    ],
                    'flush',
                  ),
                  { type: 'StatusTag', name: 'Lifecycle stage', props: { variant: { $expr: LIFECYCLE_VARIANT } }, text: `{{ ${LIFECYCLE_LABEL} }}` },
                ],
                { justify: 'between', align: 'start' },
              ),
              {
                type: 'DescriptionList',
                props: { direction: 'row' },
                children: [
                  t.item('Email', { type: 'Link', props: { href: 'mailto:{{ contact.email }}' }, text: "{{ contact.email || '—' }}" }),
                  t.item('Phone', "{{ contact.phone || '—' }}"),
                  t.item('Lead status', `{{ ${LEAD_STATUS_LABEL} }}`),
                  t.item('Location', "{{ [contact.city, contact.country].filter(Boolean).join(', ') || '—' }}"),
                ],
              },
              {
                type: 'Alert',
                name: 'Missing email',
                props: { title: 'No email address', variant: 'warning' },
                condition: '!contactLoading && !contact.email',
                text: 'Add an email address to this contact to email them from HubSpot.',
              },
              {
                type: 'ButtonRow',
                children: [
                  {
                    type: 'Button',
                    props: { variant: 'primary', href: 'mailto:{{ contact.email }}', disabled: { $expr: '!contact.email' } },
                    text: "Email {{ contact.firstname || 'contact' }}",
                  },
                  {
                    type: 'Button',
                    props: { variant: 'secondary' },
                    text: 'Copy email',
                    events: {
                      onClick: steps(
                        { type: 'copyToClipboard', text: '{{ contact.email }}' },
                        { type: 'addAlert', alertType: 'success', title: 'Email copied', message: '{{ contact.email }} is on your clipboard.' },
                      ),
                    },
                  },
                  {
                    type: 'Button',
                    props: { variant: 'secondary' },
                    text: 'Refresh',
                    events: { onClick: steps({ type: 'refreshObjectProperties' }, { type: 'runDataSource', dataSourceId: contact.id }) },
                  },
                ],
              },
            ],
            'medium',
          ),
        ],
      });
    },
  },

  // 2 ---------------------------------------------------------------------
  {
    id: 'deal-calculator',
    name: 'Deal discount calculator',
    description: 'Seats, price and discount inputs with live totals, an approval warning above 20% and an apply action.',
    kind: 'card',
    location: 'crm.record.tab',
    objectTypes: ['deals'],
    tags: ['Inputs', 'Statistics', 'Conditions'],
    build: (existing) => {
      const deal = dataSource({ kind: 'crmProperties', name: 'deal', properties: ['dealname', 'amount'] });
      return makeExtension({
        existing,
        name: 'Discount Calculator',
        description: 'Model seat pricing and discounts before sending a quote.',
        location: 'crm.record.tab',
        objectTypes: ['deals'],
        dataSources: [deal],
        state: [
          stateVar('seats', 'number', 250, 'Number of seats'),
          stateVar('price', 'number', 480, 'List price per seat (USD)'),
          stateVar('discount', 'number', 10, 'Discount in percent'),
        ],
        computed: [
          computedValue('listTotal', 'seats * price', 'List price before discount'),
          computedValue('discountAmount', 'listTotal * discount / 100', 'Discount in dollars'),
          computedValue('netTotal', 'listTotal - discountAmount', 'Price after discount'),
          computedValue('dealAmount', 'Number(deal.amount) || 0', 'Current amount of the deal record'),
        ],
        mock: (m) => mockRecord(m, '0-3', 3301, { dealname: 'Difference Engine Expansion', amount: '125000' }),
        content: [
          t.column(
            [
              t.column([t.heading('Discount calculator'), t.micro("Model seat pricing for {{ deal.dealname || 'this deal' }} before you send a quote.")], 'flush'),
              t.row(
                [
                  { type: 'StepperInput', props: { label: 'Seats', name: 'seats', min: 1, max: 5000, stepSize: 10 }, binding: { state: 'seats' } },
                  { type: 'CurrencyInput', props: { label: 'Price per seat', name: 'price', currency: 'USD', min: 0 }, binding: { state: 'price' } },
                  {
                    type: 'NumberInput',
                    props: { label: 'Discount (%)', name: 'discount', min: 0, max: 100, description: 'Above 20% needs approval' },
                    binding: { state: 'discount' },
                  },
                ],
                { gap: 'medium', wrap: 'wrap' },
              ),
              {
                type: 'Statistics',
                children: [
                  t.stat('List price', `{{ ${money('listTotal')} }}`),
                  t.stat('Discount', `{{ ${money('discountAmount')} }}`, { value: '{{ discount }}%', direction: 'decrease', color: 'red' }),
                  t.stat('Net total', `{{ ${money('netTotal')} }}`, {
                    value: "{{ dealAmount > 0 ? Math.abs(Math.round((netTotal / dealAmount - 1) * 100)) + '% vs. deal amount' : 'No deal amount yet' }}",
                    direction: { $expr: "netTotal >= dealAmount ? 'increase' : 'decrease'" },
                  }),
                ],
              },
              {
                type: 'Alert',
                name: 'Approval warning',
                props: { title: 'Manager approval needed', variant: 'warning' },
                condition: 'discount > 20',
                text: 'Discounts above 20% need approval from your sales manager before the quote is sent.',
              },
              {
                type: 'ButtonRow',
                children: [
                  {
                    type: 'Button',
                    props: { variant: 'primary' },
                    text: 'Apply discount',
                    events: {
                      onClick: steps({
                        type: 'if',
                        condition: 'discount > 20',
                        then: steps({
                          type: 'addAlert',
                          alertType: 'warning',
                          title: 'Approval required',
                          message: 'A {{ discount }}% discount needs manager approval. Request it before sending the quote.',
                        }),
                        else: steps({
                          type: 'addAlert',
                          alertType: 'success',
                          title: 'Discount applied',
                          message: `{{ discount }}% off — the new total is {{ ${money('netTotal')} }}.`,
                        }),
                      }),
                    },
                  },
                  {
                    type: 'Button',
                    props: { variant: 'secondary' },
                    text: 'Reset',
                    events: {
                      onClick: steps(
                        { type: 'setState', state: 'seats', value: '250' },
                        { type: 'setState', state: 'price', value: '480' },
                        { type: 'setState', state: 'discount', value: '10' },
                      ),
                    },
                  },
                ],
              },
            ],
            'medium',
          ),
        ],
      });
    },
  },

  // 3 ---------------------------------------------------------------------
  {
    id: 'feedback-form',
    name: 'Customer feedback form',
    description: 'A validated form with bound inputs that posts feedback to an external API and confirms with alerts.',
    kind: 'card',
    location: 'crm.record.tab',
    objectTypes: ['contacts'],
    tags: ['Form', 'Validation', 'Fetch'],
    build: (existing) => {
      const contact = dataSource({ kind: 'crmProperties', name: 'contact', properties: ['firstname', 'email'] });
      return makeExtension({
        existing,
        name: 'Customer Feedback',
        description: 'Log customer feedback and send it to your feedback inbox.',
        location: 'crm.record.tab',
        objectTypes: ['contacts'],
        dataSources: [contact],
        state: [
          stateVar('subject', 'string', ''),
          stateVar('topic', 'string', ''),
          stateVar('highlights', 'array', []),
          stateVar('message', 'string', ''),
          stateVar('submitting', 'boolean', false, 'True while the feedback is being sent'),
        ],
        content: [
          t.column(
            [
              t.column(
                [t.heading('Customer feedback'), t.micro("Log feedback from {{ contact.firstname || 'this contact' }} — it's sent straight to your feedback inbox.")],
                'flush',
              ),
              {
                type: 'Form',
                props: { autoComplete: 'off' },
                events: {
                  onSubmit: steps({
                    type: 'if',
                    condition: '!subject.trim() || !topic || !message.trim()',
                    then: steps({
                      type: 'addAlert',
                      alertType: 'danger',
                      title: 'Some fields are missing',
                      message: 'Add a subject, choose a topic and describe the feedback before sending.',
                    }),
                    else: steps(
                      { type: 'setState', state: 'submitting', value: 'true' },
                      {
                        type: 'fetch',
                        url: 'https://api.example.com/feedback',
                        method: 'POST',
                        body: '{ contactId: context.crm.objectId, contactEmail: contact.email, subject, topic, highlights, message, submittedBy: context.user.email }',
                        onSuccess: steps(
                          { type: 'setState', state: 'submitting', value: 'false' },
                          { type: 'addAlert', alertType: 'success', title: 'Feedback sent', message: 'Thanks! “{{ subject }}” is in the feedback inbox.' },
                          { type: 'setState', state: 'subject', value: "''" },
                          { type: 'setState', state: 'topic', value: "''" },
                          { type: 'setState', state: 'highlights', value: '[]' },
                          { type: 'setState', state: 'message', value: "''" },
                        ),
                        onError: steps(
                          { type: 'setState', state: 'submitting', value: 'false' },
                          { type: 'addAlert', alertType: 'danger', title: 'Couldn’t send feedback', message: '{{ error.message }}' },
                        ),
                      },
                    ),
                  }),
                },
                children: [
                  t.column(
                    [
                      {
                        type: 'Input',
                        props: { label: 'Subject', name: 'subject', required: true, placeholder: 'e.g. Loves the new reporting' },
                        binding: { state: 'subject' },
                      },
                      {
                        type: 'Select',
                        props: {
                          label: 'Topic',
                          name: 'topic',
                          required: true,
                          placeholder: 'Choose a topic',
                          options: [
                            { label: 'Product', value: 'product' },
                            { label: 'Support', value: 'support' },
                            { label: 'Pricing & billing', value: 'billing' },
                            { label: 'Onboarding', value: 'onboarding' },
                          ],
                        },
                        binding: { state: 'topic' },
                      },
                      {
                        type: 'ToggleGroup',
                        props: {
                          toggleType: 'checkboxList',
                          label: 'What did they like?',
                          name: 'highlights',
                          inline: true,
                          options: [
                            { label: 'Ease of use', value: 'ease' },
                            { label: 'Speed', value: 'speed' },
                            { label: 'Support team', value: 'support' },
                            { label: 'Value for money', value: 'value' },
                          ],
                        },
                        binding: { state: 'highlights' },
                      },
                      {
                        type: 'TextArea',
                        props: { label: 'Feedback', name: 'message', required: true, rows: 4, maxLength: 1000, placeholder: 'What did the customer say?' },
                        binding: { state: 'message' },
                      },
                      { type: 'LoadingButton', props: { type: 'submit', variant: 'primary', loading: { $expr: 'submitting' } }, text: 'Send feedback' },
                    ],
                    'small',
                  ),
                ],
              },
            ],
            'medium',
          ),
        ],
      });
    },
  },

  // 4 ---------------------------------------------------------------------
  {
    id: 'associated-deals',
    name: 'Associated deals table',
    description: 'Deals associated with the company in a table, with loading, empty and error states and totals.',
    kind: 'card',
    location: 'crm.record.tab',
    objectTypes: ['companies'],
    tags: ['Associations', 'Table', 'Repeat'],
    build: (existing) => {
      const deals = dataSource({
        kind: 'associations',
        name: 'deals',
        toObjectType: '0-3',
        properties: ['dealname', 'amount', 'dealstage', 'closedate'],
        pageLength: 25,
      });
      return makeExtension({
        existing,
        name: 'Associated Deals',
        description: 'Deals associated with this company.',
        location: 'crm.record.tab',
        objectTypes: ['companies'],
        dataSources: [deals],
        computed: [
          computedValue('totalValue', sumAmounts('deals'), 'Sum of all deal amounts'),
          computedValue('wonDeals', "deals.filter((d) => d.properties.dealstage === 'closedwon').length", 'Number of closed won deals'),
        ],
        mock: (m) => mockRecord(m, '0-2', 2201, { name: 'Analytical Engines Ltd', domain: 'analytical.example' }),
        content: [
          t.column(
            [
              t.row(
                [
                  t.heading('Associated deals'),
                  { type: 'Tag', props: { variant: 'info' }, condition: '!dealsLoading', text: "{{ deals.length }} {{ deals.length === 1 ? 'deal' : 'deals' }}" },
                ],
                { justify: 'between', align: 'center' },
              ),
              { type: 'LoadingSpinner', props: { label: 'Loading deals…', showLabel: true, layout: 'centered' }, condition: 'dealsLoading' },
              { type: 'Alert', props: { title: 'Couldn’t load deals', variant: 'danger' }, condition: 'dealsError', text: '{{ dealsError }}' },
              {
                type: 'EmptyState',
                props: { title: 'No deals yet', imageName: 'deals', layout: 'vertical' },
                condition: '!dealsLoading && !dealsError && deals.length === 0',
                children: [t.text('Associate a deal with this company and it shows up here.')],
              },
              t.column(
                [
                  dealsTable('deals', 'deal', 'deal.toObjectId', 'closedate', 'Close date'),
                  {
                    type: 'Statistics',
                    children: [
                      t.stat('Total value', `{{ ${money('totalValue')} }}`),
                      t.stat('Closed won', '{{ wonDeals }}'),
                      t.stat('Average deal size', `{{ ${money('deals.length ? totalValue / deals.length : 0')} }}`),
                    ],
                  },
                ],
                'medium',
                { name: 'Deals', condition: '!dealsLoading && deals.length > 0' },
              ),
            ],
            'medium',
          ),
        ],
      });
    },
  },

  // 5 ---------------------------------------------------------------------
  {
    id: 'account-health',
    name: 'Account health dashboard',
    description: 'Health score, adoption, support load, key metrics with trends and a usage chart from your API.',
    kind: 'card',
    location: 'crm.record.tab',
    objectTypes: ['companies'],
    tags: ['Dashboard', 'Chart', 'Fetch'],
    build: (existing) => {
      const company = dataSource({ kind: 'crmProperties', name: 'company', properties: ['name', 'domain'] });
      const health = dataSource({
        kind: 'fetch',
        name: 'health',
        url: 'https://api.example.com/accounts/{{ context.crm.objectId }}/health',
        method: 'GET',
        runOnMount: true,
      });
      const score = '(health?.score ?? 0)';
      return makeExtension({
        existing,
        name: 'Account Health',
        description: 'Customer health signals from your product analytics API.',
        location: 'crm.record.tab',
        objectTypes: ['companies'],
        dataSources: [company, health],
        mock: (m) => {
          mockRecord(m, '0-2', 2201, { name: 'Analytical Engines Ltd', domain: 'analytical.example' });
          m.dataSources[health.id] = {
            score: 78,
            adoption: 72,
            activeFeatures: 9,
            totalFeatures: 12,
            openTickets: 2,
            firstResponseHours: 3.5,
            activeUsers: 1284,
            activeUsersTrend: 12.4,
            nps: 46,
            npsTrend: -3,
            arr: 84000,
            arrTrend: 8.1,
            usage: [
              { month: 'May', activeUsers: 940 },
              { month: 'Jun', activeUsers: 1012 },
              { month: 'Jul', activeUsers: 1068 },
              { month: 'Aug', activeUsers: 1121 },
              { month: 'Sep', activeUsers: 1142 },
              { month: 'Oct', activeUsers: 1284 },
            ],
          };
        },
        content: [
          t.column(
            [
              t.row(
                [
                  t.column([t.heading('Account health'), t.micro("{{ company.name || 'This company' }} · last 6 months")], 'flush'),
                  {
                    type: 'StatusTag',
                    props: { variant: { $expr: `${score} >= 70 ? 'success' : ${score} >= 40 ? 'warning' : 'danger'` } },
                    condition: 'health',
                    text: `{{ ${score} >= 70 ? 'Healthy' : ${score} >= 40 ? 'Needs attention' : 'At risk' }}`,
                  },
                ],
                { justify: 'between', align: 'start' },
              ),
              { type: 'LoadingSpinner', props: { label: 'Loading account health…', showLabel: true, layout: 'centered' }, condition: 'healthLoading' },
              { type: 'Alert', props: { title: 'Couldn’t load health data', variant: 'danger' }, condition: 'healthError', text: '{{ healthError }}' },
              t.column(
                [
                  {
                    type: 'AutoGrid',
                    props: { columnWidth: 180, gap: 'small', flexible: true },
                    children: [
                      {
                        type: 'Tile',
                        props: { compact: true },
                        children: [t.column([t.bold('Health score'), { type: 'ScoreCircle', props: { score: '{{ health?.score ?? 0 }}' } }, t.micro('Usage, support and billing signals')], 'extra-small')],
                      },
                      {
                        type: 'Tile',
                        props: { compact: true },
                        children: [
                          t.column(
                            [
                              t.bold('Product adoption'),
                              {
                                type: 'ProgressBar',
                                props: {
                                  value: '{{ health?.adoption ?? 0 }}',
                                  maxValue: 100,
                                  showPercentage: true,
                                  variant: { $expr: "(health?.adoption ?? 0) >= 60 ? 'success' : 'warning'" },
                                  'aria-label': 'Product adoption',
                                },
                              },
                              t.micro('{{ health?.activeFeatures ?? 0 }} of {{ health?.totalFeatures ?? 0 }} key features in use'),
                            ],
                            'extra-small',
                          ),
                        ],
                      },
                      {
                        type: 'Tile',
                        props: { compact: true },
                        children: [
                          t.column(
                            [
                              t.bold('Support'),
                              t.text("{{ health?.openTickets ?? 0 }} open {{ (health?.openTickets ?? 0) === 1 ? 'ticket' : 'tickets' }}"),
                              t.micro('Average first response: {{ health?.firstResponseHours ?? 0 }} h'),
                            ],
                            'extra-small',
                          ),
                        ],
                      },
                    ],
                  },
                  {
                    type: 'Statistics',
                    children: [
                      t.stat('Monthly active users', "{{ Number(health?.activeUsers ?? 0).toLocaleString('en-US') }}", {
                        value: '{{ Math.abs(health?.activeUsersTrend ?? 0) }}%',
                        direction: { $expr: "(health?.activeUsersTrend ?? 0) >= 0 ? 'increase' : 'decrease'" },
                      }),
                      t.stat('Net promoter score', '{{ health?.nps ?? 0 }}', {
                        value: '{{ Math.abs(health?.npsTrend ?? 0) }} pts',
                        direction: { $expr: "(health?.npsTrend ?? 0) >= 0 ? 'increase' : 'decrease'" },
                      }),
                      t.stat('Annual recurring revenue', `{{ ${money('health?.arr')} }}`, {
                        value: '{{ Math.abs(health?.arrTrend ?? 0) }}%',
                        direction: { $expr: "(health?.arrTrend ?? 0) >= 0 ? 'increase' : 'decrease'" },
                      }),
                    ],
                  },
                  {
                    type: 'BarChart',
                    props: {
                      data: { $expr: 'health?.usage ?? []' },
                      axes: {
                        x: { field: 'month', fieldType: 'category', label: 'Month' },
                        y: { field: 'activeUsers', fieldType: 'linear', label: 'Active users' },
                      },
                      options: { title: 'Monthly active users', showTooltips: true },
                    },
                  },
                ],
                'medium',
                { name: 'Dashboard', condition: 'health' },
              ),
            ],
            'medium',
          ),
        ],
      });
    },
  },

  // 6 ---------------------------------------------------------------------
  {
    id: 'onboarding-checklist',
    name: 'Onboarding checklist',
    description: 'Checklist bound to state with a live progress bar, step indicator and a completion alert.',
    kind: 'card',
    location: 'crm.record.tab',
    objectTypes: ['contacts'],
    tags: ['Checklist', 'State', 'Progress'],
    build: (existing) => {
      const contact = dataSource({ kind: 'crmProperties', name: 'contact', properties: ['firstname'] });
      const done = 'completedSteps';
      const check = (state: string, label: string, description: string): NodeTemplate => ({
        type: 'Checkbox',
        props: { name: state, description },
        text: label,
        binding: { state },
      });
      return makeExtension({
        existing,
        name: 'Onboarding Checklist',
        description: 'Track onboarding steps for this customer.',
        location: 'crm.record.tab',
        objectTypes: ['contacts'],
        dataSources: [contact],
        state: [
          stateVar('kickoff', 'boolean', true, 'Kickoff call completed'),
          stateVar('accountSetup', 'boolean', true, 'Account and users set up'),
          stateVar('dataImport', 'boolean', false, 'Historical data imported'),
          stateVar('training', 'boolean', false, 'Team training delivered'),
          stateVar('goLive', 'boolean', false, 'Live in production'),
        ],
        computed: [computedValue('completedSteps', '[kickoff, accountSetup, dataImport, training, goLive].filter(Boolean).length', 'Number of checked steps')],
        content: [
          t.column(
            [
              t.row(
                [
                  t.heading('Onboarding checklist'),
                  { type: 'Tag', props: { variant: { $expr: `${done} === 5 ? 'success' : 'default'` } }, text: `{{ ${done} }} of 5 done` },
                ],
                { justify: 'between', align: 'center' },
              ),
              {
                type: 'ProgressBar',
                props: {
                  title: 'Onboarding progress',
                  value: `{{ ${done} }}`,
                  maxValue: 5,
                  showPercentage: true,
                  valueDescription: `{{ ${done} }} of 5 steps complete`,
                  variant: { $expr: `${done} === 5 ? 'success' : 'warning'` },
                },
              },
              {
                type: 'StepIndicator',
                props: { stepNames: ['Kickoff', 'Setup', 'Data import', 'Training', 'Go live'], currentStep: `{{ Math.min(${done}, 4) }}`, circleSize: 'small' },
              },
              {
                type: 'Tile',
                children: [
                  t.column(
                    [
                      check('kickoff', 'Kickoff call completed', 'Introduce the team and agree on goals'),
                      check('accountSetup', 'Account and users set up', 'Invite users and configure permissions'),
                      check('dataImport', 'Historical data imported', 'Contacts, companies and open deals'),
                      check('training', 'Team training delivered', 'Admin and end-user sessions'),
                      check('goLive', 'Live in production', 'The customer uses the product day to day'),
                    ],
                    'small',
                  ),
                ],
              },
              {
                type: 'Alert',
                name: 'Completion alert',
                props: { title: 'Onboarding complete', variant: 'success' },
                condition: `${done} === 5`,
                text: "{{ contact.firstname || 'This customer' }} is fully onboarded. Hand the account over to Customer Success.",
              },
              {
                type: 'Button',
                props: { variant: 'secondary', size: 'small' },
                text: 'Reset checklist',
                events: {
                  onClick: steps(
                    ...['kickoff', 'accountSetup', 'dataImport', 'training', 'goLive'].map((s) => ({ type: 'setState' as const, state: s, value: 'false' })),
                  ),
                },
              },
            ],
            'medium',
          ),
        ],
      });
    },
  },

  // 7 ---------------------------------------------------------------------
  {
    id: 'ticket-triage',
    name: 'Ticket triage',
    description: 'Help desk sidebar card with ticket priority and an Escalate button that confirms in a modal.',
    kind: 'card',
    location: 'helpdesk.sidebar',
    objectTypes: ['tickets'],
    tags: ['Help desk', 'Modal', 'Confirm'],
    build: (existing) => {
      const ticket = dataSource({
        kind: 'crmProperties',
        name: 'ticket',
        properties: ['subject', 'content', 'hs_ticket_priority', 'hs_pipeline_stage', 'createdate'],
      });
      return makeExtension({
        existing,
        name: 'Ticket Triage',
        description: 'Triage and escalate tickets from the help desk.',
        location: 'helpdesk.sidebar',
        objectTypes: ['tickets'],
        dataSources: [ticket],
        state: [stateVar('escalated', 'boolean', false, 'True once the ticket was escalated')],
        mock: (m) =>
          mockRecord(m, '0-5', 4401, {
            subject: 'Cannot log in to the customer portal',
            content: 'Since this morning the customer gets “invalid session” after signing in. Three users are affected.',
            hs_ticket_priority: 'HIGH',
            hs_pipeline_stage: '1',
            createdate: '2026-10-14T09:30:00.000Z',
          }),
        content: [
          t.column(
            [
              t.column(
                [t.bold("{{ ticket.subject || 'Untitled ticket' }}"), t.micro(`Opened {{ ${shortDate('ticket.createdate')} }} · Ticket #{{ context.crm.objectId }}`)],
                'flush',
              ),
              t.row(
                [
                  { type: 'StatusTag', name: 'Priority', props: { variant: { $expr: PRIORITY_VARIANT } }, text: `{{ ${PRIORITY_LABEL} }}` },
                  { type: 'StatusTag', name: 'Escalated tag', props: { variant: 'danger', hollow: true }, condition: 'escalated', text: 'Escalated' },
                ],
                { align: 'center', wrap: 'wrap' },
              ),
              t.text("{{ ticket.content || 'No description provided.' }}"),
              {
                type: 'Alert',
                name: 'Escalation hint',
                props: { title: 'Customer may be blocked', variant: 'warning' },
                condition: "(ticket.hs_ticket_priority === 'HIGH' || ticket.hs_ticket_priority === 'URGENT') && !escalated",
                text: 'This is a high-priority ticket. If the customer can’t work, escalate it to Tier 2.',
              },
              {
                type: 'Button',
                name: 'Escalate button',
                props: { variant: 'destructive', disabled: { $expr: 'escalated' } },
                text: "{{ escalated ? 'Escalated' : 'Escalate' }}",
                slots: {
                  overlay: [
                    {
                      type: 'Modal',
                      props: { id: 'escalate-ticket', title: 'Escalate this ticket?', variant: 'danger', width: 'small' },
                      children: [
                        {
                          type: 'ModalBody',
                          children: [
                            t.column(
                              [t.text('Tier 2 support is notified right away and the ticket is marked as escalated.'), t.micro('Ticket: {{ ticket.subject }}')],
                              'small',
                            ),
                          ],
                        },
                        {
                          type: 'ModalFooter',
                          children: [
                            {
                              type: 'Button',
                              props: { variant: 'destructive' },
                              text: 'Escalate ticket',
                              events: {
                                onClick: steps(
                                  { type: 'setState', state: 'escalated', value: 'true' },
                                  { type: 'addAlert', alertType: 'success', title: 'Ticket escalated', message: 'Tier 2 has been notified about “{{ ticket.subject }}”.' },
                                  { type: 'closeOverlay', overlayNodeId: '@escalate-ticket' },
                                ),
                              },
                            },
                            {
                              type: 'Button',
                              props: { variant: 'secondary' },
                              text: 'Cancel',
                              events: { onClick: steps({ type: 'closeOverlay', overlayNodeId: '@escalate-ticket' }) },
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              },
            ],
            'small',
          ),
        ],
      });
    },
  },

  // 8 ---------------------------------------------------------------------
  {
    id: 'sidebar-actions',
    name: 'Sidebar quick actions',
    description: 'One-click CRM actions (email, note, meeting, task, preview) for the record sidebar.',
    kind: 'card',
    location: 'crm.record.sidebar',
    objectTypes: ['contacts'],
    tags: ['CRM actions', 'Sidebar'],
    build: (existing) => {
      const contact = dataSource({ kind: 'crmProperties', name: 'contact', properties: ['firstname', 'lastname', 'email'] });
      const action = (actionType: string, label: string, variant: 'primary' | 'secondary'): NodeTemplate => ({
        type: 'CrmActionButton',
        props: { actionType, actionContext: { ...CURRENT_RECORD_CONTEXT }, variant, size: 'small' },
        text: label,
      });
      return makeExtension({
        existing,
        name: 'Quick Actions',
        description: 'Common tasks for this contact, one click away.',
        location: 'crm.record.sidebar',
        objectTypes: ['contacts'],
        dataSources: [contact],
        content: [
          t.column(
            [
              t.column([t.bold('Quick actions'), t.micro("Common tasks for {{ contact.firstname || 'this contact' }}")], 'flush'),
              t.column(
                [
                  action('SEND_EMAIL', 'Send email', 'primary'),
                  action('ADD_NOTE', 'Add note', 'secondary'),
                  action('SCHEDULE_MEETING', 'Schedule meeting', 'secondary'),
                  action('ADD_TASK', 'Create task', 'secondary'),
                ],
                'extra-small',
              ),
              { type: 'Divider', props: { size: 'small' } },
              t.column(
                [
                  { type: 'CrmActionLink', props: { actionType: 'PREVIEW_OBJECT', actionContext: { ...CURRENT_RECORD_CONTEXT } }, text: 'Preview this contact' },
                  { type: 'Link', props: { href: 'mailto:{{ contact.email }}' }, condition: 'contact.email', text: 'Email {{ contact.email }}' },
                  {
                    type: 'Link',
                    props: {
                      href: "https://www.linkedin.com/search/results/people/?keywords={{ encodeURIComponent([contact.firstname, contact.lastname].filter(Boolean).join(' ')) }}",
                    },
                    text: 'Find on LinkedIn',
                  },
                ],
                'extra-small',
              ),
            ],
            'small',
          ),
        ],
      });
    },
  },

  // 9 ---------------------------------------------------------------------
  {
    id: 'enrichment-lookup',
    name: 'External enrichment lookup',
    description: 'Look up the contact in an external API on demand, with loading, empty, error and result states.',
    kind: 'card',
    location: 'crm.record.tab',
    objectTypes: ['contacts'],
    tags: ['Fetch', 'On demand', 'Loading states'],
    build: (existing) => {
      const record = dataSource({ kind: 'crmProperties', name: 'record', properties: ['email', 'firstname', 'lastname'] });
      const enrichment = dataSource({
        kind: 'fetch',
        name: 'enrichment',
        url: "https://api.example.com/enrich?email={{ encodeURIComponent(record.email || '') }}",
        method: 'GET',
        runOnMount: false,
      });
      return makeExtension({
        existing,
        name: 'Contact Enrichment',
        description: 'Role and company details from your enrichment service.',
        location: 'crm.record.tab',
        objectTypes: ['contacts'],
        dataSources: [record, enrichment],
        mock: (m) => {
          m.dataSources[enrichment.id] = {
            person: { fullName: 'Ada Lovelace', title: 'Head of Computation', seniority: 'Executive' },
            company: {
              name: 'Analytical Engines Ltd',
              domain: 'analytical.example',
              industry: 'Computer software',
              employees: 120,
              location: 'London, United Kingdom',
            },
            confidence: 0.94,
          };
        },
        content: [
          t.column(
            [
              t.row(
                [
                  t.column([t.heading('Contact enrichment'), t.micro("Look up {{ record.email || 'this contact' }} in your enrichment service")], 'flush'),
                  {
                    type: 'LoadingButton',
                    props: { variant: 'primary', size: 'small', loading: { $expr: 'enrichmentLoading' }, disabled: { $expr: '!record.email' } },
                    text: "{{ enrichment ? 'Refresh' : 'Look up' }}",
                    events: { onClick: steps({ type: 'runDataSource', dataSourceId: enrichment.id }) },
                  },
                ],
                { justify: 'between', align: 'center' },
              ),
              { type: 'LoadingSpinner', props: { label: 'Looking up {{ record.email }}…', showLabel: true }, condition: 'enrichmentLoading' },
              {
                type: 'Alert',
                props: { title: 'Lookup failed', variant: 'danger' },
                condition: 'enrichmentError && !enrichmentLoading',
                text: '{{ enrichmentError }}',
              },
              {
                type: 'EmptyState',
                props: { title: 'No enrichment data yet', imageName: 'voteAndSearch', layout: 'horizontal', imageWidth: 120 },
                condition: '!enrichment && !enrichmentLoading && !enrichmentError',
                children: [t.text('Click “Look up” to fetch role and company details for this contact.')],
              },
              t.column(
                [
                  {
                    type: 'DescriptionList',
                    props: { direction: 'row' },
                    children: [
                      t.item('Full name', "{{ enrichment?.person?.fullName || '—' }}"),
                      t.item('Title', "{{ enrichment?.person?.title || '—' }}"),
                      t.item('Seniority', "{{ enrichment?.person?.seniority || '—' }}"),
                      t.item('Company', "{{ enrichment?.company?.name || '—' }}"),
                      t.item('Industry', "{{ enrichment?.company?.industry || '—' }}"),
                      t.item('Employees', "{{ enrichment?.company?.employees ? Number(enrichment.company.employees).toLocaleString('en-US') : '—' }}"),
                      t.item('Location', "{{ enrichment?.company?.location || '—' }}"),
                    ],
                  },
                  t.micro('Match confidence: {{ Math.round((enrichment?.confidence ?? 0) * 100) }}%'),
                ],
                'small',
                { name: 'Results', condition: 'enrichment && !enrichmentLoading' },
              ),
            ],
            'medium',
          ),
        ],
      });
    },
  },

  // 10 --------------------------------------------------------------------
  {
    id: 'server-quote',
    name: 'Server-side quote',
    description: 'Quote builder whose pricing runs in an app function — the function is added to your project.',
    kind: 'card',
    location: 'crm.record.tab',
    objectTypes: ['deals'],
    tags: ['App function', 'Inputs', 'Statistics'],
    functions: () => [appFunction('generateQuote', 'generate_quote', GENERATE_QUOTE_CODE)],
    build: (existing, functionIds = []) => {
      const fnId = functionIds[0] ?? 'f_generate_quote';
      const quoteMoney = (field: string) => `{{ quote ? ${money(`quote.${field}`)} : '—' }}`;
      return makeExtension({
        existing,
        name: 'Quote Builder',
        description: 'Generate a price quote with server-side pricing rules.',
        location: 'crm.record.tab',
        objectTypes: ['deals'],
        state: [
          stateVar('plan', 'string', 'professional'),
          stateVar('seats', 'number', 10),
          stateVar('term', 'string', '12', 'Contract term in months'),
          stateVar('quote', 'any', null, 'The quote returned by the app function'),
          stateVar('quoting', 'boolean', false, 'True while the quote is being generated'),
        ],
        mock: (m) => {
          mockRecord(m, '0-3', 3301, { dealname: 'Difference Engine Expansion', amount: '125000' });
          m.functions[fnId] = {
            quoteNumber: 'Q-MG7K2P',
            dealName: 'Difference Engine Expansion',
            plan: 'professional',
            seats: 10,
            term: 12,
            unitPrice: 50,
            subtotal: 6000,
            discount: 0,
            total: 6000,
            validUntil: '2026-11-14',
          };
        },
        content: [
          t.column(
            [
              t.column([t.heading('Quote builder'), t.micro('Pricing runs in the generate_quote app function, so your pricing rules stay on the server.')], 'flush'),
              t.row(
                [
                  {
                    type: 'Select',
                    props: {
                      label: 'Plan',
                      name: 'plan',
                      options: [
                        { label: 'Starter · $20 per seat / month', value: 'starter' },
                        { label: 'Professional · $50 per seat / month', value: 'professional' },
                        { label: 'Enterprise · $120 per seat / month', value: 'enterprise' },
                      ],
                    },
                    binding: { state: 'plan' },
                  },
                  { type: 'StepperInput', props: { label: 'Seats', name: 'seats', min: 1, max: 500 }, binding: { state: 'seats' } },
                  {
                    type: 'Select',
                    props: {
                      label: 'Term',
                      name: 'term',
                      options: [
                        { label: '12 months', value: '12' },
                        { label: '24 months (10% off)', value: '24' },
                        { label: '36 months (15% off)', value: '36' },
                      ],
                    },
                    binding: { state: 'term' },
                  },
                ],
                { gap: 'medium', wrap: 'wrap' },
              ),
              {
                type: 'ButtonRow',
                children: [
                  {
                    type: 'LoadingButton',
                    props: { variant: 'primary', loading: { $expr: 'quoting' } },
                    text: 'Generate quote',
                    events: {
                      onClick: steps(
                        { type: 'setState', state: 'quoting', value: 'true' },
                        {
                          type: 'runFunction',
                          functionId: fnId,
                          parameters: '{ plan, seats, term: Number(term) }',
                          propertiesToSend: ['dealname', 'amount'],
                          resultState: 'quote',
                          onSuccess: steps(
                            { type: 'setState', state: 'quoting', value: 'false' },
                            { type: 'addAlert', alertType: 'success', title: 'Quote ready', message: `Quote {{ response.quoteNumber }} totals {{ ${money('response.total')} }}.` },
                          ),
                          onError: steps(
                            { type: 'setState', state: 'quoting', value: 'false' },
                            { type: 'addAlert', alertType: 'danger', title: 'Couldn’t generate the quote', message: '{{ error.message }}' },
                          ),
                        },
                      ),
                    },
                  },
                ],
              },
              {
                type: 'Tile',
                name: 'Quote',
                condition: 'quote',
                children: [
                  t.column(
                    [
                      t.row(
                        [t.bold("Quote {{ quote?.quoteNumber || '' }}"), { type: 'Tag', props: { variant: 'success' }, text: "Valid until {{ quote?.validUntil || '—' }}" }],
                        { justify: 'between', align: 'center' },
                      ),
                      {
                        type: 'DescriptionList',
                        props: { direction: 'row' },
                        children: [
                          t.item('Plan', "{{ quote?.plan ? quote.plan.charAt(0).toUpperCase() + quote.plan.slice(1) : '—' }}"),
                          t.item('Seats', "{{ quote?.seats ?? '—' }}"),
                          t.item('Term', "{{ quote?.term ?? '—' }} months"),
                          t.item('Price per seat', `${quoteMoney('unitPrice')} / month`),
                        ],
                      },
                      {
                        type: 'Statistics',
                        children: [t.stat('Subtotal', quoteMoney('subtotal')), t.stat('Term discount', quoteMoney('discount')), t.stat('Total', quoteMoney('total'))],
                      },
                    ],
                    'small',
                  ),
                ],
              },
            ],
            'medium',
          ),
        ],
      });
    },
  },

  // 11 --------------------------------------------------------------------
  {
    id: 'settings-page',
    name: 'App settings page',
    description: 'Settings form with a connection key, region and sync options, saved through an app function.',
    kind: 'settings',
    tags: ['Settings', 'Form', 'App function'],
    functions: () => [appFunction('saveSettings', 'save_settings', SAVE_SETTINGS_CODE)],
    build: (existing, functionIds = []) => {
      const fnId = functionIds[0] ?? 'f_save_settings';
      const defaults: Array<[string, string]> = [
        ['syncEnabled', 'true'],
        ['apiKey', "''"],
        ['region', "'us'"],
        ['syncFrequency', "'hourly'"],
        ['notifyEmail', "''"],
      ];
      return makeExtension({
        existing,
        kind: 'settings',
        name: 'Settings',
        description: 'Connect your account and choose how data syncs.',
        state: [
          stateVar('syncEnabled', 'boolean', true),
          stateVar('apiKey', 'string', ''),
          stateVar('region', 'string', 'us'),
          stateVar('syncFrequency', 'string', 'hourly'),
          stateVar('notifyEmail', 'string', ''),
          stateVar('saving', 'boolean', false, 'True while the settings are being saved'),
        ],
        mock: (m) => {
          m.functions[fnId] = { ok: true, savedAt: '2026-10-15T09:00:00.000Z', region: 'us' };
        },
        content: [
          t.column(
            [
              t.column([t.heading('Integration settings'), t.text('Connect your account and choose how data syncs with HubSpot.')], 'flush'),
              {
                type: 'Form',
                props: { autoComplete: 'off' },
                events: {
                  onSubmit: steps({
                    type: 'if',
                    condition: '!apiKey.trim()',
                    then: steps({ type: 'addAlert', alertType: 'danger', title: 'API key required', message: 'Paste the API key from your account to connect.' }),
                    else: steps(
                      { type: 'setState', state: 'saving', value: 'true' },
                      {
                        type: 'runFunction',
                        functionId: fnId,
                        parameters: '{ settings: { syncEnabled, apiKey, region, syncFrequency, notifyEmail } }',
                        onSuccess: steps(
                          { type: 'setState', state: 'saving', value: 'false' },
                          { type: 'addAlert', alertType: 'success', title: 'Settings saved', message: 'Your changes are live.' },
                        ),
                        onError: steps(
                          { type: 'setState', state: 'saving', value: 'false' },
                          { type: 'addAlert', alertType: 'danger', title: 'Couldn’t save settings', message: '{{ error.message }}' },
                        ),
                      },
                    ),
                  }),
                },
                children: [
                  t.column(
                    [
                      {
                        type: 'Tile',
                        children: [
                          t.column(
                            [
                              t.bold('Connection'),
                              {
                                type: 'Input',
                                props: {
                                  label: 'API key',
                                  name: 'apiKey',
                                  type: 'password',
                                  required: true,
                                  placeholder: 'sk_live_…',
                                  description: 'Find it in your account under Settings → API.',
                                },
                                binding: { state: 'apiKey' },
                              },
                              {
                                type: 'Select',
                                props: {
                                  label: 'Data region',
                                  name: 'region',
                                  options: [
                                    { label: 'United States', value: 'us' },
                                    { label: 'European Union', value: 'eu' },
                                    { label: 'Asia Pacific', value: 'apac' },
                                  ],
                                },
                                binding: { state: 'region' },
                              },
                            ],
                            'small',
                          ),
                        ],
                      },
                      {
                        type: 'Tile',
                        children: [
                          t.column(
                            [
                              t.bold('Sync'),
                              { type: 'Toggle', props: { label: 'Sync contacts automatically', name: 'syncEnabled', labelDisplay: 'inline' }, binding: { state: 'syncEnabled' } },
                              {
                                type: 'Select',
                                props: {
                                  label: 'Sync frequency',
                                  name: 'syncFrequency',
                                  readOnly: { $expr: '!syncEnabled' },
                                  options: [
                                    { label: 'Real time', value: 'realtime' },
                                    { label: 'Every hour', value: 'hourly' },
                                    { label: 'Once a day', value: 'daily' },
                                  ],
                                },
                                binding: { state: 'syncFrequency' },
                              },
                              {
                                type: 'Input',
                                props: {
                                  label: 'Notification email',
                                  name: 'notifyEmail',
                                  placeholder: 'ops@company.com',
                                  description: 'We email this address when a sync fails.',
                                },
                                binding: { state: 'notifyEmail' },
                              },
                            ],
                            'small',
                          ),
                        ],
                      },
                      {
                        type: 'ButtonRow',
                        children: [
                          { type: 'LoadingButton', props: { type: 'submit', variant: 'primary', loading: { $expr: 'saving' } }, text: 'Save settings' },
                          {
                            type: 'Button',
                            props: { variant: 'secondary' },
                            text: 'Reset to defaults',
                            events: { onClick: steps(...defaults.map(([state, value]) => ({ type: 'setState' as const, state, value }))) },
                          },
                        ],
                      },
                    ],
                    'medium',
                  ),
                ],
              },
            ],
            'medium',
          ),
        ],
      });
    },
  },

  // 12 --------------------------------------------------------------------
  {
    id: 'app-home',
    name: 'App home dashboard',
    description: 'A welcome page with pipeline statistics and a table of recently created deals from a CRM search.',
    kind: 'home',
    tags: ['App home', 'CRM search', 'Table'],
    build: (existing) => {
      const recentDeals = dataSource({
        kind: 'crmSearch',
        name: 'recentDeals',
        objectType: 'deals',
        properties: ['dealname', 'amount', 'dealstage', 'createdate'],
        filters: [],
        sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
        pageLength: 10,
      });
      return makeExtension({
        existing,
        kind: 'home',
        name: 'App Home',
        description: 'Your pipeline at a glance.',
        dataSources: [recentDeals],
        computed: [computedValue('pipelineValue', sumAmounts('recentDeals'), 'Sum of the recent deals’ amounts')],
        content: [
          t.column(
            [
              t.column([t.heading('Welcome back, {{ context.user.firstName }}'), t.text('Here’s what is happening in your pipeline.')], 'flush'),
              {
                type: 'Statistics',
                children: [
                  t.stat('New deals', '{{ recentDeals.length }}'),
                  t.stat('Pipeline value', `{{ ${money('pipelineValue')} }}`),
                  t.stat('Closed won', "{{ recentDeals.filter((d) => d.properties.dealstage === 'closedwon').length }}"),
                ],
              },
              {
                type: 'Tile',
                children: [
                  t.column(
                    [
                      t.row(
                        [
                          t.bold('Recently created deals'),
                          {
                            type: 'Button',
                            props: { variant: 'transparent', size: 'small' },
                            text: 'Refresh',
                            events: { onClick: steps({ type: 'runDataSource', dataSourceId: recentDeals.id }) },
                          },
                        ],
                        { justify: 'between', align: 'center' },
                      ),
                      { type: 'LoadingSpinner', props: { label: 'Loading deals…', showLabel: true, layout: 'centered' }, condition: 'recentDealsLoading' },
                      { type: 'Alert', props: { title: 'Couldn’t load deals', variant: 'danger' }, condition: 'recentDealsError', text: '{{ recentDealsError }}' },
                      {
                        type: 'EmptyState',
                        props: { title: 'No deals yet', imageName: 'deals', layout: 'vertical' },
                        condition: '!recentDealsLoading && !recentDealsError && recentDeals.length === 0',
                        children: [t.text('New deals appear here as soon as your team creates them.')],
                      },
                      {
                        ...dealsTable('recentDeals', 'deal', 'deal.objectId', 'createdate', 'Created'),
                        condition: '!recentDealsLoading && recentDeals.length > 0',
                      },
                    ],
                    'small',
                  ),
                ],
              },
            ],
            'large',
          ),
        ],
      });
    },
  },

  // 13 --------------------------------------------------------------------
  {
    id: 'crm-showcase',
    name: 'CRM data components',
    description: 'HubSpot’s ready-made CRM components: data highlight, stage tracker, property list and association table.',
    kind: 'card',
    location: 'crm.record.tab',
    objectTypes: ['deals'],
    tags: ['CRM components', 'Tabs', 'No code'],
    build: (existing) =>
      makeExtension({
        existing,
        name: 'Deal Overview',
        description: 'Deal properties, stage and associated records using HubSpot’s CRM components.',
        location: 'crm.record.tab',
        objectTypes: ['deals'],
        mock: (m) => mockRecord(m, '0-3', 3301),
        content: [
          t.column(
            [
              t.heading('Deal at a glance'),
              { type: 'CrmDataHighlight', props: { properties: ['amount', 'closedate', 'dealstage', 'hubspot_owner_id'] } },
              { type: 'CrmStageTracker', props: { properties: ['dealname', 'amount', 'closedate'], showProperties: true } },
              {
                type: 'Tabs',
                props: { defaultSelected: 'properties', variant: 'enclosed' },
                children: [
                  {
                    type: 'Tab',
                    props: { tabId: 'properties', title: 'Properties' },
                    children: [{ type: 'CrmPropertyList', props: { properties: ['dealname', 'amount', 'closedate', 'pipeline', 'dealstage', 'hubspot_owner_id'] } }],
                  },
                  {
                    type: 'Tab',
                    props: { tabId: 'contacts', title: 'Contacts' },
                    children: [
                      {
                        type: 'CrmAssociationTable',
                        props: { objectTypeId: '0-1', propertyColumns: ['firstname', 'lastname', 'email', 'jobtitle'], searchable: true, pagination: true, pageSize: 5 },
                      },
                    ],
                  },
                  {
                    type: 'Tab',
                    props: { tabId: 'companies', title: 'Companies' },
                    children: [
                      {
                        type: 'CrmAssociationPropertyList',
                        props: { objectTypeId: '0-2', properties: ['name', 'domain', 'industry', 'numberofemployees'] },
                      },
                    ],
                  },
                ],
              },
            ],
            'medium',
          ),
        ],
      }),
  },

  // 14 --------------------------------------------------------------------
  {
    id: 'blank-card',
    name: 'Blank card',
    description: 'An empty record tab card for contacts. Start from scratch with components and blocks.',
    kind: 'card',
    location: 'crm.record.tab',
    objectTypes: ['contacts'],
    tags: ['Empty'],
    build: (existing) =>
      makeExtension({ existing, name: 'New Card', location: 'crm.record.tab', objectTypes: ['contacts'], content: [] }),
  },
];
