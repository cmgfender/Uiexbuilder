import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createExtension, createProject, DEFAULT_FUNCTION_CODE } from '../model/factory';
import { useEditor } from '../model/store';
import { ToastProvider } from '../ui';
import { FunctionsDialog } from './dialogs';

let fnA = '';
let fnB = '';

beforeEach(() => {
  const card = createExtension({
    name: 'Quote Card',
    content: [
      {
        type: 'Button',
        name: 'Get quote',
        text: 'Quote',
        events: { onClick: [{ id: 'a1', type: 'runFunction', functionId: '__B__' }] },
      },
    ],
  });
  useEditor.getState().loadProject(createProject('Fn App', [card]));
  act(() => {
    fnA = useEditor.getState().addFunction('alpha').id;
    fnB = useEditor.getState().addFunction('beta').id;
    useEditor.getState().commit((d) => {
      for (const n of Object.values(d.extensions[0].nodes)) {
        const step = n.events?.onClick?.[0];
        if (step?.type === 'runFunction') step.functionId = fnB;
      }
      d.extensions[0].dataSources.push({ id: 'd1', kind: 'function', name: 'quote', functionId: fnB, runOnMount: true });
    });
  });
});

function renderDialog(arg: string | null = null) {
  const onClose = vi.fn();
  render(
    <ToastProvider>
      <FunctionsDialog open onClose={onClose} arg={arg} />
    </ToastProvider>,
  );
  return { onClose };
}

const fn = (id: string) => useEditor.getState().project.functions.find((f) => f.id === id)!;

describe('<FunctionsDialog>', () => {
  it('preselects the function passed as arg and lists its usages', () => {
    const { onClose } = renderDialog(fnB);
    expect(screen.getByRole('option', { name: /beta/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'Function UID' })).toHaveValue('beta');
    expect(screen.getByText('Quote Card · Data source “quote”')).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Quote Card · Get quote · On click/));
    const s = useEditor.getState();
    expect(s.selectedNodeId).toBe(Object.values(s.project.extensions[0].nodes).find((n) => n.name === 'Get quote')!.id);
    expect(onClose).toHaveBeenCalled();
  });

  it('checks syntax, resets to the example and validates names', () => {
    renderDialog(fnA);
    const code = screen.getByLabelText('Code');
    fireEvent.change(code, { target: { value: 'exports.main = async () => {' } });
    expect(screen.getByRole('status', { name: 'Syntax check' })).toHaveTextContent('Syntax error');
    fireEvent.change(code, { target: { value: 'const x = 1;' } });
    expect(screen.getByRole('status', { name: 'Syntax check' })).toHaveTextContent('must export a handler');
    fireEvent.click(screen.getByRole('button', { name: 'Reset to example' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    expect(fn(fnA).code).toBe(DEFAULT_FUNCTION_CODE);
    expect(screen.getByRole('status', { name: 'Syntax check' })).toHaveTextContent('Syntax OK · exports main');

    const uid = screen.getByRole('textbox', { name: 'Function UID' });
    fireEvent.change(uid, { target: { value: 'beta' } });
    fireEvent.keyDown(uid, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('already used');
    fireEvent.change(uid, { target: { value: 'get_quote' } });
    fireEvent.keyDown(uid, { key: 'Enter' });
    expect(fn(fnA).uid).toBe('get_quote');
  });

  it('edits secrets and the endpoint', () => {
    renderDialog(fnA);
    const secrets = screen.getByRole('combobox', { name: 'Secret names' });
    fireEvent.change(secrets, { target: { value: 'API_KEY' } });
    fireEvent.keyDown(secrets, { key: 'Enter' });
    expect(fn(fnA).secretKeys).toEqual(['API_KEY']);
    fireEvent.click(screen.getByLabelText('Expose as a public endpoint'));
    expect(fn(fnA).endpoint).toEqual({ path: 'alpha', methods: ['GET'] });
    fireEvent.click(screen.getByRole('checkbox', { name: 'POST' }));
    expect(fn(fnA).endpoint?.methods).toEqual(['GET', 'POST']);
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '/bad path' } });
    expect(screen.getByText(/no leading slash/)).toBeInTheDocument();
  });

  it('adds and deletes functions', () => {
    renderDialog(fnA);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(useEditor.getState().project.functions).toHaveLength(3);
    expect(screen.getByRole('textbox', { name: 'Function UID' })).toHaveValue('myfunction');
    fireEvent.click(screen.getByRole('button', { name: 'Delete function' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete function' }).at(-1)!);
    expect(useEditor.getState().project.functions).toHaveLength(2);
  });

  it('shows a guided empty state without functions', () => {
    useEditor.getState().loadProject(createProject('Empty'));
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Create a function' }));
    expect(useEditor.getState().project.functions).toHaveLength(1);
    expect(screen.getByText(/hubspot\.serverless\('myfunction'/)).toBeInTheDocument();
  });
});
