import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { PluginOption } from 'vite';

// Em desenvolvimento, tudo que começa com /api vai para a API local (porta 3000),
// então o navegador só fala com um endereço e não há CORS para configurar.
//
// `npm run dev:https` serve em https com certificado de desenvolvimento autoassinado e aceita conexões da
// rede local: é o que permite testar a localização (Flash) num celular, já que o navegador só libera o GPS
// em conexão segura. O aviso de "site não seguro" do certificado é esperado nesse modo.
const useHttps = process.env['HTTPS'] === '1';
const plugins: PluginOption[] = [react()];
if (useHttps) {
  const { default: basicSsl } = await import('@vitejs/plugin-basic-ssl');
  plugins.push(basicSsl());
}

export default defineConfig({
  plugins,
  server: {
    port: 5173,
    host: useHttps ? true : undefined,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
