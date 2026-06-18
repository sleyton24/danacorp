import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
  return {
    root: '.',
    server: {
      port: 3000,
      host: '0.0.0.0',
      proxy: {
        '/api': 'http://localhost:3001',
        '/uploads': 'http://localhost:3001',
      },
    },
    plugins: [react()],
    // NOTA: la API key de Gemini ya NO se inyecta en el bundle (se usaba define para
    // process.env.API_KEY). La extracción con IA ahora va por el backend.
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        // Stub html2canvas — jspdf-autotable depends on it but we only use
        // the `body:` API (not `html:` DOM capture), so html2canvas is never called.
        // This removes ~200 KB from the production bundle.
        'html2canvas': path.resolve(__dirname, 'src/__stubs__/html2canvas.ts'),
      },
    },
  };
});
