import { useState } from 'react';
import { ToastProvider } from './ui';
import { AppShell, bootstrapEditor } from './shell';

/** Root component: restores the last project once, then renders the editor shell. */
export function App() {
  useState(() => {
    bootstrapEditor();
    return true;
  });
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  );
}
