import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useEditor } from '../model/store';
import { getComponent, listComponents } from '../registry';
import { ToastProvider } from '../ui';
import { Palette } from './Palette';
import { componentScore, highlightSegments, searchComponents, searchTerms } from './paletteModel';
import { paletteInsertTarget } from './actions';
import { focusPaletteSearch } from './shellStore';
import { activeNodes, projectWith, resetEditor, rootChildren } from './testUtils';
import { selectActiveExtension } from '../model/store';

function renderPalette() {
  return render(
    <ToastProvider>
      <Palette />
    </ToastProvider>,
  );
}

const tile = (type: string) => document.querySelector<HTMLButtonElement>(`.ub-sh-pal-tile[data-component-type="${type}"]`);

describe('palette search (logic)', () => {
  it('matches label, type, keywords and description; label hits rank first', () => {
    const defs = listComponents();
    const results = searchComponents(defs, 'button').map((d) => d.type);
    expect(results[0]).toBe('Button');
    expect(results).toContain('LoadingButton');
    expect(results).not.toContain('Text');
    // keyword-only match (Button has keyword 'cta')
    expect(searchComponents(defs, 'cta').map((d) => d.type)).toContain('Button');
    // every term must match
    expect(componentScore(getComponent('Button')!, searchTerms('button zzzz'))).toBe(0);
  });

  it('marks matched ranges for highlighting', () => {
    expect(highlightSegments('Loading button', ['butt'])).toEqual([
      { text: 'Loading ', match: false },
      { text: 'butt', match: true },
      { text: 'on', match: false },
    ]);
  });
});

describe('<Palette>', () => {
  it('groups components by category and hides nothing that is placeable', () => {
    resetEditor();
    renderPalette();
    expect(screen.getByRole('region', { name: 'Layout' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Charts' })).toBeInTheDocument();
    expect(tile('Flex')).toBeInTheDocument();
    expect(screen.getByText('Drag onto the canvas or click to add')).toBeInTheDocument();
  });

  it('filters by search with highlighted matches and an empty state', () => {
    resetEditor();
    renderPalette();
    const input = screen.getByLabelText('Search components');
    fireEvent.change(input, { target: { value: 'butt' } });
    expect(tile('Button')).toBeInTheDocument();
    expect(tile('Text')).toBeNull();
    expect(tile('Button')!.querySelector('mark')?.textContent?.toLowerCase()).toBe('butt');

    fireEvent.change(input, { target: { value: 'qqqxyz' } });
    expect(screen.getByText(/No components match/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Clear search'));
    expect(tile('Text')).toBeInTheDocument();
  });

  it('collapses a category group', () => {
    resetEditor();
    renderPalette();
    const group = screen.getByRole('region', { name: 'Layout' });
    const head = within(group).getByRole('button', { name: /Layout/ });
    expect(head).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(head);
    expect(head).toHaveAttribute('aria-expanded', 'false');
    expect(tile('Flex')).toBeNull();
  });

  it('click adds at the root, or inside the selected container, and tracks recents', () => {
    resetEditor(projectWith([{ type: 'Flex', props: {}, children: [] }]));
    renderPalette();
    const [flex] = rootChildren();
    fireEvent.click(tile('Text')!);
    // Nothing selected -> end of root, and the new node is selected.
    expect(rootChildren()).toHaveLength(2);
    const added = rootChildren()[1];
    expect(activeNodes()[added].type).toBe('Text');
    expect(useEditor.getState().selectedNodeId).toBe(added);

    useEditor.getState().select(flex);
    fireEvent.click(tile('Heading')!);
    expect(activeNodes()[flex].children.map((id) => activeNodes()[id].type)).toEqual(['Heading']);

    expect(screen.getByRole('region', { name: 'Recently used' })).toBeInTheDocument();
  });

  it('Enter in the search box inserts the best match', () => {
    resetEditor(projectWith([]));
    renderPalette();
    const input = screen.getByLabelText('Search components');
    fireEvent.change(input, { target: { value: 'divider' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(rootChildren().map((id) => activeNodes()[id].type)).toEqual(['Divider']);
  });

  it('tells the user when a component has nowhere to go', () => {
    resetEditor(projectWith([]));
    renderPalette();
    fireEvent.click(tile('Tab')!);
    expect(rootChildren()).toHaveLength(0);
    expect(screen.getByText(/Select a Tabs first/)).toBeInTheDocument();
  });

  it('attaches overlays to the selected trigger', () => {
    resetEditor(projectWith([{ type: 'Button', text: 'Open' }]));
    renderPalette();
    const [button] = rootChildren();
    const ext = selectActiveExtension(useEditor.getState());
    expect(paletteInsertTarget(ext, button, 'Modal')).toEqual({ parentId: button, slot: 'overlay', index: 0 });
    useEditor.getState().select(button);
    fireEvent.click(tile('Modal')!);
    const overlay = activeNodes()[button].slots?.overlay ?? [];
    expect(overlay).toHaveLength(1);
    expect(activeNodes()[overlay[0]].type).toBe('Modal');
  });

  it('disables components unavailable in the extension location, with a reason', () => {
    resetEditor(projectWith([], 'settings'));
    renderPalette();
    const crm = tile('CrmPropertyList')!;
    expect(crm).toHaveAttribute('aria-disabled', 'true');
    expect(crm.getAttribute('title')).toMatch(/only works in CRM locations/);
    expect(crm).toHaveAttribute('draggable', 'false');
    fireEvent.click(crm);
    expect(rootChildren()).toHaveLength(0);
    expect(tile('Text')).not.toHaveAttribute('aria-disabled');
  });

  it('starts a "new" drag with the component type', () => {
    resetEditor();
    renderPalette();
    const data: Record<string, string> = {};
    const dataTransfer = {
      setData: (k: string, v: string) => {
        data[k] = v;
      },
      getData: (k: string) => data[k],
      setDragImage: () => {},
      types: [] as string[],
      effectAllowed: 'all',
      dropEffect: 'none',
    };
    fireEvent.dragStart(tile('Button')!, { dataTransfer });
    expect(JSON.parse(data['application/x-uiex-dnd'])).toEqual({ kind: 'new', componentType: 'Button' });
    // The palette must not re-render its groups while the drag starts (that cancels real drags).
    expect(screen.queryByRole('region', { name: 'Recently used' })).toBeNull();
    // A cancelled drag is not "used"…
    fireEvent.dragEnd(tile('Button')!, { dataTransfer });
    expect(screen.queryByRole('region', { name: 'Recently used' })).toBeNull();
    // …a completed one is.
    fireEvent.dragStart(tile('Button')!, { dataTransfer });
    fireEvent.dragEnd(tile('Button')!, { dataTransfer: { ...dataTransfer, dropEffect: 'copy' } });
    expect(screen.getByRole('region', { name: 'Recently used' })).toBeInTheDocument();
  });

  it('focuses the search box on request (Cmd+/)', () => {
    resetEditor();
    renderPalette();
    act(() => focusPaletteSearch());
    expect(document.activeElement).toBe(screen.getByLabelText('Search components'));
  });
});
