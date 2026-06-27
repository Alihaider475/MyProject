import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    open: true,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true, ws: true, secure: false },
      '/frames': { target: 'http://localhost:8000', changeOrigin: true, secure: false },
      '/ws': { target: 'ws://localhost:8000', changeOrigin: true, ws: true, secure: false },
    },
  },
  build: {
    // Output to project-root /dist so FastAPI's existing static-file mount
    // (which checks for "dist/" at the CWD) picks it up automatically.
    outDir: '../dist',
    emptyOutDir: true,
  },
});
