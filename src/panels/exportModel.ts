/** Export dialog model: what export adds, the file tree and tailored deployment steps (pure). */
import { deriveRequirements, zipRootFolder, type GeneratedFile } from '../codegen';
import type { Project } from '../model/types';

function norm(url: string): string {
  return url.trim().replace(/\/+$/, '').toLowerCase();
}

/** Scopes and URLs export will add on top of the app settings. */
export function exportAdditions(project: Project): { scopes: string[]; fetch: string[]; iframe: string[]; img: string[] } {
  const req = deriveRequirements(project);
  const app = project.app;
  const listed = new Set([...app.requiredScopes, ...app.optionalScopes, ...app.conditionallyRequiredScopes].map((s) => s.trim()));
  const scopes = [...(app.requiredScopes.some((s) => s.trim() === 'oauth') ? [] : ['oauth']), ...req.scopes.filter((s) => !listed.has(s))];
  const missing = (kind: 'fetch' | 'iframe' | 'img') => {
    const have = new Set(app.permittedUrls[kind].map(norm));
    return req[kind].filter((u) => !have.has(norm(u)));
  };
  return { scopes, fetch: missing('fetch'), iframe: missing('iframe'), img: missing('img') };
}

export interface TreeDir {
  name: string;
  path: string;
  dirs: TreeDir[];
  files: GeneratedFile[];
}

export function buildTree(files: GeneratedFile[]): TreeDir {
  const root: TreeDir = { name: '', path: '', dirs: [], files: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join('/');
      let next = dir.dirs.find((d) => d.path === path);
      if (!next) {
        next = { name: parts[i], path, dirs: [], files: [] };
        dir.dirs.push(next);
      }
      dir = next;
    }
    dir.files.push(file);
  }
  const sort = (d: TreeDir) => {
    d.dirs.sort((a, b) => a.name.localeCompare(b.name));
    d.files.sort((a, b) => a.path.localeCompare(b.path));
    d.dirs.forEach(sort);
  };
  sort(root);
  return root;
}

export function languageOf(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.tsx') || lower.endsWith('.jsx')) return 'tsx';
  if (lower.endsWith('.ts')) return 'ts';
  if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'js';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.md')) return 'markdown';
  return 'text';
}

/** A numbered deployment step. */
export interface Step {
  title: string;
  body?: string;
  commands?: string[];
}

const PLACEMENT: Record<string, string> = {
  'crm.record.tab': 'a tab in the middle column',
  'crm.record.sidebar': 'the right sidebar',
  'crm.preview': 'the preview panel',
  'helpdesk.sidebar': 'the help desk ticket sidebar',
};

/** Deployment steps tailored to the project's extensions, functions and card locations. */
export function deploySteps(project: Project): Step[] {
  const folder = zipRootFolder(project);
  const cards = project.extensions.filter((e) => e.kind === 'card');
  const settings = project.extensions.find((e) => e.kind === 'settings');
  const home = project.extensions.find((e) => e.kind === 'home');
  const installs: string[] = [];
  if (cards.length) installs.push('(cd src/app/cards && npm install)');
  if (settings) installs.push('(cd src/app/settings && npm install)');
  if (home) installs.push('(cd src/app/pages && npm install)');
  if (project.functions.length) installs.push('(cd src/app/functions && npm install)');

  const steps: Step[] = [
    { title: 'Install the HubSpot CLI', body: 'Requires Node.js 20 or later.', commands: ['npm install -g @hubspot/cli@latest'] },
    {
      title: 'Connect your HubSpot account',
      body: 'Opens HubSpot to create a personal access key. Run it once per account.',
      commands: ['hs account auth'],
    },
    {
      title: 'Unzip the project and open its folder',
      commands: [`unzip ${project.name}.zip`, `cd ${folder}`],
    },
    { title: 'Install dependencies', commands: installs },
    {
      title: 'Upload and deploy',
      body: 'Builds the project in HubSpot and deploys it to your account.',
      commands: ['hs project upload'],
    },
    {
      title: 'Develop locally (optional)',
      body: 'Serves your extensions from your machine with hot reload while you test them in HubSpot.',
      commands: ['hs project dev'],
    },
  ];
  steps.push({
    title: 'Install the app in your account',
    body:
      project.app.distribution === 'marketplace'
        ? 'Install it through its OAuth install URL (Development → Projects → your project → Distribution).'
        : 'In HubSpot go to Development → Projects → your project → Distribution and click Install now.',
  });
  for (const card of cards) {
    const types = card.objectTypes.length ? card.objectTypes.join(', ') : 'CRM';
    steps.push({
      title: `Add “${card.name}” to ${PLACEMENT[card.location] ?? card.location}`,
      body:
        card.location === 'crm.preview'
          ? `Go to Settings → Objects → ${types} → Record customization, customize the preview, click Add card, choose Card library, filter by App and select “${card.name}”.`
          : card.location === 'helpdesk.sidebar'
            ? `In the help desk, open a ticket and customize the sidebar: click Add card, choose Card library, filter by App and select “${card.name}”.`
            : `Open a ${types} record, click Customize${card.location === 'crm.record.tab' ? ' and choose a tab' : ' and open the right sidebar'}, click Add card → Card library, filter by App and select “${card.name}”. Save the view.`,
    });
  }
  if (settings) {
    steps.push({ title: 'Open the settings page', body: 'Settings → Integrations → Connected apps → your app → Settings tab.' });
  }
  if (home) {
    steps.push({ title: 'Open the app home page', body: 'Click the Marketplace icon in the top navigation → Connected apps → your app.' });
  }
  return steps;
}
