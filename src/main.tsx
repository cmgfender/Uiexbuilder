import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import './preview/hubspot.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
