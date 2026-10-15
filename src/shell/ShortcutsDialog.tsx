/** Keyboard shortcuts reference (opened with `?` or Help → Keyboard shortcuts). */
import type { DialogComponentProps } from '../panels/dialogs';
import { Dialog } from '../ui';
import { SHORTCUTS, SHORTCUT_GROUPS, isMacPlatform, shortcutKeys } from './shortcuts';

export function Keys({ keys, className }: { keys: string; className?: string }) {
  const mac = isMacPlatform();
  return (
    <span className={className ?? 'ub-sh-keys'} aria-label={keys.replace(/\+/g, ' ')}>
      {shortcutKeys(keys, mac).map((k, i) => (
        <kbd key={i} className="ub-sh-kbd">
          {k}
        </kbd>
      ))}
    </span>
  );
}

export function ShortcutsDialog({ open, onClose }: DialogComponentProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" wide>
      <div className="ub-sh-keys-grid">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group} className="ub-sh-keys-group" aria-label={group}>
            <h3 className="ub-sh-keys-title">{group}</h3>
            <dl className="ub-sh-keys-list">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={s.id} className="ub-sh-keys-row">
                  <dt className="ub-sh-keys-desc">{s.description}</dt>
                  <dd className="ub-sh-keys-keys">
                    <Keys keys={s.keys} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="ub-sh-keys-note">
        {isMacPlatform() ? '⌘ is the Command key.' : 'On macOS use ⌘ instead of Ctrl.'} Shortcuts are paused while you type in a field.
      </p>
    </Dialog>
  );
}
