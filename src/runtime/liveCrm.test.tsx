/**
 * CRM component previews with live data (src/preview/liveCrm.tsx): property lists, data highlights,
 * stage trackers and association tables show the sample record's real values and the portal's
 * labels; components that can't be shown from real data say "Sample values"; with mock data
 * nothing changes.
 */
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CrmPipeline, CrmPropertyDef } from '../connect/types';
import type { NodeTemplate } from '../model/types';
import { clearLiveCrmCache } from '../preview/liveCrm';
import { byName, makeDoc, renderDoc } from './testing';
import type { LiveDataAdapter } from './types';

const DEAL = { objectId: 3004, objectTypeId: '0-3' };

const DEFS: CrmPropertyDef[] = [
  { name: 'amount', label: 'Deal amount', type: 'number', fieldType: 'number' },
  { name: 'dealstage', label: 'Deal stage', type: 'enumeration', fieldType: 'radio' },
  { name: 'closedate', label: 'Close date', type: 'datetime', fieldType: 'date' },
];

const PIPELINES: CrmPipeline[] = [
  {
    id: 'default',
    label: 'Sales Pipeline',
    displayOrder: 0,
    stages: [
      { id: 'appointmentscheduled', label: 'Appointment Scheduled', displayOrder: 0 },
      { id: 'closedwon', label: 'Closed Won', displayOrder: 1 },
    ],
  },
  {
    id: '75012345',
    label: 'Renewals',
    displayOrder: 1,
    stages: [
      { id: '1001', label: 'Renewal upcoming', displayOrder: 0 },
      { id: '1002', label: 'In negotiation', displayOrder: 1 },
      { id: '1003', label: 'Renewed', displayOrder: 2 },
    ],
  },
];

function live(over: Partial<LiveDataAdapter> = {}): LiveDataAdapter {
  return {
    key: '999|0-3:3004|live',
    context: { portal: { id: 999 }, crm: DEAL },
    getRecordProperties: async (_type, _id, properties, formatted) => {
      const raw: Record<string, string | null> = { amount: '36000', dealstage: '1002', pipeline: '75012345', closedate: '2026-01-31T17:00:00.000Z' };
      const pretty: Record<string, string | null> = { amount: '36,000', dealstage: 'In negotiation', pipeline: 'Renewals', closedate: 'Jan 31, 2026' };
      return Object.fromEntries(properties.map((p) => [p, (formatted ? pretty : raw)[p] ?? null]));
    },
    getAssociations: async (_type, _id, request) =>
      [
        { toObjectId: 1007, properties: { firstname: 'Priya', lastname: 'Patel', email: 'priya@globex.io' } },
        { toObjectId: 1001, properties: { firstname: 'Ada', lastname: 'Lovelace', email: 'ada@analyticalengines.com' } },
      ].map((r) => ({ toObjectId: r.toObjectId, associationTypes: [], properties: Object.fromEntries(request.properties.map((p) => [p, (r.properties as Record<string, string>)[p] ?? null])) })),
    search: async () => ({ results: [], total: 0, hasMore: false }),
    getPropertyDefinitions: async (type) =>
      type === '0-1' ? [{ name: 'email', label: 'Email address', type: 'string', fieldType: 'text' }] : DEFS,
    getPipelines: async () => PIPELINES,
    ...over,
  };
}

function doc(content: NodeTemplate[]) {
  return makeDoc(content);
}

beforeEach(() => clearLiveCrmCache());
afterEach(() => cleanup());

describe('CRM components with live data', () => {
  it('a property list and a data highlight show the record’s real, formatted values with the portal’s labels', async () => {
    const { project, ext } = doc([
      { type: 'CrmPropertyList', name: 'list', props: { properties: ['amount', 'dealstage'] } },
      { type: 'CrmDataHighlight', name: 'hl', props: { properties: ['amount', 'closedate'] } },
    ]);
    const r = renderDoc(project, ext, { mode: 'preview', live: live() });
    const list = () => r.nodes(byName(ext, 'list').id)[0];
    await waitFor(() => expect(list()).toHaveTextContent('In negotiation'));
    expect(list()).toHaveTextContent('Deal amount');
    expect(list()).toHaveTextContent('36,000');
    expect(list()).not.toHaveTextContent('Contract sent');
    const hl = r.nodes(byName(ext, 'hl').id)[0];
    await waitFor(() => expect(hl).toHaveTextContent('Jan 31, 2026'));
    expect(hl).not.toHaveTextContent('$125,000');
    expect(screen.queryByText(/Sample values/)).toBeNull();
  });

  it('a stage tracker shows the stages of the record’s own (custom) pipeline', async () => {
    const { project, ext } = doc([{ type: 'CrmStageTracker', name: 'tracker', props: { properties: ['amount'] } }]);
    const r = renderDoc(project, ext, { mode: 'preview', live: live() });
    const tracker = () => r.nodes(byName(ext, 'tracker').id)[0];
    await waitFor(() => expect(tracker()).toHaveTextContent('Stage 2 of 3'));
    expect(tracker()).toHaveTextContent('In negotiation');
    expect(tracker()).toHaveTextContent('Renewed');
    expect(tracker()).not.toHaveTextContent('Contract sent');
  });

  it('an association table lists the record’s real associated records', async () => {
    const { project, ext } = doc([{ type: 'CrmAssociationTable', name: 'table', props: { objectTypeId: '0-1', propertyColumns: ['firstname', 'email'] } }]);
    const r = renderDoc(project, ext, { mode: 'preview', live: live() });
    const table = () => r.nodes(byName(ext, 'table').id)[0];
    await waitFor(() => expect(table()).toHaveTextContent('priya@globex.io'));
    expect(table()).toHaveTextContent('Email address');
    expect(table()).not.toHaveTextContent('Charles');
  });

  it('components that can’t show real data say they show sample values (and only with live data)', async () => {
    const { project, ext } = doc([
      { type: 'CrmReport', name: 'report', props: { reportId: '123' } },
      { type: 'CrmStatistics', name: 'stats' },
    ]);
    renderDoc(project, ext, { mode: 'preview', live: live() });
    expect(screen.getAllByText(/Sample values — in HubSpot this shows the real record/)).toHaveLength(2);
    cleanup();
    renderDoc(project, ext, { mode: 'preview' });
    expect(screen.queryByText(/Sample values/)).toBeNull();
  });

  it('falls back to sample values with the badge when loading fails', async () => {
    const { project, ext } = doc([{ type: 'CrmPropertyList', name: 'list', props: { properties: ['amount'] } }]);
    const r = renderDoc(project, ext, { mode: 'preview', live: live({ key: 'failing', getRecordProperties: async () => Promise.reject(new Error('boom')) }) });
    await waitFor(() => expect(screen.getByText(/Sample values/)).toBeInTheDocument());
    expect(r.nodes(byName(ext, 'list').id)[0]).toHaveTextContent('Amount');
  });
});
