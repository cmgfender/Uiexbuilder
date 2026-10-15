/**
 * Project validation (problems panel, inspector warnings, export gate).
 * CONTRACT: validateProject is pure and fast (runs on every change, debounced by callers).
 * The rule implementations are filled in by the templates & validation module.
 */
import type { Project } from './types';

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface Issue {
  /** Stable id (rule + location) so UIs can key lists. */
  id: string;
  severity: IssueSeverity;
  message: string;
  /** Rule identifier, e.g. 'required-prop', 'unknown-state', 'invalid-identifier'. */
  rule: string;
  extensionId?: string;
  nodeId?: string;
  /**
   * What the issue is about, e.g. a prop name, 'text', 'event:onClick', 'condition', 'repeat',
   * 'binding', 'state:<id>', 'dataSource:<id>', 'function:<id>', 'app.requiredScopes'.
   */
  field?: string;
}

export function validateProject(_project: Project): Issue[] {
  return [];
}
