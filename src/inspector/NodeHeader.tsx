/**
 * Inspector header for the selected component: icon, label, editable layer name, type, docs link,
 * status badges and the overflow menu (duplicate, copy JSX, copy, delete).
 */
import { ArrowUpLeft, BookOpen, Code2, Copy, CopyPlus, Ellipsis, ExternalLink, Trash2 } from 'lucide-react';
import { useEditor } from '../model/store';
import { findParent, nodeLabel } from '../model/tree';
import type { Extension, Project, UINode } from '../model/types';
import { getComponent } from '../registry';
import type { ComponentDef } from '../registry/types';
import { formatShortcut, shortcutLabel } from '../shell/shortcuts';
import { Badge, IconButton, Menu, useMenu, useToast, type MenuItem } from '../ui';
import { copyText, nodeJsx } from './clipboard';

export interface NodeHeaderProps {
  node: UINode;
  def: ComponentDef;
  ext: Extension;
  project: Project;
}

export function NodeHeader({ node, def, ext, project }: NodeHeaderProps) {
  const toast = useToast();
  const menu = useMenu();
  const updateNode = useEditor((s) => s.updateNode);
  const ref = findParent(ext, node.id);
  const parentId = ref && ref.parentId !== ext.rootId ? ref.parentId : null;
  const parent = parentId ? ext.nodes[parentId] : undefined;
  const slotDef = ref?.slot && parent ? getComponent(parent.type)?.slots?.find((s) => s.name === ref.slot) : undefined;
  const slotFull = !!slotDef && slotDef.max !== undefined && (parent?.slots?.[slotDef.name]?.length ?? 0) >= slotDef.max;
  const Icon = def.icon;
  const st = useEditor.getState;

  const copyJsx = async () => {
    const code = nodeJsx(project, ext, node.id);
    if (!code.trim()) return toast('Could not generate JSX for this component');
    toast((await copyText(code)) ? 'JSX copied to the clipboard' : 'Could not copy to the clipboard');
  };

  const items: MenuItem[] = [
    {
      label: 'Duplicate',
      icon: <CopyPlus size={14} />,
      shortcut: shortcutLabel('duplicate'),
      disabled: slotFull,
      onSelect: () => st().duplicateNode(node.id),
    },
    { label: 'Copy JSX', icon: <Code2 size={14} />, onSelect: () => void copyJsx() },
    {
      label: 'Copy',
      icon: <Copy size={14} />,
      shortcut: shortcutLabel('copy'),
      onSelect: () => {
        st().copyNode(node.id);
        toast(`Copied — paste with ${formatShortcut('Cmd+V')}`);
      },
    },
    ...(parentId ? [{ label: 'Select parent', icon: <ArrowUpLeft size={14} />, onSelect: () => st().select(parentId) }] : []),
    ...(def.docsUrl
      ? [
          {
            label: 'Open documentation',
            icon: <ExternalLink size={14} />,
            onSelect: () => window.open(def.docsUrl, '_blank', 'noopener,noreferrer'),
          },
        ]
      : []),
    { separator: true, label: '' },
    {
      label: node.locked ? 'Delete (unlock first)' : 'Delete',
      icon: <Trash2 size={14} />,
      shortcut: shortcutLabel('delete'),
      danger: true,
      disabled: !!node.locked,
      onSelect: () => st().removeNode(node.id),
    },
  ];

  const eventCount = Object.values(node.events ?? {}).filter((s) => s.length > 0).length;
  const badges: Array<{ key: string; tone?: 'accent' | 'select' | 'warning' | 'success'; text: string; title: string }> = [];
  if (ref?.slot)
    badges.push({
      key: 'slot',
      tone: 'accent',
      text: slotDef?.label ?? ref.slot,
      title: `Attached to ${parent ? nodeLabel(parent, getComponent(parent.type)?.label) : 'its trigger'}`,
    });
  if (node.binding)
    badges.push({ key: 'bind', tone: 'select', text: `⇄ ${node.binding.state}`, title: `Value bound to ${node.binding.state}` });
  if (eventCount)
    badges.push({ key: 'ev', tone: 'success', text: `${eventCount} event${eventCount === 1 ? '' : 's'}`, title: 'Has event actions' });
  if (node.condition) badges.push({ key: 'cond', tone: 'warning', text: 'Conditional', title: `Shown when ${node.condition}` });
  if (node.repeat) badges.push({ key: 'rep', tone: 'warning', text: 'Repeats', title: `Once per item of ${node.repeat.items}` });
  if (node.hiddenInDesigner) badges.push({ key: 'hid', text: 'Hidden', title: 'Hidden in the designer' });
  if (node.locked) badges.push({ key: 'lock', text: 'Locked', title: 'Locked on the canvas' });

  return (
    <div className="ub-insp-head">
      <div className="ub-insp-head__row">
        <span className="ub-insp-head__icon" aria-hidden>
          <Icon size={16} />
        </span>
        <div className="ub-insp-head__titles">
          <div className="ub-insp-head__title">
            <span className="ub-insp-head__label">{def.label}</span>
            <code className="ub-insp-head__type" title="Component type in code">
              {node.type}
            </code>
            {def.docsUrl && (
              <a
                className="ub-insp-docs"
                href={def.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={`${def.label} documentation (opens in a new tab)`}
              >
                <BookOpen size={12} aria-hidden /> Docs
              </a>
            )}
          </div>
          <input
            className="ub-insp-head__name"
            value={node.name ?? ''}
            placeholder={nodeLabel({ ...node, name: undefined }, def.label)}
            aria-label="Layer name"
            title="Layer name (shown in the layers tree)"
            onChange={(e) => updateNode(node.id, { name: e.target.value || undefined })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
          />
        </div>
        <div className="ub-insp-head__tools">
          {parentId && (
            <IconButton size="sm" label="Select parent" onClick={() => st().select(parentId)}>
              <ArrowUpLeft size={14} />
            </IconButton>
          )}
          <IconButton
            size="sm"
            label="More actions"
            aria-haspopup="menu"
            aria-expanded={!!menu.position}
            onClick={(e) => menu.openAt(e.currentTarget)}
          >
            <Ellipsis size={15} />
          </IconButton>
        </div>
      </div>
      {badges.length > 0 && (
        <div className="ub-insp-head__meta">
          {badges.map((b) => (
            <Badge key={b.key} tone={b.tone} title={b.title}>
              {b.text}
            </Badge>
          ))}
        </div>
      )}
      {menu.position && <Menu x={menu.position.x} y={menu.position.y} items={items} onClose={menu.close} />}
    </div>
  );
}
