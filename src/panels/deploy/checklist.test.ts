import { afterEach, describe, expect, it } from 'vitest';
import { createExtension, createProject } from '../../model/factory';
import type { DeployStatus } from '../../connect/types';
import { readLastPublish, recordPublish, setChecklistItem } from './checklist';
import { failureAdvice, hubspotOrigin, personalAccessKeyUrl, placementInstructions, placementSteps, publishChecklist } from './model';

const PORTAL = 12345678;
const ORIGIN = 'https://app.hubspot.com';

function status(extra: Partial<DeployStatus> = {}): DeployStatus {
  return {
    deployId: 'd1',
    phase: 'success',
    message: 'Live.',
    log: [],
    portalId: PORTAL,
    projectName: 'my-cards',
    buildId: 3,
    projectUrl: `${ORIGIN}/developer-projects/${PORTAL}/project/my-cards`,
    ...extra,
  };
}

afterEach(() => localStorage.clear());

describe('personal access key page', () => {
  it('is the page the HubSpot CLI opens: per account when known, else the account chooser', () => {
    expect(personalAccessKeyUrl('app.hubspot.com', PORTAL)).toBe(`https://app.hubspot.com/personal-access-key/${PORTAL}`);
    expect(personalAccessKeyUrl(undefined, undefined)).toBe('https://app.hubspot.com/l/personal-access-key');
    expect(personalAccessKeyUrl('app-eu1.hubspot.com', PORTAL)).toBe(`https://app-eu1.hubspot.com/personal-access-key/${PORTAL}`);
    expect(personalAccessKeyUrl('app.hubspot.com', PORTAL, 'http://localhost:4011/')).toBe(`http://localhost:4011/personal-access-key/${PORTAL}`);
    expect(hubspotOrigin('evil.example/x', undefined)).toBe('https://app.hubspot.com');
  });
});

describe('"Finish in HubSpot" checklist', () => {
  it('installs the app, puts each card on its record page with the exact clicks, then opens a record', () => {
    const tab = createExtension({ name: 'Contact Details', objectTypes: ['contacts'] });
    const side = createExtension({ name: 'Deal Facts', objectTypes: ['deals'], location: 'crm.record.sidebar' });
    const project = createProject('My Cards', [tab, side]);
    const items = publishChecklist(project, {
      portalId: PORTAL,
      origin: ORIGIN,
      installUrl: `${ORIGIN}/static-token/${PORTAL}/authorize?appId=5`,
      records: { [tab.id]: { id: '101', objectTypeId: '0-1' } },
    });
    expect(items.map((i) => i.key)).toEqual(['install', `card:${tab.id}`, `card:${side.id}`, 'open']);
    expect(items[0].link).toEqual({ href: `${ORIGIN}/static-token/${PORTAL}/authorize?appId=5`, label: 'Install the app' });
    expect(items[1].title).toBe('Add “Contact Details” to contacts records');
    expect(items[1].body).toBe('Once, in your contact settings — then it shows on every contact:');
    expect(items[1].steps).toEqual([
      'In HubSpot, click the Settings icon (top right).',
      'Go to Data Management → Objects → Contacts.',
      'Open the Record Customization tab and click Default view.',
      'Pick a tab in the middle column, then click Add cards → Card library.',
      'Set Card types to App and click Add card next to “Contact Details”.',
      'Click Save and exit.',
    ]);
    expect(items[1].link).toEqual({ href: `${ORIGIN}/settings/${PORTAL}`, label: 'Open HubSpot settings' });
    expect(items[2].steps).toContain('In the right sidebar, click Add cards → Card library.');
    expect(items[3]).toMatchObject({ title: 'Open a contact to see your card', link: { href: `${ORIGIN}/contacts/${PORTAL}/record/0-1/101`, label: 'Open your sample record' } });
  });

  it('without an install link, points to the project page; custom objects use their labels', () => {
    const card = createExtension({ name: 'Project Details', objectTypes: ['p_projects'] });
    const items = publishChecklist(createProject('X', [card]), {
      portalId: PORTAL,
      origin: ORIGIN,
      projectUrl: `${ORIGIN}/developer-projects/${PORTAL}/project/x`,
      types: [{ objectType: 'p_projects', objectTypeId: '2-555', label: 'Project', pluralLabel: 'Projects' }],
    });
    expect(items[0].link?.label).toBe('Open the project');
    expect(items[0].body).toMatch(/Distribution and click Install now/);
    expect(items[1].title).toBe('Add “Project Details” to projects records');
    expect(items[2]).toMatchObject({ title: 'Open a project to see your card', link: { href: `${ORIGIN}/contacts/${PORTAL}/objects/2-555` } });
  });

  it('explains the preview panel and help desk too', () => {
    expect(placementInstructions({ name: 'P', location: 'crm.preview' }, 'Deals')).toMatch(/Preview Customization tab/);
    expect(placementInstructions({ name: 'T', location: 'helpdesk.sidebar' }, 'Tickets')).toMatch(/Open any ticket in the help desk/);
    expect(placementSteps({ name: 'P', location: 'crm.preview' }, 'Deals')).toContain('Open the Preview Customization tab and click Default view.');
    expect(placementSteps({ name: 'T', location: 'helpdesk.sidebar' }, 'Tickets')[0]).toBe('Open any ticket in the help desk.');
  });

  it('lists settings and app home pages', () => {
    const items = publishChecklist(createProject('X', [createExtension({ kind: 'settings' }), createExtension({ kind: 'home' })]), { origin: ORIGIN });
    expect(items.map((i) => i.key)).toEqual(['install', 'settings', 'home']);
  });
});

describe('remembered ticks', () => {
  it('records a publish and keeps ticks for the same account', () => {
    expect(readLastPublish('p1')).toBeNull();
    recordPublish('p1', status());
    expect(setChecklistItem('p1', 'install', true)?.done).toEqual(['install']);
    setChecklistItem('p1', 'open', true);
    recordPublish('p1', status({ deployId: 'd2', buildId: 4 }));
    // One-time steps stay ticked; "open a record to see your card" is worth doing after every publish.
    expect(readLastPublish('p1')).toMatchObject({ buildId: 4, done: ['install'], portalId: PORTAL });
    expect(setChecklistItem('p1', 'install', false)?.done).toEqual([]);
    // Another account starts over.
    setChecklistItem('p1', 'open', true);
    recordPublish('p1', status({ portalId: 999 }));
    expect(readLastPublish('p1')?.done).toEqual([]);
  });

  it('never keeps unsafe links', () => {
    recordPublish('p2', status({ projectUrl: 'javascript:alert(1)' }));
    expect(readLastPublish('p2')?.projectUrl).toBeUndefined();
    localStorage.setItem('uiex-builder:publish:p3', '{"at":"x","installUrl":"javascript:1","done":[1,"a"]}');
    expect(readLastPublish('p3')).toMatchObject({ installUrl: undefined, done: ['a'] });
  });
});

describe('after a failed publish', () => {
  it('says what to do next in plain words', () => {
    expect(failureAdvice('network').join(' ')).toMatch(/internet connection/);
    expect(failureAdvice('build_failed').join(' ')).toMatch(/not something you did/);
    expect(failureAdvice('deploy_blocked').join(' ')).toMatch(/Open the project in HubSpot/);
    expect(failureAdvice('rate_limited').join(' ')).toMatch(/Wait a minute/);
    expect(failureAdvice('something_new').join(' ')).toMatch(/Try again/);
  });
});
