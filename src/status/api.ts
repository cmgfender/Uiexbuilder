/**
 * Browser calls for the Status page and the error reporter (routes in ./types DIAGNOSTICS_ROUTES).
 * Same conventions as src/connect/client.ts: the connector base URL, the session cookie and the
 * CSRF header; failures become ConnectorError (code 'unavailable' when there is no connector).
 */
import { CSRF_HEADER } from '../connect/types';
import { ConnectorError, getConnectorClient, isAbortError } from '../connect/client';
import { DIAGNOSTICS_ROUTES, type AdminAccess, type ClientReport, type DiagnosticsSnapshot } from './types';

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const client = getConnectorClient();
  if (client.disabled) {
    throw new ConnectorError({ code: 'unavailable', status: 0, message: 'This copy of the builder has no server, so there is nothing to show.' });
  }
  let res: Response;
  try {
    res = await fetch(client.url(path), { credentials: 'include', cache: 'no-store', headers: { [CSRF_HEADER]: '1', Accept: 'application/json' }, signal });
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) throw err;
    throw new ConnectorError({ code: 'network_error', status: 0, message: "Couldn't reach the builder's server. Check your internet connection and try again." });
  }
  const isJson = /[/+]json\b/i.test(res.headers.get('content-type') ?? '');
  if (!isJson) {
    throw new ConnectorError({ code: 'unavailable', status: res.status, message: "The builder's server didn't answer (it may not be running here)." });
  }
  const data = (await res.json()) as unknown;
  if (!res.ok) {
    const e = (data as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    throw new ConnectorError({
      code: typeof e?.code === 'string' ? e.code : `http_${res.status}`,
      status: res.status,
      message: typeof e?.message === 'string' ? e.message : 'The server refused the request.',
    });
  }
  return data as T;
}

/** Who is asking and whether they may see the status page (never any events). */
export function fetchAdminAccess(signal?: AbortSignal): Promise<AdminAccess> {
  return getJson<AdminAccess>(DIAGNOSTICS_ROUTES.access, signal);
}

/** Everything the status page shows (admins only). */
export function fetchDiagnostics(signal?: AbortSignal): Promise<DiagnosticsSnapshot> {
  return getJson<DiagnosticsSnapshot>(DIAGNOSTICS_ROUTES.diagnostics, signal);
}

/** Sends a report; never throws (reports are best effort). `keepalive` lets it finish while the page unloads. */
export async function postReport(report: ClientReport): Promise<boolean> {
  const client = getConnectorClient();
  if (client.disabled) return false;
  try {
    const res = await fetch(client.url(DIAGNOSTICS_ROUTES.report), {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      keepalive: true,
      headers: { [CSRF_HEADER]: '1', 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
    return res.ok;
  } catch {
    return false;
  }
}
