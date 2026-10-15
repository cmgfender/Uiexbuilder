/**
 * One-click fixes for problems whose fix is unambiguous (Problems panel "Fix" buttons). Each fix
 * goes through store actions, so it is a single undo step, and returns a confirmation message.
 */
import { toProjectSlug } from '../model/factory';
import { useEditor } from '../model/store';
import type { JsonValue, Project } from '../model/types';
import type { Issue } from '../model/validate';
import { getComponent } from '../registry';
import { showLeftTab } from './shellStore';

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
      return {
        label: `Create “${subject}”`,
        title: `Add a ${vb.stateType} state variable named “${subject}”`,
        apply: () => {
          const st = useEditor.getState();
          if (st.activeExtensionId !== ext.id) st.setActiveExtension(ext.id);
          useEditor.getState().addStateVar({ name: subject, type: vb.stateType, initial: JSON.parse(JSON.stringify(vb.initial)) as JsonValue });
          return `Created the state variable “${subject}”.`;
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
