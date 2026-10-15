import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { resolveCreateTemplate, useEditor } from '../model/store';
import { listComponents } from '../registry';
import { Inspector } from './Inspector';
import { loadWith, topNode } from './testUtils';

/** Every registry component renders in every inspector tab without crashing. */
describe('Inspector smoke', () => {
  const defs = listComponents();
  it.each(defs.map((d) => [d.type]))('%s renders all tabs', (type) => {
    loadWith([resolveCreateTemplate(type)], 'card', { location: 'crm.record.tab' });
    const node = topNode();
    act(() => useEditor.getState().select(node.id));
    const { container, unmount } = render(<Inspector />);
    expect(container.querySelector('.ub-insp-head__type')?.textContent).toBe(type);
    for (const tab of ['events', 'advanced', 'properties'] as const) {
      act(() => useEditor.getState().setRightPanel(tab));
      expect(container.querySelector('.ub-insp-body')).toBeTruthy();
    }
    unmount();
  });

  it('renders extension settings for each extension kind', () => {
    for (const kind of ['card', 'settings', 'home'] as const) {
      loadWith([], kind);
      const { getByText, unmount } = render(<Inspector />);
      expect(getByText(kind === 'card' ? 'App card' : kind === 'settings' ? 'Settings page' : 'App home')).toBeInTheDocument();
      unmount();
    }
  });
});
