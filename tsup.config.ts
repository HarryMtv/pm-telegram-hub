import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    worker: 'src/worker.ts',
  },
  format: ['esm'],
  target: 'node26',
  platform: 'node',
  sourcemap: true,
  clean: true,
  splitting: true,
  shims: false,
});
