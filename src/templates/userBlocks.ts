/**
 * User block library ("Save as block"): reusable snippets saved to localStorage.
 * STUB with working basic behaviour — the templates module may extend it (keep signatures).
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

function read(): UserBlock[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as UserBlock[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(blocks: UserBlock[]): void {
  cache = blocks;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(blocks));
  } catch {
    /* storage unavailable: keep in memory */
  }
  listeners.forEach((l) => l());
}

export function listUserBlocks(): UserBlock[] {
  return read();
}

export function saveUserBlock(name: string, template: NodeTemplate, state?: Array<Omit<StateVar, 'id'>>): UserBlock {
  const block: UserBlock = { id: newId('n'), name, template, state, createdAt: new Date().toISOString() };
  write([block, ...read()]);
  return block;
}

export function renameUserBlock(id: string, name: string): void {
  write(read().map((b) => (b.id === id ? { ...b, name } : b)));
}

export function deleteUserBlock(id: string): void {
  write(read().filter((b) => b.id !== id));
}

export function useUserBlocks(): UserBlock[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    read,
  );
}
