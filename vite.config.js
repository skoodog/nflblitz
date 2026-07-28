// FOUNDATION — FROZEN after t=0. Do not edit.
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      // index.html only. compare.html is served straight from the repo root by
      // scripts/compare.mjs and must never be bundled (it needs relative access to
      // /bar/ and /shots/, which live outside dist/).
      input: { main: 'index.html' },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5177,
    strictPort: false,
  },
  // Zero network at runtime: no CDN, no external fonts, no remote assets.
  optimizeDeps: { include: ['three'] },
});
