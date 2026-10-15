/** App settings: project, app identity, distribution & auth, scopes, permitted URLs and support info. */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Info, Plus, Sparkles } from 'lucide-react';
import { deriveRequirements } from '../codegen/requirements';
import { toProjectSlug } from '../model/factory';
import { useEditor } from '../model/store';
import type { AppConfig, PlatformVersion } from '../model/types';
import { Button, Dialog, Field, Select, TextArea, TextInput, Tabs, cx } from '../ui';
import { Callout, ChipInput, ListEditor } from './common';
import { PLATFORM_VERSIONS, tabFromArg, type AppSettingsTab as Tab } from './appSettingsModel';
import type { DialogComponentProps } from './dialogTypes';
import { COMMON_SCOPES, scopeDescription } from './scopes';
import {
  validateEmail,
  validateHttpsUrl,
  validatePermittedUrl,
  validatePhone,
  validateProjectSlug,
  validateRedirectUrl,
  validateUid,
} from './utils';



const SCOPE_SUGGESTIONS = COMMON_SCOPES.map((s) => ({ value: s.scope, detail: s.description }));

function validateScope(scope: string): string | null {
  return /^[A-Za-z0-9._-]+$/.test(scope) ? null : 'Scopes contain letters, numbers, dots, dashes and underscores';
}


export function AppSettingsDialog({ open, onClose, arg }: DialogComponentProps) {
  const [tab, setTab] = useState<Tab>(tabFromArg(arg));
  useEffect(() => {
    if (open) setTab(tabFromArg(arg));
  }, [open, arg]);
  if (!open) return null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="App settings"
      wide
      footer={
        <>
          <span className="ub-pn-footnote">Changes apply immediately and can be undone.</span>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <Tabs<Tab>
        className="ub-pn-dialog-tabs"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'general', label: 'General' },
          { value: 'auth', label: 'Distribution & scopes' },
          { value: 'urls', label: 'Permitted URLs' },
          { value: 'support', label: 'Support' },
        ]}
      />
      <div className="ub-pn-dialog-pane" role="tabpanel">
        {tab === 'general' && <GeneralTab />}
        {tab === 'auth' && <AuthTab />}
        {tab === 'urls' && <UrlsTab />}
        {tab === 'support' && <SupportTab />}
      </div>
    </Dialog>
  );
}

function useApp(): AppConfig {
  return useEditor((s) => s.project.app);
}

function updateApp(patch: Partial<AppConfig>) {
  useEditor.getState().updateApp(patch);
}

function GeneralTab() {
  const name = useEditor((s) => s.project.name);
  const platformVersion = useEditor((s) => s.project.platformVersion);
  const app = useApp();
  const ids = { project: useId(), version: useId(), appName: useId(), desc: useId(), uid: useId() };
  const slugError = validateProjectSlug(name);
  const uidError = validateUid(app.uid);
  const suggestedSlug = toProjectSlug(name);
  return (
    <div className="ub-pn-form">
      <h3 className="ub-pn-h3">Project</h3>
      <div className="ub-pn-grid2">
        <Field
          label="Project name"
          htmlFor={ids.project}
          error={
            slugError ? (
              <>
                {slugError}
                {suggestedSlug !== name && (
                  <>
                    {' '}
                    <button type="button" className="ub-pn-link" onClick={() => useEditor.getState().updateProjectMeta({ name: suggestedSlug })}>
                      Use “{suggestedSlug}”
                    </button>
                  </>
                )}
              </>
            ) : undefined
          }
          hint="The name in hsproject.json and of the uploaded project, e.g. my-app."
        >
          <TextInput
            id={ids.project}
            code
            value={name}
            invalid={!!slugError}
            onChange={(v) => useEditor.getState().updateProjectMeta({ name: v })}
          />
        </Field>
        <Field label="Platform version" htmlFor={ids.version} hint="2026.03 is the current HubSpot developer platform.">
          <Select
            id={ids.version}
            value={platformVersion}
            options={PLATFORM_VERSIONS}
            onChange={(v) => useEditor.getState().updateProjectMeta({ platformVersion: v as PlatformVersion })}
          />
        </Field>
      </div>
      <h3 className="ub-pn-h3">App</h3>
      <div className="ub-pn-grid2">
        <Field label="App name" htmlFor={ids.appName} hint="Shown to users in HubSpot.">
          <TextInput id={ids.appName} value={app.name} onChange={(v) => updateApp({ name: v })} />
        </Field>
        <Field
          label="App UID"
          htmlFor={ids.uid}
          error={uidError ?? undefined}
          hint="Internal identifier in app-hsmeta.json. Changing it after uploading creates a new app."
        >
          <TextInput id={ids.uid} code value={app.uid} invalid={!!uidError} onChange={(v) => updateApp({ uid: v })} />
        </Field>
      </div>
      <Field label="Description" htmlFor={ids.desc}>
        <TextArea id={ids.desc} rows={3} value={app.description} onChange={(v) => updateApp({ description: v })} />
      </Field>
    </div>
  );
}

function SegmentedChoice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string; disabled?: boolean; title?: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="ub-segmented ub-pn-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={o.disabled}
          title={o.title}
          className={cx(o.disabled && 'ub-pn-seg-disabled')}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Suggested({
  title,
  items,
  onAdd,
  describe,
}: {
  title: ReactNode;
  items: string[];
  onAdd: (items: string[]) => void;
  describe?: (v: string) => string | undefined;
}) {
  if (items.length === 0) return null;
  return (
    <div className="ub-pn-suggested" role="group" aria-label="Suggestions">
      <div className="ub-pn-suggested__head">
        <Sparkles size={13} aria-hidden />
        <span>{title}</span>
        <span className="ub-pn-spacer" />
        {items.length > 1 && (
          <Button size="sm" onClick={() => onAdd(items)}>
            Add all
          </Button>
        )}
      </div>
      <div className="ub-pn-suggested__list">
        {items.map((s) => (
          <span key={s} className="ub-pn-suggested__item" title={describe?.(s)}>
            <code>{s}</code>
            <button type="button" className="ub-pn-link ub-pn-link--icon" aria-label={`Add ${s}`} onClick={() => onAdd([s])}>
              <Plus size={11} aria-hidden /> Add
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

function AuthTab() {
  const app = useApp();
  const project = useEditor((s) => s.project);
  const derived = useMemo(() => deriveRequirements(project), [project]);
  const listed = new Set([...app.requiredScopes, ...app.optionalScopes, ...app.conditionallyRequiredScopes]);
  const missingScopes = derived.scopes.filter((s) => !listed.has(s));
  const marketplace = app.distribution === 'marketplace';
  return (
    <div className="ub-pn-form">
      <h3 className="ub-pn-h3">Distribution & authentication</h3>
      <div className="ub-pn-grid2">
        <Field label="Distribution" hint={marketplace ? 'Listed on the HubSpot App Marketplace.' : 'Installed only in accounts you choose.'}>
          <SegmentedChoice
            label="Distribution"
            value={app.distribution}
            options={[
              { value: 'private', label: 'Private' },
              { value: 'marketplace', label: 'Marketplace' },
            ]}
            onChange={(distribution) => updateApp(distribution === 'marketplace' ? { distribution, authType: 'oauth' } : { distribution })}
          />
        </Field>
        <Field label="Authentication">
          <SegmentedChoice
            label="Authentication"
            value={app.authType}
            options={[
              {
                value: 'static',
                label: 'Static token',
                disabled: marketplace,
                title: marketplace ? 'Marketplace apps must use OAuth' : 'One access token for a single account',
              },
              { value: 'oauth', label: 'OAuth', title: 'Users install the app with OAuth' },
            ]}
            onChange={(authType) => updateApp({ authType })}
          />
        </Field>
      </div>
      {marketplace && (
        <Callout tone="info" icon={<Info size={14} aria-hidden />}>
          Marketplace apps must use OAuth, so static token authentication is turned off.
        </Callout>
      )}
      {app.authType === 'oauth' && (
        <Field label="Redirect URLs" hint="Where HubSpot sends users after they install the app (https://, or http://localhost for testing).">
          <ListEditor
            aria-label="Redirect URL"
            values={app.redirectUrls}
            placeholder="https://example.com/oauth/callback"
            validate={validateRedirectUrl}
            addLabel="Add URL"
            emptyText="No redirect URLs yet."
            onChange={(redirectUrls) => updateApp({ redirectUrls })}
          />
        </Field>
      )}
      <h3 className="ub-pn-h3">Scopes</h3>
      <Suggested
        title="Suggested from your extensions"
        items={missingScopes}
        describe={scopeDescription}
        onAdd={(items) => updateApp({ requiredScopes: [...app.requiredScopes, ...items.filter((s) => !app.requiredScopes.includes(s))] })}
      />
      <Field label="Required scopes" hint="Users must grant these to install the app. “oauth” is always included on export.">
        <ChipInput
          aria-label="Required scopes"
          values={app.requiredScopes}
          suggestions={SCOPE_SUGGESTIONS}
          validate={validateScope}
          describe={scopeDescription}
          placeholder="Add a scope…"
          onChange={(requiredScopes) => updateApp({ requiredScopes })}
        />
      </Field>
      <Field label="Optional scopes" hint="Requested but not required to install.">
        <ChipInput
          aria-label="Optional scopes"
          values={app.optionalScopes}
          suggestions={SCOPE_SUGGESTIONS}
          validate={validateScope}
          describe={scopeDescription}
          placeholder="Add a scope…"
          onChange={(optionalScopes) => updateApp({ optionalScopes })}
        />
      </Field>
      <Field label="Conditionally required scopes" hint="Required only for some installs (e.g. depending on the account’s subscription).">
        <ChipInput
          aria-label="Conditionally required scopes"
          values={app.conditionallyRequiredScopes}
          suggestions={SCOPE_SUGGESTIONS}
          validate={validateScope}
          describe={scopeDescription}
          placeholder="Add a scope…"
          onChange={(conditionallyRequiredScopes) => updateApp({ conditionallyRequiredScopes })}
        />
      </Field>
    </div>
  );
}

const URL_KINDS: Array<{ key: 'fetch' | 'iframe' | 'img'; label: string; hint: string; placeholder: string }> = [
  { key: 'fetch', label: 'Fetch', hint: 'Origins your extensions call with hubspot.fetch.', placeholder: 'https://api.example.com' },
  { key: 'iframe', label: 'Iframe', hint: 'Pages opened in iframe modals.', placeholder: 'https://app.example.com' },
  { key: 'img', label: 'Images', hint: 'Hosts of images shown with the Image component.', placeholder: 'https://images.example.com' },
];

function UrlsTab() {
  const app = useApp();
  const project = useEditor((s) => s.project);
  const derived = useMemo(() => deriveRequirements(project), [project]);
  const norm = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase();
  return (
    <div className="ub-pn-form">
      <Callout tone="info" icon={<Info size={14} aria-hidden />}>
        HubSpot only allows requests to permitted URLs. Export adds the origins your extensions use automatically — add others here,
        for example URLs built from dynamic values.
      </Callout>
      {URL_KINDS.map((k) => {
        const values = app.permittedUrls[k.key];
        const present = new Set(values.map(norm));
        const missing = derived[k.key].filter((u) => !present.has(norm(u)));
        const set = (next: string[]) => updateApp({ permittedUrls: { ...app.permittedUrls, [k.key]: next } });
        return (
          <section key={k.key} className="ub-pn-form" aria-label={`${k.label} URLs`}>
            <h3 className="ub-pn-h3">{k.label}</h3>
            <div className="ub-pn-muted">{k.hint}</div>
            <Suggested title="Used by your extensions (added on export)" items={missing} onAdd={(items) => set([...values, ...items])} />
            <ListEditor
              aria-label={`${k.label} URL`}
              values={values}
              placeholder={k.placeholder}
              validate={validatePermittedUrl}
              addLabel="Add URL"
              emptyText="None added manually."
              onChange={set}
            />
          </section>
        );
      })}
    </div>
  );
}

function SupportTab() {
  const app = useApp();
  const support = app.support;
  const ids = { email: useId(), docs: useId(), url: useId(), phone: useId() };
  const set = (patch: Partial<AppConfig['support']>) => updateApp({ support: { ...support, ...patch } });
  const errors = {
    email: validateEmail(support.supportEmail),
    docs: validateHttpsUrl(support.documentationUrl),
    url: validateHttpsUrl(support.supportUrl),
    phone: validatePhone(support.supportPhone),
  };
  return (
    <div className="ub-pn-form">
      <div className="ub-pn-muted">How users reach you. Empty fields are left out of app-hsmeta.json; marketplace listings require them.</div>
      <div className="ub-pn-grid2">
        <Field label="Support email" htmlFor={ids.email} error={errors.email ?? undefined}>
          <TextInput
            id={ids.email}
            type="email"
            value={support.supportEmail}
            invalid={!!errors.email}
            placeholder="support@example.com"
            onChange={(supportEmail) => set({ supportEmail })}
          />
        </Field>
        <Field label="Support phone" htmlFor={ids.phone} error={errors.phone ?? undefined} hint="International format, e.g. +18005555555.">
          <TextInput
            id={ids.phone}
            value={support.supportPhone}
            invalid={!!errors.phone}
            placeholder="+18005555555"
            onChange={(supportPhone) => set({ supportPhone })}
          />
        </Field>
        <Field label="Documentation URL" htmlFor={ids.docs} error={errors.docs ?? undefined}>
          <TextInput
            id={ids.docs}
            value={support.documentationUrl}
            invalid={!!errors.docs}
            placeholder="https://example.com/docs"
            onChange={(documentationUrl) => set({ documentationUrl })}
          />
        </Field>
        <Field label="Support URL" htmlFor={ids.url} error={errors.url ?? undefined}>
          <TextInput
            id={ids.url}
            value={support.supportUrl}
            invalid={!!errors.url}
            placeholder="https://example.com/support"
            onChange={(supportUrl) => set({ supportUrl })}
          />
        </Field>
      </div>
    </div>
  );
}
