/**
 * Template catalog contract.
 * - ExtensionTemplate: a complete starter extension (card / settings / home) with state, data
 *   sources and mock data; `build(existing)` returns a fresh Extension (new ids each call).
 * - BlockTemplate: a reusable snippet dropped onto the canvas (DragPayload kind 'template').
 */
import type { LucideIcon } from 'lucide-react';
import type { CardLocation, Extension, ExtensionKind, NodeTemplate, StateVar } from '../model/types';

export interface ExtensionTemplate {
  id: string;
  name: string;
  description: string;
  kind: ExtensionKind;
  location?: CardLocation;
  objectTypes?: string[];
  /** Short tags shown in the gallery, e.g. ['Form', 'Fetch']. */
  tags: string[];
  build: (existing: Extension[]) => Extension;
}

export interface BlockTemplate {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  template: NodeTemplate;
  /** State variables the block needs (added on drop if missing). */
  state?: Array<Omit<StateVar, 'id'>>;
}

export const PROJECT_TEMPLATES: ExtensionTemplate[] = [];
export const BLOCK_TEMPLATES: BlockTemplate[] = [];
