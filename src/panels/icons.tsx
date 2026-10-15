/** Small icon helpers shared by the panels module. */
import { House, LayoutPanelTop, Settings } from 'lucide-react';
import type { ExtensionKind } from '../model/types';

export function ExtensionIcon({ kind, size = 14, className }: { kind: ExtensionKind; size?: number; className?: string }) {
  const Icon = kind === 'settings' ? Settings : kind === 'home' ? House : LayoutPanelTop;
  return <Icon size={size} className={className} aria-hidden />;
}

export const EXTENSION_KIND_LABEL: Record<ExtensionKind, string> = {
  card: 'App card',
  settings: 'Settings page',
  home: 'App home page',
};
