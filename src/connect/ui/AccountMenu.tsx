/**
 * Account popover of the connected HubSpot account: which account and user, what the builder may
 * see (granted permissions, expandable), Open HubSpot, Status page (admins of this builder only),
 * Switch account and Disconnect.
 */
import { useState } from 'react';
import { Activity, Check, ChevronDown, ChevronRight, ExternalLink, LogOut, Minus, RefreshCw, Repeat } from 'lucide-react';
import { Button } from '../../ui';
import type { ConnectionInfo } from '../types';
import { scopeLabel } from '../describe';
import { useConnection } from '../store';
import { connectedAppsUrl, portalHomeUrl } from './links';
import { useStatusAdmin } from '../../status/useStatusAdmin';
import { STATUS_PAGE_PATH } from '../../status/paths';

export interface AccountMenuProps {
  info: Extract<ConnectionInfo, { connected: true }>;
  onDone: () => void;
}

export function accountInitial(info: Extract<ConnectionInfo, { connected: true }>): string {
  const source = info.hubDomain || info.user.email || 'H';
  return source.replace(/^www\./, '').charAt(0).toUpperCase() || 'H';
}

export function AccountMenu({ info, onDone }: AccountMenuProps) {
  const health = useConnection((s) => s.health);
  const error = useConnection((s) => s.error);
  const [showScopes, setShowScopes] = useState(false);
  const statusAdmin = useStatusAdmin();
  const granted = info.scopes;
  const missingOptional = (health?.scopes.optional ?? []).filter((s) => !granted.includes(s));

  return (
    <div className="ub-cn-account">
      <div className="ub-cn-account__head">
        <span className="ub-cn-avatar ub-cn-avatar--lg" aria-hidden>
          {accountInitial(info)}
        </span>
        <div className="ub-cn-account__who">
          <div className="ub-cn-account__portal">{info.hubDomain || `Account ${info.portalId}`}</div>
          <div className="ub-cn-account__meta">Account ID {info.portalId}</div>
          {info.user.email && <div className="ub-cn-account__meta">Signed in as {info.user.email}</div>}
        </div>
      </div>

      <p className="ub-cn-account__note">
        <Check size={13} aria-hidden /> Read-only: the builder can't change anything in HubSpot.
      </p>

      {error && (
        <p className="ub-cn-account__error" role="alert">
          {error}
        </p>
      )}

      <button type="button" className="ub-cn-disclosure" aria-expanded={showScopes} onClick={() => setShowScopes((v) => !v)}>
        {showScopes ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
        What the builder can see ({granted.length})
      </button>
      {showScopes && (
        <div className="ub-cn-account__scopes">
          <ul className="ub-cn-scope-list ub-cn-scope-list--granted" aria-label="Allowed">
            {granted.map((s) => (
              <li key={s} title={s}>
                <Check size={12} aria-hidden /> {scopeLabel(s)}
              </li>
            ))}
          </ul>
          {missingOptional.length > 0 && (
            <>
              <div className="ub-cn-scope-groups__title">Not included in this connection</div>
              <ul className="ub-cn-scope-list ub-cn-scope-list--missing" aria-label="Not included in this connection">
                {missingOptional.map((s) => (
                  <li key={s} title={s}>
                    <Minus size={12} aria-hidden /> {scopeLabel(s)}
                  </li>
                ))}
              </ul>
              <p className="ub-cn-account__hint">
                Usually your HubSpot plan or your user doesn’t include them. Reconnecting can add them if that changed; otherwise a Super Admin can
                check your user’s permissions.
              </p>
              <Button
                size="sm"
                icon={<RefreshCw size={13} aria-hidden />}
                onClick={() => {
                  onDone();
                  void useConnection.getState().connect();
                }}
              >
                Reconnect HubSpot
              </Button>
            </>
          )}
        </div>
      )}

      <div className="ub-cn-account__actions">
        <a className="ub-btn ub-btn--sm ub-cn-account__action" href={portalHomeUrl(info)} target="_blank" rel="noopener noreferrer" onClick={onDone}>
          <ExternalLink size={13} aria-hidden /> Open HubSpot
        </a>
        {statusAdmin && (
          <a className="ub-btn ub-btn--sm ub-cn-account__action" href={STATUS_PAGE_PATH} title="Sign-ins, publishes and errors on this builder, with fixes" onClick={onDone}>
            <Activity size={13} aria-hidden /> Status page
          </a>
        )}
        <Button
          size="sm"
          className="ub-cn-account__action"
          icon={<Repeat size={13} aria-hidden />}
          title="Sign in to a different HubSpot account"
          onClick={() => {
            onDone();
            void useConnection.getState().switchPortal();
          }}
        >
          Switch account
        </Button>
        <Button
          size="sm"
          variant="danger"
          className="ub-cn-account__action"
          icon={<LogOut size={13} aria-hidden />}
          onClick={() => {
            onDone();
            void useConnection.getState().disconnect();
          }}
        >
          Disconnect
        </Button>
      </div>
      <p className="ub-cn-account__hint">
        You can also remove access in HubSpot:{' '}
        <a href={connectedAppsUrl(info)} target="_blank" rel="noopener noreferrer">
          Connected apps
        </a>
        .
      </p>
    </div>
  );
}
