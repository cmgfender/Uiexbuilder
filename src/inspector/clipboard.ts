/**
 * Clipboard + "Copy JSX" helpers for the inspector.
 */
import { generateExtensionSource, generateNodeJsx } from '../codegen';
import type { Extension, NodeId, Project } from '../model/types';

export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall back below */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    const ok = typeof document.execCommand === 'function' ? document.execCommand('copy') : false;
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * JSX of one node with only the public generator: generate a probe extension whose root holds just
 * that node and extract the returned fragment's children.
 */
function probeNodeJsx(project: Project, ext: Extension, nodeId: NodeId): string {
  const root = ext.nodes[ext.rootId];
  if (!root || !ext.nodes[nodeId]) return '';
  const probe: Extension = { ...ext, nodes: { ...ext.nodes, [ext.rootId]: { ...root, children: [nodeId] } } };
  const lines = generateExtensionSource(project, probe).split('\n');
  const start = lines.findIndex((l) => l.trim() === '<>');
  const end = lines.map((l) => l.trim()).lastIndexOf('</>');
  if (start === -1 || end <= start) {
    // Single top-level element: return everything between `return (` and `);`.
    const ret = lines.findIndex((l) => /return \($/.test(l.trim()));
    const close = lines.findIndex((l, i) => i > ret && l.trim() === ');');
    if (ret === -1 || close === -1) return '';
    return dedent(lines.slice(ret + 1, close));
  }
  return dedent(lines.slice(start + 1, end));
}

function dedent(lines: string[]): string {
  const indents = lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return `${lines.map((l) => l.slice(min)).join('\n')}\n`;
}

/**
 * JSX for a node: `generateNodeJsx(project, ext, nodeId)` from src/codegen; a probe through
 * generateExtensionSource only if that throws or returns nothing.
 */
export function nodeJsx(project: Project, ext: Extension, nodeId: NodeId): string {
  try {
    const out = generateNodeJsx(project, ext, nodeId);
    if (out.trim()) return out;
  } catch {
    /* fall back */
  }
  try {
    return probeNodeJsx(project, ext, nodeId);
  } catch {
    return '';
  }
}
