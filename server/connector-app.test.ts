/**
 * The builder document for the HubSpot sign-in app (public/hubspot-connector-app.uiex.json, made by
 * scripts/make-connector-app.mjs) must stay in sync with hubspot-app/ and be deployable as is.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateProjectShape } from '../src/model/persistence';
import { validateProject } from '../src/model/validate';
import { generateProjectFiles } from '../src/codegen/project';

const ROOT = path.resolve(__dirname, '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

describe('HubSpot sign-in app as a builder document', () => {
  const parsed = validateProjectShape(JSON.parse(read('public/hubspot-connector-app.uiex.json')));

  it('opens in the builder without repairs and without errors', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.warnings).toEqual([]);
    const errors = validateProject(parsed.project).filter((i) => i.severity === 'error');
    expect(errors.map((e) => e.message)).toEqual([]);
  });

  it('generates the same app settings as hubspot-app/ (the CLI version)', () => {
    if (!parsed.ok) throw new Error('document did not parse');
    const files = generateProjectFiles(parsed.project);
    const generated = JSON.parse(files.find((f) => f.path === 'src/app/app-hsmeta.json')!.contents);
    const reference = JSON.parse(read('hubspot-app/src/app/app-hsmeta.json'));
    expect(generated.uid).toBe(reference.uid);
    expect(generated.config.distribution).toBe(reference.config.distribution);
    expect(generated.config.auth).toEqual(reference.config.auth);
    expect(generated.config.permittedUrls).toEqual(reference.config.permittedUrls);
    expect(JSON.parse(files.find((f) => f.path === 'hsproject.json')!.contents)).toMatchObject(JSON.parse(read('hubspot-app/hsproject.json')));
  });
});
