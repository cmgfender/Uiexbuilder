/**
 * Terminal-free deploy routes (beta) — see server/core/deploy/job.ts.
 *
 *   POST   /api/deploy             DeployRequest → DeployStatus (phase "building"; upload done)
 *   GET    /api/deploy/key         → DeployKeyInfo (is a personal access key remembered?)
 *   DELETE /api/deploy/key         forget the remembered key → DeployKeyInfo
 *   GET    /api/deploy/:deployId   advance the job one step → DeployStatus (poll with the NEW deployId)
 *
 * All routes require the CSRF header (Route default). The connector answers 404 feature_disabled
 * for all of them when ENABLE_DEPLOY is false.
 */
import { CONNECTOR_ROUTES, type ConnectorErrorBody, type DeployKeyInfo } from '../../../src/connect/types';
import type { RequestContext, Route } from '../types';
import { json, readJsonBody } from '../http';
import { DEPLOY_LIMITS } from '../deploy/paths';
import { PortalMismatchError, advanceDeploy, startDeploy } from '../deploy/job';

async function keyInfo(ctx: RequestContext): Promise<DeployKeyInfo> {
  const data = await ctx.session.get().catch(() => null);
  return data?.personalAccessKey ? { remembered: true, portalId: data.portalId } : { remembered: false };
}

function portalMismatch(err: PortalMismatchError): Response {
  const body: ConnectorErrorBody = { error: { code: err.code, message: err.message, status: err.status, portalId: err.keyPortalId } };
  return json(body, err.status);
}

export const deployRoutes: Route[] = [
  {
    method: 'POST',
    path: CONNECTOR_ROUTES.deployStart,
    handler: async (ctx) => {
      const body = await readJsonBody(ctx.request, DEPLOY_LIMITS.maxBodyBytes);
      try {
        const { status } = await startDeploy(ctx.config, ctx.session, body);
        return json(status);
      } catch (err) {
        if (err instanceof PortalMismatchError) return portalMismatch(err);
        throw err;
      }
    },
  },
  {
    method: 'GET',
    path: CONNECTOR_ROUTES.deployKey,
    handler: async (ctx) => json(await keyInfo(ctx)),
  },
  {
    method: 'DELETE',
    path: CONNECTOR_ROUTES.deployKey,
    handler: async (ctx) => {
      const data = await ctx.session.get().catch(() => null);
      if (data?.personalAccessKey) {
        const rest = { ...data };
        delete rest.personalAccessKey;
        await ctx.session.set(rest);
      }
      return json({ remembered: false } satisfies DeployKeyInfo);
    },
  },
  {
    method: 'GET',
    path: CONNECTOR_ROUTES.deployStatus,
    handler: async (ctx) => {
      const { status } = await advanceDeploy(ctx.config, ctx.session, ctx.params.deployId ?? '');
      return json(status);
    },
  },
];
