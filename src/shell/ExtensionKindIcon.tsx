import { House, LayoutPanelTop, Settings } from 'lucide-react';
import type { ExtensionKind } from '../model/types';

/** Icon for an extension kind (card / settings page / app home). */
export function ExtensionKindIcon({ kind, size = 14, className }: { kind: ExtensionKind; size?: number; className?: string }) {
  const Icon = kind === 'settings' ? Settings : kind === 'home' ? House : LayoutPanelTop;
  return <Icon size={size} className={className} aria-hidden />;
}
