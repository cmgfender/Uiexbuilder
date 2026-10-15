/**
 * Object type select: HubSpot's standard objects plus, when an account is connected, its custom
 * objects (label + id). Any other type id / name can still be typed ("Other object…").
 *
 * `valueKind` decides what is stored: the object type id ('0-1', '2-1234567' — data sources, CRM
 * component props) or the name ('contacts', 'p_projects' — card object types).
 */
import { useId } from 'react';
import { Field, TextInput, cx } from '../ui';
import { findObjectTypeOption, usePortalObjectTypes, type ObjectTypeOption } from './portal';

const OTHER = '__other__';
const UNSET = '__unset__';

export interface ObjectTypeSelectProps {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name of the select. */
  label: string;
  /** Store ids (default) or names. */
  valueKind?: 'id' | 'name';
  /** Offer an empty choice with this label (optional props), e.g. "Current record". */
  emptyLabel?: string;
  id?: string;
  className?: string;
}

function optionValue(o: ObjectTypeOption, kind: 'id' | 'name'): string {
  return kind === 'id' ? o.id : o.name;
}

export function ObjectTypeSelect({ value, onChange, label, valueKind = 'id', emptyLabel, id, className }: ObjectTypeSelectProps) {
  const { options, connected, loading } = usePortalObjectTypes();
  const known = findObjectTypeOption(options, value);
  const trimmed = (value ?? '').trim();
  const selectValue = known ? optionValue(known, valueKind) : trimmed === '' && emptyLabel !== undefined ? UNSET : OTHER;
  const otherId = useId();
  const standard = options.filter((o) => !o.custom);
  const custom = options.filter((o) => o.custom);
  return (
    <div className={cx('ub-pn-stack', className)}>
      <select
        id={id}
        className="ub-select"
        aria-label={label}
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === UNSET) onChange('');
          else if (v === OTHER) onChange(known ? '' : value);
          else onChange(v);
        }}
      >
        {emptyLabel !== undefined && <option value={UNSET}>{emptyLabel}</option>}
        <optgroup label="Standard objects">
          {standard.map((o) => (
            <option key={o.id} value={optionValue(o, valueKind)}>
              {o.label} ({valueKind === 'id' ? o.id : o.name})
            </option>
          ))}
        </optgroup>
        {custom.length > 0 && (
          <optgroup label="Your custom objects">
            {custom.map((o) => (
              <option key={o.id} value={optionValue(o, valueKind)}>
                {o.label} ({valueKind === 'id' ? o.id : o.name})
              </option>
            ))}
          </optgroup>
        )}
        <option value={OTHER}>{connected ? 'Other object…' : 'Custom object…'}</option>
      </select>
      {selectValue === OTHER && (
        <Field
          htmlFor={otherId}
          hint={
            connected
              ? loading
                ? 'Loading your custom objects…'
                : 'Object type id (e.g. 2-1234567) or name (p_my_object).'
              : 'Custom object type id (e.g. 2-1234567) or fully qualified name (p_my_object). Connect HubSpot to pick from your custom objects.'
          }
        >
          <TextInput id={otherId} code value={value} placeholder="2-1234567" aria-label={`${label} (id or name)`} onChange={onChange} />
        </Field>
      )}
    </div>
  );
}
