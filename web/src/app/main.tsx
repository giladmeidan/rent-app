import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// The brand fonts, self-hosted (no third-party request), one variable file per subset: Rubik for
// text, Fredoka (used at 600) for display. Each subset's unicode-range fetches only what a page uses.
import '@fontsource-variable/rubik/wght.css';
import '@fontsource-variable/fredoka/wght.css';

import { initAnalytics } from './analytics';
import { App } from './App';
import { AppErrorBoundary, initSentry } from './sentry';
import './index.css';

initSentry();
initAnalytics();

const root = document.getElementById('root');
if (root === null) throw new Error('index.html: missing #root');

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
