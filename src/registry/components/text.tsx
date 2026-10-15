/**
 * Text & content components.
 * REFERENCE PATTERN: `Text` below shows the conventions every component definition follows —
 * exact prop names from @hubspot/ui-extensions, inspector metadata, and a preview that spreads
 * `rootProps` on its outermost element and styles itself with `hsp-` classes.
 */
import { Type } from 'lucide-react';
import type { ComponentDef, PreviewProps } from '../types';
import { STANDARD_DOCS, enumOptions } from '../constants';
import { cx } from '../../preview/util';
import '../../preview/styles/text.css';

function TextPreview({ props, text, rootProps }: PreviewProps) {
  const format = (props.format ?? {}) as {
    fontWeight?: string;
    italic?: boolean;
    lineDecoration?: string;
    textTransform?: string;
  };
  const truncate = props.truncate;
  const style: React.CSSProperties = {
    fontWeight: format.fontWeight === 'bold' ? 700 : format.fontWeight === 'demibold' ? 600 : undefined,
    fontStyle: format.italic ? 'italic' : undefined,
    textDecoration:
      format.lineDecoration === 'underline'
        ? 'underline'
        : format.lineDecoration === 'strikethrough'
          ? 'line-through'
          : undefined,
    textTransform:
      format.textTransform && format.textTransform !== 'sentenceCase' && format.textTransform !== 'none'
        ? (format.textTransform as React.CSSProperties['textTransform'])
        : undefined,
    maxWidth: truncate && typeof truncate === 'object' && truncate.maxWidth ? truncate.maxWidth : undefined,
  };
  let content = text;
  if (format.textTransform === 'sentenceCase' && content) {
    content = content.charAt(0).toUpperCase() + content.slice(1).toLowerCase();
  }
  const Tag = props.inline ? 'span' : 'p';
  return (
    <Tag
      {...rootProps}
      className={cx('hsp-text', props.variant === 'microcopy' && 'hsp-microcopy', truncate && 'hsp-truncate', props.inline && 'hsp-inline', rootProps.className)}
      style={style}
      title={truncate && typeof truncate === 'object' ? truncate.tooltipText : undefined}
    >
      {content || ' '}
    </Tag>
  );
}

export const textComponents: ComponentDef[] = [
  {
    type: 'Text',
    label: 'Text',
    category: 'Text & content',
    description: 'Renders text with formatting options. Supports {{ expressions }} for dynamic values.',
    icon: Type,
    docsUrl: `${STANDARD_DOCS}/text`,
    importFrom: '@hubspot/ui-extensions',
    keywords: ['paragraph', 'label', 'copy', 'body'],
    children: { mode: 'text', defaultText: 'Text' },
    props: [
      {
        name: 'variant',
        label: 'Variant',
        type: { kind: 'enum', options: [{ value: 'bodytext', label: 'Body text' }, { value: 'microcopy', label: 'Microcopy' }] },
        defaultValue: 'bodytext',
        group: 'Appearance',
      },
      {
        name: 'format',
        label: 'Format',
        group: 'Appearance',
        type: {
          kind: 'object',
          fields: [
            { name: 'fontWeight', label: 'Font weight', type: { kind: 'enum', options: enumOptions('regular', 'demibold', 'bold') } },
            { name: 'italic', label: 'Italic', type: { kind: 'boolean' } },
            {
              name: 'lineDecoration',
              label: 'Line decoration',
              type: { kind: 'enum', options: enumOptions('none', 'underline', 'strikethrough') },
            },
            {
              name: 'textTransform',
              label: 'Text transform',
              type: { kind: 'enum', options: enumOptions('none', 'uppercase', 'lowercase', 'capitalize', 'sentenceCase') },
            },
          ],
        },
      },
      { name: 'inline', label: 'Inline', type: { kind: 'boolean' }, defaultValue: false, group: 'Layout' },
      {
        name: 'truncate',
        label: 'Truncate',
        type: { kind: 'boolean' },
        defaultValue: false,
        group: 'Layout',
        description: 'Truncate long text with an ellipsis (shows full text on hover).',
      },
      { name: 'testId', label: 'Test ID', type: { kind: 'string' }, group: 'Advanced' },
    ],
    preview: TextPreview,
  },
];
