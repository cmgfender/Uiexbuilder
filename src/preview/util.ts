import { useEffect, useState } from 'react';

/** Joins class names, skipping falsy values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

const SPACE: Record<string, string> = {
  flush: 'var(--hsp-space-flush)',
  xs: 'var(--hsp-space-xs)',
  'extra-small': 'var(--hsp-space-xs)',
  sm: 'var(--hsp-space-sm)',
  small: 'var(--hsp-space-sm)',
  md: 'var(--hsp-space-md)',
  medium: 'var(--hsp-space-md)',
  lg: 'var(--hsp-space-lg)',
  large: 'var(--hsp-space-lg)',
  xl: 'var(--hsp-space-xl)',
  'extra-large': 'var(--hsp-space-xl)',
};

/** Maps a HubSpot distance token ('flush' | 'xs' | 'extra-small' | ...) to a CSS length. */
export function space(token: unknown, fallback = 'var(--hsp-space-flush)'): string {
  return typeof token === 'string' && SPACE[token] ? SPACE[token] : fallback;
}

/** Normalises size aliases: 'xs' -> 'extra-small', 'sm' -> 'small', ... */
export function normalizeSize(size: unknown, fallback = 'medium'): string {
  const map: Record<string, string> = { xs: 'extra-small', sm: 'small', md: 'medium', lg: 'large', xl: 'extra-large' };
  if (typeof size !== 'string') return fallback;
  return map[size] ?? size;
}

/**
 * Value state for preview inputs: controlled when `value` is provided (bound to state or an
 * expression), otherwise local state seeded from `defaultValue`.
 */
export function usePreviewValue<T>(value: T | undefined, defaultValue: T | undefined, empty: T): [T, (v: T) => void] {
  const controlled = value !== undefined;
  const [local, setLocal] = useState<T>(defaultValue ?? empty);
  useEffect(() => {
    if (!controlled && defaultValue !== undefined) setLocal(defaultValue);
  }, [controlled, defaultValue]);
  return [controlled ? (value as T) : local, (v: T) => setLocal(v)];
}

/** Coerces unknown to a display string for previews. */
export function str(v: unknown): string {
  if (v === null || v === undefined || typeof v === 'boolean') return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Resolves a HubSpot HrefProp (string | { url, external }) to a URL string. */
export function hrefUrl(href: unknown): string | undefined {
  if (typeof href === 'string') return href;
  if (href && typeof href === 'object' && typeof (href as { url?: unknown }).url === 'string') {
    return (href as { url: string }).url;
  }
  return undefined;
}
