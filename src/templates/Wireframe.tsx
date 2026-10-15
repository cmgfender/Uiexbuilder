/**
 * Mini wireframe thumbnails for template galleries. A node template tree is drawn with simple CSS
 * shapes (bars for text, pills for buttons, outlined boxes for inputs, grids for tables, ...), so
 * every block and starter gets a recognisable preview without rendering real components.
 */
import { Fragment, memo, type ReactNode } from 'react';
import { toTemplate } from '../model/tree';
import type { Extension, NodeTemplate, PropValue } from '../model/types';
import { cx } from '../ui';

const INPUT_TYPES = new Set([
  'Input',
  'TextArea',
  'NumberInput',
  'CurrencyInput',
  'StepperInput',
  'DateInput',
  'TimeInput',
  'Select',
  'MultiSelect',
  'SearchInput',
]);
const BUTTON_TYPES = new Set(['Button', 'LoadingButton', 'CrmActionButton', 'Dropdown']);
const BOX_TYPES = new Set(['Image', 'Illustration']);
const CONTAINER_TYPES = new Set(['Box', 'Form', 'Inline', 'ModalBody', 'PanelBody', 'PanelSection', 'TableCell']);

interface Budget {
  left: number;
}

function str(v: PropValue | undefined): string {
  return typeof v === 'string' ? v : '';
}

/** A stable pseudo-random width (%) from a piece of text. */
function widthFor(text: string | undefined, min: number, max: number): string {
  const len = (text ?? '').replace(/\{\{[\s\S]*?\}\}/g, 'xxxxxx').length || 12;
  const pct = Math.max(min, Math.min(max, 18 + len * 2.2));
  return `${Math.round(pct)}%`;
}

function Line({ width, tone }: { width: string; tone?: 'heading' | 'bold' | 'muted' | 'link' }) {
  return <span className={cx('ub-tpl-wf-line', tone && `ub-tpl-wf-line--${tone}`)} style={{ width }} />;
}

function renderList(nodes: NodeTemplate[] | undefined, budget: Budget, limit = 6): ReactNode[] {
  const out: ReactNode[] = [];
  for (const [i, n] of (nodes ?? []).slice(0, limit).entries()) {
    if (budget.left <= 0) break;
    const r = renderNode(n, budget);
    if (r !== null) out.push(<Fragment key={i}>{r}</Fragment>);
  }
  return out;
}

function renderNode(n: NodeTemplate, budget: Budget): ReactNode {
  if (budget.left <= 0) return null;
  budget.left -= 1;
  const p = n.props ?? {};
  switch (n.type) {
    case 'Flex': {
      const row = p.direction === 'row';
      return (
        <span className={cx(row ? 'ub-tpl-wf-row' : 'ub-tpl-wf-col', row && p.justify === 'between' && 'ub-tpl-wf-row--between')}>
          {renderList(n.children, budget)}
        </span>
      );
    }
    case 'ButtonRow':
    case 'Inline':
      return <span className="ub-tpl-wf-row">{renderList(n.children, budget, 4)}</span>;
    case 'Tile':
    case 'Accordion':
      return (
        <span className="ub-tpl-wf-tile">
          {n.type === 'Accordion' && <Line width="55%" tone="bold" />}
          {renderList(n.children, budget, 4)}
        </span>
      );
    case 'AutoGrid':
      return <span className="ub-tpl-wf-grid">{renderList(n.children, budget, 3)}</span>;
    case 'Tabs': {
      const tabs = n.children ?? [];
      return (
        <span className="ub-tpl-wf-col">
          <span className="ub-tpl-wf-tabs">
            {tabs.slice(0, 3).map((_t, i) => (
              <span key={i} className={cx('ub-tpl-wf-tabs__tab', i === 0 && 'ub-tpl-wf-tabs__tab--on')} />
            ))}
          </span>
          {tabs[0] ? renderList(tabs[0].children, budget, 3) : null}
        </span>
      );
    }
    case 'Heading':
      return <Line width={widthFor(n.text, 35, 75)} tone="heading" />;
    case 'Text': {
      const format = p.format as Record<string, unknown> | undefined;
      const tone = format && typeof format === 'object' && format.fontWeight === 'bold' ? 'bold' : p.variant === 'microcopy' ? 'muted' : undefined;
      return <Line width={widthFor(n.text, 20, tone === 'muted' ? 60 : 90)} tone={tone} />;
    }
    case 'Link':
    case 'CrmActionLink':
      return <Line width={widthFor(n.text, 18, 45)} tone="link" />;
    case 'Tag':
    case 'StatusTag':
      return <span className="ub-tpl-wf-tag" />;
    case 'Divider':
      return <span className="ub-tpl-wf-divider" />;
    case 'Spacer':
      return null;
    case 'Alert':
      return (
        <span className={cx('ub-tpl-wf-alert', `ub-tpl-wf-alert--${str(p.variant as PropValue) || 'info'}`)}>
          <Line width="40%" tone="bold" />
          <Line width="75%" />
        </span>
      );
    case 'Checkbox':
    case 'RadioButton':
      return (
        <span className="ub-tpl-wf-row ub-tpl-wf-row--tight">
          <span className={cx('ub-tpl-wf-check', n.type === 'RadioButton' && 'ub-tpl-wf-check--round')} />
          <Line width={widthFor(n.text, 25, 60)} />
        </span>
      );
    case 'Toggle':
      return (
        <span className="ub-tpl-wf-row ub-tpl-wf-row--tight">
          <span className="ub-tpl-wf-toggle" />
          <Line width="45%" />
        </span>
      );
    case 'ToggleGroup':
      return (
        <span className="ub-tpl-wf-col">
          <Line width="35%" tone="muted" />
          <span className="ub-tpl-wf-row ub-tpl-wf-row--tight">
            {[0, 1, 2].map((i) => (
              <span key={i} className="ub-tpl-wf-check" />
            ))}
          </span>
        </span>
      );
    case 'Table': {
      return (
        <span className="ub-tpl-wf-table">
          <span className="ub-tpl-wf-table__row ub-tpl-wf-table__row--head" />
          <span className="ub-tpl-wf-table__row" />
          <span className="ub-tpl-wf-table__row" />
          <span className="ub-tpl-wf-table__row" />
        </span>
      );
    }
    case 'DescriptionList':
      return (
        <span className="ub-tpl-wf-dl">
          {(n.children ?? []).slice(0, 4).map((_c, i) => (
            <span key={i} className="ub-tpl-wf-col ub-tpl-wf-col--tight">
              <Line width="60%" tone="muted" />
              <Line width="85%" tone="bold" />
            </span>
          ))}
        </span>
      );
    case 'Statistics':
      return (
        <span className="ub-tpl-wf-stats">
          {(n.children ?? []).slice(0, 3).map((_c, i) => (
            <span key={i} className="ub-tpl-wf-col ub-tpl-wf-col--tight">
              <Line width="70%" tone="muted" />
              <span className="ub-tpl-wf-stat" />
            </span>
          ))}
        </span>
      );
    case 'ProgressBar':
      return (
        <span className="ub-tpl-wf-col ub-tpl-wf-col--tight">
          {p.title ? <Line width="40%" tone="muted" /> : null}
          <span className="ub-tpl-wf-progress">
            <span className="ub-tpl-wf-progress__fill" />
          </span>
        </span>
      );
    case 'StepIndicator':
      return (
        <span className="ub-tpl-wf-steps">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={cx('ub-tpl-wf-steps__dot', i < 2 && 'ub-tpl-wf-steps__dot--on')} />
          ))}
        </span>
      );
    case 'BarChart':
    case 'LineChart':
      return (
        <span className="ub-tpl-wf-chart">
          {[45, 70, 55, 85, 65, 95].map((h, i) => (
            <span key={i} className="ub-tpl-wf-chart__bar" style={{ height: `${h}%` }} />
          ))}
        </span>
      );
    case 'ScoreCircle':
    case 'LoadingSpinner':
      return <span className={cx('ub-tpl-wf-circle', n.type === 'LoadingSpinner' && 'ub-tpl-wf-circle--spin')} />;
    case 'EmptyState':
    case 'ErrorState':
      return (
        <span className="ub-tpl-wf-empty">
          <span className="ub-tpl-wf-box ub-tpl-wf-box--square" />
          <span className="ub-tpl-wf-col ub-tpl-wf-col--tight" style={{ flex: 1 }}>
            <Line width="60%" tone="bold" />
            <Line width="85%" />
          </span>
        </span>
      );
    case 'List':
      return <span className="ub-tpl-wf-col ub-tpl-wf-col--list">{renderList(n.children, budget, 3)}</span>;
    default:
      break;
  }
  if (BUTTON_TYPES.has(n.type)) {
    const variant = str(p.variant as PropValue);
    return (
      <span
        className={cx(
          'ub-tpl-wf-btn',
          (variant === 'primary' || (n.type === 'Button' && !variant)) && 'ub-tpl-wf-btn--primary',
          variant === 'destructive' && 'ub-tpl-wf-btn--danger',
        )}
      />
    );
  }
  if (INPUT_TYPES.has(n.type)) {
    return (
      <span className="ub-tpl-wf-col ub-tpl-wf-col--tight ub-tpl-wf-field">
        <Line width="35%" tone="muted" />
        <span className={cx('ub-tpl-wf-input', n.type === 'TextArea' && 'ub-tpl-wf-input--tall')} />
      </span>
    );
  }
  if (BOX_TYPES.has(n.type) || n.type.startsWith('Crm')) {
    return (
      <span className="ub-tpl-wf-box">
        <Line width="50%" tone="muted" />
        <Line width="70%" tone="muted" />
      </span>
    );
  }
  if (CONTAINER_TYPES.has(n.type) || (n.children && n.children.length)) {
    return <span className="ub-tpl-wf-col">{renderList(n.children, budget)}</span>;
  }
  return <Line width="50%" />;
}

export interface WireframeProps {
  /** Top-level nodes to draw. */
  nodes: NodeTemplate[];
  size?: 'sm' | 'md';
  className?: string;
}

/** Decorative wireframe of a node tree (aria-hidden). */
export const Wireframe = memo(function Wireframe({ nodes, size = 'md', className }: WireframeProps) {
  const budget: Budget = { left: size === 'sm' ? 18 : 30 };
  const content = renderList(nodes, budget, 8);
  return (
    <span className={cx('ub-tpl-wf', `ub-tpl-wf--${size}`, className)} aria-hidden="true">
      {content.length ? content : <span className="ub-tpl-wf-blank">Empty</span>}
    </span>
  );
});

/** The top-level node templates of an extension (for wireframes). */
export function extensionTemplates(ext: Extension): NodeTemplate[] {
  const root = ext.nodes[ext.rootId];
  if (!root) return [];
  return root.children.filter((id) => ext.nodes[id]).map((id) => toTemplate(ext, id));
}
