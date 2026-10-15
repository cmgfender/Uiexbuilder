#!/usr/bin/env node
/**
 * Writes public/hubspot-connector-app.uiex.json: a builder document for the HubSpot app that powers
 * "Connect HubSpot" (same app settings and scopes as hubspot-app/src/app/app-hsmeta.json, plus a
 * short settings page that explains the app to HubSpot admins, because a builder project needs at
 * least one extension).
 *
 * The person hosting the builder can open it in the builder (or download it pre-filled from
 * /setup.html) and use "Deploy to HubSpot" to create the app without a terminal.
 *
 * Run after changing hubspot-app/src/app/app-hsmeta.json: node scripts/make-connector-app.mjs
 * (server/adapters.test.ts checks that both stay in sync and that the document validates).
 */
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'hubspot-connector-app.uiex.json');

const entry = `
import { createExtension, createProject } from './src/model/factory';
import { serializeProject } from './src/model/persistence';
import meta from './hubspot-app/src/app/app-hsmeta.json';
import hsproject from './hubspot-app/hsproject.json';

export function make() {
  const c = meta.config;
  const settings = createExtension({
    kind: 'settings',
    name: 'UI Extension Builder',
    content: [
      {
        type: 'Flex',
        props: { direction: 'column', gap: 'medium' },
        children: [
          { type: 'Heading', text: 'UI Extension Builder' },
          {
            type: 'Text',
            text: 'This app lets your team preview HubSpot cards in UI Extension Builder with your real CRM records, properties and pipelines.',
          },
          { type: 'Text', text: 'It only reads data. It never creates, changes or deletes anything in HubSpot.' },
          {
            type: 'Text',
            text: 'To turn it off for this account, uninstall the app: Settings > Integrations > Connected apps.',
          },
        ],
      },
    ],
  });
  settings.fileName = 'BuilderSettings';
  settings.uid = 'uiex_builder_settings';
  const project = createProject(c.name, [settings]);
  project.id = 'p_uiex_builder_connector';
  project.name = hsproject.name;
  project.platformVersion = hsproject.platformVersion;
  project.createdAt = project.updatedAt = '2026-10-15T00:00:00.000Z';
  project.app = {
    uid: meta.uid,
    name: c.name,
    description: c.description,
    distribution: c.distribution,
    authType: c.auth.type,
    redirectUrls: [...c.auth.redirectUrls],
    requiredScopes: [...c.auth.requiredScopes],
    optionalScopes: [...c.auth.optionalScopes],
    conditionallyRequiredScopes: [...c.auth.conditionallyRequiredScopes],
    permittedUrls: { fetch: [...c.permittedUrls.fetch], iframe: [...c.permittedUrls.iframe], img: [...c.permittedUrls.img] },
    support: { ...c.support },
  };
  return serializeProject(project) + '\\n';
}
`;

const result = await build({
  stdin: { contents: entry, resolveDir: ROOT, sourcefile: 'make-connector-app.ts', loader: 'ts' },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'warning',
});
const mod = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
writeFileSync(OUT, mod.make());
console.log(`Wrote ${path.relative(ROOT, OUT)}`);
