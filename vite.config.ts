import { defineConfig } from 'vite';

// base: './' keeps every asset path relative, so the build works from any
// sub-path (GitHub Pages project sites, local file servers, itch.io, ...).
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
  },
  server: {
    host: true,
    port: 5173,
  },
});
