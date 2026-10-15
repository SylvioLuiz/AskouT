import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// A gestão roda em outra porta (5174) e outro endereço que o app dos usuários (5173).
// Em desenvolvimento, /api vai para a API local (porta 3000), então não há CORS para configurar.
// Em produção, sirva este app em um endereço próprio (ex.: gestao.seudominio.com) e inclua-o em CORS_ORIGINS da API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
