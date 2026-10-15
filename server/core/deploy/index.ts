/**
 * Terminal-free deploy (beta): upload a generated project to HubSpot with a personal access key,
 * exactly like `hs project upload` — see job.ts for the flow and api.ts / ir.ts for the HubSpot
 * CLI behaviour it re-implements.
 */
export { createZip, readStoredZip, crc32, type ZipEntry } from './zip';
export { DEPLOY_LIMITS, filePathProblem, isIgnoredOnUpload, readProjectConfig, uploadSourceFiles, validateDeployFiles, type DeployFile } from './paths';
export {
  translateProject,
  mapToInternalType,
  mapToUserFacingType,
  meetsMinimumPlatformVersion,
  isLegacyPlatformVersion,
  SERVERLESS_PACKAGE_UID,
  type IntermediateRepresentation,
  type IntermediateRepresentationNode,
} from './ir';
export { DeployApiError, DeployHubSpotClient, exchangePersonalAccessKey, mapDeployError, projectsApi, type PersonalAccessKeyToken } from './api';
export {
  advanceDeploy,
  startDeploy,
  sealJob,
  unsealJob,
  toStatus,
  projectUrl,
  PortalMismatchError,
  MAX_BUILD_POLLS,
  MAX_DEPLOY_POLLS,
  AUTODEPLOY_WAIT_POLLS,
  MAX_TRANSIENT_ERRORS,
  type JobState,
  type JobStep,
} from './job';
