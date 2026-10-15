import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { selectActiveExtension, useEditor } from '../model/store';
import { RuntimeProvider, useRuntime } from '../runtime';
import type { RuntimeApi } from '../runtime';
import { ToastProvider } from '../ui';
import { BottomPanel } from './BottomPanel';
import { buildFileTree, extensionSourcePath, fallbackNodeJsx, languageForPath } from './CodePanel';
import { formatDetail, formatLogTime } from './ConsolePanel';
import { useShell } from './shellStore';
import { resetEditor } from './testUtils';

let runtime: RuntimeApi | null = null;
function Capture() {
  runtime = useRuntime();
  return null;
}

function Workspace({ children }: { children: ReactNode }) {
  const project = useEditor((s) => s.project);
  const extension = useEditor((s) => selectActiveExtension(s));
  const mode = useEditor((s) => s.mode);
  return (
    <RuntimeProvider project={project} extension={extension} mode={mode}>
      <Capture />
      {children}
    </RuntimeProvider>
  );
}

function renderPanel() {
  return render(
    <ToastProvider>
      <Workspace>
        <BottomPanel />
      </Workspace>
    </ToastProvider>,
  );
}

describe('code helpers', () => {
  it('builds a folder tree and picks languages', () => {
    const tree = buildFileTree([
      { path: 'src/app/cards/B.tsx', contents: '' },
      { path: 'hsproject.json', contents: '' },
      { path: 'src/app/app-hsmeta.json', contents: '' },
      { path: 'src/app/cards/A.tsx', contents: '' },
    ]);
    expect(tree.files.map((f) => f.path)).toEqual(['hsproject.json']);
    expect(tree.dirs[0].name).toBe('src');
    const app = tree.dirs[0].dirs[0];
    expect(app.dirs.map((d) => d.name)).toEqual(['cards']);
    expect(app.dirs[0].files.map((f) => f.path)).toEqual(['src/app/cards/A.tsx', 'src/app/cards/B.tsx']);
    expect(languageForPath('x.tsx')).toBe('tsx');
    expect(languageForPath('x.json')).toBe('json');
    expect(languageForPath('README.md')).toBe('markdown');
  });

  it('formats console values', () => {
    expect(formatLogTime(new Date(2026, 0, 1, 9, 5, 7, 42).getTime())).toBe('09:05:07.042');
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(formatDetail(circular)).toContain('[Circular]');
    expect(formatDetail('plain')).toBe('plain');
  });
});

describe('<BottomPanel>', () => {
  it('is collapsed to its tab strip until a tab is opened', () => {
    resetEditor();
    renderPanel();
    expect(screen.queryByRole('tabpanel')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Problems/ }));
    expect(useEditor.getState().bottomPanel).toBe('problems');
    expect(screen.getByText('No problems — ready to export')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Hide panel/ }));
    expect(useEditor.getState().bottomPanel).toBeNull();
  });

  it('resizes with the keyboard handle', () => {
    resetEditor();
    useEditor.getState().setBottomPanel('problems');
    renderPanel();
    const handle = screen.getByRole('separator', { name: 'Resize panel' });
    const h = useShell.getState().bottomHeight;
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(useShell.getState().bottomHeight).toBe(h + 16);
    fireEvent.keyDown(handle, { key: 'ArrowDown', shiftKey: true });
    expect(useShell.getState().bottomHeight).toBe(h + 16 - 64);
  });

  it('shows generated files, defaulting to the active extension source', async () => {
    resetEditor();
    useEditor.getState().setBottomPanel('code');
    renderPanel();
    const expected = extensionSourcePath(useEditor.getState().project, useEditor.getState().activeExtensionId)!;
    const nav = await screen.findByRole('navigation', { name: 'Project files' });
    await waitFor(() => expect(within(nav).getByTitle('hsproject.json')).toBeInTheDocument());
    const active = nav.querySelector('[aria-current="true"]');
    expect(active?.getAttribute('title')).toBe(expected);
    expect(document.querySelector('.ub-sh-code-view')?.textContent).toContain('hubspot.extend');

    fireEvent.click(within(nav).getByTitle('hsproject.json'));
    expect(document.querySelector('.ub-sh-code-view')?.textContent).toContain('platformVersion');

    // Regenerates (debounced) after edits.
    act(() => useEditor.getState().updateApp({ name: 'Renamed App' }));
    fireEvent.click(within(nav).getByTitle('src/app/app-hsmeta.json'));
    await waitFor(() => expect(document.querySelector('.ub-sh-code-view')?.textContent).toContain('Renamed App'));

    fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }));
    await waitFor(() => expect(screen.getByText(/Copied to clipboard|Could not copy/)).toBeInTheDocument());
  });

  it('selection mode shows only the selected component JSX', async () => {
    resetEditor();
    useEditor.getState().setBottomPanel('code');
    renderPanel();
    await screen.findByRole('navigation', { name: 'Project files' });
    fireEvent.click(screen.getByRole('button', { name: /Selection/ }));
    expect(screen.getByText('Nothing selected')).toBeInTheDocument();

    const ext = selectActiveExtension(useEditor.getState());
    const flex = ext.nodes[ext.rootId].children[0];
    const heading = ext.nodes[flex].children[0];
    act(() => useEditor.getState().select(heading));
    const view = document.querySelector('.ub-sh-code-view')!.textContent!;
    expect(view).toContain('<Heading>');
    expect(view).not.toContain('<Flex');
    expect(view).not.toContain('hubspot.extend');
  });

  it('fallback JSX extraction renders a single node', () => {
    resetEditor();
    const s = useEditor.getState();
    const ext = selectActiveExtension(s);
    const flex = ext.nodes[ext.rootId].children[0];
    const out = fallbackNodeJsx(s.project, ext, flex);
    expect(out.startsWith('<Flex')).toBe(true);
    expect(out.trimEnd().endsWith('</Flex>')).toBe(true);
  });

  it('lists console entries with filters, details and clear; badges new entries in preview', async () => {
    resetEditor();
    renderPanel();
    act(() => useEditor.getState().setMode('preview'));
    await act(async () => {
      await runtime!.runActions([
        { id: 'l1', type: 'log', level: 'info', message: 'Hello console' },
        { id: 'l2', type: 'log', level: 'error', message: 'Something broke' },
      ]);
    });
    // Console not visible -> "new" badge on its tab.
    const tab = screen.getByRole('tab', { name: /Console/ });
    expect(within(tab).getByLabelText(/new/)).toBeInTheDocument();

    fireEvent.click(tab);
    expect(within(tab).queryByLabelText(/new/)).toBeNull();
    expect(screen.getByText('Hello console')).toBeInTheDocument();
    expect(screen.getByText('Something broke')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Errors/ }));
    expect(screen.queryByText('Hello console')).toBeNull();
    expect(screen.getByText('Something broke')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^All/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('Console is empty')).toBeInTheDocument();
  });
});
