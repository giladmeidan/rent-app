import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// The brand fonts, self-hosted (no third-party request): Rubik for text, Fredoka 600 for display.
import '@fontsource-variable/rubik';
import '@fontsource/fredoka/600.css';

import { App } from './App';
import './index.css';

const root = document.getElementById('root');
if (root === null) throw new Error('index.html: missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
