import type { DropPlaceholderProps } from './types';

/**
 * Design-mode drop target rendered inside empty containers (and an empty card). The canvas finds
 * it through `data-drop-placeholder-for` (+ `data-drop-slot` for slots) and may restyle it.
 */
export function DropPlaceholder({ parentId, slot, label, children }: DropPlaceholderProps) {
  return (
    <div className="hsp-rt-drop-placeholder" data-drop-placeholder-for={parentId} data-drop-slot={slot}>
      {children ?? label ?? 'Drop components here'}
    </div>
  );
}
