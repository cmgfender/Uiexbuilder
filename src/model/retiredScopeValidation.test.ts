import { describe, expect, it } from 'vitest';
import { createProject } from './factory';
import { validateProject } from './validate';
import { generateProjectFiles } from '../codegen';

describe('retired scopes', () => {
  it('validation flags a retired scope as an error with the scope as subject', () => {
    const project = createProject();
    project.app.optionalScopes = ['tickets'];
    const issue = validateProject(project).find((i) => i.rule === 'retired-scope');
    expect(issue).toMatchObject({ severity: 'error', subject: 'tickets' });
    expect(issue?.message).toContain('crm.objects.tickets.read');
  });

  it('exports never contain retired scopes', () => {
    const project = createProject();
    project.app.requiredScopes = ['oauth', 'tickets'];
    project.app.optionalScopes = ['e-commerce', 'crm.objects.tickets.read'];
    const appMeta = generateProjectFiles(project).find((f) => f.path === 'src/app/app-hsmeta.json')!;
    const auth = JSON.parse(appMeta.contents).config.auth;
    expect(auth.requiredScopes).toContain('crm.objects.tickets.read');
    expect(auth.requiredScopes).not.toContain('tickets');
    expect(auth.optionalScopes).toEqual(['crm.objects.products.read', 'crm.objects.line_items.read']);
  });
});
