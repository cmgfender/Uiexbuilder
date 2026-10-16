/** Help links shown by the connection UI. */
import { getConnectorClient } from '../client';
import type { ConnectionInfo } from '../types';
import { hubspotAppOrigin } from '../store';

/** Hosting guide (for whoever puts the builder online and sets up HubSpot sign-in). */
export const HOSTING_DOCS_URL = 'https://github.com/cmgfender/Uiexbuilder/blob/HEAD/docs/HOSTING.md';

/** The connector's setup checklist page (served next to the builder). */
export function setupPageUrl(): string {
  return `${getConnectorClient().baseUrl}/setup.html`;
}

/** HubSpot's own page listing connected apps (where access can be removed). Links use HUBSPOT_APP_BASE when the server set one (EU, demo). */
export function connectedAppsUrl(info: Extract<ConnectionInfo, { connected: true }>): string {
  return `${hubspotAppOrigin(info.appHost)}/integrations-settings/${info.portalId}/installed`;
}

/** A link into the connected HubSpot account. */
export function portalHomeUrl(info: Extract<ConnectionInfo, { connected: true }>): string {
  return `${hubspotAppOrigin(info.appHost)}/contacts/${info.portalId}`;
}

/** Deep link to a record when the connector did not send one. */
export function recordUrl(info: Extract<ConnectionInfo, { connected: true }>, objectTypeId: string, id: string): string {
  return `${hubspotAppOrigin(info.appHost)}/contacts/${info.portalId}/record/${encodeURIComponent(objectTypeId)}/${encodeURIComponent(id)}`;
}
