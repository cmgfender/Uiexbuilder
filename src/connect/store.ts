/**
 * Connection store. STUB with the final shape — implemented by the connect module.
 */
import { create } from 'zustand';
import type { ConnectionInfo, ConnectorHealth } from './types';

/**
 * 'checking'     – probing /api/health and /api/me on startup
 * 'unavailable'  – no connector server (e.g. static hosting): connecting is not possible here
 * 'not-configured' – server present but OAuth env vars missing
 * 'disconnected' – ready to connect
 * 'connecting'   – OAuth popup open
 * 'connected'
 * 'error'
 */
export type ConnectionStatus = 'checking' | 'unavailable' | 'not-configured' | 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ConnectionState {
  status: ConnectionStatus;
  health: ConnectorHealth | null;
  info: ConnectionInfo;
  error: string | null;
  /** Probe the connector (called once at startup by the shell). */
  init: () => Promise<void>;
  /** Open the HubSpot sign-in popup. Resolves when connected or the popup closes. */
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export const useConnection = create<ConnectionState>()(() => ({
  status: 'unavailable',
  health: null,
  info: { connected: false },
  error: null,
  init: async () => {},
  connect: async () => {},
  disconnect: async () => {},
}));
