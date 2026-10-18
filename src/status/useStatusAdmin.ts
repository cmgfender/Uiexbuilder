/**
 * Whether the signed-in person may open the status page (for a "Status page" link in the account
 * menu). Asks the connector once per signed-in account; false while unknown, signed out, or when
 * the builder has no connector.
 */
import { useEffect, useState } from 'react';
import { getConnectorClient } from '../connect/client';
import { useConnection } from '../connect/store';
import { fetchAdminAccess } from './api';

const known = new Map<string, boolean>();

export function useStatusAdmin(): boolean {
  const info = useConnection((s) => s.info);
  const key = info.connected ? `${info.portalId}:${info.user.email}` : '';
  const [admin, setAdmin] = useState(() => (key ? (known.get(key) ?? false) : false));

  useEffect(() => {
    if (!key || getConnectorClient().disabled) {
      setAdmin(false);
      return;
    }
    if (known.has(key)) {
      setAdmin(known.get(key)!);
      return;
    }
    const controller = new AbortController();
    fetchAdminAccess(controller.signal)
      .then((access) => {
        known.set(key, access.admin);
        setAdmin(access.admin);
      })
      .catch(() => setAdmin(false));
    return () => controller.abort();
  }, [key]);

  return admin;
}

/** Test helper. */
export function resetStatusAdminForTests(): void {
  known.clear();
}
