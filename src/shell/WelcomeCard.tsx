/** First-visit welcome card shown over the canvas (dismissal is remembered in localStorage). */
import { useState } from 'react';
import { LayoutTemplate, MousePointerClick, X } from 'lucide-react';
import { createProject } from '../model/factory';
import { selectActiveExtension, useEditor } from '../model/store';
import { PROJECT_TEMPLATES } from '../templates';
import { Button, IconButton, useToast } from '../ui';
import { useDialogs } from './dialogs';
import { dismissWelcome, isWelcomeDismissed } from './persistence';
import { useShell } from './shellStore';
import { LogoMark } from './TopBar';

/** Opens a sample card: a starter template when available, else the current card. */
export function exploreSample(notify: (msg: string) => void): void {
  const state = useEditor.getState();
  const cards = PROJECT_TEMPLATES.filter((t) => t.kind === 'card');
  const tpl = cards.find((t) => /summary|overview/i.test(`${t.id} ${t.name}`)) ?? cards[0];
  if (tpl) {
    const pristine = state.past.length === 0 && useShell.getState().saveStatus === 'idle';
    if (pristine) {
      const ext = tpl.build([]);
      state.loadProject(createProject(state.project.app.name, [ext]));
    } else {
      state.addExtensionFromObject(tpl.build(state.project.extensions));
    }
  }
  const ext = selectActiveExtension(useEditor.getState());
  const first = ext.nodes[ext.rootId]?.children[0] ?? null;
  useEditor.getState().setMode('design');
  useEditor.getState().select(first);
  notify('Click any component to edit it — press Preview to try the card with mock data');
}

export function WelcomeCard() {
  const toast = useToast();
  const [visible, setVisible] = useState(() => !isWelcomeDismissed());
  if (!visible) return null;
  const close = () => {
    dismissWelcome();
    setVisible(false);
  };
  return (
    <div className="ub-sh-welcome" role="region" aria-label="Welcome">
      <LogoMark size={36} />
      <div className="ub-sh-welcome-text">
        <div className="ub-sh-welcome-title">Build HubSpot app cards without writing code</div>
        <div className="ub-sh-welcome-body">
          Drag components onto the card, wire up data and actions in plain language, preview it with mock CRM data, then
          export a project you can deploy with <code>hs project upload</code>.
        </div>
        <div className="ub-sh-welcome-actions">
          <Button
            variant="primary"
            icon={<LayoutTemplate size={14} />}
            onClick={() => {
              close();
              useDialogs.getState().open('newProject');
            }}
          >
            Start from a template
          </Button>
          <Button
            icon={<MousePointerClick size={14} />}
            onClick={() => {
              close();
              exploreSample(toast);
            }}
          >
            Explore the sample card
          </Button>
        </div>
      </div>
      <IconButton label="Dismiss" size="sm" className="ub-sh-welcome-close" onClick={close}>
        <X size={14} />
      </IconButton>
    </div>
  );
}
