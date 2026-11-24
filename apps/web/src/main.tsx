import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/bricolage-grotesque/wght.css';
import './styles.css';
import './desktop.css';

import { installChunkReload } from './lib/chunk-reload.ts';

import { getLocale, loadLocale } from './lib/i18n/index.ts';
import { applyTheme, readTheme, syncWidgetTheme } from './lib/theme.ts';

installChunkReload();

document.documentElement.lang = getLocale();

try {
  const theme = readTheme(window.localStorage);
  applyTheme(theme, document.documentElement);
  // Os widgets do celular ficam no mesmo tema (também para quem escolheu antes de os widgets saberem do tema).
  syncWidgetTheme(theme);
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
