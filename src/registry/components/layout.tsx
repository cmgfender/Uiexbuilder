/**
 * Layout components. See text.tsx for the reference conventions.
 */
import { Columns3 } from 'lucide-react';
import type { ComponentDef, PreviewProps } from '../types';
import { DISTANCE_OPTIONS, FLEX_ALIGN, FLEX_JUSTIFY, STANDARD_DOCS, enumOptions } from '../constants';
import { cx, space } from '../../preview/util';
import '../../preview/styles/layout.css';

const JUSTIFY_CSS: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  around: 'space-around',
  between: 'space-between',
};
const ALIGN_CSS: Record<string, string> = {
  start: 'flex-start',
  center: 'center',
  baseline: 'baseline',
  end: 'flex-end',
  stretch: 'stretch',
};

function FlexPreview({ props, children, rootProps }: PreviewProps) {
  const direction = props.direction === 'column' ? 'column' : 'row';
  const wrap = props.wrap === true || props.wrap === 'wrap';
  return (
    <div
      {...rootProps}
      className={cx('hsp-flex', rootProps.className)}
      style={{
        display: 'flex',
        flexDirection: direction,
        flexWrap: wrap ? 'wrap' : 'nowrap',
        gap: space(props.gap),
        justifyContent: JUSTIFY_CSS[props.justify as string] ?? 'flex-start',
        alignItems: ALIGN_CSS[props.align as string] ?? 'stretch',
        alignSelf: props.alignSelf ? ALIGN_CSS[props.alignSelf as string] : undefined,
      }}
    >
      {children}
    </div>
  );
}

export const layoutComponents: ComponentDef[] = [
  {
    type: 'Flex',
    label: 'Flex',
    category: 'Layout',
    description: 'Arranges child components in a row or column with consistent spacing.',
    icon: Columns3,
    docsUrl: `${STANDARD_DOCS}/flex`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['row', 'column', 'stack', 'container', 'layout'],
    children: { mode: 'nodes', placeholder: 'Drop components here' },
    create: () => ({ type: 'Flex', props: { direction: 'column', gap: 'small' } }),
    props: [
      { name: 'direction', label: 'Direction', type: { kind: 'enum', options: enumOptions('row', 'column') }, defaultValue: 'row', group: 'Layout' },
      { name: 'gap', label: 'Gap', type: { kind: 'enum', options: DISTANCE_OPTIONS }, defaultValue: 'flush', group: 'Layout' },
      { name: 'justify', label: 'Justify', type: { kind: 'enum', options: FLEX_JUSTIFY }, defaultValue: 'start', group: 'Layout' },
      { name: 'align', label: 'Align', type: { kind: 'enum', options: FLEX_ALIGN }, defaultValue: 'stretch', group: 'Layout' },
      { name: 'alignSelf', label: 'Align self', type: { kind: 'enum', options: FLEX_ALIGN }, group: 'Layout' },
      {
        name: 'wrap',
        label: 'Wrap',
        type: { kind: 'enum', options: [{ value: 'nowrap', label: 'No wrap' }, { value: 'wrap', label: 'Wrap' }] },
        defaultValue: 'nowrap',
        group: 'Layout',
      },
      { name: 'testId', label: 'Test ID', type: { kind: 'string' }, group: 'Advanced' },
    ],
    preview: FlexPreview,
  },
];
