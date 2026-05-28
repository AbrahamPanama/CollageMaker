import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted display + UI fonts (so the app works fully offline as a Tauri bundle).
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/900.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/fraunces/400.css';
import '@fontsource/fraunces/700.css';
import '@fontsource/fraunces/900.css';
import '@fontsource/playfair-display/900.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/archivo-black/400.css';
import '@fontsource/caveat/700.css';
import '@fontsource/dm-mono/500.css';
import '@fontsource/abril-fatface/400.css';
import '@fontsource/rubik-mono-one/400.css';

import { App } from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
