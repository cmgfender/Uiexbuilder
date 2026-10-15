/**
 * Code generation public API.
 *
 * generateExtensionSource(project, ext) -> TSX source of one extension (card/settings/home)
 * generateNodeJsx(project, ext, nodeId) -> JSX of one node subtree as it appears in that source
 * generateProjectFiles(project)          -> every file of the HubSpot project (paths relative to project root)
 * buildProjectZip(project)               -> zip Blob of generateProjectFiles (includes the builder document)
 * deriveRequirements(project)            -> scopes / permitted URLs the extensions need
 * formatSource(code, filePath)           -> prettier-formatted code (lazy-loaded), for export / code view
 */
export { generateExtensionSource, generateNodeJsx } from './extension';
export { generateProjectFiles, planExtensionFiles, type GeneratedFile, type ExtensionFiles } from './project';
export { buildProjectZip, formattedProjectFiles, zipRootFolder, type ZipOptions } from './zip';
export { deriveRequirements, scopeForObjectType, staticOrigin, type ProjectRequirements } from './requirements';
export { formatSource, parserForPath } from './format';
