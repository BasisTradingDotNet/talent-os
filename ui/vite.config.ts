import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // Type-only imports of the frozen HTTP contract. Nothing runtime crosses this alias.
    alias: { '@contracts': path.resolve(__dirname, '../api/src/contracts') },
  },
  server: {
    port: 5174,
    host: true,
    proxy: { '/api': { target: process.env.API_URL ?? 'http://127.0.0.1:4310', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: false },
});
