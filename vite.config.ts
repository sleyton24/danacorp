import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
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
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
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
