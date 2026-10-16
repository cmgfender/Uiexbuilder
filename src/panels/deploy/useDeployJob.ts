/**
 * Deploy job state for the panel: POST /api/deploy, then poll POST /api/deploy/status every
 * `pollIntervalMs` (1.5 s) with the deployId of the latest answer until success / failed.
 * Polling stops when the component unmounts (the deploy itself keeps running in HubSpot).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeployRequest, DeployStatus } from '../../connect/types';
import { DeployClientError, isTransientDeployError, type DeployClient } from './client';
import { ACCOUNT_ERROR_CODES, KEY_ERROR_CODES, stepIndex } from './model';

export const DEPLOY_POLL_INTERVAL_MS = 1500;
/** Consecutive failed polls (network / 5xx) before the panel gives up. */
export const MAX_POLL_FAILURES = 5;

export type DeployJobState =
  | { kind: 'idle' }
  /** status null while the upload (POST) is in flight. */
  | { kind: 'running'; status: DeployStatus | null }
  | { kind: 'success'; status: DeployStatus }
  | { kind: 'failed'; status: DeployStatus | null; code: string; message: string; log: string[]; failedStep: number };

export interface DeployFormError {
  code: string;
  message: string;
  /** For 'portal_mismatch': the account the key belongs to. */
  portalId?: number;
}

export interface DeployJob {
  state: DeployJobState;
  /** Problems with the key / target account, shown on the form. */
  formError: DeployFormError | null;
  start(request: DeployRequest): Promise<void>;
  reset(): void;
  clearFormError(): void;
}

function messageOf(err: unknown): { code: string; message: string; portalId?: number } {
  if (err instanceof DeployClientError) return { code: err.code, message: err.message, portalId: err.portalId };
  return { code: 'error', message: err instanceof Error ? err.message : String(err) };
}

export function useDeployJob(client: DeployClient, pollIntervalMs = DEPLOY_POLL_INTERVAL_MS): DeployJob {
  const [state, setState] = useState<DeployJobState>({ kind: 'idle' });
  const [formError, setFormError] = useState<DeployFormError | null>(null);
  /** Bumped on start / reset / unmount so stale async work is ignored. */
  const run = useRef(0);
  const failures = useRef(0);

  useEffect(
    () => () => {
      run.current += 1;
    },
    [],
  );

  const start = useCallback(
    async (request: DeployRequest) => {
      const id = ++run.current;
      failures.current = 0;
      setFormError(null);
      setState({ kind: 'running', status: null });
      try {
        const status = await client.start(request);
        if (run.current !== id) return;
        if (status.phase === 'success') setState({ kind: 'success', status });
        else if (status.phase === 'failed') {
          setState({ kind: 'failed', status, code: status.error ?? 'deploy_failed', message: status.message, log: status.log, failedStep: 0 });
        } else setState({ kind: 'running', status });
      } catch (err) {
        if (run.current !== id) return;
        const e = messageOf(err);
        if (KEY_ERROR_CODES.has(e.code) || ACCOUNT_ERROR_CODES.has(e.code) || e.code === 'portal_mismatch') {
          setFormError(e);
          setState({ kind: 'idle' });
        } else {
          setState({ kind: 'failed', status: null, code: e.code, message: e.message, log: [], failedStep: 0 });
        }
      }
    },
    [client],
  );

  // Poll while running with a known deployId.
  const running = state.kind === 'running' ? state.status : null;
  useEffect(() => {
    if (!running) return;
    const id = run.current;
    const timer = setTimeout(async () => {
      try {
        const next = await client.status(running.deployId);
        if (run.current !== id) return;
        failures.current = 0;
        if (next.phase === 'success') setState({ kind: 'success', status: next });
        else if (next.phase === 'failed') {
          setState({ kind: 'failed', status: next, code: next.error ?? 'deploy_failed', message: next.message, log: next.log, failedStep: stepIndex(running.phase) });
        } else setState({ kind: 'running', status: next });
      } catch (err) {
        if (run.current !== id) return;
        failures.current += 1;
        if (isTransientDeployError(err) && failures.current < MAX_POLL_FAILURES) {
          // Same status object identity would not re-trigger the effect; copy it to poll again.
          setState({ kind: 'running', status: { ...running } });
          return;
        }
        const e = messageOf(err);
        setState({
          kind: 'failed',
          status: running,
          code: e.code,
          message: isTransientDeployError(err)
            ? "Lost contact while following the deploy. It may still finish in HubSpot — open the project there to check."
            : e.message,
          log: running.log,
          failedStep: stepIndex(running.phase),
        });
      }
    }, pollIntervalMs);
    return () => clearTimeout(timer);
  }, [running, client, pollIntervalMs]);

  const reset = useCallback(() => {
    run.current += 1;
    setState({ kind: 'idle' });
    setFormError(null);
  }, []);

  const clearFormError = useCallback(() => setFormError(null), []);

  return { state, formError, start, reset, clearFormError };
}
