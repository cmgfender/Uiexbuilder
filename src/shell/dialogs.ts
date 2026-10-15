/**
 * Which modal dialog is open. Dialog components live in src/panels (and src/templates for the
 * new-project dialog); the shell mounts them all and they render only when open.
 */
import { create } from 'zustand';

export type DialogName =
  | 'appSettings' // App settings: name, uid, distribution, auth, scopes, permitted URLs, support
  | 'extensionSettings' // Manage extensions: add/rename/remove cards, settings page, app home
  | 'functions' // App functions editor
  | 'export' // Export / deploy: file tree, download zip, instructions
  | 'newProject' // New project wizard (templates)
  | 'projects' // Open saved projects / import / delete
  | 'shortcuts'; // Keyboard shortcuts help

interface DialogState {
  current: DialogName | null;
  /** Optional argument (e.g. an extension id or function id to focus). */
  arg: string | null;
  open: (name: DialogName, arg?: string) => void;
  close: () => void;
}

export const useDialogs = create<DialogState>()((set) => ({
  current: null,
  arg: null,
  open: (current, arg) => set({ current, arg: arg ?? null }),
  close: () => set({ current: null, arg: null }),
}));
