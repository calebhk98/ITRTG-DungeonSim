import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/sim/**', 'packages/core/src/constants/**'],
    },
  },
});
