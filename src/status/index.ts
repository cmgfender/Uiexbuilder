/**
 * The host's private status page (/status) and the builder's error reporter. The page itself
 * (./StatusPage) is loaded on demand by src/main.tsx and is not re-exported here, so callers that
 * only need the link or the reporter stay light.
 */
export { STATUS_PAGE_PATH, isStatusPath } from './paths';
export { installErrorReporter, reportReactError, reportSignInFeedback } from './reporter';
export { useStatusAdmin } from './useStatusAdmin';
export type { AdminAccess, DiagnosticEvent, DiagnosticsSnapshot, SignInFeedbackKind } from './types';
