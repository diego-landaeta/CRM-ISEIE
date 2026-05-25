import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const BASE = process.env.VITE_BASE_PATH || '/';

export default defineConfig({
  plugins: [react()],
  base: BASE,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        // Manual chunks conservador: separa solo libs que se sabe son grandes.
        // El resto se deja al automatic chunking de Rollup (que respeta orden
        // de imports y evita el bug de "PureComponent undefined" por libs que
        // dependen de React cargadas antes que React).
        manualChunks: {
          'vendor-charts': ['recharts'],
          'vendor-icons': ['@phosphor-icons/react'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3005',
        changeOrigin: true,
      },
    },
  },
});
