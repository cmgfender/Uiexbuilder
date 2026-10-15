import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createExtension, createProject } from '../model/factory';
import { useEditor } from '../model/store';
import type { Issue } from '../model/validate';
import { ToastProvider } from '../ui';
import { ExportDialog } from './dialogs';
import { buildTree, deploySteps, exportAdditions, languageOf } from './exportModel';

const mocks = vi.hoisted(() => ({
  issues: [] as Issue[],
  downloadFile: vi.fn(),
  buildProjectZip: vi.fn(),
}));

vi.mock('../model/persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../model/persistence')>();
  return { ...actual, downloadFile: mocks.downloadFile };
});

vi.mock('../model/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../model/validate')>();
  return { ...actual, validateProject: () => mocks.issues };
});

vi.mock('../codegen', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../codegen')>();
  mocks.buildProjectZip.mockImplementation((p) => actual.buildProjectZip(p, { format: false }));
  return { ...actual, buildProjectZip: mocks.buildProjectZip };
});

function setup(arg: string | null = null) {
  const card = createExtension({ name: 'Deal Card', objectTypes: ['deals'] });
  card.dataSources = [
    { id: 'd1', kind: 'fetch', name: 'api', url: 'https://api.example.com/x', method: 'GET', runOnMount: true },
  ];
  const settings = createExtension({ kind: 'settings', existing: [card] });
  useEditor.getState().loadProject(createProject('Deal Desk', [card, settings]));
  const onClose = vi.fn();
  render(
    <ToastProvider>
      <ExportDialog open onClose={onClose} arg={arg} />
    </ToastProvider>,
  );
  return { onClose };
}

beforeEach(() => {
  mocks.issues = [];
  mocks.downloadFile.mockClear();
  mocks.buildProjectZip.mockClear();
});

describe('<ExportDialog> download', () => {
  it('summarises the project and what export adds', () => {
    setup();
    expect(screen.getByText('No problems found — ready to export.')).toBeInTheDocument();
    const project = screen.getByRole('region', { name: 'Project' });
    expect(within(project).getByText('deal-desk')).toBeInTheDocument();
    expect(within(project).getByText('2026.03')).toBeInTheDocument();
    const exts = screen.getByRole('region', { name: 'Extensions' });
    expect(within(exts).getByText('src/app/cards/DealCard.tsx')).toBeInTheDocument();
    expect(within(exts).getByText('Settings page')).toBeInTheDocument();
    const added = screen.getByRole('region', { name: 'Added automatically' });
    expect(within(added).getByText('crm.objects.deals.read')).toBeInTheDocument();
    expect(within(added).getByText('https://api.example.com')).toBeInTheDocument();
  });

  it('builds the zip and downloads it as <project name>.zip', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Download project (.zip)' }));
    await waitFor(() => expect(mocks.downloadFile).toHaveBeenCalled());
    expect(mocks.buildProjectZip).toHaveBeenCalledWith(useEditor.getState().project);
    const [name, blob, mime] = mocks.downloadFile.mock.calls[0];
    expect(name).toBe('deal-desk.zip');
    expect(blob).toBeInstanceOf(Blob);
    expect(mime).toBe('application/zip');
    expect(await screen.findByText('Downloaded deal-desk.zip')).toBeInTheDocument();
  });

  it('downloads the builder file', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Download builder file (.uiex.json)' }));
    const [name, contents, mime] = mocks.downloadFile.mock.calls[0];
    expect(name).toBe('deal-desk.uiex.json');
    expect(JSON.parse(contents as string).id).toBe(useEditor.getState().project.id);
    expect(mime).toBe('application/json');
  });

  it('gates export on errors until acknowledged and links to problems', () => {
    mocks.issues = [
      { id: 'x', severity: 'error', message: 'Missing label', rule: 'required-prop' },
      { id: 'y', severity: 'warning', message: 'Hmm', rule: 'other' },
    ];
    const { onClose } = setup();
    expect(screen.getByRole('alert')).toHaveTextContent('1 error and 1 warning');
    const download = screen.getByRole('button', { name: 'Download project (.zip)' });
    expect(download).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Export anyway'));
    expect(download).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Show problems' }));
    expect(useEditor.getState().bottomPanel).toBe('problems');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('<ExportDialog> files and deploy', () => {
  it('shows the file tree and file contents', async () => {
    setup('files');
    const tree = screen.getByRole('navigation', { name: 'Project files' });
    expect(within(tree).getByRole('button', { name: 'hsproject.json' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Prettier'));
    fireEvent.click(within(tree).getByRole('button', { name: 'hsproject.json' }));
    const viewer = await screen.findByRole('region', { name: 'json code' });
    expect(viewer).toHaveTextContent('"platformVersion": "2026.03"');
    // Collapse a folder.
    fireEvent.click(within(tree).getByRole('button', { name: 'src' }));
    expect(within(tree).queryByRole('button', { name: 'app-hsmeta.json' })).toBeNull();
  });

  it('lists tailored deploy steps with copyable commands', () => {
    setup('deploy');
    expect(screen.getByText('npm install -g @hubspot/cli@latest')).toBeInTheDocument();
    expect(screen.getByText('hs account auth')).toBeInTheDocument();
    expect(screen.getByText('(cd src/app/cards && npm install)')).toBeInTheDocument();
    expect(screen.getByText('(cd src/app/settings && npm install)')).toBeInTheDocument();
    expect(screen.queryByText('(cd src/app/pages && npm install)')).toBeNull();
    expect(screen.getByText('hs project upload')).toBeInTheDocument();
    expect(screen.getByText('hs project dev')).toBeInTheDocument();
    expect(screen.getByText(/Add “Deal Card” to a tab in the middle column/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Copy/ }).length).toBeGreaterThan(5);
  });
});

describe('export helpers', () => {
  it('computes additions and steps', () => {
    const p = createProject('X');
    p.app.requiredScopes = ['crm.objects.contacts.read'];
    expect(exportAdditions(p).scopes).toEqual(['oauth']);
    const steps = deploySteps(p);
    expect(steps[2].commands).toEqual(['unzip x.zip', 'cd x']);
    expect(steps.some((s) => s.title.startsWith('Add “Contact Overview”'))).toBe(true);
  });

  it('builds a sorted file tree and maps languages', () => {
    const tree = buildTree([
      { path: 'b.json', contents: '' },
      { path: 'src/app/x.tsx', contents: '' },
      { path: 'a.md', contents: '' },
      { path: 'src/z.js', contents: '' },
    ]);
    expect(tree.files.map((f) => f.path)).toEqual(['a.md', 'b.json']);
    expect(tree.dirs[0].name).toBe('src');
    expect(tree.dirs[0].dirs[0].path).toBe('src/app');
    expect(tree.dirs[0].files.map((f) => f.path)).toEqual(['src/z.js']);
    expect(['x.tsx', 'x.ts', 'x.cjs', 'x.json', 'README.md', '.gitignore'].map(languageOf)).toEqual([
      'tsx',
      'ts',
      'js',
      'json',
      'markdown',
      'text',
    ]);
  });
});
