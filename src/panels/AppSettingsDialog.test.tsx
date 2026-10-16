import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createExtension, createProject } from '../model/factory';
import { useEditor } from '../model/store';
import { ToastProvider } from '../ui';
import { AppSettingsDialog } from './dialogs';

function setup(arg: string | null = null) {
  const card = createExtension({ name: 'Deals Card', objectTypes: ['contacts', 'deals'] });
  card.dataSources = [
    { id: 'd1', kind: 'associations', name: 'tickets', toObjectType: '0-5', properties: ['subject'], pageLength: 5 },
    { id: 'd2', kind: 'fetch', name: 'api', url: 'https://api.example.com/v1/{{ context.crm.objectId }}', method: 'GET', runOnMount: true },
  ];
  useEditor.getState().loadProject(createProject('My App', [card]));
  const onClose = vi.fn();
  render(
    <ToastProvider>
      <AppSettingsDialog open onClose={onClose} arg={arg} />
    </ToastProvider>,
  );
  return { onClose };
}

const app = () => useEditor.getState().project.app;

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('<AppSettingsDialog>', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<AppSettingsDialog open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('edits the project and app identity with validation', () => {
    const { onClose } = setup();
    const name = screen.getByLabelText('Project name');
    expect(name).toHaveValue('my-app');
    fireEvent.change(name, { target: { value: 'My Cool App' } });
    expect(screen.getByText(/lowercase letters/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use “my-cool-app”' }));
    expect(useEditor.getState().project.name).toBe('my-cool-app');

    fireEvent.change(screen.getByLabelText('Platform version'), { target: { value: '2026.09' } });
    expect(useEditor.getState().project.platformVersion).toBe('2026.09');
    expect(screen.getByRole('option', { name: '2026.03 (default, recommended)' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('App name'), { target: { value: 'Deal Desk' } });
    expect(app().name).toBe('Deal Desk');
    const before = app().uid;
    const uid = screen.getByLabelText('App UID');
    fireEvent.change(uid, { target: { value: 'bad uid' } });
    expect(screen.getByText(/no spaces/)).toBeInTheDocument();
    // Invalid drafts are never stored (not even keystroke by keystroke).
    expect(app().uid).toBe(before);
    fireEvent.change(uid, { target: { value: useEditor.getState().project.extensions[0].uid } });
    fireEvent.keyDown(uid, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('already uses this UID');
    expect(app().uid).toBe(before);
    fireEvent.change(uid, { target: { value: 'deal_desk' } });
    fireEvent.keyDown(uid, { key: 'Enter' });
    expect(app().uid).toBe('deal_desk');

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('adds all scopes suggested from the extensions', () => {
    setup('scopes');
    expect(app().requiredScopes).toEqual(['oauth', 'crm.objects.contacts.read']);
    const suggestions = screen.getByRole('group', { name: 'Suggestions' });
    expect(within(suggestions).getByText('crm.objects.deals.read')).toBeInTheDocument();
    expect(within(suggestions).getByText('crm.objects.tickets.read')).toBeInTheDocument();
    expect(within(suggestions).queryByText('crm.objects.contacts.read')).toBeNull();
    fireEvent.click(within(suggestions).getByRole('button', { name: 'Add all' }));
    expect(app().requiredScopes).toEqual(['oauth', 'crm.objects.contacts.read', 'crm.objects.deals.read', 'crm.objects.tickets.read']);
    expect(screen.queryByRole('group', { name: 'Suggestions' })).toBeNull();
  });

  it('adds a single suggested scope and edits scopes as chips', () => {
    setup('auth');
    fireEvent.click(screen.getByRole('button', { name: 'Add crm.objects.tickets.read' }));
    expect(app().requiredScopes).toContain('crm.objects.tickets.read');
    const optional = screen.getByRole('combobox', { name: 'Optional scopes' });
    fireEvent.focus(optional);
    fireEvent.change(optional, { target: { value: 'crm.lists.re' } });
    fireEvent.keyDown(optional, { key: 'ArrowDown' });
    fireEvent.keyDown(optional, { key: 'Enter' });
    expect(app().optionalScopes).toEqual(['crm.lists.read']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove crm.lists.read' }));
    expect(app().optionalScopes).toEqual([]);
  });

  it('marketplace distribution requires OAuth', () => {
    setup('auth');
    expect(screen.queryByLabelText('New Redirect URL')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Marketplace' }));
    expect(app()).toMatchObject({ distribution: 'marketplace', authType: 'oauth' });
    expect(screen.getByRole('button', { name: 'Static token' })).toBeDisabled();
    expect(screen.getByText(/Marketplace apps must use OAuth/)).toBeInTheDocument();
    const redirect = screen.getByLabelText('New Redirect URL');
    fireEvent.change(redirect, { target: { value: 'ftp://x' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add URL' })[0]);
    expect(screen.getByText('Must start with https://')).toBeInTheDocument();
    fireEvent.change(redirect, { target: { value: 'https://example.com/oauth' } });
    fireEvent.keyDown(redirect, { key: 'Enter' });
    expect(app().redirectUrls).toEqual(['https://example.com/oauth']);
  });

  it('suggests and validates permitted URLs', () => {
    setup('urls');
    const fetchSection = screen.getByRole('region', { name: 'Fetch URLs' });
    expect(within(fetchSection).getByText('https://api.example.com')).toBeInTheDocument();
    fireEvent.click(within(fetchSection).getByRole('button', { name: 'Add https://api.example.com' }));
    expect(app().permittedUrls.fetch).toEqual(['https://api.example.com']);
    const input = within(fetchSection).getByLabelText('New Fetch URL');
    fireEvent.change(input, { target: { value: 'http://insecure.example.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(within(fetchSection).getByText('Must start with https://')).toBeInTheDocument();
    expect(app().permittedUrls.fetch).toHaveLength(1);
  });

  it('opens the tab matching an issue field', () => {
    setup('app.permittedUrls.img');
    expect(screen.getByRole('tab', { name: 'Permitted URLs' })).toHaveAttribute('aria-selected', 'true');
  });

  it('validates support fields', () => {
    setup('support');
    fireEvent.change(screen.getByLabelText('Support email'), { target: { value: 'nope' } });
    expect(screen.getByText('Enter a valid email address')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Support phone'), { target: { value: '555 1234' } });
    expect(screen.getByText(/International format without spaces|international format/i)).toBeInTheDocument();
    expect(app().support.supportEmail).toBe('nope');
  });
});
