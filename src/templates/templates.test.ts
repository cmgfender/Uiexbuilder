/**
 * Template catalog quality gate: every starter extension and every block
 *  (a) validates with zero errors and zero warnings,
 *  (b) generates code that type-checks (strict) against the real @hubspot/ui-extensions package,
 *  (c) renders through the preview runtime in design and preview mode without error boxes.
 */
import path from 'node:path';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { generateProjectFiles, type GeneratedFile } from '../codegen';
import { createExtension, createProject } from '../model/factory';
import { newId } from '../model/ids';
import { instantiateTemplate } from '../model/tree';
import type { Extension, Project } from '../model/types';
import { validateProject } from '../model/validate';
import { renderDoc } from '../runtime/testing';
import { formatDiagnostics, scratchDir, typecheck, writeFiles } from '../test/typecheck';
import {
  BLOCK_TEMPLATES,
  freshBlockTemplate,
  instantiateExtensionTemplate,
  matchesBlock,
  PROJECT_TEMPLATES,
  templateConflict,
  type BlockTemplate,
  type ExtensionTemplate,
} from './catalog';

afterEach(() => cleanup());

function projectForTemplate(tpl: ExtensionTemplate): { project: Project; ext: Extension } {
  const project = createProject(`${tpl.name} App`, []);
  const { extension, functions } = instantiateExtensionTemplate(tpl, project);
  project.extensions = [extension];
  project.functions = functions;
  return { project, ext: extension };
}

function projectForBlock(block: BlockTemplate): { project: Project; ext: Extension } {
  const ext = createExtension({ name: `${block.name} block` });
  ext.state = (block.state ?? []).map((s) => ({ ...s, id: newId('s') }));
  for (let i = 0; i < 2; i++) {
    // Insert twice: blocks must be insertable more than once (unique overlay ids).
    // Data blocks are built for the card (their data sources get names that don't clash).
    const built = block.create ? block.create(ext, { functions: [] }) : null;
    if (built) ext.dataSources.push(...built.dataSources);
    const sub = instantiateTemplate(freshBlockTemplate(built ? built.template : block.template, ext));
    Object.assign(ext.nodes, sub.nodes);
    ext.nodes[ext.rootId].children.push(sub.rootId);
  }
  return { project: createProject(`${block.name} App`, [ext]), ext };
}

const describeIssues = (project: Project, severities: string[]) =>
  validateProject(project)
    .filter((i) => severities.includes(i.severity))
    .map((i) => `${i.severity} ${i.rule} [${i.field ?? ''}] ${i.message}`);

describe('catalog shape', () => {
  it('has at least 14 starter extensions and 15 blocks with unique ids', () => {
    expect(PROJECT_TEMPLATES.length).toBeGreaterThanOrEqual(14);
    expect(BLOCK_TEMPLATES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(PROJECT_TEMPLATES.map((t) => t.id)).size).toBe(PROJECT_TEMPLATES.length);
    expect(new Set(BLOCK_TEMPLATES.map((t) => t.id)).size).toBe(BLOCK_TEMPLATES.length);
    for (const tpl of PROJECT_TEMPLATES) {
      expect(tpl.name && tpl.description && tpl.tags.length, tpl.id).toBeTruthy();
    }
    for (const block of BLOCK_TEMPLATES) expect(block.icon, block.id).toBeTruthy();
  });

  it('builds fresh ids on every call and matches the declared kind / location / objects', () => {
    for (const tpl of PROJECT_TEMPLATES) {
      const a = tpl.build([]);
      const b = tpl.build([a]);
      expect(a.id).not.toBe(b.id);
      expect(a.uid).not.toBe(b.uid);
      expect(Object.keys(a.nodes).some((id) => b.nodes[id])).toBe(false);
      expect(a.kind, tpl.id).toBe(tpl.kind);
      if (tpl.kind === 'card') {
        expect(a.location, tpl.id).toBe(tpl.location);
        expect(a.objectTypes, tpl.id).toEqual(tpl.objectTypes);
      }
    }
  });

  it('wires template functions to the extension and keeps their names unique', () => {
    const quote = PROJECT_TEMPLATES.find((t) => t.id === 'server-quote')!;
    const project = createProject('Quotes', []);
    const first = instantiateExtensionTemplate(quote, project);
    project.extensions.push(first.extension);
    project.functions.push(...first.functions);
    const second = instantiateExtensionTemplate(quote, project);
    expect(first.functions).toHaveLength(1);
    expect(second.functions[0].uid).not.toBe(first.functions[0].uid);
    expect(second.functions[0].fileName).not.toBe(first.functions[0].fileName);
    const json = JSON.stringify(second.extension);
    expect(json).toContain(second.functions[0].id);
    expect(second.extension.mock.functions[second.functions[0].id]).toBeTruthy();
  });

  it('reports settings / home conflicts', () => {
    const settings = PROJECT_TEMPLATES.find((t) => t.kind === 'settings')!;
    const home = PROJECT_TEMPLATES.find((t) => t.kind === 'home')!;
    const card = PROJECT_TEMPLATES.find((t) => t.kind === 'card')!;
    const existing = [settings.build([]), home.build([])];
    expect(templateConflict(settings, existing)).toMatch(/settings page/);
    expect(templateConflict(home, existing)).toMatch(/app home/);
    expect(templateConflict(card, existing)).toBeNull();
    expect(templateConflict(settings, existing, existing[0].id)).toBeNull();
  });

  it('renames overlay ids of blocks inserted more than once', () => {
    const confirm = BLOCK_TEMPLATES.find((b) => b.id === 'confirm-button')!;
    const { ext } = projectForBlock(confirm);
    const ids = Object.values(ext.nodes)
      .filter((n) => n.type === 'Modal')
      .map((n) => n.props.id);
    expect(ids).toEqual(['confirm-delete', 'confirm-delete-2']);
  });

  it('searches blocks by name, description and keywords', () => {
    const names = (q: string) => BLOCK_TEMPLATES.filter((b) => matchesBlock(b, q)).map((b) => b.id);
    expect(names('')).toHaveLength(BLOCK_TEMPLATES.length);
    expect(names('modal')).toContain('confirm-button');
    expect(names('KPI')).toContain('stat-row');
    expect(names('zzz-nothing')).toEqual([]);
  });
});

describe.each(PROJECT_TEMPLATES.map((t) => [t.id, t] as const))('starter %s', (_id, tpl) => {
  it('validates with zero errors and warnings', () => {
    const { project } = projectForTemplate(tpl);
    expect(describeIssues(project, ['error', 'warning'])).toEqual([]);
  });

  it('renders in design and preview mode without error boxes', () => {
    const { project, ext } = projectForTemplate(tpl);
    for (const mode of ['design', 'preview'] as const) {
      const r = renderDoc(project, ext, { mode });
      expect(r.container.querySelectorAll('.hsp-rt-error').length, `${mode} errors`).toBe(0);
      if (Object.keys(ext.nodes).length > 1 && mode === 'design') {
        expect(r.container.querySelectorAll('[data-node-id]').length).toBeGreaterThan(0);
      }
      r.unmount();
    }
  });
});

describe.each(BLOCK_TEMPLATES.map((b) => [b.id, b] as const))('block %s', (_id, block) => {
  it('validates with zero errors and warnings', () => {
    const { project } = projectForBlock(block);
    expect(describeIssues(project, ['error', 'warning'])).toEqual([]);
  });

  it('renders in design and preview mode without error boxes', () => {
    const { project, ext } = projectForBlock(block);
    for (const mode of ['design', 'preview'] as const) {
      const r = renderDoc(project, ext, { mode });
      expect(r.container.querySelectorAll('.hsp-rt-error').length, `${mode} errors`).toBe(0);
      r.unmount();
    }
  });
});

describe('generated code', () => {
  let outDir = '';
  const written: Array<{ name: string; dir: string; files: GeneratedFile[] }> = [];

  beforeAll(() => {
    outDir = scratchDir('templates-check');
    for (const tpl of PROJECT_TEMPLATES) {
      const dir = path.join(outDir, `starter-${tpl.id}`);
      const files = generateProjectFiles(projectForTemplate(tpl).project);
      writeFiles(dir, files);
      written.push({ name: tpl.id, dir, files });
    }
    for (const block of BLOCK_TEMPLATES) {
      const dir = path.join(outDir, `block-${block.id}`);
      const files = generateProjectFiles(projectForBlock(block).project);
      writeFiles(dir, files);
      written.push({ name: block.id, dir, files });
    }
  });

  it('type-checks every starter and block (strict)', () => {
    const roots = written.flatMap((w) => w.files.filter((f) => f.path.endsWith('.tsx')).map((f) => path.join(w.dir, f.path)));
    expect(roots.length).toBe(PROJECT_TEMPLATES.length + BLOCK_TEMPLATES.length);
    expect(formatDiagnostics(typecheck(roots))).toBe('');
  });

  it('includes the app functions of templates that need them', () => {
    const quote = written.find((w) => w.name === 'server-quote')!;
    expect(quote.files.some((f) => /^src\/app\/functions\/generateQuote\.js$/.test(f.path))).toBe(true);
    const settings = written.find((w) => w.name === 'settings-page')!;
    expect(settings.files.some((f) => f.path.startsWith('src/app/settings/'))).toBe(true);
  });
});
