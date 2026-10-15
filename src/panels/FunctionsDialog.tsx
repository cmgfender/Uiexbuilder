/** App functions editor: list + editor (uid, file, code, secrets, endpoint, usages, how to call it). */
import { useEffect, useId, useMemo, useState } from 'react';
import { CircleCheck, Plus, RotateCcw, Server, SquareFunction, Trash2, TriangleAlert } from 'lucide-react';
import { DEFAULT_FUNCTION_CODE } from '../model/factory';
import { useEditor } from '../model/store';
import type { AppFunction, HttpMethod } from '../model/types';
import { appFunctionsUnsupported } from '../model/validate';
import { Badge, Button, Dialog, EmptyState, Field, Switch, TextArea, TextInput, cx, useToast } from '../ui';
import { Callout, ChipInput, CommitInput, Snippet, ToggleChips } from './common';
import { findFunctionUsages, revealNode } from './actions';
import type { DialogComponentProps } from './dialogTypes';
import {
  checkFunctionSyntax,
  defaultEndpointPath,
  functionFileNameError,
  projectUidError,
  validateEndpointPath,
  validateSecretKey,
} from './utils';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export function FunctionsDialog({ open, onClose, arg }: DialogComponentProps) {
  const functions = useEditor((s) => s.project.functions);
  const unsupported = useEditor((s) => appFunctionsUnsupported(s.project));
  const [selectedId, setSelectedId] = useState<string | null>(arg ?? null);
  useEffect(() => {
    if (open) setSelectedId(arg ?? useEditor.getState().project.functions[0]?.id ?? null);
  }, [open, arg]);
  if (!open) return null;
  const selected = functions.find((f) => f.id === selectedId) ?? functions[0] ?? null;

  const add = () => {
    const fn = useEditor.getState().addFunction();
    setSelectedId(fn.id);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="App functions"
      wide
      footer={
        <>
          <span className="ub-pn-footnote">Functions are exported to src/app/functions and run on HubSpot’s servers.</span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className="ub-pn-two-pane">
        <div className="ub-pn-two-pane__list">
          <div className="ub-pn-list-head">
            <span>Functions</span>
            <Button size="sm" icon={<Plus size={13} aria-hidden />} onClick={add}>
              New
            </Button>
          </div>
          {functions.length === 0 ? (
            <div className="ub-pn-muted ub-pn-pad">No functions yet.</div>
          ) : (
            <nav aria-label="Functions" className="ub-pn-nav">
              {functions.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-current={selected?.id === f.id ? 'true' : undefined}
                  className={cx('ub-pn-nav__item', selected?.id === f.id && 'ub-pn-nav__item--active')}
                  onClick={() => setSelectedId(f.id)}
                >
                  <SquareFunction size={14} aria-hidden />
                  <span className="ub-pn-nav__text">
                    <span className="ub-pn-nav__title">{f.uid}</span>
                    <span className="ub-pn-nav__sub">{f.fileName}.js</span>
                  </span>
                  {f.endpoint && <Badge>endpoint</Badge>}
                </button>
              ))}
            </nav>
          )}
        </div>
        <div className="ub-pn-two-pane__main">
          {unsupported && functions.length > 0 && (
            <Callout tone="danger" icon={<TriangleAlert size={14} aria-hidden />} role="alert">
              {unsupported}. These functions can’t be uploaded with this app type — switch to Private distribution with Static token
              auth in App settings, or delete them.
            </Callout>
          )}
          {selected ? (
            <FunctionEditor
              key={selected.id}
              fn={selected}
              onDeleted={() => setSelectedId(null)}
              onNavigate={(extId, nodeId) => {
                revealNode(extId, nodeId);
                onClose();
              }}
            />
          ) : (
            <EmptyState icon={<Server size={24} aria-hidden />} title="Server-side code for your cards">
              <p className="ub-pn-p">
                App functions run on HubSpot’s infrastructure. Use them to call third-party APIs with secrets, or the HubSpot API with
                the app’s access token.
              </p>
              <Button variant="primary" icon={<Plus size={14} aria-hidden />} onClick={add}>
                Create a function
              </Button>
            </EmptyState>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function FunctionEditor({
  fn,
  onDeleted,
  onNavigate,
}: {
  fn: AppFunction;
  onDeleted: () => void;
  onNavigate: (extensionId: string, nodeId?: string) => void;
}) {
  const project = useEditor((s) => s.project);
  const toast = useToast();
  const usages = useMemo(() => findFunctionUsages(project, fn.id), [project, fn.id]);
  const [confirm, setConfirm] = useState<'delete' | 'reset' | null>(null);
  const syntaxError = useMemo(() => checkFunctionSyntax(fn.code), [fn.code]);
  const hasMain = /exports\.main\s*=|module\.exports\s*=|exports\[['"]main['"]\]\s*=/.test(fn.code);
  const codeId = useId();
  const pathId = useId();
  const update = (patch: Partial<AppFunction>) => useEditor.getState().updateFunction(fn.id, patch);
  const snippet = `import { hubspot } from '@hubspot/ui-extensions';

const result = await hubspot.serverless('${fn.uid}', {
  parameters: { recordId: context.crm.objectId },
});`;

  return (
    <div className="ub-pn-form">
      <div className="ub-pn-grid2">
        <Field label="UID" hint="Name passed to hubspot.serverless().">
          <CommitInput
            code
            value={fn.uid}
            aria-label="Function UID"
            validate={(v) => projectUidError(useEditor.getState().project, v, { kind: 'function', id: fn.id })}
            onCommit={(uid) => update({ uid })}
          />
        </Field>
        <Field label="File name" hint={`src/app/functions/${fn.fileName}.js`}>
          <CommitInput
            code
            value={fn.fileName}
            suffix=".js"
            aria-label="Function file name"
            validate={(v) => functionFileNameError(useEditor.getState().project, v, fn.id)}
            onCommit={(fileName) => update({ fileName })}
          />
        </Field>
      </div>

      <Field
        label="Code"
        htmlFor={codeId}
        actions={
          confirm === 'reset' ? (
            <span className="ub-pn-row">
              <span className="ub-pn-muted">Replace your code?</span>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  update({ code: DEFAULT_FUNCTION_CODE });
                  setConfirm(null);
                }}
              >
                Replace
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw size={12} aria-hidden />}
              disabled={fn.code === DEFAULT_FUNCTION_CODE}
              onClick={() => setConfirm('reset')}
            >
              Reset to example
            </Button>
          )
        }
      >
        <TextArea
          id={codeId}
          code
          className="ub-pn-code-area"
          value={fn.code}
          rows={16}
          invalid={!!syntaxError}
          onChange={(code) => update({ code })}
        />
      </Field>
      <div className={cx('ub-pn-syntax', syntaxError ? 'ub-pn-syntax--error' : 'ub-pn-syntax--ok')} role="status" aria-label="Syntax check">
        {syntaxError ? (
          <>
            <TriangleAlert size={13} aria-hidden /> Syntax error: {syntaxError}
          </>
        ) : hasMain ? (
          <>
            <CircleCheck size={13} aria-hidden /> Syntax OK · exports main
          </>
        ) : (
          <>
            <TriangleAlert size={13} aria-hidden /> Syntax OK, but the file must export a handler: <code>exports.main = async (context) =&gt; {'{ … }'}</code>
          </>
        )}
      </div>

      <Field label="Secrets" hint="Names of secrets added with `hs secrets add`; available as process.env.NAME.">
        <ChipInput
          aria-label="Secret names"
          values={fn.secretKeys}
          validate={validateSecretKey}
          placeholder="API_KEY"
          onChange={(secretKeys) => update({ secretKeys })}
        />
      </Field>

      <div className="ub-pn-block">
        <Switch
          checked={!!fn.endpoint}
          onChange={(on) => update({ endpoint: on ? { path: defaultEndpointPath(fn.uid), methods: ['GET'] } : undefined })}
          label="Expose as a public endpoint"
        />
        {fn.endpoint && (
          <div className="ub-pn-grid2">
            <Field label="Path" htmlFor={pathId} error={validateEndpointPath(fn.endpoint.path) ?? undefined}>
              <TextInput
                id={pathId}
                code
                value={fn.endpoint.path}
                invalid={!!validateEndpointPath(fn.endpoint.path)}
                onChange={(path) => update({ endpoint: { ...fn.endpoint!, path } })}
              />
            </Field>
            <Field label="Methods" error={fn.endpoint.methods.length === 0 ? 'Choose at least one method' : undefined}>
              <ToggleChips
                aria-label="Endpoint methods"
                options={METHODS}
                values={fn.endpoint.methods}
                onChange={(methods) => update({ endpoint: { ...fn.endpoint!, methods } })}
              />
            </Field>
          </div>
        )}
      </div>

      <div className="ub-pn-block">
        <div className="ub-pn-subhead">
          <span>Used by</span>
          <Badge>{usages.length}</Badge>
        </div>
        {usages.length === 0 ? (
          <div className="ub-pn-muted">Not used yet. Add an “App function” data source or a “Run function” action.</div>
        ) : (
          <ul className="ub-pn-usages">
            {usages.map((u, i) => (
              <li key={i}>
                <button type="button" className="ub-pn-link" onClick={() => onNavigate(u.extensionId, u.nodeId)}>
                  {u.extensionName} · {u.location}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Callout tone="info">
        <div className="ub-pn-strong">Calling it from a card</div>
        Use an “App function” data source or a “Run function” action — or call it in custom code:
        <Snippet code={snippet} block label="Copy snippet" />
        The function receives <code>context.parameters</code> and returns any JSON value.
      </Callout>

      <div className="ub-pn-row ub-pn-row--end">
        {confirm === 'delete' ? (
          <Callout tone="warning" icon={<TriangleAlert size={14} aria-hidden />} role="alert">
            Delete <strong>{fn.uid}</strong>?{' '}
            {usages.length > 0 ? `It is used in ${usages.length} place${usages.length === 1 ? '' : 's'}; those will stop working.` : ''}
            <div className="ub-pn-row ub-pn-row--end">
              <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  useEditor.getState().removeFunction(fn.id);
                  toast(`Deleted function “${fn.uid}”`);
                  onDeleted();
                }}
              >
                Delete function
              </Button>
            </div>
          </Callout>
        ) : (
          <Button size="sm" variant="ghost" className="ub-pn-danger-btn" icon={<Trash2 size={13} aria-hidden />} onClick={() => setConfirm('delete')}>
            Delete function
          </Button>
        )}
      </div>
    </div>
  );
}
