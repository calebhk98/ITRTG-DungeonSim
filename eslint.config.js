// @ts-check
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },
  {
    files: ['packages/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { sourceType: 'module', ecmaVersion: 2022 },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Enforce engine-core purity: the core package must not depend on Node/DOM I/O.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'fs', message: 'core must stay I/O-free; do file access at the CLI/web edge.' },
            { name: 'node:fs', message: 'core must stay I/O-free; do file access at the CLI/web edge.' },
            { name: 'path', message: 'core must stay I/O-free.' },
            { name: 'node:path', message: 'core must stay I/O-free.' },
          ],
          patterns: ['node:*'],
        },
      ],
    },
  },
  {
    // Tests are not shipped runtime code — they may read fixtures via node:fs etc.
    files: ['packages/core/src/**/*.{test,spec}.ts'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
];
