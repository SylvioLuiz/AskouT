import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/figtree';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

import { applyTheme, readTheme } from './lib/theme.ts';

try {
  applyTheme(readTheme(window.localStorage), document.documentElement);
} catch {
  // sem armazenamento: fica no automático
}

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root não encontrado');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
