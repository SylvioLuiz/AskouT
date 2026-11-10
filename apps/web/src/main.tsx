import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

import { installChunkReload } from './lib/chunk-reload.ts';

import { getLocale, loadLocale } from './lib/i18n/index.ts';
import { applyTheme, readTheme } from './lib/theme.ts';

installChunkReload();

document.documentElement.lang = getLocale();

try {
  applyTheme(readTheme(window.localStorage), document.documentElement);
} catch {
  // sem armazenamento: fica no automático
}

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root não encontrado');

// O app é importado só depois do dicionário: vários textos são traduzidos já ao carregar os módulos.
void loadLocale().then(async () => {
  const { App } = await import('./App.tsx');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
