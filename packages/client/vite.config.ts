import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        canary: resolve(__dirname, 'canary.html'),
      },
    },
  },
  test: {
    environment: 'node',
  },
});
