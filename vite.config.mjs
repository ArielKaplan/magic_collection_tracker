import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

// Vite bundles the whole renderer: the Svelte dashboard (svelte-app.js) and
// the vanilla-JS app modules in src/renderer-js (app-main.js). index.html
// loads both as ES modules; secretlair.js stays a classic script.
export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: resolve(__dirname, 'src/renderer/dist'),
    emptyOutDir: true,
    minify: false,        // easier debugging in DevTools
    sourcemap: true,
    rollupOptions: {
      input: {
        'svelte-app': resolve(__dirname, 'src/renderer-svelte/main.js'),
        'app-main':   resolve(__dirname, 'src/renderer-js/main.js'),
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-chunk.js',
        // Keep the stable stylesheet name index.html links to
        assetFileNames: (info) =>
          info.name && info.name.endsWith('.css') ? 'svelte-app.css' : '[name][extname]',
      },
    },
  },
});
