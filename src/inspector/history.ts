/**
 * Undo grouping for inspector gestures (ARCHITECTURE §6d). The implementation lives in the model
 * so panels and the shell group their multi-action gestures the same way.
 */
export { asOneUndoStep } from '../model/history';
