/** App functions of the project (shared by all extensions) with quick links to the editor. */
import { useMemo } from 'react';
import { Plus, Server, SquareFunction } from 'lucide-react';
import { useEditor } from '../../model/store';
import { useDialogs } from '../../shell/dialogs';
import { Badge, Button, IconButton, Section } from '../../ui';
import { findFunctionUsages } from '../actions';

export function FunctionsSection() {
  const project = useEditor((s) => s.project);
  const functions = project.functions;
  const counts = useMemo(
    () => new Map(functions.map((f) => [f.id, findFunctionUsages(project, f.id).length])),
    [project, functions],
  );
  const create = () => {
    const fn = useEditor.getState().addFunction();
    useDialogs.getState().open('functions', fn.id);
  };
  return (
    <Section
      defaultOpen={functions.length > 0}
      title={
        <span className="ub-pn-section-title">
          App functions <span className="ub-pn-count">{functions.length}</span>
        </span>
      }
      actions={
        <IconButton label="New app function" size="sm" onClick={create}>
          <Plus size={14} aria-hidden />
        </IconButton>
      }
    >
      {functions.length === 0 ? (
        <div className="ub-pn-empty">
          <Server size={18} aria-hidden />
          <div>
            <div className="ub-pn-strong">No app functions</div>
            <div className="ub-pn-muted">Run server-side JavaScript with secrets and the HubSpot API, called from any extension.</div>
          </div>
        </div>
      ) : (
        <div className="ub-pn-items" role="list" aria-label="App functions">
          {functions.map((f) => {
            const n = counts.get(f.id) ?? 0;
            return (
              <div key={f.id} className="ub-pn-item" role="listitem">
                <button
                  type="button"
                  className="ub-pn-item__head ub-pn-item__head--2l"
                  title="Edit function"
                  onClick={() => useDialogs.getState().open('functions', f.id)}
                >
                  <span className="ub-pn-kind">
                    <SquareFunction size={13} aria-hidden />
                  </span>
                  <span className="ub-pn-item__text">
                    <span className="ub-pn-item__name">{f.uid}</span>
                    <span className="ub-pn-item__summary">functions/{f.fileName}.js</span>
                  </span>
                  <Badge tone={n ? 'success' : undefined} title={n ? `Used in ${n} place${n === 1 ? '' : 's'}` : 'Not used yet'}>
                    {n ? `${n} use${n === 1 ? '' : 's'}` : 'unused'}
                  </Badge>
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="ub-pn-row">
        <Button size="sm" icon={<Plus size={13} aria-hidden />} onClick={create}>
          New function
        </Button>
        <Button size="sm" variant="ghost" onClick={() => useDialogs.getState().open('functions')}>
          Manage functions…
        </Button>
      </div>
    </Section>
  );
}
