import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createProject } from '../model/factory';
import { saveProject } from '../model/persistence';
import { useEditor } from '../model/store';
import { ToastProvider } from '../ui';
import { readBootGuard, resumeAutosave, useAutosave } from './persistence';
import { EditorErrorBoundary, StartupRecovery } from './Recovery';
import * as reporter from '../status/reporter';
import { resetEditor, rootChildren } from './testUtils';

/** Renders like the editor until the document has no top-level content, then throws. */
function FragileEditor() {
  useAutosave();
  const empty = useEditor((s) => {
    const ext = s.project.extensions.find((e) => e.id === s.activeExtensionId)!;
    return ext.nodes[ext.rootId].children.length === 0;
  });
  if (empty) throw new Error('Cannot read properties of undefined (reading icon)');
  return <div>editor ok</div>;
}

afterEach(() => {
  resumeAutosave();
  vi.restoreAllMocks();
});

describe('<EditorErrorBoundary>', () => {
  it('shows the recovery screen instead of a white page, without saving the broken document', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reportCrash = vi.spyOn(reporter, 'reportReactError').mockImplementation(() => {});
    resetEditor();
    const project = useEditor.getState().project;
    saveProject(project);
    const savedBefore = window.localStorage.getItem(`uiex-builder:project:${project.id}`);
    render(
      <ToastProvider>
        <EditorErrorBoundary>
          <FragileEditor />
        </EditorErrorBoundary>
      </ToastProvider>,
    );
    expect(screen.getByText('editor ok')).toBeInTheDocument();
    // An edit that makes rendering throw (the autosave timer is pending when the editor unmounts).
    act(() => useEditor.getState().removeNode(rootChildren()[0]));
    expect(screen.getByRole('heading', { name: 'The editor ran into a problem' })).toBeInTheDocument();
    expect(screen.getByText(/reading icon/)).toBeInTheDocument();
    // The crash goes to the host's status page (React keeps caught render errors from window 'error').
    expect(reportCrash).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/reading icon/) }), expect.any(String));
    expect(window.localStorage.getItem(`uiex-builder:project:${project.id}`)).toBe(savedBefore);
    expect(readBootGuard()).toMatchObject({ projectId: project.id, reason: 'crash' });
    expect(screen.getByRole('button', { name: /Download “My UI Extensions App”/ })).toBeInTheDocument();

    // Way out: a blank project; the editor renders again.
    fireEvent.click(screen.getByRole('button', { name: 'Start a blank project' }));
    expect(useEditor.getState().project.id).not.toBe(project.id);
    expect(screen.getByText('editor ok')).toBeInTheDocument();
    expect(readBootGuard()).toMatchObject({ projectId: useEditor.getState().project.id, reason: 'boot' });
    // The new project is what the next startup restores (not the one that crashed).
    expect(window.localStorage.getItem('uiex-builder:last-project')).toBe(useEditor.getState().project.id);
  });

  it('can open another saved project from the recovery screen', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resetEditor();
    const other = createProject('Other App');
    saveProject(other);
    render(
      <ToastProvider>
        <EditorErrorBoundary>
          <FragileEditor />
        </EditorErrorBoundary>
      </ToastProvider>,
    );
    act(() => useEditor.getState().removeNode(rootChildren()[0]));
    fireEvent.click(screen.getByRole('button', { name: /Open another project/ }));
    fireEvent.click(screen.getByRole('button', { name: /Other App/ }));
    expect(useEditor.getState().project.id).toBe(other.id);
    expect(screen.getByText('editor ok')).toBeInTheDocument();
  });
});

describe('<StartupRecovery>', () => {
  it('offers to download, retry or replace a project that crashed last time', () => {
    resetEditor();
    const fragile = createProject('Fragile App');
    saveProject(fragile);
    const onContinue = vi.fn();
    render(
      <ToastProvider>
        <StartupRecovery guard={{ projectId: fragile.id, reason: 'crash', at: '', message: 'i.map is not a function' }} safeMode={false} onContinue={onContinue} />
      </ToastProvider>,
    );
    expect(screen.getByRole('heading', { name: 'The editor ran into a problem last time' })).toBeInTheDocument();
    expect(screen.getByText(/was not reopened automatically/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download “Fragile App”/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try opening it again' }));
    expect(useEditor.getState().project.id).toBe(fragile.id);
    expect(onContinue).toHaveBeenCalled();
  });

  it('says "Safe mode" with ?safe=1', () => {
    resetEditor();
    render(
      <ToastProvider>
        <StartupRecovery guard={null} safeMode onContinue={() => {}} />
      </ToastProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Safe mode' })).toBeInTheDocument();
  });
});
