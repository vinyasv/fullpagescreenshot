import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.source.json';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: { rollupOptions: { input: { editor: 'editor.html', progress: 'progress.html' } } },
});
