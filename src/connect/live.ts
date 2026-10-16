/**
 * Real HubSpot data for the designer preview: builds the runtime's LiveDataAdapter from the
 * connection, the active extension and its sample record (see LiveDataAdapter in
 * src/runtime/types.ts). Every call goes through the connector (read-only).
 */
import { useEffect, useMemo, useState } from 'react';
import type { LiveDataAdapter } from '../runtime/types';
import type { Extension } from '../model/types';
import { selectActiveExtension, useEditor } from '../model/store';
import type { ConnectionInfo, ConnectorHealth, CrmObjectTypeInfo, CrmOwner, CrmRecordSummary } from './types';
import { getConnectorClient, isAbortError, type ConnectorClient } from './client';
import { canonicalObjectType } from './objectTypes';
import { useConnection } from './store';
import { useLiveData } from './records';

export interface BuildLiveAdapterOptions {
  client?: ConnectorClient;
  /** The signed-in user's name (from the portal's owner list), for `context.user.firstName/lastName`. */
  userName?: { firstName?: string; lastName?: string } | null;
  /** Called with every failure (not aborts), e.g. to show a missing permission. */
  onError?: (err: unknown) => void;
}

/** True when a sample record can preview a card for these object types. */
export function recordFitsCard(record: Pick<CrmRecordSummary, 'objectType' | 'objectTypeId'>, objectTypes: readonly string[], known?: readonly CrmObjectTypeInfo[] | null): boolean {
  if (objectTypes.length === 0) return true;
  const ids = new Set([canonicalObjectType(record.objectTypeId, known), canonicalObjectType(record.objectType, known)]);
  return objectTypes.some((t) => ids.has(canonicalObjectType(t, known)));
}

/**
 * The adapter for the preview, or null when real data can't be used: not connected, or a CRM card
 * without a sample record. Settings pages and app home need no record (context only).
 */
export function buildLiveAdapter(
  connection: { info: ConnectionInfo; health?: ConnectorHealth | null },
  extension: Pick<Extension, 'kind'>,
  record: CrmRecordSummary | null,
  options: BuildLiveAdapterOptions = {},
): LiveDataAdapter | null {
  const info = connection.info;
  if (!info.connected) return null;
  const isCard = extension.kind === 'card';
  if (isCard && (!record || !/^\d{1,20}$/.test(record.id))) return null;
  const client = options.client ?? getConnectorClient();
  const report = <T>(p: Promise<T>): Promise<T> =>
    p.catch((err: unknown) => {
      if (!isAbortError(err)) options.onError?.(err);
      throw err;
    });

  const user: NonNullable<LiveDataAdapter['context']['user']> = info.user.id !== undefined ? { id: info.user.id, email: info.user.email } : { email: info.user.email };
  if (options.userName?.firstName) user.firstName = options.userName.firstName;
  if (options.userName?.lastName) user.lastName = options.userName.lastName;
  const context: LiveDataAdapter['context'] = { portal: { id: info.portalId }, user };
  if (isCard && record) context.crm = { objectId: Number(record.id), objectTypeId: record.objectTypeId };

  const adapter: LiveDataAdapter = {
    key: `${info.portalId}|${isCard && record ? `${record.objectTypeId}:${record.id}` : extension.kind}|live`,
    context,
    getRecordProperties: (objectTypeId, objectId, properties, formatted) =>
      report(client.getRecord(objectTypeId, String(objectId), { properties, formatted }).then((r) => ({ ...(r?.properties ?? {}) }))),
    getAssociations: (objectTypeId, objectId, request) =>
      report(
        client.getAssociations(objectTypeId, String(objectId), request.toObjectType, {
          properties: request.properties,
          limit: request.pageLength,
          formatted: request.formatted,
        }),
      ),
    search: (objectType, request) => report(client.search(objectType, request)),
  };
  if (connection.health?.features?.fetchProxy) {
    adapter.proxyFetch = (request) => report(client.proxyFetch(request));
  }
  return adapter;
}

const OWNERS_SCOPE = 'crm.objects.owners.read';

/** The signed-in user's owner entry: same HubSpot user id, else the same email (case-insensitive). */
export function findOwnerForUser(owners: readonly CrmOwner[], user: { id?: number; email: string }): CrmOwner | null {
  if (user.id !== undefined) {
    const byId = owners.find((o) => o.userId === user.id);
    if (byId) return byId;
  }
  const email = user.email.trim().toLowerCase();
  return (email && owners.find((o) => o.email.trim().toLowerCase() === email)) || null;
}

/**
 * The signed-in user's first and last name for the live preview context. Looked up in the portal's
 * owner list only while live data is on and the owners permission was granted; otherwise null
 * (the context keeps the mock names). Failures are silent: names are a nicety, not data.
 */
function useSignedInUserName(enabled: boolean): { firstName?: string; lastName?: string } | null {
  const portalId = useConnection((s) => (s.info.connected ? s.info.portalId : null));
  const userId = useConnection((s) => (s.info.connected ? s.info.user.id : undefined));
  const userEmail = useConnection((s) => (s.info.connected ? s.info.user.email : ''));
  const canReadOwners = useConnection((s) => s.info.connected && s.info.scopes.includes(OWNERS_SCOPE));
  const active = enabled && canReadOwners && portalId !== null;
  const [found, setFound] = useState<{ key: string; name: { firstName?: string; lastName?: string } | null } | null>(null);
  const key = active ? `${portalId}|${userId ?? ''}|${userEmail}` : null;

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    getConnectorClient()
      .owners({ signal: controller.signal })
      .then(
        (owners) => {
          const owner = Array.isArray(owners) ? findOwnerForUser(owners, { id: userId, email: userEmail }) : null;
          const name = owner && (owner.firstName || owner.lastName) ? { firstName: owner.firstName || undefined, lastName: owner.lastName || undefined } : null;
          setFound({ key, name });
        },
        () => {
          if (!controller.signal.aborted) setFound({ key, name: null });
        },
      );
    return () => controller.abort();
    // `key` covers the portal and the user.
  }, [key]);

  return key && found?.key === key ? found.name : null;
}

/** The active extension's sample record (only when it belongs to the connected portal and fits the card). */
export function useSampleRecord(extension: Pick<Extension, 'id' | 'kind' | 'objectTypes'>): CrmRecordSummary | null {
  const portalId = useConnection((s) => (s.info.connected ? s.info.portalId : null));
  const record = useLiveData((s) => s.recordByExtension[extension.id] ?? null);
  const recordPortal = useLiveData((s) => s.portalByExtension[extension.id]);
  const typesKey = extension.objectTypes.join(',');
  return useMemo(() => {
    if (extension.kind !== 'card' || !record || portalId === null || recordPortal !== portalId) return null;
    const known = getConnectorClient().peek<CrmObjectTypeInfo[]>('objectTypes');
    // typesKey stands for extension.objectTypes (a new array on every edit).
    return recordFitsCard(record, typesKey ? typesKey.split(',') : [], known) ? record : null;
  }, [extension.kind, record, portalId, recordPortal, typesKey]);
}

/**
 * The LiveDataAdapter for the shell's RuntimeProvider: null in mock mode, when disconnected, or
 * when a CRM card has no sample record yet (the record picker then asks for one). Also loads the
 * open project's live-data selection.
 */
export function useLiveAdapter(): LiveDataAdapter | null {
  const projectId = useEditor((s) => s.project.id);
  const extId = useEditor((s) => selectActiveExtension(s).id);
  const kind = useEditor((s) => selectActiveExtension(s).kind);
  const typesKey = useEditor((s) => selectActiveExtension(s).objectTypes.join(','));
  const status = useConnection((s) => s.status);
  const portalId = useConnection((s) => (s.info.connected ? s.info.portalId : null));
  const userId = useConnection((s) => (s.info.connected ? s.info.user.id : undefined));
  const userEmail = useConnection((s) => (s.info.connected ? s.info.user.email : ''));
  const fetchProxy = useConnection((s) => !!s.health?.features?.fetchProxy);
  const loadedProject = useLiveData((s) => s.projectId);
  const mode = useLiveData((s) => s.mode);

  useEffect(() => {
    useLiveData.getState().loadProject(projectId);
  }, [projectId]);

  const objectTypes = useMemo(() => (typesKey ? typesKey.split(',') : []), [typesKey]);
  const record = useSampleRecord({ id: extId, kind, objectTypes });
  const userName = useSignedInUserName(mode === 'live' && status === 'connected');
  const firstName = userName?.firstName;
  const lastName = userName?.lastName;

  // Rebuilt only when what the preview reads changes (not when a label is looked up or the token renews).
  const recordId = record?.id ?? null;
  const recordType = record?.objectType ?? '';
  const recordTypeId = record?.objectTypeId ?? '';
  const adapter = useMemo(() => {
    if (loadedProject !== projectId || mode !== 'live' || status !== 'connected' || portalId === null) return null;
    const info = useConnection.getState().info;
    if (!info.connected) return null;
    const sample: CrmRecordSummary | null = recordId ? { id: recordId, objectType: recordType, objectTypeId: recordTypeId, label: '' } : null;
    return buildLiveAdapter({ info, health: { features: { fetchProxy } } as ConnectorHealth }, { kind }, sample, {
      userName: firstName || lastName ? { firstName, lastName } : null,
      onError: (err) => useLiveData.getState().reportError(err),
    });
    // userId / userEmail: the context reads them from the current info.
  }, [loadedProject, projectId, mode, status, portalId, userId, userEmail, fetchProxy, kind, recordId, recordType, recordTypeId, firstName, lastName]);

  // A new adapter (another record, portal or mode) starts without the previous problem.
  const key = adapter?.key ?? null;
  useEffect(() => {
    useLiveData.getState().clearError();
  }, [key]);

  return adapter;
}
