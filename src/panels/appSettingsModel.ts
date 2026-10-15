/** App settings dialog model: platform versions and argument -> tab mapping. */
import type { PlatformVersion } from '../model/types';

export type AppSettingsTab = 'general' | 'auth' | 'urls' | 'support';

export const PLATFORM_VERSIONS: Array<{ value: PlatformVersion; label: string }> = [
  { value: '2025.2', label: '2025.2' },
  { value: '2026.03', label: '2026.03 (default, recommended)' },
  { value: '2026.09', label: '2026.09' },
];

/**
 * Tab to show for a dialog argument: a tab name ('general', 'auth' | 'scopes', 'urls', 'support')
 * or an issue field such as 'app.requiredScopes', 'app.permittedUrls.fetch', 'app.support.supportEmail'.
 */
export function tabFromArg(arg: string | null | undefined): AppSettingsTab {
  const a = (arg ?? '').trim();
  if (a === 'auth' || a === 'scopes') return 'auth';
  if (a === 'urls' || a === 'support' || a === 'general') return a;
  if (/^app\.(requiredScopes|optionalScopes|conditionallyRequiredScopes|scopes|redirectUrls|authType|auth|distribution)/.test(a)) return 'auth';
  if (a.startsWith('app.permittedUrls')) return 'urls';
  if (a.startsWith('app.support')) return 'support';
  return 'general';
}
