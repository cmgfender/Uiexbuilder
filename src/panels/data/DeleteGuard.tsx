/** Delete button that warns (listing usages) before deleting something still referenced. */
import { useState } from 'react';
import { Trash2, TriangleAlert } from 'lucide-react';
import { useEditor } from '../../model/store';
import type { Extension } from '../../model/types';
import { Button } from '../../ui';
import { Callout } from '../common';
import { findUsages, type Usage } from '../findUsages';

export interface DeleteGuardProps {
  ext: Extension;
  /** Name whose usages are checked. */
  name: string;
  /** What is deleted, e.g. "variable" / "data source". */
  noun: string;
  onDelete: () => void;
}

export function DeleteGuard({ ext, name, noun, onDelete }: DeleteGuardProps) {
  const [usages, setUsages] = useState<Usage[] | null>(null);
  if (usages && usages.length > 0) {
    const shown = usages.slice(0, 5);
    return (
      <Callout tone="warning" icon={<TriangleAlert size={14} aria-hidden />} role="alert">
        <div className="ub-pn-strong">
          “{name}” is used in {usages.length} {usages.length === 1 ? 'place' : 'places'}
        </div>
        <ul className="ub-pn-usages">
          {shown.map((u, i) => (
            <li key={`${u.field}-${u.nodeId ?? ''}-${i}`}>
              {u.nodeId ? (
                <button
                  type="button"
                  className="ub-pn-link"
                  title="Select this component"
                  onClick={() => useEditor.getState().select(u.nodeId!)}
                >
                  {u.location}
                </button>
              ) : (
                u.location
              )}
            </li>
          ))}
          {usages.length > shown.length && <li className="ub-pn-muted">and {usages.length - shown.length} more…</li>}
        </ul>
        <div className="ub-pn-muted">Those references will show errors until you update them.</div>
        <div className="ub-pn-row ub-pn-row--end">
          <Button size="sm" variant="ghost" onClick={() => setUsages(null)}>
            Cancel
          </Button>
          <Button size="sm" variant="danger" onClick={onDelete}>
            Delete anyway
          </Button>
        </div>
      </Callout>
    );
  }
  return (
    <Button
      size="sm"
      variant="ghost"
      className="ub-pn-danger-btn"
      icon={<Trash2 size={13} aria-hidden />}
      onClick={() => {
        const found = findUsages(ext, name);
        if (found.length === 0) onDelete();
        else setUsages(found);
      }}
    >
      Delete {noun}
    </Button>
  );
}
