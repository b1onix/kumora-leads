import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The React client is same-origin with the API in dev thanks to this proxy,
// so the browser never does a cross-origin request (no CORS headaches).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4820',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
