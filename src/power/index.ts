/**
 * Power-user features (power module):
 * - ComputedSection / HelpersSection: editors mounted inside the Data panel.
 * - CommandPalette: ⌘K / Ctrl+K command palette mounted by the shell (openCommandPalette() opens it).
 * - CodeEditor / CodeEditorDialog / handleCodeKeyDown: highlighted code editor, the "large editor"
 *   modal and editor keys (Tab indent, Enter keeps indentation) for any multi-line code field.
 * - helperNames(): top-level function/const names declared in Extension.helpers (scope listing).
 * - ShapeEditor / shape.ts: filter, sort, limit and format a list without code (a computed value
 *   with a fixed, readable expression shape that parseShape recognises again).
 * - Pure helpers shared with the model, runtime, codegen and validation: compileHelpers,
 *   checkHelpersSyntax, usableComputed, validateComputedName, stripTypeScript, fuzzyMatch.
 */
export { ComputedSection, HelpersSection } from './sections';
export { CommandPalette, isPaletteShortcut } from './CommandPalette';
export { CodeEditor, CodeEditorDialog, handleCodeKeyDown, type CodeEditorProps, type CodeEditorDialogProps } from './CodeEditor';
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
export { renameComputed, addShapedList, listSourceOf } from './actions';
export { ShapeEditor, type ShapeEditorProps } from './ShapeEditor';
export { parseShape, shapeToExpr, describeShape, type ListShape, type ShapeFormat, type ShapeSort } from './shape';
