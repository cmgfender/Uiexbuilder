/**
 * Power-user features (power module):
 * - ComputedSection / HelpersSection: editors mounted inside the Data panel.
 * - CommandPalette: ⌘K / Ctrl+K command palette mounted by the shell (openCommandPalette() opens it).
 * - helperNames(): top-level function/const names declared in Extension.helpers (scope listing).
 * - Pure helpers shared with the model, runtime, codegen and validation: compileHelpers,
 *   checkHelpersSyntax, usableComputed, validateComputedName, stripTypeScript, fuzzyMatch.
 */
export { ComputedSection, HelpersSection } from './sections';
export { CommandPalette, isPaletteShortcut } from './CommandPalette';
export { openCommandPalette, closeCommandPalette, usePowerUi } from './uiStore';
export {
  helperNames,
  compileHelpers,
  checkHelpersSyntax,
  prepareHelpersForTypeScript,
  HELPERS_EXAMPLE,
  HELPER_EXAMPLES,
  type CompiledHelpers,
} from './helpers';
export { usableComputed, validateComputedName, uniqueComputedName, isComputedIdentifier } from './computed';
export { stripTypeScript, annotateUntypedParams, topLevelDeclarations } from './tsTransform';
export { fuzzyMatch, highlightParts, type FuzzyMatch } from './fuzzy';
export { buildCommands, type Command, type CommandGroup, type CommandEnv } from './commands';
export { rankCommands, type RankedCommand } from './paletteModel';
export { renameComputed } from './actions';
