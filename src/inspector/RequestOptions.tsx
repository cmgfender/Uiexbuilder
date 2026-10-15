/**
 * Request headers and timeout of a hubspot.fetch call — shared by the “Fetch URL” action
 * (ActionList) and External API data sources (panels/data/DataSourceEditors). Collapsed by
 * default (most requests need neither); the summary says how many headers are set.
 */
import { useId, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import type { Extension, NodeId, RequestHeader } from '../model/types';
import { Button, IconButton, NumberField, TextInput } from '../ui';
import { TemplateInput } from './controls';

export interface RequestOptionsProps {
  ext: Extension;
  nodeId?: NodeId | null;
  eventParams?: string[];
  headers: RequestHeader[] | undefined;
  timeout: number | undefined;
  onChange: (patch: { headers?: RequestHeader[]; timeout?: number }) => void;
}

const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export function RequestOptions({ ext, nodeId, eventParams, headers, timeout, onChange }: RequestOptionsProps) {
  const list = Array.isArray(headers) ? headers : [];
  const set = list.filter((h) => h.key.trim()).length;
  const [open, setOpen] = useState(set > 0 || timeout !== undefined);
  const panelId = useId();
  const timeoutId = useId();
  const summary = [set ? `${set} header${set === 1 ? '' : 's'}` : '', timeout !== undefined ? `timeout ${timeout} ms` : ''].filter(Boolean).join(', ');
  const write = (next: RequestHeader[]) => onChange({ headers: next.length ? next : undefined, timeout });
  return (
    <div className="ub-insp-reqopts">
      <button
        type="button"
        className="ub-insp-reqopts__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
        Headers & timeout
        {summary && <span className="ub-insp-reqopts__summary">{summary}</span>}
      </button>
      {open && (
        <div id={panelId} className="ub-insp-reqopts__body">
          {list.map((h, i) => {
            const bad = h.key.trim() && !HEADER_NAME_RE.test(h.key.trim());
            return (
              <div key={i} className="ub-insp-reqopts__row">
                <TextInput
                  value={h.key}
                  placeholder="Header name"
                  aria-label={`Header ${i + 1} name`}
                  invalid={!!bad}
                  title={bad ? 'Header names may only use letters, digits and - _ . ! # $ % & * + ^ ` | ~' : undefined}
                  onChange={(key) => write(list.map((x, j) => (j === i ? { ...x, key } : x)))}
                />
                <TemplateInput
                  value={h.value}
                  onChange={(value) => write(list.map((x, j) => (j === i ? { ...x, value } : x)))}
                  ext={ext}
                  nodeId={nodeId}
                  eventParams={eventParams}
                  placeholder="Value, e.g. Bearer {{ token }}"
                  aria-label={`Value of header ${h.key.trim() || i + 1}`}
                />
                <IconButton label={`Remove header ${h.key.trim() || i + 1}`} size="sm" onClick={() => write(list.filter((_, j) => j !== i))}>
                  <X size={13} aria-hidden />
                </IconButton>
              </div>
            );
          })}
          <Button size="sm" variant="ghost" icon={<Plus size={13} aria-hidden />} onClick={() => write([...list, { key: '', value: '' }])}>
            Add header
          </Button>
          <div className="ub-insp-reqopts__timeout">
            <label htmlFor={timeoutId}>Timeout (ms)</label>
            <NumberField
              id={timeoutId}
              value={timeout}
              min={0}
              step={500}
              placeholder="HubSpot default"
              onChange={(t) => onChange({ headers: list.length ? list : undefined, timeout: t === undefined || t < 0 ? undefined : Math.round(t) })}
            />
          </div>
          <div className="ub-field__hint">Header values may use {'{{ }}'} — keep secrets in app functions, not in cards.</div>
        </div>
      )}
    </div>
  );
}
