/**
 * Alerts added with actions.addAlert in the preview. They are drawn in the flow at the top of the
 * card body (pushing the content down, never covering fields or buttons), dismiss themselves after
 * RUNTIME_TIMING.alertDismissMs, and the same alert added again in a row is counted (×2) instead
 * of stacked.
 */
import { X } from 'lucide-react';
import { useInternalRuntime } from './context';
import type { RuntimeAlert } from './types';

export function PreviewAlerts() {
  const rt = useInternalRuntime('PreviewAlerts');
  if (rt.mode !== 'preview' || rt.alerts.length === 0) return null;
  return (
    <div className="hsp-rt-alerts" role="region" aria-label="Alerts">
      {rt.alerts.map((a) => (
        <AlertBanner key={a.id} alert={a} onDismiss={() => rt.dismissAlert(a.id)} />
      ))}
    </div>
  );
}

function AlertBanner({ alert, onDismiss }: { alert: RuntimeAlert; onDismiss: () => void }) {
  return (
    <div className={`hsp-rt-alert hsp-rt-alert-${alert.type}`} role="alert" data-alert-type={alert.type}>
      <div className="hsp-rt-alert-body">
        {alert.title && <strong className="hsp-rt-alert-title">{alert.title}</strong>}
        {alert.message && <span className="hsp-rt-alert-message">{alert.message}</span>}
      </div>
      {alert.count !== undefined && alert.count > 1 && (
        <span className="hsp-rt-alert-count" aria-label={`shown ${alert.count} times`}>
          ×{alert.count}
        </span>
      )}
      <button type="button" className="hsp-rt-alert-dismiss" aria-label="Dismiss alert" onClick={onDismiss}>
        <X size={14} strokeWidth={2.5} aria-hidden="true" />
      </button>
    </div>
  );
}
