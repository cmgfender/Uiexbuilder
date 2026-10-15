/**
 * Light formatting of CRM property values for `formatted=1` (mirrors what HubSpot's
 * `propertiesToFormat` does inside a real card, as closely as a server can without the viewer's
 * locale / time zone):
 *
 * - date      "2025-03-04" or epoch ms        → "Mar 4, 2025"            (UTC calendar date)
 * - datetime  ISO string or epoch ms          → "Mar 4, 2025, 3:05 PM UTC"
 * - number    "1234567.5"                     → "1,234,567.5"            (en-US grouping)
 * - enumeration / bool  "a;b" (option values) → "Label A, Label B"       (labels from the properties API)
 * - everything else is returned unchanged; null stays null.
 */
import type { CrmPropertyDef } from '../../src/connect/types';

const dateFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});
const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });

function toDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = /^-?\d+$/.test(trimmed) ? Number(trimmed) : Date.parse(trimmed);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatPropertyValue(value: string | null, def: CrmPropertyDef | undefined): string | null {
  if (value === null || value === undefined || !def) return value ?? null;
  if (value === '') return value;
  switch (def.type) {
    case 'date': {
      const d = toDate(value);
      return d ? dateFormat.format(d) : value;
    }
    case 'datetime': {
      const d = toDate(value);
      return d ? dateTimeFormat.format(d) : value;
    }
    case 'number': {
      const n = Number(value);
      return value.trim() !== '' && Number.isFinite(n) ? numberFormat.format(n) : value;
    }
    case 'enumeration':
    case 'bool': {
      const options = def.options ?? [];
      const parts = value.split(';').filter((p) => p !== '');
      const labels = parts.map((part) => {
        const opt = options.find((o) => o.value === part);
        if (opt) return opt.label;
        if (def.type === 'bool' || def.fieldType === 'booleancheckbox') {
          if (part === 'true') return 'Yes';
          if (part === 'false') return 'No';
        }
        return part;
      });
      return labels.join(', ');
    }
    default:
      return value;
  }
}

export function formatProperties(properties: Record<string, string | null>, defs: Map<string, CrmPropertyDef>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(properties)) {
    out[name] = formatPropertyValue(value, defs.get(name));
  }
  return out;
}
