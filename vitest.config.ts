import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Tests import the engine via its package name; resolve to source so the
      // suite runs without a prior build.
      '@itrtg-sim/core': resolve(dir, 'packages/core/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/sim/**', 'packages/core/src/constants/**'],
    },
  },
});
