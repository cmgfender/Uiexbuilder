/**
 * Shown above the card while the project's code is paused (an imported, untrusted document — see
 * model/trust.ts): says what does not run, says plainly what trusted code can do (with HubSpot
 * connected: read the connected account's data), and lets the user trust the project. A project
 * trusted before HubSpot was connected is paused again — and asked about again — once it is.
 * Rendered by <ExtensionRenderer> in both modes; it is builder chrome (`data-cv-chrome`), not a
 * component.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { ShieldAlert } from 'lucide-react';
import { codeTrustState, codeTrustVersion, hubSpotAccess, subscribeCodeTrust, trustProject } from '../model/trust';
import type { ActionStep, Extension } from '../model/types';
import { helperNames } from '../power/helpers';
import { collectExtensionCode } from '../codegen/extension';
import { getComponent } from '../registry';
import { useInternalRuntime } from './context';
import { isSafeExpression } from './safeExpression';

function customSteps(steps: ActionStep[] | undefined): number {
  let n = 0;
  for (const s of Array.isArray(steps) ? steps : []) {
    if (!s || typeof s !== 'object') continue;
    if (s.type === 'custom' && s.code?.trim()) n++;
    if (s.type === 'if') n += customSteps(s.then) + customSteps(s.else);
    if (s.type === 'fetch' || s.type === 'runFunction') n += customSteps(s.onSuccess) + customSteps(s.onError);
  }
  return n;
}

/** What is paused in an extension: helper declarations, custom code actions and other code. */
export function pausedCode(ext: Extension, scopeNames: string[]): { helpers: number; custom: number; expressions: number } {
  const helpers = helperNames(ext.helpers).length;
  let custom = 0;
  for (const node of Object.values(ext.nodes ?? {})) for (const steps of Object.values(node.events ?? {})) custom += customSteps(steps);
  const names = new Set([...scopeNames, ...(ext.computed ?? []).map((c) => c.name)]);
  for (const node of Object.values(ext.nodes ?? {})) {
    if (node.repeat) [node.repeat.itemName, node.repeat.indexName].forEach((n) => names.add(n));
    for (const event of getComponent(node.type)?.events ?? []) event.params.forEach((p) => names.add(p.name));
  }
  ['response', 'error'].forEach((n) => names.add(n));
  const expressions = collectExtensionCode(ext).filter((code) => code.trim() && !isSafeExpression(code.trim(), names)).length;
  return { helpers, custom, expressions: Math.max(0, expressions - custom) };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function CodeTrustNotice() {
  const rt = useInternalRuntime('CodeTrustNotice');
  useSyncExternalStore(subscribeCodeTrust, codeTrustVersion, codeTrustVersion);
  const projectId = rt.project.id;
  const state = codeTrustState(projectId);
  const connected = hubSpotAccess();
  const trusted = state === 'trusted';
  const scopeNames = useMemo(() => Object.keys(rt.scope), [rt.scope]);
  const summary = useMemo(() => (trusted ? null : pausedCode(rt.extension, scopeNames)), [trusted, rt.extension, scopeNames]);
  // Nothing is paused (only simple values): no need to interrupt.
  if (trusted || !summary || summary.helpers + summary.custom + summary.expressions === 0) return null;
  const parts = [
    summary.expressions ? plural(summary.expressions, 'expression with code', 'expressions with code') : '',
    summary.helpers ? plural(summary.helpers, 'helper function', 'helper functions') : '',
    summary.custom ? plural(summary.custom, 'custom code action', 'custom code actions') : '',
  ].filter(Boolean);
  const what = parts.length ? ` (${parts.join(', ')})` : '';
  const reconfirm = state === 'needs-hubspot-confirmation';
  return (
    <div className={connected ? 'hsp-rt-trust hsp-rt-trust--hubspot' : 'hsp-rt-trust'} role="region" aria-label="Paused code" data-cv-chrome="">
      <ShieldAlert size={18} aria-hidden="true" className="hsp-rt-trust-icon" />
      <div className="hsp-rt-trust-body">
        <strong>{reconfirm ? 'HubSpot is connected: confirm this imported project’s code' : 'Code in this imported project is paused'}</strong>
        {reconfirm ? (
          <span>
            You trusted this file’s code{what} before connecting HubSpot. Now it would run with your HubSpot connection: it could read the
            contacts, companies, deals and other records your connection can see, and send them to someone else. It stays paused until you
            confirm.
          </span>
        ) : (
          <span>
            It came from a file, so its code does not run until you trust it{what}. Simple values such as {'{{ contact.firstname }}'} still show;
            paused expressions appear as their source text.{' '}
            {connected
              ? 'Trusted code runs inside the builder with your HubSpot connection: it could read the contacts, companies, deals and other records your connection can see, and send them to someone else.'
              : 'Trusted code runs inside the builder. If you connect HubSpot, it could also read your HubSpot data — you’ll be asked again then.'}{' '}
            Only trust files from people you trust.
          </span>
        )}
      </div>
      <button type="button" className="hsp-rt-trust-button" onClick={() => trustProject(projectId)}>
        {connected ? 'Trust it with my HubSpot data' : 'Trust and run code'}
      </button>
    </div>
  );
}
