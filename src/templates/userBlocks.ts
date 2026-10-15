/**
 * User block library ("Save as block"): reusable snippets saved to localStorage (per browser).
 * Storage access is wrapped so the library keeps working in memory when storage is unavailable,
 * entries are sanitised on load (hand-edited or older data never breaks the panel) and other tabs'
 * changes are picked up through the `storage` event.
 */
import { useSyncExternalStore } from 'react';
import { newId } from '../model/ids';
import type { NodeTemplate, StateVar } from '../model/types';

export interface UserBlock {
  id: string;
  name: string;
  template: NodeTemplate;
  state?: Array<Omit<StateVar, 'id'>>;
  createdAt: string;
}

const KEY = 'uiex-builder:user-blocks';
const listeners = new Set<() => void>();
let cache: UserBlock[] | null = null;
let storageListening = false;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Keeps only well-formed blocks. */
function sanitize(raw: unknown): UserBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: UserBlock[] = [];
  for (const b of raw) {
    if (!isRecord(b) || typeof b.id !== 'string' || !isRecord(b.template) || typeof b.template.type !== 'string') continue;
    out.push({
      id: b.id,
      name: typeof b.name === 'string' && b.name.trim() ? b.name : 'Untitled block',
      template: b.template as unknown as NodeTemplate,
      ...(Array.isArray(b.state) ? { state: (b.state as unknown[]).filter((s) => isRecord(s) && typeof s.name === 'string') as Array<Omit<StateVar, 'id'>> } : {}),
      createdAt: typeof b.createdAt === 'string' ? b.createdAt : new Date(0).toISOString(),
    });
  }
  return out;
}

function read(): UserBlock[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? sanitize(JSON.parse(raw)) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function notify(): void {
  listeners.forEach((l) => l());
}

function write(blocks: UserBlock[]): void {
  cache = blocks;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(blocks));
  } catch {
    /* storage unavailable: keep in memory */
  }
  notify();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function listUserBlocks(): UserBlock[] {
  return read();
}

export function saveUserBlock(name: string, template: NodeTemplate, state?: Array<Omit<StateVar, 'id'>>): UserBlock {
  const block: UserBlock = {
    id: newId('n'),
    name: name.trim() || 'Untitled block',
    template: clone(template),
    ...(state && state.length ? { state: clone(state) } : {}),
    createdAt: new Date().toISOString(),
  };
  write([block, ...read()]);
  return block;
}

export function renameUserBlock(id: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  write(read().map((b) => (b.id === id ? { ...b, name: trimmed } : b)));
}

export function deleteUserBlock(id: string): void {
  write(read().filter((b) => b.id !== id));
}

/** Re-reads the library from storage (e.g. after another tab changed it). */
export function reloadUserBlocks(): void {
  cache = null;
  notify();
}

function onStorage(e: StorageEvent): void {
  if (e.key === null || e.key === KEY) reloadUserBlocks();
}

export function useUserBlocks(): UserBlock[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      if (!storageListening && typeof window !== 'undefined') {
        window.addEventListener('storage', onStorage);
        storageListening = true;
      }
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0 && storageListening) {
          window.removeEventListener('storage', onStorage);
          storageListening = false;
        }
      };
    },
    read,
    read,
  );
}
