/**
 * Registry aggregator. Each group module exports a ComponentDef[]; this file merges them and
 * offers lookups. Do not import UI code here beyond the group modules.
 */
import type { ComponentCategory, ComponentDef } from './types';
import { CATEGORY_ORDER } from './types';
import { layoutComponents } from './components/layout';
import { textComponents } from './components/text';
import { buttonComponents } from './components/buttons';
import { inputComponents } from './components/inputs';
import { dataDisplayComponents } from './components/dataDisplay';
import { overlayChartComponents } from './components/overlaysCharts';
import { crmComponents } from './components/crm';

export const ALL_COMPONENTS: ComponentDef[] = [
  ...layoutComponents,
  ...textComponents,
  ...buttonComponents,
  ...inputComponents,
  ...dataDisplayComponents,
  ...overlayChartComponents,
  ...crmComponents,
];

const BY_TYPE = new Map<string, ComponentDef>();
for (const def of ALL_COMPONENTS) {
  if (BY_TYPE.has(def.type)) {
    // Duplicate registrations are a programming error; surface loudly in dev and tests.
    throw new Error(`Duplicate component registration: ${def.type}`);
  }
  BY_TYPE.set(def.type, def);
}

export function getComponent(type: string): ComponentDef | undefined {
  return BY_TYPE.get(type);
}

export function requireComponent(type: string): ComponentDef {
  const def = BY_TYPE.get(type);
  if (!def) throw new Error(`Unknown component type: ${type}`);
  return def;
}

export function listComponents(): ComponentDef[] {
  return ALL_COMPONENTS;
}

export function componentsByCategory(): Array<{ category: ComponentCategory; components: ComponentDef[] }> {
  return CATEGORY_ORDER.map((category) => ({
    category,
    components: ALL_COMPONENTS.filter((c) => c.category === category),
  })).filter((g) => g.components.length > 0);
}

export type { ComponentDef } from './types';
