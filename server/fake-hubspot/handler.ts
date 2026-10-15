/**
 * In-memory fake of the HubSpot endpoints the connector uses (OAuth authorize/token/token-info,
 * CRM objects/search/associations/properties/schemas/pipelines/owners, and the developer-project
 * endpoints used by terminal-free deploy). Used by unit tests (inject as ServerConfig.fetch) and by
 * the dev/e2e fake server (server/fake-hubspot/server.ts). STUB — implemented by the server-core module.
 */
export interface FakeHubSpot {
  /** Handle a request addressed to the fake API or app host. */
  handle(request: Request): Promise<Response>;
  /** fetch-compatible wrapper (for ServerConfig.fetch). */
  fetch: typeof fetch;
}

export interface FakeHubSpotOptions {
  clientId: string;
  clientSecret: string;
  portalId?: number;
}

export function createFakeHubSpot(_opts: FakeHubSpotOptions): FakeHubSpot {
  throw new Error('fake HubSpot not implemented yet');
}
