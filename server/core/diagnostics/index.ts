/**
 * The private status page's server side: an in-memory event log of sign-ins, publishes, refused
 * API requests and browser errors (resets when the server restarts), `[event]` JSON log lines, and
 * the admin-only routes that show it. See docs/STATUS-PAGE.md.
 */
export { Diagnostics, errorTypeName, publishStage, safeCode } from './observe';
export type { DiagnosticsOptions, ObservedExchange } from './observe';
export { DiagnosticsLog, DIAGNOSTICS_DEFAULTS, emptyCounters, eventLogLine } from './log';
export type { EventInput, DiagnosticsLogOptions } from './log';
export { diagnosticsRoutes, CLIENT_REPORT_RULE, CLIENT_REPORT_GLOBAL_RULE } from './routes';
export type { DiagnosticsRouteDeps } from './routes';
export { adminConfigured, isAdminUser } from './access';
export { VisitorIds, shortHash } from './visitor';
export { cleanClientError, cleanLine, cleanPath, cleanStack, maskSensitive, stripQueryStrings, CLIENT_LIMITS } from './sanitize';
