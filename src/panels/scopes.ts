/** Common HubSpot OAuth scopes offered as suggestions in the app settings scope editors. */
export interface ScopeInfo {
  scope: string;
  description: string;
}

const s = (scope: string, description: string): ScopeInfo => ({ scope, description });

export const COMMON_SCOPES: ScopeInfo[] = [
  s('oauth', 'Basic OAuth access (always required)'),
  s('crm.objects.contacts.read', 'Read contacts'),
  s('crm.objects.contacts.write', 'Create and edit contacts'),
  s('crm.objects.companies.read', 'Read companies'),
  s('crm.objects.companies.write', 'Create and edit companies'),
  s('crm.objects.deals.read', 'Read deals'),
  s('crm.objects.deals.write', 'Create and edit deals'),
  s('crm.objects.tickets.read', 'Read tickets'),
  s('crm.objects.tickets.write', 'Create and edit tickets'),
  s('crm.schemas.tickets.read', 'Read ticket properties and schema'),
  s('crm.objects.products.read', 'Read products'),
  s('crm.objects.products.write', 'Create and edit products'),
  s('crm.objects.line_items.read', 'Read line items'),
  s('crm.objects.line_items.write', 'Create and edit line items'),
  s('crm.objects.quotes.read', 'Read quotes'),
  s('crm.objects.quotes.write', 'Create and edit quotes'),
  s('crm.objects.custom.read', 'Read custom objects'),
  s('crm.objects.custom.write', 'Create and edit custom objects'),
  s('crm.objects.owners.read', 'Read record owners'),
  s('crm.objects.users.read', 'Read users'),
  s('crm.objects.leads.read', 'Read leads'),
  s('crm.objects.leads.write', 'Create and edit leads'),
  s('crm.objects.invoices.read', 'Read invoices'),
  s('crm.objects.orders.read', 'Read orders'),
  s('crm.objects.carts.read', 'Read carts'),
  s('crm.objects.subscriptions.read', 'Read subscriptions'),
  s('crm.objects.appointments.read', 'Read appointments'),
  s('crm.objects.courses.read', 'Read courses'),
  s('crm.objects.listings.read', 'Read listings'),
  s('crm.objects.services.read', 'Read services'),
  s('crm.objects.feedback_submissions.read', 'Read feedback submissions'),
  s('crm.objects.marketing_events.read', 'Read marketing events'),
  s('crm.objects.marketing_events.write', 'Create and edit marketing events'),
  s('crm.schemas.contacts.read', 'Read contact properties and schema'),
  s('crm.schemas.companies.read', 'Read company properties and schema'),
  s('crm.schemas.deals.read', 'Read deal properties and schema'),
  s('crm.schemas.custom.read', 'Read custom object schemas'),
  s('crm.lists.read', 'Read lists'),
  s('crm.lists.write', 'Create and edit lists'),
  s('crm.import', 'Import CRM records'),
  s('crm.export', 'Export CRM records'),
  s('settings.users.read', 'Read users and teams'),
  s('timeline', 'Create timeline events'),
  s('automation', 'Workflows and sequences'),
  s('conversations.read', 'Read conversations inbox'),
  s('files', 'Upload and manage files'),
  s('forms', 'Read and submit forms'),
  s('content', 'CMS pages, blogs and HubDB'),
  s('hubdb', 'Read and edit HubDB tables'),
  s('transactional-email', 'Send transactional email'),
  s('communication_preferences.read', 'Read subscription preferences'),
];

export function scopeDescription(scope: string): string | undefined {
  return COMMON_SCOPES.find((x) => x.scope === scope)?.description;
}
