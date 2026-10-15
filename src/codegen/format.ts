/**
 * Optional prettier formatting of generated files (export and code view). Prettier and its
 * plugins are loaded lazily so they stay out of the main bundle. Generation already produces
 * clean, consistently indented code; this only normalises it to prettier's exact style.
 */

/** Prettier parser for a file path, or null when the file type is not formatted. */
export function parserForPath(filePath: string): 'typescript' | 'babel' | 'json' | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'babel';
  if (lower.endsWith('.json')) return 'json';
  return null;
}

/**
 * Formats `code` with prettier using the templates' settings (single quotes, 80 columns).
 * Unsupported file types and code that fails to parse are returned unchanged.
 */
export async function formatSource(code: string, filePath: string): Promise<string> {
  const parser = parserForPath(filePath);
  if (!parser) return code;
  try {
    const [prettier, babel, estree, typescript] = await Promise.all([
      import('prettier/standalone'),
      import('prettier/plugins/babel'),
      import('prettier/plugins/estree'),
      import('prettier/plugins/typescript'),
    ]);
    return await prettier.format(code, {
      parser,
      plugins: [babel, estree, typescript],
      singleQuote: parser !== 'json',
      printWidth: 80,
      tabWidth: 2,
    });
  } catch {
    return code;
  }
}
