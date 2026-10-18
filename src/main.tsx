import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import './preview/hubspot.css';
import { App } from './App';
import { isStatusPath } from './status/paths';
import { installErrorReporter } from './status/reporter';

// Errors in the builder reach the host's private status page (only when the builder has its server).
installErrorReporter();

const root = createRoot(document.getElementById('root')!);

if (isStatusPath(window.location.pathname)) {
  // The host's private status page (/status) instead of the editor; loaded on demand.
  import('./status/StatusPage')
    .then(({ StatusPage }) =>
      root.render(
        <StrictMode>
          <StatusPage />
        </StrictMode>,
      ),
    )
    .catch(() => {
      root.render(
        <p style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
          The status page couldn’t load (the builder may have just been updated). <a href="/status">Reload the page</a>.
        </p>,
      );
    });
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
