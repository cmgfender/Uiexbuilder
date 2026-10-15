import { beforeEach, describe, expect, it } from 'vitest';
import { createExtension, createProject } from './factory';
import { selectActiveExtension, unavailableComponents, useEditor } from './store';
import { instantiateTemplate, toTemplate } from './tree';
import type { ActionStep, CrmPropertiesSource, Extension, NodeTemplate, Project, UINode } from './types';
import { generateExtensionSource } from '../codegen';
import { validateProject } from './validate';

const modalButton = (overlayId = 'confirm'): NodeTemplate => ({
  type: 'Button',
  text: 'Delete',
  slots: {
    overlay: [
      {
        type: 'Modal',
        props: { id: overlayId, title: 'Sure?' },
        children: [
          { type: 'ModalBody', children: [{ type: 'Text', text: 'Really?' }] },
          {
            type: 'ModalFooter',
            children: [
              { type: 'Button', text: 'Save', events: { onClick: [{ id: 'a1', type: 'closeOverlay', overlayNodeId: `@${overlayId}` }] } },
              { type: 'Button', text: 'Cancel', events: { onClick: [{ id: 'a2', type: 'closeOverlay', overlayNodeId: `@${overlayId}` }] } },
            ],
          },
        ],
      },
    ],
  },
});

function load(content: NodeTemplate[] = [], extra: Extension[] = []): Project {
  const project = createProject('Store test', [createExtension({ name: 'Card', content }), ...extra]);
  useEditor.getState().loadProject(project);
  return project;
}

const ext = () => selectActiveExtension(useEditor.getState());
const rootChildren = () => ext().nodes[ext().rootId].children;

/** Modal node id and the overlay targets of every closeOverlay step under a trigger button. */
function overlayWiring(e: Extension, buttonId: string): { modalId: string; modalIdProp: unknown; targets: string[] } {
  const modalId = e.nodes[buttonId].slots!.overlay[0];
  const targets: string[] = [];
  const visit = (id: string) => {
    const n: UINode = e.nodes[id];
    for (const steps of Object.values(n.events ?? {})) {
      for (const s of steps as ActionStep[]) if (s.type === 'closeOverlay') targets.push(s.overlayNodeId);
    }
    n.children.forEach(visit);
  };
  visit(modalId);
  return { modalId, modalIdProp: e.nodes[modalId].props.id, targets };
}

beforeEach(() => {
  window.localStorage.clear();
  load();
});

describe('copies keep their own overlays', () => {
  it('duplicate: the copy gets a unique modal id and its buttons close the copied modal', () => {
    load([modalButton()]);
    const original = rootChildren()[0];
    const copy = useEditor.getState().duplicateNode(original)!;
    const a = overlayWiring(ext(), original);
    const b = overlayWiring(ext(), copy);
    expect(a.targets).toEqual([a.modalId, a.modalId]);
    expect(b.targets).toEqual([b.modalId, b.modalId]);
    expect(b.modalIdProp).toBe('confirm-2');
    const code = generateExtensionSource(useEditor.getState().project, ext());
    expect(code).toContain("actions.closeOverlay('confirm-2')");
    const issues = validateProject(useEditor.getState().project).filter((i) => i.severity !== 'info');
    expect(issues).toEqual([]);
  });

  it('copy + paste and cut + paste keep working close actions', () => {
    load([modalButton()]);
    const original = rootChildren()[0];
    useEditor.getState().copyNode(original);
    const pasted = useEditor.getState().paste(null)!;
    const p = overlayWiring(ext(), pasted);
    expect(p.modalIdProp).toBe('confirm-2');
    expect(p.targets).toEqual([p.modalId, p.modalId]);

    useEditor.getState().cutNode(pasted);
    const again = useEditor.getState().paste(null)!;
    const q = overlayWiring(ext(), again);
    expect(q.targets).toEqual([q.modalId, q.modalId]);
    expect(validateProject(useEditor.getState().project).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('duplicating an extension and saving as a block keep the wiring', () => {
    load([modalButton()]);
    const srcId = ext().id;
    const dupId = useEditor.getState().duplicateExtension(srcId)!;
    const dup = useEditor.getState().project.extensions.find((e) => e.id === dupId)!;
    const btn = dup.nodes[dup.rootId].children[0];
    const w = overlayWiring(dup, btn);
    expect(w.targets).toEqual([w.modalId, w.modalId]);
    expect(validateProject(useEditor.getState().project).filter((i) => i.rule === 'missing-overlay')).toEqual([]);

    // Save as block (toTemplate) and insert it into another card.
    const source = useEditor.getState().project.extensions.find((e) => e.id === srcId)!;
    const block = toTemplate(source, source.nodes[source.rootId].children[0]);
    const sub = instantiateTemplate(block);
    const modal = sub.nodes[sub.nodes[sub.rootId].slots!.overlay[0]];
    const steps = Object.values(sub.nodes).flatMap((n) => Object.values(n.events ?? {}).flat()) as ActionStep[];
    expect(steps.map((s) => (s.type === 'closeOverlay' ? s.overlayNodeId : ''))).toEqual([modal.id, modal.id]);
  });
});

describe('paste respects location rules for nested components', () => {
  it('refuses to paste a Tile holding a CRM component into a settings page', () => {
    load([{ type: 'Tile', children: [{ type: 'Text', text: 'x' }, { type: 'CrmPropertyList', props: { properties: ['email'] } }] }]);
    useEditor.getState().copyNode(rootChildren()[0]);
    const settingsId = useEditor.getState().addExtension({ kind: 'settings' });
    expect(ext().id).toBe(settingsId);
    expect(unavailableComponents(ext(), useEditor.getState().clipboard!)).toEqual(['Property list']);
    expect(useEditor.getState().paste(null)).toBeNull();
    expect(rootChildren()).toEqual([]);
  });
});

describe('undo / redo shows the extension they change', () => {
  it('switches to the extension the step changes instead of editing out of view', () => {
    load([{ type: 'Text', text: 'card' }]);
    const cardId = ext().id;
    const settingsId = useEditor.getState().addExtension({ kind: 'settings' });
    const btn = useEditor.getState().insertNode('Button', { parentId: ext().rootId, index: 0 })!;
    useEditor.getState().setText(btn, 'Save settings');
    useEditor.getState().setActiveExtension(cardId);

    useEditor.getState().undo();
    expect(useEditor.getState().activeExtensionId).toBe(settingsId);
    expect(ext().nodes[btn].text).not.toBe('Save settings');

    useEditor.getState().setActiveExtension(cardId);
    useEditor.getState().redo();
    expect(useEditor.getState().activeExtensionId).toBe(settingsId);
    expect(ext().nodes[btn].text).toBe('Save settings');
  });
});

describe('addStateVar names', () => {
  it('keeps valid names as typed and avoids every declared name', () => {
    load();
    expect(useEditor.getState().addStateVar({ name: 'first_name' }).name).toBe('first_name');
    expect(useEditor.getState().addStateVar({ name: 'First name' }).name).toBe('firstName');
    useEditor.getState().addComputed({ name: 'email', expr: "'a'" });
    expect(useEditor.getState().addStateVar({ name: 'email' }).name).toBe('email2');
    useEditor.getState().addDataSource({ kind: 'crmProperties', name: 'contact', properties: [] } as Omit<CrmPropertiesSource, 'id'>);
    expect(useEditor.getState().addStateVar({ name: 'contactLoading' }).name).toBe('contactLoading2');
    useEditor.getState().setHelpers('function fmt(x) { return x; }');
    expect(useEditor.getState().addStateVar({ name: 'fmt' }).name).toBe('fmt2');
  });
});

describe('no-op edits', () => {
  it('do not create undo steps or touch updatedAt', () => {
    load([{ type: 'Flex', children: [{ type: 'Text', text: 'a' }, { type: 'Text', text: 'b' }] }]);
    const st = useEditor.getState();
    const flex = rootChildren()[0];
    const [a] = ext().nodes[flex].children;
    const before = useEditor.getState().project;
    st.setEvent(a, 'onClick', []);
    st.setProp('missing', 'x', 1);
    st.moveComputed('nope', 0);
    st.updateNode(a, { condition: undefined });
    st.removeComputed('nope');
    st.setText(a, 'a');
    expect(st.moveNode(a, { parentId: flex, index: 0 })).toBe(true);
    expect(st.moveNode(a, { parentId: flex, index: 1 })).toBe(true);
    expect(useEditor.getState().project).toBe(before);
    expect(useEditor.getState().past).toHaveLength(0);
    // A real change still records history.
    st.setText(a, 'changed');
    expect(useEditor.getState().past).toHaveLength(1);
    expect(useEditor.getState().project.updatedAt >= before.updatedAt).toBe(true);
  });
});
