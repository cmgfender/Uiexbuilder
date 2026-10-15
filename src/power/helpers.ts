/** Names of top-level `function x(` / `const x =` / `let x =` declarations in helper code. */
export function helperNames(code: string | undefined): string[] {
  if (!code) return [];
  const names = new Set<string>();
  for (const m of code.matchAll(/^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of code.matchAll(/^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/gm)) names.add(m[1]);
  return [...names];
}
