/**
 * Undo grouping for gestures that call several store actions (e.g. "create a state variable and
 * bind it", "create an app function and a data source that runs it"): one user gesture must be
 * one undo step.
 */
import { useEditor } from './store';

/**
 * Runs `fn` and records everything it commits as ONE undo step: history entries added while it
 * ran are collapsed into the entry holding the document as it was before `fn`. Undo then restores
 * that document in one go; redo replays the whole gesture. (Matched by identity, so it degrades
 * to separate steps — never loses history — when the entry was coalesced or trimmed.)
 */
export function asOneUndoStep<T>(fn: () => T): T {
  const before = useEditor.getState().project;
  const result = fn();
  const { past } = useEditor.getState();
  const i = past.lastIndexOf(before);
  if (i !== -1 && i < past.length - 1) useEditor.setState({ past: past.slice(0, i + 1) });
  return result;
}
