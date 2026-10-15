/**
 * Power-user features (implemented by the power module):
 * - ComputedSection / HelpersSection: editors mounted inside the Data panel.
 * - CommandPalette: ⌘K / Ctrl+K command palette mounted by the shell.
 * - helperNames(): top-level function/const names declared in Extension.helpers (scope listing).
 */
export { ComputedSection, HelpersSection } from './sections';
export { CommandPalette } from './CommandPalette';
export { helperNames } from './helpers';
