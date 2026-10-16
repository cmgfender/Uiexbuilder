/**
 * One-click fixes for problems whose fix is unambiguous (Problems panel "Fix" buttons). Each fix
 * goes through store actions, so it is a single undo step, and returns a confirmation message.
 */
import { toProjectSlug } from '../model/factory';
import { asOneUndoStep } from '../model/history';
import { useEditor } from '../model/store';
import type { Extension, JsonValue, Project } from '../model/types';
import { renameReferences } from '../panels/findUsages';
import type { Issue } from '../model/validate';
import { getComponent } from '../registry';
import { showLeftTab } from './shellStore';
import { RETIRED_SCOPES, modernizeScopes } from '../model/scopes';

export interface QuickFix {
  /** Button text, e.g. "Add scope". */
  label: string;
  /** Longer explanation for the tooltip. */
  title: string;
  /** Applies the fix; returns a confirmation for a toast. */
  apply: () => string;
}

type PermittedKind = keyof Project['app']['permittedUrls'];
const PERMITTED_KINDS: PermittedKind[] = ['fetch', 'iframe', 'img'];

/** The quick fix for an issue, or null when it needs a human decision. */
export function quickFixFor(issue: Issue, project: Project): QuickFix | null {
  const subject = issue.subject;
  switch (issue.rule) {
    case 'missing-scope': {
      if (!subject) return null;
      return {
        label: 'Add scope',
        title: `Add “${subject}” to the app’s required scopes now`,
        apply: () => {
          const scopes = useEditor.getState().project.app.requiredScopes;
          if (!scopes.includes(subject)) useEditor.getState().updateApp({ requiredScopes: [...scopes, subject] });
          return `Added the “${subject}” scope.`;
        },
      };
    }
    case 'retired-scope': {
      if (!subject) return null;
      return {
        label: 'Replace scope',
        title: `Replace “${subject}” with HubSpot's current read scopes`,
        apply: () => {
          const app = useEditor.getState().project.app;
          useEditor.getState().updateApp({
            requiredScopes: modernizeScopes(app.requiredScopes),
            optionalScopes: modernizeScopes(app.optionalScopes),
            conditionallyRequiredScopes: modernizeScopes(app.conditionallyRequiredScopes),
          });
          return `Replaced “${subject}” with ${(RETIRED_SCOPES[subject]?.readReplacement ?? []).join(', ')}.`;
        },
      };
    }
    case 'missing-permitted-url': {
      const kind = issue.field?.split('.')[2] as PermittedKind | undefined;
      if (!subject || !kind || !PERMITTED_KINDS.includes(kind)) return null;
      return {
        label: 'Add URL',
        title: `Add ${subject} to the permitted ${kind} URLs now`,
        apply: () => {
          const permitted = useEditor.getState().project.app.permittedUrls;
          if (!permitted[kind].includes(subject)) {
            useEditor.getState().updateApp({ permittedUrls: { ...permitted, [kind]: [...permitted[kind], subject] } });
          }
          return `Added ${subject} to the permitted URLs.`;
        },
      };
    }
    case 'project-name': {
      const slug = toProjectSlug(project.name.trim() || project.app.name);
      if (slug === project.name) return null;
      return {
        label: `Use “${slug}”`,
        title: 'Rename the project to a valid hsproject.json name',
        apply: () => {
          useEditor.getState().updateProjectMeta({ name: slug });
          return `Renamed the project to “${slug}”.`;
        },
      };
    }
    case 'unknown-state': {
      if (issue.field !== 'binding' || !subject || !issue.extensionId || !issue.nodeId) return null;
      const ext = project.extensions.find((e) => e.id === issue.extensionId);
      const node = ext?.nodes[issue.nodeId];
      const vb = node ? getComponent(node.type)?.valueBinding : undefined;
      if (!ext || !vb || ext.state.some((s) => s.name === subject)) return null;
      const nodeId = issue.nodeId;
      return {
        label: `Create “${subject}”`,
        title: `Add a ${vb.stateType} state variable named “${subject}”`,
        apply: () => {
          const st = useEditor.getState();
          if (st.activeExtensionId !== ext.id) st.setActiveExtension(ext.id);
          return asOneUndoStep(() => {
            const v = useEditor.getState().addStateVar({ name: subject, type: vb.stateType, initial: JSON.parse(JSON.stringify(vb.initial)) as JsonValue });
            // The store keeps names unique (e.g. the name is taken by a computed value): bind
            // the variable it actually created.
            if (v.name !== subject) {
              useEditor.getState().updateNode(nodeId, { binding: { state: v.name } });
              return `“${subject}” is already used, so the input is now bound to the new state variable “${v.name}”.`;
            }
            return `Created the state variable “${subject}”.`;
          });
        },
      };
    }
    case 'unknown-name': {
      const to = issue.suggestion;
      if (!subject || !to || !issue.extensionId) return null;
      const extId = issue.extensionId;
      return {
        label: `Use “${to}”`,
        title: `Replace “${subject}” with “${to}” everywhere in this extension (one undo step)`,
        apply: () => {
          let changed = 0;
          useEditor.getState().commit((d) => {
            const e = d.extensions.find((x) => x.id === extId);
            if (e) changed = renameReferences(e as Extension, subject, to);
          });
          return changed > 0 ? `Replaced “${subject}” with “${to}”.` : `“${subject}” was not found any more.`;
        },
      };
    }
    case 'dynamic-url-origin': {
      // The issue key starts with the permitted-URL kind (`img:…`, `fetch:…`, `iframe:…`).
      const kind = issue.id.split('|').slice(4).join('|').split(':')[0] as PermittedKind;
      if (!subject || !PERMITTED_KINDS.includes(kind)) return null;
      return {
        label: 'Add URL',
        title: `Add ${subject} to the permitted ${kind} URLs now`,
        apply: () => {
          const permitted = useEditor.getState().project.app.permittedUrls;
          if (!permitted[kind].includes(subject)) {
            useEditor.getState().updateApp({ permittedUrls: { ...permitted, [kind]: [...permitted[kind], subject] } });
          }
          return `Added ${subject} to the permitted URLs.`;
        },
      };
    }
    case 'data-source-properties': {
      const to = issue.suggestion;
      const dsId = issue.field?.startsWith('dataSource:') ? issue.field.slice('dataSource:'.length) : null;
      if (!subject || !to || !dsId || !issue.extensionId) return null;
      const extId = issue.extensionId;
      return {
        label: `Use “${to}”`,
        title: `Load the standard property “${to}” instead of “${subject}”`,
        apply: () => {
          useEditor.getState().commit((d) => {
            const ds = d.extensions.find((x) => x.id === extId)?.dataSources.find((x) => x.id === dsId);
            if (!ds || !('properties' in ds) || !Array.isArray(ds.properties)) return;
            const i = ds.properties.indexOf(subject);
            if (i === -1) return;
            if (ds.properties.includes(to)) ds.properties.splice(i, 1);
            else ds.properties[i] = to;
          });
          return `The data source now loads “${to}”.`;
        },
      };
    }
    case 'empty-extension': {
      if (!issue.extensionId) return null;
      const extId = issue.extensionId;
      return {
        label: 'Browse components',
        title: 'Open the components palette to add something',
        apply: () => {
          const st = useEditor.getState();
          if (st.activeExtensionId !== extId) st.setActiveExtension(extId);
          showLeftTab('components');
          return 'Drag a component onto the card, or click one to add it.';
        },
      };
    }
    default:
      return null;
  }
}
