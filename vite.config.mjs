import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

// Vite is used to bundle the Svelte renderer into a single ES module that the
// existing index.html loads alongside (and progressively replaces) the legacy
// vanilla-JS app.js. Each new tab/component gets ported one at a time.
export default defineConfig({
  plugins: [svelte()],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/renderer-svelte/main.js'),
      formats: ['es'],
      fileName: () => 'svelte-app.js',
    },
    outDir: resolve(__dirname, 'src/renderer/dist'),
    emptyOutDir: true,
    minify: false,        // easier debugging in DevTools
    sourcemap: true,
    rollupOptions: {
      output: {
        assetFileNames: 'svelte-app[extname]',
      },
    },
  },
});
