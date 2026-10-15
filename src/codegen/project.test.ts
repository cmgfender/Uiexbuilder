// @vitest-environment node
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createExtension, createProject } from '../model/factory';
import { parseProjectJson } from '../model/persistence';
import type { Project } from '../model/types';
import { createFeatureProject } from './fixtures';
import { buildProjectZip, deriveRequirements, generateProjectFiles, scopeForObjectType, staticOrigin } from './index';
import { mergeRequiredScopes, mergeUrls } from './requirements';

function fileMap(project: Project): Map<string, string> {
  return new Map(generateProjectFiles(project).map((f) => [f.path, f.contents]));
}

function json(files: Map<string, string>, path: string): any {
  const contents = files.get(path);
  if (contents === undefined) throw new Error(`Missing file ${path}`);
  return JSON.parse(contents);
}

describe('generateProjectFiles', () => {
  it('produces the 2026.03 project layout', () => {
    const files = fileMap(createFeatureProject());
    expect([...files.keys()]).toEqual([
      'hsproject.json',
      'README.md',
      '.gitignore',
      '.uiex.json',
      'src/app/app-hsmeta.json',
      'src/app/cards/FeatureCard.tsx',
      'src/app/cards/FeatureCard-hsmeta.json',
      'src/app/cards/SidebarActionsCard.tsx',
      'src/app/cards/SidebarActionsCard-hsmeta.json',
      'src/app/cards/package.json',
      'src/app/cards/tsconfig.json',
      'src/app/cards/.prettierrc.json',
      'src/app/cards/eslint.config.js',
      'src/app/settings/Settings.tsx',
      'src/app/settings/settings-hsmeta.json',
      'src/app/settings/package.json',
      'src/app/settings/tsconfig.json',
      'src/app/settings/.prettierrc.json',
      'src/app/settings/eslint.config.js',
      'src/app/pages/AppHome.tsx',
      'src/app/pages/app_home-hsmeta.json',
      'src/app/pages/package.json',
      'src/app/pages/tsconfig.json',
      'src/app/pages/.prettierrc.json',
      'src/app/pages/eslint.config.js',
      'src/app/functions/getQuote.js',
      'src/app/functions/getQuote-hsmeta.json',
      'src/app/functions/publicStatus.js',
      'src/app/functions/publicStatus-hsmeta.json',
      'src/app/functions/package.json',
    ]);
  });

  it('writes hsproject.json and extension configs like the templates', () => {
    const project = createFeatureProject();
    const files = fileMap(project);
    expect(json(files, 'hsproject.json')).toEqual({ name: 'feature-test-app', srcDir: 'src', platformVersion: '2026.03' });
    expect(files.get('src/app/cards/FeatureCard-hsmeta.json')).toBe(
      [
        '{',
        `  "uid": "${project.extensions[0].uid}",`,
        '  "type": "card",',
        '  "config": {',
        '    "name": "Feature Card",',
        '    "description": "Every feature of the builder in one card.",',
        '    "location": "crm.record.tab",',
        '    "entrypoint": "/app/cards/FeatureCard.tsx",',
        '    "objectTypes": ["contacts", "deals", "p_my_object"]',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    expect(json(files, 'src/app/settings/settings-hsmeta.json')).toEqual({
      uid: project.extensions[2].uid,
      type: 'settings',
      config: { entrypoint: '/app/settings/Settings.tsx' },
    });
    expect(json(files, 'src/app/pages/app_home-hsmeta.json')).toEqual({
      uid: 'app_home',
      type: 'page',
      config: { entrypoint: '/app/pages/AppHome.tsx', location: 'home' },
    });
    expect(json(files, 'src/app/functions/publicStatus-hsmeta.json')).toEqual({
      uid: 'public_status',
      type: 'app-function',
      config: {
        entrypoint: '/app/functions/publicStatus.js',
        endpoint: { path: '/api/status', methods: ['GET', 'POST'] },
        secretKeys: ['API_TOKEN'],
      },
    });
    expect(json(files, 'src/app/functions/getQuote-hsmeta.json').config).toEqual({
      entrypoint: '/app/functions/getQuote.js',
      secretKeys: [],
    });
  });

  it('writes package.json files based on the HubSpot templates', () => {
    const files = fileMap(createFeatureProject());
    const cards = json(files, 'src/app/cards/package.json');
    expect(cards.name).toBe('feature-test-app-cards');
    expect(cards.type).toBe('module');
    expect(cards.dependencies).toEqual({ '@hubspot/ui-extensions': '^0.17.1', react: '^18.2.0' });
    expect(cards.scripts.lint).toBe('eslint .');
    expect(cards.devDependencies.typescript).toBe('^5');
    expect(json(files, 'src/app/functions/package.json').dependencies).toEqual({ '@hubspot/api-client': '^14.0.1' });
    expect(json(files, 'src/app/cards/tsconfig.json').compilerOptions.jsx).toBe('react-jsx');
    expect(files.get('src/app/cards/.prettierrc.json')).toBe('{ "singleQuote": true }\n');
  });

  it('merges derived scopes and permitted URLs into app-hsmeta.json', () => {
    const files = fileMap(createFeatureProject());
    const app = json(files, 'src/app/app-hsmeta.json');
    expect(app.uid).toBe('feature_test_app');
    expect(app.type).toBe('app');
    expect(app.config.auth.type).toBe('static');
    expect(app.config.auth).not.toHaveProperty('redirectUrls');
    expect(app.config.auth.requiredScopes).toEqual([
      'oauth',
      'crm.objects.contacts.read',
      'crm.objects.companies.read',
      'crm.objects.custom.read',
      'crm.objects.deals.read',
      'tickets',
    ]);
    expect(app.config.permittedUrls).toEqual({
      fetch: ['https://api.example.com/', 'https://data.example.org', 'https://settings.example.com'],
      iframe: ['https://embed.example.com', 'https://help.example.com'],
      img: ['https://images.example.com'],
    });
    expect(app.config.support.supportEmail).toBe('support@example.com');
  });

  it('includes redirect URLs for OAuth apps only and drops empty support fields', () => {
    const project = createProject('OAuth App');
    project.app.authType = 'oauth';
    project.app.redirectUrls = ['http://localhost:3000'];
    project.app.requiredScopes = ['crm.objects.contacts.read'];
    project.app.support = { supportEmail: 'help@example.com', documentationUrl: '', supportUrl: ' ', supportPhone: '' };
    const app = json(fileMap(project), 'src/app/app-hsmeta.json');
    expect(app.config.auth.redirectUrls).toEqual(['http://localhost:3000']);
    expect(app.config.auth.requiredScopes).toEqual(['oauth', 'crm.objects.contacts.read']);
    expect(app.config.support).toEqual({ supportEmail: 'help@example.com' });
  });

  it('documents deployment in the README', () => {
    const readme = fileMap(createFeatureProject()).get('README.md')!;
    expect(readme).toContain('# Feature Test App');
    expect(readme).toContain('hs account auth');
    expect(readme).toContain('(cd src/app/cards && npm install)');
    expect(readme).toContain('(cd src/app/functions && npm install)');
    expect(readme).toContain('hs project upload');
    expect(readme).toContain('hs project dev');
    expect(readme).toContain('| Feature Card | App card |');
    expect(readme).toContain('`crm.objects.deals.read`');
  });

  it('includes the builder document for re-import', () => {
    const project = createFeatureProject();
    const doc = fileMap(project).get('.uiex.json')!;
    const parsed = parseProjectJson(doc);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.project).toEqual(project);
  });

  it('keeps file names unique within a directory', () => {
    const project = createProject('Dupes');
    const a = createExtension({ name: 'Same' });
    const b = createExtension({ name: 'Other' });
    b.fileName = a.fileName;
    project.extensions = [a, b];
    const paths = generateProjectFiles(project).map((f) => f.path);
    expect(paths).toContain('src/app/cards/SameCard.tsx');
    expect(paths).toContain('src/app/cards/SameCard2.tsx');
    expect(paths).toContain('src/app/cards/SameCard2-hsmeta.json');
  });

  it('is deterministic', () => {
    const project = createFeatureProject();
    expect(generateProjectFiles(project)).toEqual(generateProjectFiles(project));
  });
});

describe('deriveRequirements', () => {
  it('maps object types to read scopes', () => {
    expect(scopeForObjectType('contacts')).toBe('crm.objects.contacts.read');
    expect(scopeForObjectType('CONTACT')).toBe('crm.objects.contacts.read');
    expect(scopeForObjectType('0-3')).toBe('crm.objects.deals.read');
    expect(scopeForObjectType('tickets')).toBe('tickets');
    expect(scopeForObjectType('0-7')).toBe('e-commerce');
    expect(scopeForObjectType('p_cars')).toBe('crm.objects.custom.read');
    expect(scopeForObjectType('2-12345')).toBe('crm.objects.custom.read');
    expect(scopeForObjectType('calls')).toBeNull();
    expect(scopeForObjectType('')).toBeNull();
  });

  it('extracts origins only from URLs with a static host', () => {
    expect(staticOrigin('https://api.example.com/v1/{{ id }}')).toBe('https://api.example.com');
    expect(staticOrigin('https://api.example.com:8443?q={{ q }}')).toBe('https://api.example.com:8443');
    expect(staticOrigin('HTTPS://Api.Example.com')).toBe('https://api.example.com');
    expect(staticOrigin('https://{{ host }}/x')).toBeNull();
    expect(staticOrigin('https://api.example.com{{ path }}')).toBeNull();
    expect(staticOrigin('{{ url }}')).toBeNull();
    expect(staticOrigin('/relative/path')).toBeNull();
    expect(staticOrigin('data:image/png;base64,AAAA')).toBeNull();
  });

  it('collects scopes and URLs from cards, data sources, actions and images', () => {
    expect(deriveRequirements(createFeatureProject())).toEqual({
      scopes: ['crm.objects.companies.read', 'crm.objects.contacts.read', 'crm.objects.custom.read', 'crm.objects.deals.read', 'tickets'],
      fetch: ['https://api.example.com', 'https://data.example.org', 'https://settings.example.com'],
      iframe: ['https://embed.example.com', 'https://help.example.com'],
      img: ['https://images.example.com'],
    });
  });

  it('merges user values first, deduplicated', () => {
    expect(mergeUrls(['https://a.com/', 'https://b.com'], ['https://a.com', 'https://c.com'])).toEqual([
      'https://a.com/',
      'https://b.com',
      'https://c.com',
    ]);
    expect(
      mergeRequiredScopes(
        { requiredScopes: ['crm.objects.deals.read', 'oauth'], optionalScopes: ['tickets'], conditionallyRequiredScopes: [] },
        ['tickets', 'crm.objects.contacts.read', 'crm.objects.deals.read'],
      ),
    ).toEqual(['crm.objects.deals.read', 'oauth', 'crm.objects.contacts.read']);
  });
});

describe('buildProjectZip', () => {
  it('zips every project file under a folder named after the project', async () => {
    const project = createFeatureProject();
    const blob = await buildProjectZip(project, { format: false });
    expect(blob.size).toBeGreaterThan(0);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    const expected = generateProjectFiles(project).map((f) => `feature-test-app/${f.path}`);
    expect(names.sort()).toEqual([...expected].sort());
    expect(await zip.file('feature-test-app/hsproject.json')!.async('string')).toContain('"platformVersion": "2026.03"');
    const generated = generateProjectFiles(project).find((f) => f.path === 'src/app/cards/FeatureCard.tsx')!;
    expect(await zip.file('feature-test-app/src/app/cards/FeatureCard.tsx')!.async('string')).toBe(generated.contents);
  });

  it('formats sources with prettier by default so format:check passes', async () => {
    const prettier = await import('prettier');
    const project = createFeatureProject();
    const zip = await JSZip.loadAsync(await (await buildProjectZip(project)).arrayBuffer());
    for (const path of ['src/app/cards/FeatureCard.tsx', 'src/app/cards/package.json', 'src/app/app-hsmeta.json', 'src/app/cards/eslint.config.js']) {
      const contents = await zip.file(`feature-test-app/${path}`)!.async('string');
      const parser = path.endsWith('.tsx') ? 'typescript' : path.endsWith('.js') ? 'babel' : 'json';
      expect(await prettier.check(contents, { parser, singleQuote: true, filepath: path }), path).toBe(true);
    }
    const doc = await zip.file('feature-test-app/.uiex.json')!.async('string');
    expect(doc).toBe(generateProjectFiles(project).find((f) => f.path === '.uiex.json')!.contents);
  });
});
