// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  isKnownPlatformVersion,
  isLegacyPlatformVersion,
  mapToInternalType,
  mapToUserFacingType,
  meetsMinimumPlatformVersion,
  SERVERLESS_PACKAGE_UID,
  translateProject,
  uidProblem,
} from './ir';
import { uploadSourceFiles, type DeployFile } from './paths';
import { sampleProjectFiles } from './testFixtures';

const SCHEMAS = Object.fromEntries(['APPLICATION', 'CARD', 'SETTINGS', 'PAGE', 'APP_FUNCTION', 'APP_OBJECT'].map((t) => [t, {}]));

function src(files = sampleProjectFiles()): DeployFile[] {
  return uploadSourceFiles(files, 'src');
}

function meta(path: string, content: unknown): DeployFile {
  return { path, contents: typeof content === 'string' ? content : JSON.stringify(content) };
}

const APP = meta('app/app-hsmeta.json', { uid: 'my_app', type: 'app', config: { name: 'App', distribution: 'private', auth: { type: 'static' } } });

describe('platform versions (project-parsing-lib platformVersion.ts)', () => {
  it('compares dated, beta and unstable versions', () => {
    expect(meetsMinimumPlatformVersion('2026.03', '2025.2')).toBe(true);
    expect(meetsMinimumPlatformVersion('2025.2', '2025.2')).toBe(true);
    expect(meetsMinimumPlatformVersion('2025.1', '2025.2')).toBe(false);
    expect(meetsMinimumPlatformVersion('2023.2', '2025.2')).toBe(false);
    expect(meetsMinimumPlatformVersion('2027.03-beta', '2027.03')).toBe(false);
    expect(meetsMinimumPlatformVersion('2027.03', '2027.03-beta')).toBe(true);
    expect(meetsMinimumPlatformVersion('unstable', '2027.03')).toBe(true);
    expect(meetsMinimumPlatformVersion('weird', '2027.03')).toBe(true);
    expect(isLegacyPlatformVersion('2025.1')).toBe(true);
    expect(isLegacyPlatformVersion('2025.2')).toBe(false);
    expect(isKnownPlatformVersion('2026.09')).toBe(true);
    expect(isKnownPlatformVersion('2030.01')).toBe(false);
  });

  it('maps component types like the library', () => {
    expect(mapToInternalType('app')).toBe('APPLICATION');
    expect(mapToInternalType('card')).toBe('CARD');
    expect(mapToInternalType('app-function')).toBe('APP_FUNCTION');
    expect(mapToInternalType('page')).toBe('PAGE');
    expect(mapToInternalType('pages')).toBe('PAGE');
    expect(mapToInternalType('calling')).toBe('CALLING_EXTENSION');
    expect(mapToInternalType('serverless-package')).toBe('SERVERLESS_PACKAGE');
    expect(mapToUserFacingType('APPLICATION')).toBe('app');
    expect(mapToUserFacingType('PAGE')).toBe('pages');
    expect(mapToUserFacingType('APP_FUNCTION')).toBe('app-function');
  });

  it('checks uids', () => {
    expect(uidProblem('deal_card.v2-1')).toBeNull();
    expect(uidProblem('')).toMatch(/at least one/);
    expect(uidProblem('a b')).toMatch(/letters, numbers/);
    expect(uidProblem('x'.repeat(65))).toMatch(/64 characters/);
  });
});

describe('translateProject', () => {
  it('builds the IR `hs project upload` sends for a generated project', () => {
    const { intermediateRepresentation: ir, errors, skippedHsMetaFiles } = translateProject(src(), '2026.03', SCHEMAS);
    expect(errors).toEqual([]);
    expect(skippedHsMetaFiles).toEqual([]);
    expect(ir.profileData).toEqual({ vars: { profileVariables: {} } });
    const nodes = ir.intermediateNodesIndexedByUid;
    // The auto-generated serverless package comes first, like transform() puts it.
    expect(Object.keys(nodes)[0]).toBe(SERVERLESS_PACKAGE_UID);
    expect(Object.keys(nodes).sort()).toEqual(['app_home', 'deal_card_card', 'deal_desk', 'get_weather', SERVERLESS_PACKAGE_UID, 'settings'].sort());
    expect(nodes.deal_desk).toEqual({
      uid: 'deal_desk',
      componentType: 'APPLICATION',
      config: expect.objectContaining({ name: 'Deal Desk', distribution: 'private' }),
      componentDeps: {},
      metaFilePath: 'app/app-hsmeta.json',
      files: {},
    });
    expect(nodes.deal_card_card).toEqual({
      uid: 'deal_card_card',
      componentType: 'CARD',
      config: { name: 'Deal Card', location: 'crm.record.tab', entrypoint: '/app/cards/DealCard.tsx', objectTypes: ['deals'] },
      componentDeps: { app: 'deal_desk', allAppObjects: [] },
      metaFilePath: 'app/cards/DealCard-hsmeta.json',
      files: {},
    });
    expect(nodes.settings.componentType).toBe('SETTINGS');
    expect(nodes.app_home.componentType).toBe('PAGE');
    expect(nodes.get_weather.componentDeps).toEqual({ app: 'deal_desk', allAppObjects: [], serverlessPackage: SERVERLESS_PACKAGE_UID });
    expect(nodes[SERVERLESS_PACKAGE_UID]).toEqual({
      uid: SERVERLESS_PACKAGE_UID,
      componentType: 'SERVERLESS_PACKAGE',
      config: { packageFile: 'app/functions/package.json' },
      componentDeps: { app: 'deal_desk', allAppObjects: [] },
      metaFilePath: 'app/functions/package.json',
      files: {},
    });
    // JSON round trip drops nothing important (undefined lock file is simply absent).
    expect(JSON.parse(JSON.stringify(ir))).toEqual(ir);
  });

  it('adds the lock file, app objects and authored dependencies', () => {
    const files = [
      APP,
      meta('app/app-objects/car-hsmeta.json', { uid: 'car', type: 'app-object', config: { name: 'car' } }),
      meta('app/functions/fn-hsmeta.json', { uid: 'fn', type: 'app-function', config: { entrypoint: '/app/functions/fn.js' }, dependencies: { other: 'x', app: 'ignored' } }),
      { path: 'app/functions/package.json', contents: '{}' },
      { path: 'app/functions/package-lock.json', contents: '{}' },
    ];
    const { intermediateRepresentation: ir, errors } = translateProject(files, '2026.03', SCHEMAS);
    expect(errors).toEqual([]);
    const n = ir.intermediateNodesIndexedByUid;
    expect(n.car.componentDeps).toEqual({ app: 'my_app' });
    expect(n.fn.componentDeps).toEqual({ other: 'x', app: 'my_app', allAppObjects: ['car'], serverlessPackage: SERVERLESS_PACKAGE_UID });
    expect(n[SERVERLESS_PACKAGE_UID].config).toEqual({ packageFile: 'app/functions/package.json', packageLockfile: 'app/functions/package-lock.json' });
  });

  it('skips hsmeta files outside component folders', () => {
    const files = [APP, meta('app/cards/nested/x-hsmeta.json', { uid: 'x', type: 'card', config: {} }), meta('other/y-hsmeta.json', { uid: 'y', type: 'card', config: {} })];
    const r = translateProject(files, '2026.03', SCHEMAS);
    expect(r.skippedHsMetaFiles).toEqual(['app/cards/nested/x-hsmeta.json', 'other/y-hsmeta.json']);
    expect(Object.keys(r.intermediateRepresentation.intermediateNodesIndexedByUid)).toEqual(['my_app']);
  });

  it('reports the structural problems project-parsing-lib validates', () => {
    const files = [
      APP,
      meta('app/cards/a-hsmeta.json', { uid: 'dup', type: 'card', config: {} }),
      meta('app/cards/b-hsmeta.json', { uid: 'dup', type: 'card', config: {} }),
      meta('app/cards/c-hsmeta.json', '{ not json'),
      meta('app/cards/d-hsmeta.json', { uid: 'd', type: 'card', config: {}, extra: 1 }),
      meta('app/cards/e-hsmeta.json', { uid: 'bad uid', type: 'card' }),
      meta('app/settings/f-hsmeta.json', { uid: 'f', type: 'card', config: {} }),
      meta('app/cards/g-hsmeta.json', { uid: 'g', type: 'gizmo', config: {} }),
      meta('app/settings/s1-hsmeta.json', { uid: 's1', type: 'settings', config: {} }),
      meta('app/settings/s2-hsmeta.json', { uid: 's2', type: 'settings', config: {} }),
      meta('app/cards/p-hsmeta.json', { uid: 'p', type: 'card', config: {}, permissions: { requiredScopes: ['x'] } }),
      meta('app/functions/fn-hsmeta.json', { uid: 'fn', type: 'app-function', config: {} }),
    ];
    const { errors } = translateProject(files, '2026.03', SCHEMAS);
    const text = errors.join('\n');
    expect(text).toMatch(/Duplicate uid 'dup' found in: app\/cards\/a-hsmeta\.json, app\/cards\/b-hsmeta\.json/);
    expect(text).toMatch(/app\/cards\/c-hsmeta\.json: Invalid JSON/);
    expect(text).toMatch(/app\/cards\/d-hsmeta\.json: Unexpected top-level properties found: extra/);
    expect(text).toMatch(/app\/cards\/e-hsmeta\.json: 'uid' should use only letters/);
    expect(text).toMatch(/app\/cards\/e-hsmeta\.json: Missing required field: 'config'/);
    expect(text).toMatch(/app\/settings\/f-hsmeta\.json: The directory 'app\/settings' is incorrect for type 'card'. Card features should only be placed in the 'app\/cards' directory/);
    expect(text).toMatch(/app\/cards\/g-hsmeta\.json: Unsupported type: gizmo/);
    expect(text).toMatch(/app\/settings\/s1-hsmeta\.json: Only one settings component is allowed/);
    expect(text).toMatch(/app\/settings\/s2-hsmeta\.json: Only one settings component is allowed/);
    expect(text).toMatch(/app\/cards\/p-hsmeta\.json: The "permissions" field is not supported on platform version "2026\.03"/);
    expect(text).toMatch(/app\/functions\/package\.json does not exist/);
    // Permissions are fine from 2027.03.
    expect(translateProject([APP, meta('app/cards/p-hsmeta.json', { uid: 'p', type: 'card', config: {}, permissions: {} })], '2027.03', SCHEMAS).errors).toEqual([]);
  });

  it('needs an app component for sub-components and at least one hsmeta file', () => {
    const r = translateProject([meta('app/cards/a-hsmeta.json', { uid: 'a', type: 'card', config: {} })], '2026.03', SCHEMAS);
    expect(r.errors.join('\n')).toMatch(/must be a child of the 'app' component/);
    expect(translateProject([{ path: 'app/x.txt', contents: '' }], '2026.03').errors[0]).toMatch(/No \*-hsmeta\.json files/);
  });

  it('skips the unsupported-type check without schemas', () => {
    expect(translateProject([APP, meta('app/cards/g-hsmeta.json', { uid: 'g', type: 'card', config: {} })], '2026.03', null).errors).toEqual([]);
    expect(translateProject([APP], '2026.03', { CARD: {} }).errors.join()).toMatch(/Unsupported type: app/);
  });
});
