import { defineConfig, type Plugin } from 'vite';

/**
 * 1.8.8 stage 4: the page may send exactly one kind of form — the purchase, to Robokassa's own payment page
 * (index.html: `form-action https://auth.robokassa.ru`). The dev server alone also lets it reach the local
 * stand-in of that page on 127.0.0.1 (`npm run payments:sandbox`); a production build keeps Robokassa only.
 */
function devPaymentEmulator(): Plugin {
  return {
    name: 'prime-dev-payment-emulator-csp',
    apply: 'serve',
    transformIndexHtml: (html) => html.replace('form-action https://auth.robokassa.ru', 'form-action https://auth.robokassa.ru http://127.0.0.1:*'),
  };
}

// base: './' keeps every asset path relative, so the build works from any
// sub-path (GitHub Pages project sites, local file servers, itch.io, ...).
export default defineConfig({
  plugins: [devPaymentEmulator()],
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
