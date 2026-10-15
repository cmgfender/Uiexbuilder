import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExtension, createProject } from './factory';
import { MAX_NODE_DEPTH } from './normalize';
import {
  deleteSavedProject,
  listSavedProjects,
  loadLastProject,
  loadSavedProject,
  parseProjectJson,
  saveProject,
  saveProjectResult,
  serializeProject,
  validateProjectShape,
} from './persistence';
import { collectSubtree, walk } from './tree';
import type { Project } from './types';
import { generateProjectFiles } from '../codegen';
import { validateProject } from './validate';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function baseDoc(): Doc {
  const p = createProject('Shape Test');
  p.extensions[0] = createExtension({
    name: 'Card',
    content: [{ type: 'Flex', children: [{ type: 'Text', text: 'Hello' }, { type: 'Button', text: 'Go' }] }],
  });
  return JSON.parse(serializeProject(p)) as Doc;
}

function parse(doc: Doc) {
  return parseProjectJson(JSON.stringify(doc));
}

function ext0(doc: Doc): Doc {
  return doc.extensions[0];
}

function firstChild(doc: Doc): string {
  const e = ext0(doc);
  return e.nodes[e.rootId].children[0];
}

describe('validateProjectShape (import normaliser)', () => {
  it('returns well-formed documents unchanged, with no warnings', () => {
    const doc = baseDoc();
    const res = parse(doc);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.project).toEqual(doc);
    expect(res.warnings).toEqual([]);
  });

  it('rejects unknown extension kinds and the wrong schema version', () => {
    const doc = baseDoc();
    ext0(doc).kind = 'weird';
    const res = parse(doc);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/unknown type “weird”/);
    expect(parse({ ...baseDoc(), schemaVersion: 2 })).toMatchObject({ ok: false, error: expect.stringMatching(/schemaVersion/) });
  });

  it('repairs fields the editor dereferences (location, objectTypes, mock, app, dates)', () => {
    const doc = baseDoc();
    delete ext0(doc).location;
    ext0(doc).objectTypes = 'contacts';
    delete ext0(doc).mock.context;
    doc.app = {};
    delete doc.updatedAt;
    const res = parse(doc);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ext = res.project.extensions[0];
    expect(ext.location).toBe('crm.record.tab');
    expect(ext.objectTypes).toEqual(['contacts']);
    expect(ext.mock.context.crm.objectTypeId).toBe('0-1');
    expect(typeof res.project.updatedAt).toBe('string');
    expect(res.project.app.permittedUrls).toEqual({ fetch: [], iframe: [], img: [] });
    expect(res.project.app.requiredScopes).toEqual(['oauth']);
    expect(res.warnings?.length).toBeGreaterThan(0);
    // The repaired document works with every consumer.
    expect(() => validateProject(res.project)).not.toThrow();
    expect(() => generateProjectFiles(res.project)).not.toThrow();
  });

  it('repairs or drops wrongly typed node fields, state, data sources and power fields', () => {
    const doc = baseDoc();
    const e = ext0(doc);
    const id = firstChild(doc);
    const node = e.nodes[id];
    node.props = null;
    node.text = 42;
    node.condition = { a: 1 };
    node.repeat = { items: 5 };
    node.events = { onClick: 'nope', onFocus: [null, { type: 'setState', state: 1 }] };
    node.binding = 'x';
    e.state = [null, { name: 5 }, { id: 's1', name: 'ok', type: 'mystery', initial: 1 }];
    e.dataSources = [{ kind: 'nope', name: 'x' }, { id: 'd1', kind: 'fetch', name: 'api', url: 5, method: 'BREW' }];
    e.computed = 'x';
    e.helpers = { a: 1 };
    doc.functions = [{}];
    doc.app.requiredScopes = 'oauth';
    const res = parse(doc);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ext = res.project.extensions[0];
    const n = ext.nodes[id];
    expect(n.props).toEqual({});
    expect(n.text).toBe('42');
    expect(n.condition).toBeUndefined();
    expect(n.repeat).toBeUndefined();
    expect(n.binding).toBeUndefined();
    expect(n.events).toEqual({ onFocus: [expect.objectContaining({ type: 'setState', state: '1', value: '' })] });
    expect(ext.state).toEqual([{ id: 's1', name: 'ok', type: 'any', initial: 1 }]);
    expect(ext.dataSources).toEqual([expect.objectContaining({ id: 'd1', kind: 'fetch', url: '5', method: 'GET', runOnMount: false })]);
    expect(ext.computed).toBeUndefined();
    expect(ext.helpers).toBeUndefined();
    expect(res.project.functions[0]).toEqual(expect.objectContaining({ id: expect.any(String), code: '', secretKeys: [] }));
    expect(res.project.app.requiredScopes).toEqual(['oauth']);
    expect(() => generateProjectFiles(res.project)).not.toThrow();
  });

  it('re-keys nodes whose id differs from their key and de-duplicates extension ids', () => {
    const doc = baseDoc();
    const id = firstChild(doc);
    delete ext0(doc).nodes[id].id;
    doc.extensions.push(JSON.parse(JSON.stringify(ext0(doc))));
    const res = parse(doc);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.project.extensions[0].nodes[id].id).toBe(id);
    expect(res.project.extensions[0].id).not.toBe(res.project.extensions[1].id);
  });

  it('rejects node graphs that are not trees (cycles, shared nodes, root as child)', () => {
    const cycle = baseDoc();
    const flex = firstChild(cycle);
    ext0(cycle).nodes[flex].children.push(flex);
    expect(parse(cycle)).toMatchObject({ ok: false, error: expect.stringMatching(/more than once/) });

    const rootCycle = baseDoc();
    ext0(rootCycle).nodes[firstChild(rootCycle)].children.push(ext0(rootCycle).rootId);
    expect(parse(rootCycle)).toMatchObject({ ok: false, error: expect.stringMatching(/root as its child/) });

    const shared = baseDoc();
    const sflex = firstChild(shared);
    const text = ext0(shared).nodes[sflex].children[0];
    ext0(shared).nodes[ext0(shared).rootId].children.push(text);
    expect(parse(shared)).toMatchObject({ ok: false, error: expect.stringMatching(/more than once/) });

    const deep = baseDoc();
    const e = ext0(deep);
    let parent = firstChild(deep);
    for (let i = 0; i < MAX_NODE_DEPTH + 5; i++) {
      const nid = `n_deep${i}`;
      e.nodes[nid] = { id: nid, type: 'Flex', props: {}, children: [] };
      e.nodes[parent].children.push(nid);
      parent = nid;
    }
    expect(parse(deep)).toMatchObject({ ok: false, error: expect.stringMatching(/nested more than/) });
  });

  it('drops unreachable nodes so tree helpers never loop', () => {
    const doc = baseDoc();
    const e = ext0(doc);
    e.nodes.n_a = { id: 'n_a', type: 'Flex', props: {}, children: ['n_b'] };
    e.nodes.n_b = { id: 'n_b', type: 'Flex', props: {}, children: ['n_a'] };
    const res = parse(doc);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ext = res.project.extensions[0];
    expect(ext.nodes.n_a).toBeUndefined();
    expect(() => walk(ext, () => undefined)).not.toThrow();
    expect(collectSubtree(ext, ext.rootId).length).toBe(Object.keys(ext.nodes).length);
    expect(res.warnings?.some((w) => /not part of the tree/.test(w))).toBe(true);
  });

  it('does not mutate the input object', () => {
    const doc = baseDoc();
    delete ext0(doc).location;
    const before = JSON.stringify(doc);
    validateProjectShape(doc);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('local storage', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  const named = (name: string, updatedAt: string): Project => ({ ...createProject(name), updatedAt });

  it('lists projects even when an index entry is malformed (no updatedAt) and keeps them on the next save', () => {
    const alpha = named('Alpha', '2026-01-01T00:00:00.000Z');
    const beta = named('Beta', '2026-02-01T00:00:00.000Z');
    saveProject(alpha);
    saveProject(beta);
    const index = JSON.parse(window.localStorage.getItem('uiex-builder:projects')!) as Array<Record<string, unknown>>;
    delete index[0].updatedAt;
    window.localStorage.setItem('uiex-builder:projects', JSON.stringify(index));
    expect(listSavedProjects().map((p) => p.id).sort()).toEqual([alpha.id, beta.id].sort());
    const gamma = named('Gamma', '2026-03-01T00:00:00.000Z');
    saveProject(gamma);
    const ids = listSavedProjects().map((p) => p.id);
    expect(ids[0]).toBe(gamma.id);
    expect(ids.slice(1).sort()).toEqual([alpha.id, beta.id].sort());
    const raw = JSON.parse(window.localStorage.getItem('uiex-builder:projects')!) as Array<{ id: string }>;
    expect(raw.map((e) => e.id).sort()).toEqual([alpha.id, beta.id, gamma.id].sort());
  });

  it('recovers projects whose index is corrupt or missing', () => {
    const alpha = named('Alpha', '2026-01-01T00:00:00.000Z');
    saveProject(alpha);
    window.localStorage.setItem('uiex-builder:projects', '{not json');
    expect(listSavedProjects().map((p) => p.id)).toEqual([alpha.id]);
    window.localStorage.removeItem('uiex-builder:projects');
    expect(listSavedProjects().map((p) => p.id)).toEqual([alpha.id]);
  });

  it('still reads saved projects when storage is full, and reports the quota on save', () => {
    const alpha = named('Alpha', '2026-01-01T00:00:00.000Z');
    saveProject(alpha);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    expect(listSavedProjects().map((p) => p.id)).toEqual([alpha.id]);
    expect(loadSavedProject(alpha.id)?.id).toBe(alpha.id);
    expect(loadLastProject()?.id).toBe(alpha.id);
    const res = saveProjectResult({ ...alpha, name: 'changed' });
    expect(res).toMatchObject({ ok: false, reason: 'quota' });
    expect(saveProject(alpha)).toBe(false);
    vi.restoreAllMocks();
    expect(listSavedProjects().map((p) => p.id)).toEqual([alpha.id]);
  });

  it('deletes a project without touching the others', () => {
    const alpha = named('Alpha', '2026-01-01T00:00:00.000Z');
    const beta = named('Beta', '2026-02-01T00:00:00.000Z');
    saveProject(alpha);
    saveProject(beta);
    deleteSavedProject(beta.id);
    expect(listSavedProjects().map((p) => p.id)).toEqual([alpha.id]);
  });
});
