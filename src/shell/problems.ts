/**
 * Problems (validateProject) computed once for the whole shell, debounced after document changes,
 * and the click-to-navigate behaviour shared by the problems panel and the top bar badge.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { useEditor, type RightPanelTab } from '../model/store';
import { validateProject, type Issue } from '../model/validate';
import type { Project } from '../model/types';
import { useDialogs } from './dialogs';
import { showLeftTab, showRightTab } from './shellStore';
import { revealField } from '../inspector/Problems';
import { revealDataItem } from '../panels/reveal';
import { usePowerUi } from '../power/uiStore';

/**
 * Validation waits for a pause in editing (the same delay the inline syntax checks use), so a
 * half-typed expression doesn't flash an error badge and count in the top bar while typing.
 */
export const PROBLEMS_DEBOUNCE_MS = 600;

interface ProblemsState {
  issues: Issue[];
  errors: number;
  warnings: number;
  infos: number;
  /** Set when validation itself threw (shown in the panel). */
  failure: string | null;
  setIssues: (issues: Issue[], failure?: string | null) => void;
}

export const useProblems = create<ProblemsState>()((set) => ({
  issues: [],
  errors: 0,
  warnings: 0,
  infos: 0,
  failure: null,
  setIssues: (issues, failure = null) =>
    set({
      issues,
      failure,
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
      infos: issues.filter((i) => i.severity === 'info').length,
    }),
}));

export function runValidation(project: Project): void {
  try {
    useProblems.getState().setIssues(validateProject(project));
  } catch (err) {
    useProblems.getState().setIssues([], err instanceof Error ? err.message : String(err));
  }
}

/** Keeps `useProblems` in sync with the document (mount once in the shell). */
export function useProblemsSync(): void {
  useEffect(() => {
    runValidation(useEditor.getState().project);
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.project === prev.project) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        runValidation(useEditor.getState().project);
      }, PROBLEMS_DEBOUNCE_MS);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);
}

/** Inspector tab that edits an issue's field. */
export function rightTabForField(field: string | undefined): RightPanelTab {
  if (!field) return 'properties';
  if (field.startsWith('event:')) return 'events';
  if (field === 'condition' || field === 'repeat' || field === 'binding') return 'advanced';
  return 'properties';
}

const EXTENSION_FIELDS = new Set(['uid', 'fileName', 'name', 'description', 'objectTypes', 'location', 'kind']);

/** Takes the user to where an issue can be fixed. */
export function navigateToIssue(issue: Issue): void {
  const editor = useEditor.getState();
  const field = issue.field ?? '';
  const ext = issue.extensionId ? editor.project.extensions.find((e) => e.id === issue.extensionId) : undefined;
  if (ext && ext.id !== editor.activeExtensionId) editor.setActiveExtension(ext.id);

  if (field === 'app' || field.startsWith('app.') || field.startsWith('project.') || field === 'platformVersion') {
    useDialogs.getState().open('appSettings', field || undefined);
    return;
  }
  if (field.startsWith('function:')) {
    useDialogs.getState().open('functions', field.slice('function:'.length));
    return;
  }
  if (issue.nodeId && (!ext || ext.nodes[issue.nodeId])) {
    if (editor.mode !== 'design') editor.setMode('design');
    useEditor.getState().select(issue.nodeId);
    showRightTab(rightTabForField(field));
    // Scroll to, flash and focus the setting that fixes it.
    if (field) revealField(issue);
    return;
  }
  if (
    field.startsWith('state:') ||
    field.startsWith('dataSource:') ||
    field.startsWith('computed:') ||
    field === 'helpers' ||
    field.startsWith('mock')
  ) {
    showLeftTab('data');
    // Expand the item that needs fixing.
    if (field.startsWith('state:')) revealDataItem('state', field.slice('state:'.length));
    else if (field.startsWith('dataSource:')) revealDataItem('dataSource', field.slice('dataSource:'.length));
    else if (field.startsWith('computed:')) usePowerUi.getState().revealComputed(field.slice('computed:'.length));
    else if (field === 'helpers') usePowerUi.getState().focusHelpers();
    return;
  }
  if (ext && EXTENSION_FIELDS.has(field.replace(/^extension\./, ''))) {
    useDialogs.getState().open('extensionSettings', ext.id);
  }
}
