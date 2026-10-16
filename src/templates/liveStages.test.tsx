/**
 * ux-4: templates that list deals show the stage LABEL for deals in custom pipelines (HubSpot
 * formats only `dealstage`, like `propertiesToFormat: ['dealstage']`) and color the tag from
 * HubSpot's calculated hs_is_closed / hs_is_closed_won instead of default-pipeline stage ids.
 */
import { cleanup, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CrmSearchRequestDTO } from '../connect/types';
import { createProject } from '../model/factory';
import { renderDoc } from '../runtime/testing';
import type { LiveDataAdapter } from '../runtime/types';
import { generateProjectFiles } from '../codegen';
import { PROJECT_TEMPLATES } from './projectTemplates';

afterEach(() => cleanup());

const RAW = [
  { objectId: 501, properties: { dealname: 'Northwind – Annual renewal', amount: '36000', dealstage: '1002', hs_is_closed: 'false', hs_is_closed_won: 'false', createdate: '2026-09-01T10:00:00.000Z' } },
  { objectId: 502, properties: { dealname: 'Globex – Onboarding package', amount: '12000', dealstage: 'closedwon', hs_is_closed: 'true', hs_is_closed_won: 'true', createdate: '2026-08-20T10:00:00.000Z' } },
];
const LABELS: Record<string, string> = { '1002': 'In negotiation', closedwon: 'Closed Won' };

function liveSearch(seen: CrmSearchRequestDTO[]): LiveDataAdapter {
  return {
    key: '12345678|home|live',
    context: { portal: { id: 12345678 } },
    getRecordProperties: async () => ({}),
    getAssociations: async () => [],
    search: async (_type, request) => {
      seen.push(request);
      const formatted = request.formatted;
      const formats = (name: string) => formatted === true || (Array.isArray(formatted) && formatted.includes(name));
      return {
        results: RAW.map((r) => ({
          objectId: r.objectId,
          properties: Object.fromEntries(
            Object.entries(r.properties).map(([k, v]) => [k, k === 'dealstage' && formats('dealstage') ? (LABELS[v] ?? v) : v]),
          ),
        })),
        total: RAW.length,
        hasMore: false,
      };
    },
  };
}

describe('deal stages in templates with live data', () => {
  it('the App home dashboard shows stage labels for custom pipelines and colors from hs_is_closed*', async () => {
    const tpl = PROJECT_TEMPLATES.find((t) => t.id === 'app-home')!;
    const ext = tpl.build([]);
    const project = createProject('Stages', [ext]);
    const seen: CrmSearchRequestDTO[] = [];
    const r = renderDoc(project, ext, { mode: 'preview', live: liveSearch(seen) });
    await waitFor(() => expect(r.container).toHaveTextContent('In negotiation'));
    expect(r.container).not.toHaveTextContent(/\b1002\b/);
    // Only the stage is formatted: amounts stay numbers the card can add up.
    expect(seen[0].formatted).toEqual(['dealstage']);
    expect(seen[0].properties).toEqual(expect.arrayContaining(['dealstage', 'hs_is_closed', 'hs_is_closed_won']));
    // The won deal counts as won (any pipeline).
    expect(r.container).toHaveTextContent('Closed Won');
  });

  it('generated code asks HubSpot to format only the stage (propertiesToFormat)', () => {
    const tpl = PROJECT_TEMPLATES.find((t) => t.id === 'app-home')!;
    const project = createProject('Stages', [tpl.build([])]);
    const code = generateProjectFiles(project)
      .filter((f) => f.path.endsWith('.tsx'))
      .map((f) => f.contents)
      .join('\n');
    expect(code).toMatch(/propertiesToFormat: \['dealstage'\]/);
    expect(code).toContain("hs_is_closed_won === 'true'");
  });
});
