import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Express server serves the built SPA from ./dist and exposes /api.
// During local dev, proxy /api calls to the running server on 8080.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080'
    }
  }
});
