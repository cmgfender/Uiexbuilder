import { useState } from 'react';
import { ToastProvider } from './ui';
import { AppShell, EditorErrorBoundary, StartupRecovery, bootstrapEditor } from './shell';

/**
 * Root component: restores the last project once, then renders the editor shell inside a
 * top-level error boundary. When the previous session crashed (or `?safe=1` is in the address)
 * the recovery screen comes first instead of reopening the project automatically.
 */
export function App() {
  const [boot] = useState(() => bootstrapEditor());
  const [recovering, setRecovering] = useState(boot.kind === 'recovery');
  return (
    <ToastProvider>
      {recovering && boot.kind === 'recovery' ? (
        <StartupRecovery guard={boot.guard} safeMode={boot.safeMode} onContinue={() => setRecovering(false)} />
      ) : (
        <EditorErrorBoundary>
          <AppShell />
        </EditorErrorBoundary>
      )}
    </ToastProvider>
  );
}
