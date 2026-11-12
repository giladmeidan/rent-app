import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// The brand fonts, self-hosted (no third-party request), one variable file per subset: Rubik for
// text, Fredoka (used at 600) for display. Each subset's unicode-range fetches only what a page uses.
import '@fontsource-variable/rubik/wght.css';
import '@fontsource-variable/fredoka/wght.css';

import { App } from './App';
import './index.css';

const root = document.getElementById('root');
if (root === null) throw new Error('index.html: missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
