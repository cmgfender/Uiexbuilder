/**
 * Fake HubSpot developer-project endpoints (personal-access-key exchange, project upload, build and
 * deploy status) for terminal-free deploy tests. STUB — implemented by the deploy module.
 * The main fake handler (./handler.ts) delegates requests whose path starts with one of
 * FAKE_PROJECT_PATH_PREFIXES to handleFakeProjects.
 */
export const FAKE_PROJECT_PATH_PREFIXES = ['/localdevauth/', '/dfs/', '/project-components-external/', '/developer/'];

export interface FakeProjectsState {
  portalId: number;
  /** Personal access keys accepted by the fake (key -> portal id). */
  personalAccessKeys: Map<string, number>;
}

export async function handleFakeProjects(_request: Request, _state: FakeProjectsState): Promise<Response> {
  return new Response(JSON.stringify({ message: 'fake project endpoints not implemented' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}
