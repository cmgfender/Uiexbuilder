/**
 * Zip export: every generated project file under a root folder named after the project, ready
 * for `hs project upload`.
 */
import JSZip from 'jszip';
import { toProjectSlug } from '../model/factory';
import type { Project } from '../model/types';
import { formatSource, parserForPath } from './format';
import { generateProjectFiles, type GeneratedFile } from './project';

export interface ZipOptions {
  /**
   * Run prettier over source and config files (default true) so the exported project passes its
   * own `npm run format:check`. The builder document (.uiex.json) is kept as generated.
   */
  format?: boolean;
}

/** Root folder of the zip (the hsproject name, made file-system safe). */
export function zipRootFolder(project: Project): string {
  return toProjectSlug(project.name);
}

/** Generated files, prettier-formatted where a parser exists (except the builder document). */
export async function formattedProjectFiles(project: Project): Promise<GeneratedFile[]> {
  return Promise.all(
    generateProjectFiles(project).map(async (file) =>
      file.path === '.uiex.json' || !parserForPath(file.path)
        ? file
        : { ...file, contents: await formatSource(file.contents, file.path) },
    ),
  );
}

export async function buildProjectZip(project: Project, options: ZipOptions = {}): Promise<Blob> {
  const files = options.format === false ? generateProjectFiles(project) : await formattedProjectFiles(project);
  const zip = new JSZip();
  const root = zip.folder(zipRootFolder(project));
  if (!root) throw new Error('Could not create the project folder in the zip archive');
  for (const file of files) root.file(file.path, file.contents);
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
