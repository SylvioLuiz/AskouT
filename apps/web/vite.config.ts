import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Em desenvolvimento, tudo que começa com /api vai para a API local (porta 3000),
// então o navegador só fala com um endereço e não há CORS para configurar.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
