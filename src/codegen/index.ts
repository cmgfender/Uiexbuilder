/**
 * Code generation public API (implementation in this folder).
 *
 * generateExtensionSource(project, ext) -> TSX source of one extension (card/settings/home)
 * generateProjectFiles(project)          -> every file of the HubSpot project (paths relative to project root)
 * buildProjectZip(project)               -> zip Blob of generateProjectFiles + builder document
 */
import type { Extension, Project } from '../model/types';

export interface GeneratedFile {
  /** POSIX path relative to the project root, e.g. "src/app/cards/MyCard.tsx". */
  path: string;
  contents: string;
}

export function generateExtensionSource(_project: Project, _ext: Extension): string {
  throw new Error('codegen not implemented yet');
}

export function generateProjectFiles(_project: Project): GeneratedFile[] {
  throw new Error('codegen not implemented yet');
}

export async function buildProjectZip(_project: Project): Promise<Blob> {
  throw new Error('codegen not implemented yet');
}
