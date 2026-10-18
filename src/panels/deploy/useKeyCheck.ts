/**
 * Checks the pasted personal access key with HubSpot BEFORE anything is uploaded
 * (POST /api/deploy/check-key): which account it belongs to, whether it has the "Developer
 * projects" permission, whether publishing can go there. A key that looks complete is checked by
 * itself shortly after it is pasted; Publish checks it first if that hasn't happened yet, and the
 * problem callout's "Check again" re-checks the same key after a fix in HubSpot.
 *
 * Without a check endpoint (an older connector, test doubles without `checkKey`) the state is
 * 'unavailable' and publishing goes ahead: the deploy itself still checks the key.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DeployKeyCheck } from '../../connect/types';
import { DeployClientError, type DeployClient } from './client';
import { looksLikePrivateAppToken } from './model';
import type { DeployFormError } from './useDeployJob';

/** Wait this long after the last change of the key before checking it by itself. */
export const KEY_CHECK_DEBOUNCE_MS = 700;

export type KeyCheckState =
  | { kind: 'idle' }
  /** `previous`: the last verdict for this same key, kept on screen while checking again. */
  | { kind: 'checking'; key: string; previous?: KeyCheckState }
  | { kind: 'done'; key: string; result: DeployKeyCheck }
  /** The key itself (invalid_key, missing_key …) or who may publish (not_connected …). */
  | { kind: 'error'; key: string; error: DeployFormError }
  /** No check endpoint here: the deploy checks the key itself. */
  | { kind: 'unavailable'; key: string };

/** Worth checking without a click: long enough, no spaces, not a private app token (that hint shows right away). */
export function keyLooksComplete(key: string): boolean {
  const k = key.trim();
  return k.length >= 20 && k.length <= 4096 && !/\s/.test(k) && !looksLikePrivateAppToken(k);
}

/** Codes meaning "this connector has no key check" (older server): publish without it. */
function noCheckEndpoint(err: DeployClientError): boolean {
  return (err.status === 404 && err.code === 'not_found') || err.status === 405 || err.code === 'method_not_allowed';
}

export interface KeyCheck {
  state: KeyCheckState;
  /** Check the current key now (resolves with the final state; never rejects). */
  check: () => Promise<KeyCheckState>;
  /** The latest state for exactly this key, or null (a result for an older key doesn't count). */
  resultFor: (key: string) => KeyCheckState | null;
}

export function useKeyCheck(client: DeployClient, key: string, opts: { portalId?: number; debounceMs?: number } = {}): KeyCheck {
  const [state, setState] = useState<KeyCheckState>({ kind: 'idle' });
  const stateRef = useRef<KeyCheckState>(state);
  const keyRef = useRef(key.trim());
  keyRef.current = key.trim();
  const seq = useRef(0);
  const portalId = opts.portalId;
  const debounceMs = opts.debounceMs ?? KEY_CHECK_DEBOUNCE_MS;

  const set = useCallback((next: KeyCheckState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const run = useCallback(
    async (k: string): Promise<KeyCheckState> => {
      if (!client.checkKey) {
        const s: KeyCheckState = { kind: 'unavailable', key: k };
        set(s);
        return s;
      }
      const id = ++seq.current;
      const before = stateRef.current;
      const previous = before.kind === 'checking' ? before.previous : before.kind !== 'idle' && before.key === k ? before : undefined;
      set({ kind: 'checking', key: k, ...(previous ? { previous } : {}) });
      let next: KeyCheckState;
      try {
        const result = await client.checkKey({ personalAccessKey: k, ...(portalId !== undefined ? { portalId } : {}) });
        next = { kind: 'done', key: k, result };
      } catch (err) {
        if (err instanceof DeployClientError && noCheckEndpoint(err)) next = { kind: 'unavailable', key: k };
        else if (err instanceof DeployClientError) {
          next = { kind: 'error', key: k, error: { code: err.code, message: err.message, ...(err.portalId !== undefined ? { portalId: err.portalId } : {}), ...(err.key ? { key: err.key } : {}) } };
        } else next = { kind: 'error', key: k, error: { code: 'error', message: err instanceof Error ? err.message : String(err) } };
      }
      // A newer check (or a newer key) wins.
      if (id === seq.current && keyRef.current === k) set(next);
      return next;
    },
    [client, portalId, set],
  );

  // A changed key forgets the old result; a complete-looking key is checked by itself shortly after.
  useEffect(() => {
    const k = key.trim();
    const current = stateRef.current;
    if (current.kind !== 'idle' && current.key !== k) {
      seq.current += 1;
      set({ kind: 'idle' });
    }
    if (!keyLooksComplete(k) || !client.checkKey) return;
    const latest = stateRef.current;
    if (latest.kind !== 'idle' && latest.key === k) return;
    const t = setTimeout(() => void run(k), debounceMs);
    return () => clearTimeout(t);
  }, [key, client, debounceMs, run, set]);

  const check = useCallback(() => run(keyRef.current), [run]);
  const resultFor = useCallback((k: string) => {
    const s = stateRef.current;
    return s.kind !== 'idle' && s.key === k.trim() ? s : null;
  }, []);

  return { state, check, resultFor };
}
